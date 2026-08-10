'use strict';

// ════════════════════════════════════════════════════════════════
// MONTAR — juntar en una sola película todo lo que el usuario aprobó.
//
//   POST { id }            lanza el montaje  ->  { job, estado }
//   GET  ?id=&job=         pregunta en qué punto va
//
// POR QUÉ SON DOS PETICIONES Y NO UNA
//
// El montaje son minutos de ffmpeg y aquí sólo hay 60 segundos. Así que el
// POST prepara el encargo, se lo pasa a Cloud Build (ver _lib/montaje.js) y
// contesta enseguida con el identificador del trabajo. El GET es el que
// pregunta después, tantas veces como haga falta.
//
// El identificador y la carpeta del trabajo se APUNTAN EN EL PROYECTO, no se
// quedan en la memoria de la función: la siguiente petición cae en otra
// instancia, y el usuario puede cerrar la pestaña, apagar el móvil y volver
// mañana. Lo único compartido es el bucket.
//
// LO QUE ESTE ARCHIVO NO HACE: aprobar. Cuando el montaje termina bien, la
// previsualización queda EN REVISIÓN. El MP4 final sale de /api/entrega, y
// sólo después de que el usuario haya visto el corte entero y lo apruebe.
// ════════════════════════════════════════════════════════════════

const { empezar, cuerpo, requerido, fallo, ErrorPeticion } = require('./_lib/http.js');
const { cfg, auth, gcsList, loadServiceAccount, signedUrl } = require('./_lib/gcp.js');
const almacen = require('./_lib/almacen.js');
const dominio = require('./_lib/dominio.js');
const { computeProductionStatus, hasApprovedVersion, formatTimecode } = require('./_lib/progreso.js');
const { lanzarMontaje, estadoMontaje } = require('./_lib/montaje.js');
const { formato } = require('./_lib/constantes.js');

// Cuántos nombres caben en un mensaje de error antes de que deje de leerse en
// un móvil. Los que no caben se cuentan, y la lista entera va en `detalle`.
const NOMBRES_EN_EL_MENSAJE = 8;

// A partir de aquí un montaje «en curso» ya no lo está: Cloud Build corta a los
// 30 minutos (timeout del build en _lib/montaje.js), así que pasado ese plazo
// con margen lo que hay es un trabajo que se perdió, no uno que va lento. Sin
// este plazo, un build desaparecido dejaría el proyecto en «montando» para
// siempre y el botón de montar bloqueado sin manera de recuperarlo.
const MONTAJE_ATASCADO_MS = 35 * 60 * 1000;

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['GET', 'POST'])) return;

  try {
    if (req.method === 'POST') {
      const datos = await cuerpo(req);
      return await lanzar(res, String(requerido(datos, 'id')).trim());
    }
    const q = consulta(req);
    const id = String(requerido(q, 'id')).trim();
    return await preguntar(res, id, String(q.job || '').trim());
  } catch (e) {
    return fallo(res, e);
  }
};

/** La query. Vercel la trae parseada; fuera de Vercel se saca de la URL. */
function consulta(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const salida = {};
  try {
    const url = new URL(req.url || '/', 'http://local');
    url.searchParams.forEach((v, k) => { salida[k] = v; });
  } catch (e) {
    // Sin URL legible no hay parámetros; `requerido` dará el 400 con nombre.
  }
  return salida;
}

// ---------------------------------------------------------------------------
// POST — lanzar el montaje
// ---------------------------------------------------------------------------

