'use strict';

// ════════════════════════════════════════════════════════════════
// GENERAR — lanzar una generación y empujarla hasta el final.
//
// POR QUÉ ESTO NO ES «GENERA Y DEVUELVE»
//
// Una función de Vercel vive 60 segundos y deja de existir en cuanto
// contesta: no hay «segundo plano». Pero el trabajo no cabe en ese
// hueco por igual:
//
//   imagen    ~10-20 s   cabe entera en el POST
//   ambiente  instantáneo (síntesis local)  cabe entera en el POST
//   clip      MINUTOS    no cabe: Veo se LANZA y se PREGUNTA después
//   música    2-6 fragmentos de Lyria: no caben juntos, se hace uno
//             por petición y se guarda el avance
//
// De ahí el modelo de PASOS:
//
//   POST  deja constancia de la generación y arranca lo que quepa.
//   GET   mira en qué punto está y la EMPUJA un poco más. La interfaz
//         lo llama cada pocos segundos mientras el activo esté
//         «generating», así que cada llamada tiene que avanzar algo y
//         devolver el avance para que la pantalla se mueva.
//
// El estado intermedio del trabajo vive en `gen.trabajo`, dentro del
// proyecto: la siguiente petición cae en otra instancia, con otra
// memoria, y lo único compartido es el bucket.
//
// LO QUE ESTE ARCHIVO NO HACE, Y NO DEBE HACER NUNCA: aprobar. Una
// generación que termina bien aterriza en REVISIÓN y se queda ahí
// hasta que el usuario decida. Es la regla que sostiene el producto.
// ════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const { empezar, cuerpo, requerido, fallo, ErrorPeticion } = require('./_lib/http.js');
const { cfg, auth, gcsDelete } = require('./_lib/gcp.js');
const almacen = require('./_lib/almacen.js');
const dominio = require('./_lib/dominio.js');
const { canGenerate } = require('./_lib/progreso.js');
const vertex = require('./_lib/vertex.js');
const modelos = require('./_lib/modelos.js');
const audio = require('./_lib/audio.js');

// ─── Plazos ───
//
// Todos existen para que ninguna generación se quede «generando» para siempre:
// un activo atascado bloquea su etapa entera y el usuario no puede ni aprobarlo
// ni descartarlo, solo mirarlo girar.

// Veo tarda minutos y a veces bastantes. Este plazo no es «lo que tarda»: es
// «a partir de aquí seguro que algo se rompió».
const ESPERA_MAX_VIDEO_MS = 20 * 60 * 1000;

// La música son N llamadas a Lyria de una en una, empujadas por el latido de la
// interfaz. Si en veinte minutos no ha juntado sus fragmentos, no va a hacerlo.
const ESPERA_MAX_MUSICA_MS = 20 * 60 * 1000;

// Margen para una generación que consta como «generando» pero no ha llegado a
// apuntar ningún trabajo. Lo normal es que el POST siga corriendo (una imagen
// tarda hasta 20 s); pasado este rato, lo que pasó es que el POST murió al
// agotarse el tiempo de la función y no hay nada que esperar.
const GRACIA_SIN_TRABAJO_MS = 5 * 60 * 1000;

// Cada intento de fragmento de música es una llamada facturada a Lyria. Se
// reintenta, pero no indefinidamente. (El vídeo no lleva contador: ver
// `empujarVideo`.)
const TROPIEZOS_MAX_MUSICA = 3;

// La URL firmada que acompaña a la respuesta es para mirar la generación
// ahora mismo; la del proyecto la vuelve a firmar api/proyecto.js en cada
// lectura porque caduca.
const VIGENCIA_URL_SEG = 3600;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['GET', 'POST'])) return;

  try {
    if (req.method === 'POST') {
      const datos = await cuerpo(req);
      return await lanzar(res, texto(requerido(datos, 'id')), texto(requerido(datos, 'activo')));
    }
    const q = consulta(req);
    return await empujar(
      res,
      texto(requerido(q, 'id')),
      texto(requerido(q, 'activo')),
      texto(requerido(q, 'gen')),
    );
  } catch (e) {
    return fallo(res, e);
  }
};

const texto = (v) => String(v);

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
// POST — lanzar
// ---------------------------------------------------------------------------