async function lanzar(res, id) {
  const proyecto = await abrir(id);
  const corte = proyecto.finalCut || {};

  // Un montaje ya en marcha se devuelve tal cual en vez de lanzar otro. Cada
  // montaje enciende una máquina en Google y baja decenas de clips: un doble
  // toque en el botón no puede costar el doble ni dejar dos builds escribiendo
  // sobre el mismo MP4 a la vez.
  if (corte.status === 'building' && corte.job && !atascado(corte)) {
    return responder(res, 200, {
      job: corte.job,
      estado: 'montando',
      yaEnCurso: true,
      corte,
    });
  }

  // El montador SÓLO recibe material aprobado. Esta es la puerta donde se hace
  // cumplir la regla del producto en la última etapa: si algo no lo aprobó el
  // usuario, no entra en la película.
  comprobarTodoAprobado(proyecto);

  const entradas = armarEntradas(proyecto);
  const musica = pistaAprobada(proyecto, dominio.MUSIC_ASSET_ID, 'la música');
  const ambiente = pistaAprobada(proyecto, dominio.AMBIENT_ASSET_ID, 'el sonido ambiental');

  const { token, projectId } = await auth();

  // Carpeta propia por intento. Ahí dejará el montaje su script, su hoja de
  // encargo y su error.txt; compartirla entre intentos haría que la queja de
  // un montaje viejo se leyera como la del nuevo.
  const carpeta = almacen.rutaProyecto(id) + '/montajes/' + marcaDeTiempo() + '_' + dominio.shortId(6);
  const salida = almacen.rutaFinal(id, almacen.ARCHIVO_PREVISUALIZACION);

  // El lienzo del MP4 lo decide el formato con el que se creó el corto.
  const formatoId = (proyecto.config || {}).formatoId;
  const trabajo = await lanzarMontaje({
    formatoId,
    token,
    projectId,
    bucket: cfg.bucket,
    carpeta,
    entradas,
    musica,
    ambiente,
    salida,
  });

  // El trabajo caro ya está hecho y fuera del candado. Aquí sólo se anota el
  // resultado: `modificarProyecto` puede reintentar su función varias veces, y
  // lanzar el montaje dentro lanzaría varios montajes.
  const edl = construirEdl(proyecto);
  const builtFrom = instantaneaDeLoUsado(proyecto);
  const empezado = new Date().toISOString();

  const guardado = await almacen.modificarProyecto(id, (p) => {
    const previo = p.finalCut || {};
    p.finalCut = {
      status: 'building',
      job: trabajo.buildId,
      carpeta: trabajo.carpeta,
      salida: trabajo.salida,
      startedAt: empezado,
      // Con qué versión exacta de cada activo se montó. El dominio lo compara
      // al aprobar: si algo cambia después, el montaje se marca por rehacer.
      builtFrom,
      edl,
      // La previsualización y el MP4 anteriores se conservan a propósito: el
      // usuario sigue pudiendo ver el corte viejo mientras se rehace el nuevo.
      preview: previo.preview,
      export: previo.export,
      exportedAt: previo.exportedAt,
    };
    dominio.makeEventAndPush(
      p,
      'cut_started',
      `Montaje lanzado: ${entradas.length} cortes, ${Math.round(duracionDelPlan(p))} s.`,
    );
  });

  return responder(res, 202, {
    job: trabajo.buildId,
    estado: 'montando',
    corte: guardado.proyecto.finalCut,
  });
}

// ---------------------------------------------------------------------------
// GET — preguntar por un montaje ya lanzado
// ---------------------------------------------------------------------------

async function preguntar(res, id, jobPedido) {
  const proyecto = await abrir(id);
  const corte = proyecto.finalCut || {};
  const job = jobPedido || corte.job || '';

  // Sin trabajo que consultar no hay error que dar: simplemente no hay ningún
  // montaje en marcha. La interfaz pregunta en cada latido y un 400 aquí sería
  // una alarma roja por algo perfectamente normal.
  if (!job) {
    return responder(res, 200, { estado: 'inactivo', corte });
  }

  const { token, projectId } = await auth();
  const r = await estadoMontaje(token, projectId, job, cfg.bucket, corte.carpeta || '');

  if (r.estado === 'montando') {
    return responder(res, 200, { estado: 'montando', fase: r.fase, job, corte });
  }

  // 'desconocido' es un fallo al PREGUNTAR, no un fallo del montaje. El
  // proyecto no se toca: dar el montaje por muerto porque una consulta no
  // llegó tiraría a la basura un trabajo que probablemente sigue corriendo.
  if (r.estado === 'desconocido') {
    return responder(res, 200, { estado: 'desconocido', aviso: r.error, job, corte });
  }

  if (r.estado === 'fallo') {
    // El texto viene del error.txt que dejó el propio montaje en el bucket, y
    // es lo único legible desde un teléfono: se guarda y se devuelve TAL CUAL.
    const guardado = await almacen.modificarProyecto(id, (p) => {
      const c = p.finalCut || {};
      if (c.job !== job) return 'obsoleto';
      p.finalCut = Object.assign({}, c, { status: 'failed', error: r.error, finishedAt: new Date().toISOString() });
      dominio.makeEventAndPush(p, 'cut_failed', `El montaje falló: ${r.error}`);
      return 'anotado';
    });
    // Mismo cuidado que en la rama de éxito: si mientras se montaba se lanzó
    // otro montaje, este resultado ya no manda y devolver su finalCut daría
    // por fallido un montaje que puede estar yendo bien.
    if (guardado.resultado === 'obsoleto') {
      return responder(res, 200, {
        estado: 'obsoleto',
        aviso: 'Este montaje quedó anticuado porque se lanzó otro. Mira el que está en curso.',
        job,
        corte: guardado.proyecto.finalCut,
      });
    }
    return responder(res, 200, {
      estado: 'fallo',
      error: r.error,
      job,
      corte: guardado.proyecto.finalCut,
    });
  }

  // ─── Terminó bien ───

  const salida = corte.salida || almacen.rutaFinal(id, almacen.ARCHIVO_PREVISUALIZACION);
  const preview = {
    path: salida,
    bytes: await tamano(token, salida),
    mimeType: 'video/mp4',
    durationSec: duracionDelPlan(proyecto),
    width: formato((proyecto.config || {}).formatoId).ancho,
    height: formato((proyecto.config || {}).formatoId).alto,
  };
  const terminado = new Date().toISOString();

  const guardado = await almacen.modificarProyecto(id, (p) => {
    const c = p.finalCut || {};
    // Si el proyecto ya no reconoce este trabajo es que algo pasó mientras se
    // montaba: el usuario aprobó otra versión (y el dominio invalidó el corte)
    // o lanzó un montaje nuevo. Anotar esta película sería presentar como
    // válido un corte hecho con material que ya no manda.
    if (c.job !== job) return 'obsoleto';
    p.finalCut = Object.assign({}, c, {
      // REVISIÓN, nunca aprobado: el usuario tiene que ver el corte entero
      // antes de que exista un MP4 final.
      status: 'review',
      preview,
      builtAt: terminado,
      error: undefined,
    });
    dominio.makeEventAndPush(
      p,
      'cut_ready',
      'La previsualización está montada y esperando que la revises.',
    );
    return 'anotado';
  });

  if (guardado.resultado === 'obsoleto') {
    return responder(res, 200, {
      estado: 'obsoleto',
      aviso: 'Este montaje quedó anticuado porque el material cambió mientras se montaba. Vuelve a montar.',
      job,
      corte: guardado.proyecto.finalCut,
    });
  }

  // La URL firmada se calcula ahora y no se guarda nunca: caduca, y una URL
  // caducada escrita en el proyecto sería un vídeo que deja de verse sin que
  // nada haya cambiado.
  const conUrl = Object.assign({}, guardado.proyecto.finalCut);
  conUrl.preview = Object.assign({}, preview);
  // Una `url` vacía no se manda: la interfaz comprueba si existe para decidir
  // si pinta el reproductor, y una cadena vacía la haría pintar un vídeo roto.
  const url = firmar(salida);
  if (url) conUrl.preview.url = url;

  return responder(res, 200, {
    estado: 'listo',
    job,
    preview: conUrl.preview,
    corte: conUrl,
  });
}

// ---------------------------------------------------------------------------
// La puerta: nada entra en la película sin estar aprobado
// ---------------------------------------------------------------------------

/**
 * 409 nombrando lo que falta, uno a uno.
 *
 * «Faltan activos» no sirve de nada: el usuario tiene delante treinta tomas y
 * necesita saber a cuál ir. Los nombres son las etiquetas que ya ve en la
 * pantalla de producción, así que puede buscarlas tal cual.
 */