async function lanzar(res, id, activoId) {
  const inicio = Date.now();

  // FASE 1 — dejar constancia. Es lo único que va dentro del candado: mientras
  // se escribe el proyecto nadie más puede tocarlo, así que aquí no puede haber
  // ni una llamada a Vertex. Si la hubiera, cada clip bloquearía el proyecto
  // entero durante minutos y el usuario no podría ni aprobar una imagen.
  const arranque = await almacen.modificarProyecto(id, (p) => {
    const activo = dominio.getAsset(p, activoId); // 404 si no existe
    const puerta = canGenerate(p, activo);
    // El motivo va tal cual como lo da progreso.js: ya está redactado para el
    // usuario y dice exactamente qué falta aprobar.
    if (!puerta.ok) throw new dominio.DomainError(puerta.reason, 409);
    const gen = dominio.startGeneration(p, activo, argumentosDe(p, activo));
    return { genId: gen.id };
  });

  const proyecto = arranque.proyecto;
  const genId = arranque.resultado.genId;
  const activo = dominio.getAsset(proyecto, activoId);
  const gen = generacionDe(activo, genId);

  let actualizado;
  try {
    // FASE 2 — el trabajo lento, FUERA del candado.
    switch (activo.kind) {
      case 'clip':
        actualizado = await arrancarClip(proyecto, activo, gen);
        break;
      case 'music':
        actualizado = await arrancarMusica(proyecto, activo, gen);
        break;
      case 'ambient':
        actualizado = await hacerAmbiente(proyecto, activo, gen, inicio);
        break;
      case 'master_character':
      case 'master_environment':
      case 'master_scene':
      case 'shot_image':
        actualizado = await hacerImagen(proyecto, activo, gen, inicio);
        break;
      default:
        throw new dominio.DomainError(`No sé generar un activo de tipo "${activo.kind}".`, 400);
    }
  } catch (e) {
    // La generación ya existe en el proyecto: dejarla «generando» para siempre
    // sería peor que marcarla fallida, porque su etapa quedaría bloqueada sin
    // que el usuario pueda hacer nada. Se anota el motivo y se propaga el error
    // para que la interfaz lo cuente.
    await anotarFallo(id, activoId, genId, motivoLegible(e));
    throw e;
  }

  return res.status(200).json(await instantanea(actualizado, activoId, genId));
}

/**
 * Los argumentos con los que nace la generación.
 *
 * El prompt NO se inventa aquí: ya viene escrito en el plan (`activo.spec`),
 * que es donde el director artístico dejó la continuidad. Lo único que se
 * decide en este momento es la semilla y qué referencias aprobadas hay.
 */
function argumentosDe(proyecto, activo) {
  const spec = activo.spec || {};
  const referenceAssetIds = (spec.referenceAssetIds || []).filter((rid) => {
    const dep = proyecto.assets.find((a) => a.id === rid);
    // Solo lo APROBADO cuenta como referencia (PRD §17). Una versión a medias
    // no puede fijar la continuidad de nada.
    return Boolean(dep && dominio.approvedFileOf(dep));
  });

  return {
    prompt: spec.prompt,
    negativePrompt: spec.negativePrompt,
    referenceAssetIds,
    provider: proveedorDe(proyecto, activo),
    // Semilla nueva en cada intento: regenerar tiene que dar algo distinto, o el
    // botón «Regenerar» no serviría de nada. Se guarda para poder repetirlo.
    seed: crypto.randomInt(1, 2147483646),
  };
}

/**
 * Quién generó esto, y con qué. Se guarda EN LA GENERACIÓN porque el modelo ya
 * no es una constante del despliegue: es una elección del corto, y dentro de un
 * mes hay que poder mirar una toma y saber con qué se hizo.
 */
function proveedorDe(proyecto, activo) {
  switch (activo.kind) {
    case 'clip':
      return { name: 'Veo', model: modeloVideoDe(proyecto).id };
    case 'music':
      return { name: 'Lyria', model: cfg.musicModel };
    case 'ambient':
      return { name: 'Síntesis local', model: 'audio.js' };
    default: {
      // El nombre del proveedor sigue a la familia del modelo: poner «Imagen»
      // encima de una toma hecha con un Nano Banana engañaría a quien luego
      // intente reproducirla.
      const m = modeloImagenDe(proyecto);
      return { name: modelos.esGemini(m.id) ? 'Gemini' : 'Imagen', model: m.id };
    }
  }
}

// ---------------------------------------------------------------------------
// El modelo del proyecto
// ---------------------------------------------------------------------------
//
// TODAS las generaciones de un mismo corto usan el mismo modelo. Se eligió al
// crearlo y vive en su configuración; cambiarlo a mitad de producción daría
// tomas que no encajan entre ellas, y la continuidad visual es lo que esta
// herramienta más cuida.
//
// Un proyecto creado antes de que esto se pudiera elegir no trae los campos:
// `modeloImagen`/`modeloVideo` devuelven entonces el por defecto, que es a
// propósito el mismo modelo con el que ese corto se venía generando.

function modeloImagenDe(proyecto) {
  return modelos.modeloImagen((proyecto.config || {}).imageModelId);
}

function modeloVideoDe(proyecto) {
  return modelos.modeloVideo((proyecto.config || {}).videoModelId);
}

// ---------------------------------------------------------------------------
// Imagen — cabe entera en el POST
// ---------------------------------------------------------------------------

async function hacerImagen(proyecto, activo, gen, inicio) {
  const { token, projectId } = await auth();
  const modelo = modeloImagenDe(proyecto);

  // Las referencias sólo se bajan si el modelo elegido va a usarlas: son hasta
  // cuatro imágenes del bucket, y traerlas para tirarlas gasta segundos de los
  // sesenta que tiene la función.
  const referencias = modelos.admiteReferencias(modelo.id)
    ? await bajarReferencias(token, proyecto, gen.referenceAssetIds)
    : [];

  let r;
  try {
    r = await vertex.generarImagen({
      token,
      projectId,
      modeloId: modelo.id,
      prompt: gen.prompt,
      negativePrompt: gen.negativePrompt,
      seed: gen.seed,
      referencias,
    });
  } catch (e) {
    throw prefijar(e, 'No se pudo generar la imagen');
  }

  const bytes = Buffer.from(r.base64, 'base64');
  const mimeType = r.mimeType || 'image/png';
  const ruta = almacen.rutaGeneracion(proyecto.id, activo, gen.index);
  await almacen.subirMedio(ruta, bytes, mimeType);

  return cerrar(proyecto.id, activo.id, gen.id, {
    path: ruta,
    bytes: bytes.length,
    mimeType,
  }, Date.now() - inicio);
}

/**
 * Las referencias aprobadas, ya en base64.
 *
 * Son LA continuidad: el personaje, el escenario y la escena que el usuario dio
 * por buenos. Se bajan del bucket porque el proyecto solo guarda su ruta.
 */