function comprobarTodoAprobado(proyecto) {
  if (computeProductionStatus(proyecto).readyForEdit) return;

  const faltan = (proyecto.assets || [])
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .filter((a) => !hasApprovedVersion(a) || a.stale)
    // Un activo desactualizado SÍ tiene versión aprobada, pero de algo que ya
    // cambió por debajo. Decir sólo su nombre haría que el usuario lo buscara
    // y lo viera en verde sin entender qué se le pide.
    .map((a) => (hasApprovedVersion(a) && a.stale ? `${a.label} (desactualizado)` : a.label));

  throw conDetalle(
    new ErrorPeticion(
      409,
      `El montaje sólo recibe material que hayas aprobado tú. Falta${faltan.length === 1 ? '' : 'n'} ` +
        `${faltan.length}: ${enumerar(faltan)}.`,
    ),
    { faltan },
  );
}

/**
 * La línea de tiempo, resuelta a objetos del bucket.
 *
 * Un mismo clip puede aparecer varias veces: el productor planifica la
 * reutilización a propósito. Aquí no es un caso especial — se repite la entrada
 * y ya está; `lanzarMontaje` baja cada archivo una sola vez.
 */
function armarEntradas(proyecto) {
  const timeline = (proyecto.plan && proyecto.plan.timeline) || [];
  if (!timeline.length) {
    throw new ErrorPeticion(409, 'El plan de este proyecto no tiene línea de tiempo: no hay nada que montar.');
  }

  const porId = new Map((proyecto.assets || []).map((a) => [a.id, a]));
  const entradas = [];
  const sinArchivo = [];

  for (const corte of timeline) {
    const idActivo = corte.clipAssetId || corte.clipId;
    const activo = porId.get(idActivo);
    if (!activo) {
      sinArchivo.push(`${idActivo} (no está en el proyecto)`);
      continue;
    }
    const archivo = dominio.approvedFileOf(activo);
    if (!archivo || !archivo.path) {
      sinArchivo.push(activo.label);
      continue;
    }
    entradas.push({
      objeto: archivo.path,
      durationSec: Number(corte.durationSec) || 0,
      transitionIn: corte.transitionIn || 'cut',
    });
  }

  if (sinArchivo.length) {
    // Se llega aquí con el proyecto «listo para montar»: el activo consta
    // aprobado pero su generación no tiene archivo. Es un estado roto, y
    // callarlo produciría una película con huecos.
    throw conDetalle(
      new ErrorPeticion(
        409,
        `Estos cortes no tienen vídeo aprobado que montar: ${enumerar(sinArchivo)}.`,
      ),
      { faltan: sinArchivo },
    );
  }

  return entradas;
}

/** El objeto del bucket de una pista aprobada (música o ambiente). */
function pistaAprobada(proyecto, idActivo, comoSeLlama) {
  const activo = (proyecto.assets || []).find((a) => a.id === idActivo);
  if (!activo) {
    throw new ErrorPeticion(409, `Este proyecto no tiene pista para ${comoSeLlama}.`);
  }
  const archivo = dominio.approvedFileOf(activo);
  if (!archivo || !archivo.path) {
    throw conDetalle(
      new ErrorPeticion(409, `Falta aprobar «${activo.label}»: sin ella no hay película que montar.`),
      { faltan: [activo.label] },
    );
  }
  return archivo.path;
}

// ---------------------------------------------------------------------------
// Piezas sueltas
// ---------------------------------------------------------------------------

async function abrir(id) {
  const leido = await almacen.leerProyecto(id);
  if (!leido) {
    throw new ErrorPeticion(404, `No existe ningún proyecto con el identificador "${id}".`);
  }
  return leido.proyecto;
}

/** La lista de cortes que la interfaz pinta debajo de la previsualización. */
function construirEdl(proyecto) {
  const timeline = (proyecto.plan && proyecto.plan.timeline) || [];
  const porId = new Map((proyecto.assets || []).map((a) => [a.id, a]));
  return timeline.map((corte, i) => {
    const idActivo = corte.clipAssetId || corte.clipId;
    const activo = porId.get(idActivo);
    return {
      index: corte.index === undefined ? i : corte.index,
      clipAssetId: idActivo,
      label: (activo && activo.label) || idActivo,
      startSec: Number(corte.startSec) || 0,
      durationSec: Number(corte.durationSec) || 0,
      timecode: formatTimecode(Number(corte.startSec) || 0),
      reused: !!corte.reused,
      transitionIn: corte.transitionIn || 'cut',
    };
  });
}