async function bajarReferencias(token, proyecto, ids) {
  const salida = [];
  for (const rid of (ids || []).slice(0, 4)) {
    const dep = proyecto.assets.find((a) => a.id === rid);
    const file = dep && dominio.approvedFileOf(dep);
    if (!file || !file.path) continue;
    const bytes = await bajarObjeto(token, cfg.bucket, file.path);
    salida.push({
      assetId: rid,
      base64: bytes.toString('base64'),
      mimeType: file.mimeType || 'image/png',
    });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Ambiente — síntesis local, instantánea
// ---------------------------------------------------------------------------

async function hacerAmbiente(proyecto, activo, gen, inicio) {
  const spec = activo.spec || {};
  const brief = (proyecto.plan && proyecto.plan.ambient) || {};
  const durationSec = Number(brief.durationSec || spec.durationSec || 60);

  let wav;
  try {
    wav = audio.renderAmbient({
      brief: {
        durationSec,
        layers: Array.isArray(brief.layers) && brief.layers.length ? brief.layers : ['ambiente neutro'],
        acoustics: brief.acoustics || 'natural',
      },
      seed: gen.seed,
    });
  } catch (e) {
    throw prefijar(e, 'No se pudo sintetizar el lecho ambiental');
  }

  const ruta = almacen.rutaGeneracion(proyecto.id, activo, gen.index);
  await almacen.subirMedio(ruta, wav, 'audio/wav');

  return cerrar(proyecto.id, activo.id, gen.id, {
    path: ruta,
    bytes: wav.length,
    mimeType: 'audio/wav',
    durationSec,
  }, Date.now() - inicio);
}

// ---------------------------------------------------------------------------
// Clip — se lanza aquí y se recoge en el GET
// ---------------------------------------------------------------------------

async function arrancarClip(proyecto, activo, gen) {
  const spec = activo.spec || {};
  const { token, projectId } = await auth();

  const idImagen = (activo.dependsOn && activo.dependsOn[0]) || `${activo.shotId}_image`;
  const activoImagen = proyecto.assets.find((a) => a.id === idImagen);
  const imagen = activoImagen && dominio.approvedFileOf(activoImagen);
  if (!imagen || !imagen.path) {
    // canGenerate ya lo impide, pero el clip es lo más caro del proyecto: antes
    // fallar aquí que pagarle a Veo una animación de la imagen equivocada.
    throw new dominio.DomainError(
      'La imagen aprobada de esta toma no está disponible, así que el clip no puede empezar donde debe.',
      409,
    );
  }
  const imagenBytes = await bajarObjeto(token, cfg.bucket, imagen.path);

  // EL FOTOGRAMA FINAL. Si la toma siguiente ya tiene imagen aprobada, el clip
  // termina exactamente donde empieza la siguiente y el corte deja de notarse.
  // Si no la hay todavía, se genera sin él: es una mejora, no un requisito.
  const final = fotogramaFinalDe(proyecto, activo);
  let finalBytes = null;
  if (final) finalBytes = await bajarObjeto(token, cfg.bucket, final.file.path);

  let r;
  try {
    r = await vertex.iniciarVideo({
      token,
      projectId,
      modeloId: modeloVideoDe(proyecto).id,
      prompt: gen.prompt,
      negativePrompt: gen.negativePrompt,
      imagenBase64: imagenBytes.toString('base64'),
      imagenMime: imagen.mimeType || 'image/png',
      fotogramaFinalBase64: finalBytes ? finalBytes.toString('base64') : undefined,
      fotogramaFinalMime: final ? final.file.mimeType || 'image/png' : undefined,
      durationSec: spec.durationSec,
      // Veo escribe el MP4 directamente en el bucket: así el vídeo no pasa
      // nunca por una función de Vercel, que no puede devolver algo tan grande.
      bucket: cfg.bucket,
      prefijo: cfg.prefix,
    });
  } catch (e) {
    throw prefijar(e, 'No se pudo lanzar el clip');
  }

  // A partir de aquí hay una operación de Veo corriendo y facturándose. Lo que
  // queda es apuntarla; si esta escritura fallara, el clip seguiría generándose
  // en Google sin que nadie lo recoja — de ahí que sea lo primero que se hace
  // después de la llamada y nada más.
  const anotado = await anotar(proyecto.id, (p) => {
    const a = dominio.getAsset(p, activo.id);
    const g = generacionDe(a, gen.id);
    if (g.status !== 'generating') return;
    g.trabajo = {
      tipo: 'video',
      operationName: r.operationName,
      modelo: r.modelo,
      durationSec: r.durationSec,
      interpolado: Boolean(r.interpolado),
      fotogramaFinalDe: final ? final.assetId : null,
      desde: Date.now(),
    };
    if (r.aviso) {
      g.aviso = r.aviso;
      // Al registro de actividad: el usuario tiene que poder entender por qué
      // este corte se nota más que los otros.
      dominio.makeEventAndPush(p, 'generation_started', `${a.label}: ${r.aviso}`, {
        assetId: a.id,
        generationId: g.id,
        stage: a.stage,
      });
    }
  });

  return anotado;
}

/**
 * La imagen aprobada de la toma SIGUIENTE, si sirve como fotograma final.
 *
 * Solo para el ÚLTIMO clip de una toma: los clips intermedios continúan dentro
 * de la misma toma y comparten su imagen, así que pasarles esa misma imagen
 * como final le pediría a Veo que volviera al punto de partida — el movimiento
 * de cámara se quedaría congelado.
 */
function fotogramaFinalDe(proyecto, activo) {
  const tomas = (proyecto.plan && proyecto.plan.shots) || [];
  const i = tomas.findIndex((s) => s.id === activo.shotId);
  if (i < 0) return null;

  const clips = tomas[i].clips || [];
  if (clips.length && clips[clips.length - 1].id !== activo.id) return null;

  const siguiente = tomas[i + 1];
  if (!siguiente) return null;

  const assetId = `${siguiente.id}_image`;
  const dep = proyecto.assets.find((a) => a.id === assetId);
  const file = dep && dominio.approvedFileOf(dep);
  return file && file.path ? { assetId, file } : null;
}

// ---------------------------------------------------------------------------
// Música — un fragmento por petición
// ---------------------------------------------------------------------------

/**
 * El POST hace el PRIMER fragmento y apunta cuántos faltan.
 *
 * Hacer uno aquí y no ninguno no es capricho: así el usuario ve avance nada más
 * pulsar, y el resto lo empuja el latido de la interfaz. Hacerlos todos no cabe
 * en 60 segundos ni de lejos.
 */
async function arrancarMusica(proyecto, activo, gen) {
  const spec = activo.spec || {};
  const durationSec = Number(spec.durationSec || (proyecto.plan && proyecto.plan.music && proyecto.plan.music.durationSec) || 60);
  const fragmentos = vertex.fragmentosNecesarios(durationSec);

  const registrado = await anotar(proyecto.id, (p) => {
    const a = dominio.getAsset(p, activo.id);
    const g = generacionDe(a, gen.id);
    if (g.status !== 'generating') return;
    g.trabajo = { tipo: 'musica', fragmentos, hechos: [], durationSec, tropiezos: 0, desde: Date.now() };
  });

  return hacerFragmento(registrado, activo.id, gen.id, 1);
}

/** Genera el fragmento `indice`, lo guarda en el bucket y apunta el avance. */
async function hacerFragmento(proyecto, activoId, genId, indice) {
  const activo = dominio.getAsset(proyecto, activoId);
  const gen = generacionDe(activo, genId);
  const { token, projectId } = await auth();

  let r;
  try {
    r = await vertex.generarMusica({
      token,
      projectId,
      prompt: gen.prompt,
      negativePrompt: gen.negativePrompt,
      // Una semilla por fragmento: con la misma, Lyria devolvería seis veces el
      // mismo trozo y la pieza sonaría a bucle.
      seed: (gen.seed + indice * 7919) % 2147483646,
    });
  } catch (e) {
    throw prefijar(e, `No se pudo componer el fragmento ${indice}`);
  }

  const bytes = Buffer.from(r.base64, 'base64');
  const ruta = almacen.rutaGeneracion(proyecto.id, activo, gen.index, sufijoFragmento(indice));
  await almacen.subirMedio(ruta, bytes, 'audio/wav');

  // El avance se guarda en el bucket y en el proyecto porque la petición que
  // haga el fragmento siguiente será otra, en otra instancia: aquí no hay
  // memoria que compartir.
  return anotar(proyecto.id, (p) => {
    const a = dominio.getAsset(p, activoId);
    const g = generacionDe(a, genId);
    if (!g.trabajo || g.trabajo.tipo !== 'musica') return;
    const hechos = g.trabajo.hechos || (g.trabajo.hechos = []);
    // Dos pestañas abiertas pueden pedir el mismo fragmento a la vez; el
    // archivo se sobreescribe solo, pero la lista no debe duplicarse.
    if (!hechos.some((h) => h.indice === indice)) hechos.push({ indice, ruta, bytes: bytes.length });
    hechos.sort((x, y) => x.indice - y.indice);
  });
}

const sufijoFragmento = (indice) => '_f' + String(indice).padStart(2, '0') + '.wav';

/** El primer hueco de 1..total que todavía no está hecho. */
function siguienteFragmento(hechos, total) {
  const puestos = new Set((hechos || []).map((h) => h.indice));
  for (let i = 1; i <= total; i += 1) if (!puestos.has(i)) return i;
  return null;
}

/**
 * Todos los fragmentos hechos: se bajan, se unen y se cierra la generación.
 *
 * Va en su propia petición, separada de la que genera el último fragmento:
 * bajar seis WAV, encadenarlos y subir el resultado ya se come buena parte de
 * los 60 segundos, y sumarle una llamada a Lyria delante sería quedarse a
 * medias justo al final.
 */
async function unirYCerrar(proyecto, activo, gen) {
  const t = gen.trabajo;
  const { token } = await auth();

  const trozos = [];
  for (const h of t.hechos) trozos.push(await bajarObjeto(token, cfg.bucket, h.ruta));

  let wav;
  try {
    wav = audio.unirFragmentos(trozos, {
      duracionSec: t.durationSec,
      // Sin fundido de salida el recorte a la duración exacta se oye como un
      // golpe seco, porque corta el audio por donde toca y no por un silencio.
      fadeInSec: 0.6,
      fadeOutSec: 2,
    });
  } catch (e) {
    throw prefijar(e, 'No se pudieron unir los fragmentos de la música');
  }

  const ruta = almacen.rutaGeneracion(proyecto.id, activo, gen.index);
  await almacen.subirMedio(ruta, wav, 'audio/wav');

  const actualizado = await cerrar(proyecto.id, activo.id, gen.id, {
    path: ruta,
    bytes: wav.length,
    mimeType: 'audio/wav',
    durationSec: t.durationSec,
  }, Date.now() - Date.parse(gen.createdAt || new Date().toISOString()));

  // Los parciales ya no le sirven a nadie. Se borran al final y sin darle
  // importancia: si alguno se queda, cuesta céntimos y la pieza ya está.
  for (const h of t.hechos) {
    try { await gcsDelete(token, cfg.bucket, h.ruta); } catch (e) { /* da igual */ }
  }

  return actualizado;
}

// ---------------------------------------------------------------------------
// GET — empujar
// ---------------------------------------------------------------------------

async function empujar(res, id, activoId, genId) {
  const leido = await almacen.leerProyecto(id);
  if (!leido) throw new dominio.DomainError(`Proyecto no encontrado: ${id}`, 404);

  const proyecto = leido.proyecto;
  const activo = dominio.getAsset(proyecto, activoId); // 404 si no existe
  const gen = generacionDe(activo, genId); // 404 si no existe

  // Ya terminó (o la cerró otra petición): contestar lo que hay. La interfaz
  // pregunta en bucle y esta llamada tiene que ser inofensiva.
  if (gen.status !== 'generating') {
    return res.status(200).json(await instantanea(proyecto, activoId, genId));
  }

  const trabajo = gen.trabajo;
  let salida;

  if (!trabajo) salida = await empujarSinTrabajo(proyecto, activo, gen);
  else if (trabajo.tipo === 'video') salida = await empujarVideo(proyecto, activo, gen);
  else if (trabajo.tipo === 'musica') salida = await empujarMusica(proyecto, activo, gen);
  else {
    salida = {
      proyecto: await anotarFallo(id, activoId, genId, `Trabajo pendiente de tipo desconocido: ${trabajo.tipo}.`),
    };
  }

  return res.status(200).json(
    await instantanea(salida.proyecto || proyecto, activoId, genId, salida.progreso),
  );
}

/**
 * «Generando» pero sin nada apuntado.
 *
 * Casi siempre significa que el POST todavía está corriendo (una imagen tarda
 * hasta veinte segundos y el latido pregunta a los 800 ms). Pasado el margen de
 * gracia ya no: significa que el POST murió al agotarse el tiempo de la función
 * y este activo se quedaría girando para siempre.
 */
async function empujarSinTrabajo(proyecto, activo, gen) {
  const desde = Date.parse(gen.createdAt || '') || Date.now();
  const transcurrido = Date.now() - desde;

  if (transcurrido > GRACIA_SIN_TRABAJO_MS) {
    return {
      proyecto: await anotarFallo(
        proyecto.id, activo.id, gen.id,
        'La generación se interrumpió antes de arrancar, probablemente porque el servidor agotó su tiempo. Vuelve a generar.',
      ),
    };
  }

  return {
    progreso: {
      fase: 'preparando',
      texto: 'Preparando la generación…',
      transcurridoMs: transcurrido,
    },
  };
}

async function empujarVideo(proyecto, activo, gen) {
  const t = gen.trabajo;
  const transcurrido = Date.now() - (t.desde || Date.parse(gen.createdAt || '') || Date.now());
  const enCurso = (extra) => ({
    progreso: Object.assign({
      fase: 'video',
      texto: 'Veo está animando el clip. Suele tardar varios minutos.',
      transcurridoMs: transcurrido,
    }, extra || {}),
  });

  const { token, projectId } = await auth();

  let r;
  try {
    r = await vertex.consultarVideo({
      token,
      projectId,
      operationName: t.operationName,
      modelo: t.modelo,
    });
  } catch (e) {
    // Un fallo AL PREGUNTAR no dice nada del clip: la operación sigue viva en
    // Google y ya está pagada. Marcar la generación como fallida por un 503
    // pasajero tiraría a la basura minutos de trabajo que están en marcha, así
    // que aquí no se cuentan tropiezos: el único que corta es el reloj.
    if (transcurrido > ESPERA_MAX_VIDEO_MS) {
      return { proyecto: await anotarFallo(proyecto.id, activo.id, gen.id, motivoLegible(e)) };
    }
    return enCurso({ aviso: motivoLegible(e) });
  }

  if (!r.listo) {
    if (transcurrido > ESPERA_MAX_VIDEO_MS) {
      return {
        proyecto: await anotarFallo(
          proyecto.id, activo.id, gen.id,
          `Veo lleva ${Math.round(transcurrido / 60000)} minutos con este clip y no ha terminado. Vuelve a generarlo.`,
        ),
      };
    }
    // Una consulta que no cambia nada NO reescribe el proyecto: cada escritura
    // compite con las aprobaciones del usuario, y el latido pregunta cada pocos
    // segundos por cada clip en curso.
    return enCurso();
  }

  if (r.error) {
    return { proyecto: await anotarFallo(proyecto.id, activo.id, gen.id, r.error) };
  }

  // Listo: el MP4 se lleva a su sitio dentro del proyecto.
  const ruta = almacen.rutaGeneracion(proyecto.id, activo, gen.index);
  let bytes = 0;

  if (r.bucket && r.objeto) {
    // Copia del lado del servidor: el vídeo no baja a Vercel ni vuelve a subir.
    bytes = await copiarObjeto(token, r.bucket, r.objeto, cfg.bucket, ruta);
    if (r.bucket === cfg.bucket) {
      // La carpeta de trabajo de Veo se limpia: el mismo clip guardado dos
      // veces se paga dos veces.
      try { await gcsDelete(token, cfg.bucket, r.objeto); } catch (e) { /* da igual */ }
    }
  } else if (r.base64) {
    const buf = Buffer.from(r.base64, 'base64');
    await almacen.subirMedio(ruta, buf, 'video/mp4');
    bytes = buf.length;
  } else {
    return {
      proyecto: await anotarFallo(proyecto.id, activo.id, gen.id, 'Veo terminó pero no dejó ningún vídeo.'),
    };
  }

  const proyectoFinal = await cerrar(proyecto.id, activo.id, gen.id, {
    path: ruta,
    bytes,
    mimeType: 'video/mp4',
    durationSec: t.durationSec,
  }, Date.now() - (Date.parse(gen.createdAt || '') || Date.now()));

  return { proyecto: proyectoFinal };
}

async function empujarMusica(proyecto, activo, gen) {
  const t = gen.trabajo;
  const total = Number(t.fragmentos) || 1;
  const hechos = t.hechos || [];
  const transcurrido = Date.now() - (t.desde || Date.parse(gen.createdAt || '') || Date.now());

  if (transcurrido > ESPERA_MAX_MUSICA_MS) {
    return {
      proyecto: await anotarFallo(
        proyecto.id, activo.id, gen.id,
        `La música lleva ${Math.round(transcurrido / 60000)} minutos sin completarse (${hechos.length} de ${total} fragmentos). Vuelve a generarla.`,
      ),
    };
  }

  const siguiente = siguienteFragmento(hechos, total);

  // Todos hechos: toca unirlos y cerrar.
  if (siguiente === null) {
    const proyectoFinal = await unirYCerrar(proyecto, activo, gen);
    return { proyecto: proyectoFinal };
  }

  let actualizado;
  try {
    actualizado = await hacerFragmento(proyecto, activo.id, gen.id, siguiente);
  } catch (e) {
    // Cada intento es una llamada facturada a Lyria, así que aquí sí se cuentan
    // los tropiezos: un prompt que el filtro rechaza fallaría igual mil veces.
    return tropezarMusica(proyecto, activo, gen, motivoLegible(e));
  }

  const puestos = hechos.length + 1;
  return {
    proyecto: actualizado,
    progreso: {
      fase: puestos >= total ? 'uniendo' : 'musica',
      hechos: puestos,
      total,
      texto: puestos >= total
        ? 'Uniendo los fragmentos de la pieza…'
        : `Componiendo la música: ${puestos} de ${total} fragmentos.`,
      transcurridoMs: transcurrido,
    },
  };
}

async function tropezarMusica(proyecto, activo, gen, mensaje) {
  const previos = Number((gen.trabajo && gen.trabajo.tropiezos) || 0) + 1;

  if (previos >= TROPIEZOS_MAX_MUSICA) {
    return {
      proyecto: await anotarFallo(
        proyecto.id, activo.id, gen.id,
        `${mensaje} (falló ${previos} veces seguidas).`,
      ),
    };
  }

  const actualizado = await anotar(proyecto.id, (p) => {
    const a = dominio.getAsset(p, activo.id);
    const g = generacionDe(a, gen.id);
    if (!g.trabajo) return;
    g.trabajo.tropiezos = previos;
    g.trabajo.ultimoError = mensaje;
  });

  return {
    proyecto: actualizado,
    progreso: {
      fase: 'musica',
      hechos: ((gen.trabajo && gen.trabajo.hechos) || []).length,
      total: Number((gen.trabajo && gen.trabajo.fragmentos)) || 1,
      texto: 'Reintentando el fragmento que falló…',
      aviso: mensaje,
    },
  };
}

// ---------------------------------------------------------------------------
// Escrituras sobre el proyecto
// ---------------------------------------------------------------------------

/**
 * Cualquier cambio en el proyecto pasa por aquí, y por tanto por
 * `modificarProyecto`: lee, aplica y guarda con precondición, reintentando si
 * alguien escribió en medio. Sin eso, la aprobación que el usuario está dando
 * en otra pestaña mientras este clip termina desaparecería sin dejar rastro.
 *
 * `fn` puede ejecutarse varias veces, así que no puede hacer nada más que
 * tocar el objeto que recibe.
 */
async function anotar(id, fn) {
  const { proyecto } = await almacen.modificarProyecto(id, fn);
  return proyecto;
}

/** Cierra la generación: la deja EN REVISIÓN. Nunca aprobada. */
async function cerrar(id, activoId, genId, file, elapsedMs) {
  return anotar(id, (p) => {
    const activo = dominio.getAsset(p, activoId);
    const gen = generacionDe(activo, genId);
    // Otra petición pudo cerrarla ya (dos latidos a la vez); no se toca lo que
    // el usuario quizá esté revisando en este momento.
    if (gen.status !== 'generating') return;
    delete gen.trabajo;
    dominio.completeGeneration(p, activo, gen, file, Math.max(0, Math.round(elapsedMs || 0)));
  });
}

async function anotarFallo(id, activoId, genId, mensaje) {
  return anotar(id, (p) => {
    const activo = dominio.getAsset(p, activoId);
    const gen = generacionDe(activo, genId);
    if (gen.status !== 'generating') return;
    delete gen.trabajo;
    dominio.failGeneration(p, activo, gen, String(mensaje || 'Fallo desconocido').slice(0, 400));
  });
}

// ---------------------------------------------------------------------------
// Respuesta
// ---------------------------------------------------------------------------

/**
 * Lo que ve la interfaz: { gen, estado, progreso }.
 *
 * El `file` sale con URL FIRMADA: el material vive en un bucket privado y una
 * ruta gs:// no la sabe abrir ningún navegador. La URL no se guarda en el
 * proyecto porque caduca.
 */
async function instantanea(proyecto, activoId, genId, progreso) {
  const activo = dominio.getAsset(proyecto, activoId);
  const gen = (activo.generations || []).find((g) => g.id === genId) || null;

  let copia = null;
  if (gen) {
    copia = Object.assign({}, gen);
    // El estado interno del trabajo (nombre de la operación, rutas parciales) no
    // le sirve de nada a la interfaz y solo estorba en la respuesta.
    delete copia.trabajo;
    if (copia.file && copia.file.path) {
      copia.file = Object.assign({}, copia.file);
      try {
        copia.file.url = await almacen.urlFirmada(copia.file.path, { expiresSeconds: VIGENCIA_URL_SEG });
      } catch (e) {
        // Sin URL la interfaz recarga el proyecto y la obtiene de allí: no vale
        // la pena tirar una respuesta buena por no poder firmar.
      }
    }
  }

  return {
    gen: copia,
    estado: estadoDe(gen),
    progreso: progreso || progresoPorDefecto(gen),
    activo: {
      id: activo.id,
      label: activo.label,
      status: activo.status,
      locked: activo.locked,
      stale: Boolean(activo.stale),
      approvedGenerationId: activo.approvedGenerationId,
    },
  };
}

function estadoDe(gen) {
  if (!gen) return 'desconocido';
  switch (gen.status) {
    case 'review': return 'revision';
    case 'approved': return 'aprobada';
    case 'rejected': return 'descartada';
    case 'failed': return 'fallo';
    default: return 'generando';
  }
}

function progresoPorDefecto(gen) {
  if (!gen) return { fase: 'desconocida', texto: 'No hay ninguna generación con ese identificador.' };
  if (gen.status === 'review') {
    return {
      fase: 'revision',
      texto: 'Listo para revisar. No está aprobado: la decisión es tuya.',
      transcurridoMs: gen.elapsedMs || 0,
    };
  }
  if (gen.status === 'failed') return { fase: 'fallo', texto: gen.error || 'La generación falló.' };
  return { fase: 'generando', texto: 'Trabajando…' };
}

// ---------------------------------------------------------------------------
// Cloud Storage: lo que gcp.js no cubre
// ---------------------------------------------------------------------------

/** Baja un objeto del bucket como Buffer. */
async function bajarObjeto(token, bucket, objeto) {
  const url =
    'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket) +
    '/o/' + encodeURIComponent(objeto) + '?alt=media';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) {
    const detalle = (await r.text().catch(() => '')).slice(0, 200);
    throw new ErrorPeticion(
      r.status === 404 ? 404 : 502,
      `No se pudo leer del bucket el archivo "${objeto}": ${r.status} ${detalle}`,
    );
  }
  return Buffer.from(await r.arrayBuffer());
}

/**
 * Copia un objeto DENTRO de Google, sin traérselo.
 *
 * El clip que deja Veo pesa megas; bajarlo a la función y volver a subirlo
 * gastaría casi todo el tiempo disponible para no cambiar ni un byte. `rewrite`
 * lo hace en el lado del servidor y devuelve el tamaño final.
 */
async function copiarObjeto(token, bucketOrigen, objetoOrigen, bucketDestino, objetoDestino) {
  const base =
    'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucketOrigen) +
    '/o/' + encodeURIComponent(objetoOrigen) +
    '/rewriteTo/b/' + encodeURIComponent(bucketDestino) +
    '/o/' + encodeURIComponent(objetoDestino);

  let testigo = '';
  // Objetos grandes se copian por tramos y hay que insistir con el testigo que
  // devuelve Google. Un clip de ocho segundos cabe en una sola pasada.
  for (let vuelta = 0; vuelta < 20; vuelta += 1) {
    const r = await fetch(base + (testigo ? '?rewriteToken=' + encodeURIComponent(testigo) : ''), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) {
      const detalle = (await r.text().catch(() => '')).slice(0, 200);
      throw new ErrorPeticion(502, `No se pudo mover el clip a la carpeta del proyecto: ${r.status} ${detalle}`);
    }
    const d = await r.json().catch(() => ({}));
    if (d.done) return Number((d.resource && d.resource.size) || d.objectSize || 0);
    testigo = d.rewriteToken || '';
    if (!testigo) throw new ErrorPeticion(502, 'La copia del clip se quedó a medias.');
  }
  throw new ErrorPeticion(504, 'La copia del clip está tardando demasiado; se reintentará en la siguiente consulta.');
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function generacionDe(activo, genId) {
  const gen = (activo.generations || []).find((g) => g.id === genId);
  if (!gen) throw new dominio.DomainError(`Generación desconocida: ${genId}`, 404);
  return gen;
}

/** Añade contexto al mensaje de un error sin perder su código HTTP. */
function prefijar(e, contexto) {
  const mensaje = `${contexto}: ${(e && e.message) || 'error desconocido'}`;
  const salida = new Error(mensaje);
  salida.status = (e && e.status) || 502;
  if (e && e.configError) salida.configError = true;
  salida.stack = (e && e.stack) || salida.stack;
  return salida;
}

const motivoLegible = (e) => String((e && e.message) || e || 'Fallo desconocido').slice(0, 400);