/**
 * Con qué generación exacta de cada activo se montó esta película.
 *
 * No es documentación: el dominio lo lee al aprobar algo nuevo para saber si el
 * montaje se quedó viejo. Sin esto, aprobar otra versión de una toma dejaría en
 * pantalla un corte que ya no corresponde a lo aprobado.
 */
function instantaneaDeLoUsado(proyecto) {
  const usados = {};
  for (const activo of proyecto.assets || []) {
    if (activo.approvedGenerationId) usados[activo.id] = activo.approvedGenerationId;
  }
  return usados;
}

/** Lo que dura la película según el plan: la suma de sus cortes. */
function duracionDelPlan(proyecto) {
  const timeline = (proyecto.plan && proyecto.plan.timeline) || [];
  const suma = timeline.reduce((total, c) => total + (Number(c.durationSec) || 0), 0);
  return suma || Number(proyecto.config && proyecto.config.durationSec) || 0;
}

/**
 * El tamaño del MP4 recién subido. Es informativo (la interfaz lo enseña junto
 * al vídeo), así que un fallo aquí no puede tirar abajo un montaje que salió
 * bien: se devuelve 0 y el vídeo se ve igual.
 */
async function tamano(token, ruta) {
  try {
    const items = await gcsList(token, cfg.bucket, ruta, { fields: 'items(name,size),nextPageToken' });
    const encontrado = items.find((i) => i.name === ruta);
    return encontrado ? Number(encontrado.size) || 0 : 0;
  } catch (e) {
    console.error('[montar] no se pudo medir', ruta, e && e.message);
    return 0;
  }
}

/** URL firmada de lectura, o vacía si la credencial no se puede cargar. */
function firmar(ruta) {
  try {
    return signedUrl(loadServiceAccount(), cfg.bucket, ruta);
  } catch (e) {
    // El montaje ya está guardado. Fallar ahora sería devolver un error por
    // algo que salió bien; la interfaz volverá a pedir el proyecto y allí se
    // firma otra vez.
    console.error('[montar] no se pudo firmar la previsualización:', e && e.message);
    return '';
  }
}

function atascado(corte) {
  const desde = Date.parse(corte.startedAt || '') || 0;
  // Sin marca de tiempo no se puede saber si va lento o si murió; se le da por
  // vivo, que es la opción que no gasta dinero de más.
  if (!desde) return false;
  return Date.now() - desde > MONTAJE_ATASCADO_MS;
}

/** "a, b, c y 4 más" — un mensaje que se pueda leer en un móvil. */
function enumerar(nombres) {
  const visibles = nombres.slice(0, NOMBRES_EN_EL_MENSAJE);
  const resto = nombres.length - visibles.length;
  return visibles.map((n) => `«${n}»`).join(', ') + (resto > 0 ? ` y ${resto} más` : '');
}

/** La lista completa viaja en `detalle`, que http.js sabe devolver. */
/**
 * Añade el detalle a un error.
 *
 * `detalle` tiene que ser TEXTO: la interfaz lo concatena tal cual al mensaje
 * (`msg += ' (' + e.detalle + ')'`), así que un objeto se pinta como
 * "[object Object]" y el usuario se queda sin saber qué falta. La lista con
 * los nombres viaja aparte, en `faltan`, por si algún día se quiere pintar
 * como lista de verdad.
 */
function conDetalle(error, extra) {
  const faltan = (extra && extra.faltan) || [];
  if (faltan.length) {
    error.detalle = faltan.join(', ');
    error.faltan = faltan;
  } else if (typeof extra === 'string') {
    error.detalle = extra;
  }
  return error;
}

function marcaDeTiempo() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function responder(res, status, cuerpoRespuesta) {
  // El estado del montaje cambia cada pocos segundos: si un intermediario lo
  // cachea, la interfaz se queda mirando un «montando» que ya terminó.
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(cuerpoRespuesta);
}
