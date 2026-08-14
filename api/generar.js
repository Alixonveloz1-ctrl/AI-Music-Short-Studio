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
//   clip      MINUTOS    no cabe: Veo se LANZA y se PREGUNTA después
//   música    una sola pieza de Lyria 3 Pro, hasta 184 s de una vez
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
const { cfg, auth, gcsDelete, gcsCopy, gcsDescargar } = require('./_lib/gcp.js');
const almacen = require('./_lib/almacen.js');
const dominio = require('./_lib/dominio.js');
const { canGenerate, computeProductionStatus } = require('./_lib/progreso.js');
const { paraEnviar } = require('./_lib/respuesta.js');
const vertex = require('./_lib/vertex.js');
const compositor = require('./_lib/compositor.js');
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
// La música es UNA llamada que tiene que caber en una función de 60 s. Si a
// los cuatro minutos no ha salido, no es que vaya lenta: es que cada intento se
// está muriendo. Veinte minutos era dejar al usuario media hora mirando una
// ruedecita, que es exactamente lo que pasó.
const ESPERA_MAX_MUSICA_MS = 4 * 60 * 1000;

// Salvo cuando la composición se le encargó a una máquina de Cloud Build, que
// es justo lo contrario: ahí no hay ninguna función muriéndose cada pocos
// segundos, hay un trabajo que tarda lo que tarda —hacer cola, arrancar la
// máquina y componer— y cortarlo a los cuatro minutos sería tirar a la basura
// lo único que sí iba a terminar.
const ESPERA_MAX_MUSICA_BUILD_MS = 20 * 60 * 1000;

// Margen para una generación que consta como «generando» pero no ha llegado a
// apuntar ningún trabajo. Lo normal es que el POST siga corriendo (una imagen
// tarda hasta 20 s); pasado este rato, lo que pasó es que el POST murió al
// agotarse el tiempo de la función y no hay nada que esperar.
const GRACIA_SIN_TRABAJO_MS = 5 * 60 * 1000;

// Cada intento de fragmento de música es una llamada facturada a Lyria. Se
// reintenta, pero no indefinidamente. (El vídeo no lleva contador: ver
// `empujarVideo`.)
const TROPIEZOS_MAX_MUSICA = 3;

// SALVO CUANDO EL FALLO ES EL RELOJ, que es otra cosa.
//
// Tres intentos valen para un error de verdad: si el prompt no le gusta a
// Google, fallará igual las tres veces. Pero cuando lo que pasa es que la
// respuesta no llegó a tiempo, el propio mensaje lo dice: el tiempo de Lyria
// varía mucho de una vez a otra. Ahí cada reintento es una tirada distinta, y
// rendirse a la tercera es rendirse pronto — sobre todo cuando lo único que
// hace falta es que una salga por debajo del minuto.
const TROPIEZOS_MAX_MUSICA_POR_RELOJ = 8;

/** ¿El fallo fue que no dio tiempo, y no que algo esté mal? */
function esFalloDeReloj(mensaje) {
  return /tardó más de|se corta a los|timeout|abort/i.test(String(mensaje || ''));
}

/** Cuántos intentos merece este fallo antes de darse por vencido. */
function topeDeTropiezos(mensaje) {
  return esFalloDeReloj(mensaje) ? TROPIEZOS_MAX_MUSICA_POR_RELOJ : TROPIEZOS_MAX_MUSICA;
}

// La URL firmada que acompaña a la respuesta es para mirar la generación
// ahora mismo; la del proyecto la vuelve a firmar api/proyecto.js en cada
// lectura porque caduca.
const VIGENCIA_URL_SEG = 3600;

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['GET', 'POST', 'DELETE'])) return;

  try {
    if (req.method === 'POST') {
      const datos = await cuerpo(req);
      return await lanzar(
        res,
        texto(requerido(datos, 'id')),
        texto(requerido(datos, 'activo')),
      );
    }
    if (req.method === 'DELETE') {
      const q = consulta(req);
      // Sin `activo` se paran TODAS las del corto: es el botón de emergencia
      // cuando hay varias en marcha y todas están chocando contra lo mismo.
      return await parar(
        res,
        texto(requerido(q, 'id')),
        q.activo ? texto(q.activo) : '',
        q.gen ? texto(q.gen) : '',
      );
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
        actualizado = await arrancarMusica(proyecto, activo, gen, inicio);
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
      // El modelo REAL, no el de la configuración: la ficha del activo decía
      // «lyria-002» mientras la llamada iba a Lyria 3 Pro, y eso convertía la
      // pantalla en una pista falsa a la hora de buscar el fallo.
      return { name: 'Lyria', model: vertex.MODELO_MUSICA_PRO };
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
    ? await bajarReferencias(token, proyecto, gen.referenceAssetIds, activo)
    : [];

  let r;
  try {
    r = await vertex.generarImagen({
      token,
      projectId,
      modeloId: modelo.id,
      formatoId: (proyecto.config || {}).formatoId,
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
async function bajarReferencias(token, proyecto, ids, activo) {
  const salida = [];
  for (const rid of (ids || []).slice(0, 4)) {
    const dep = proyecto.assets.find((a) => a.id === rid);
    const file = dep && dominio.approvedFileOf(dep);
    if (!file || !file.path) continue;
    const bytes = await bajarObjeto(token, cfg.bucket, file.path);
    salida.push({
      assetId: rid,
      rol: papelDeReferencia(activo, dep),
      base64: bytes.toString('base64'),
      mimeType: file.mimeType || 'image/png',
    });
  }
  return salida;
}

/**
 * PARA QUÉ se le adjunta esta referencia a esta generación.
 *
 * De aquí sale la frase que acompaña a la imagen, y esa frase decide el
 * resultado. El caso que lo destapó: al generar el retrato del intérprete 2 se
 * le adjunta el del intérprete 1, y con el texto genérico —«copia esta
 * identidad»— salían las dos músicas siendo la misma persona. Lo que hace falta
 * decirle ahí es lo contrario: que se parezca en el ESTILO y se diferencie en
 * la CARA.
 */
function papelDeReferencia(activo, referencia) {
  const suyo = activo && activo.kind;
  const otro = referencia && referencia.kind;

  // Un retrato mirando a otro retrato: son personas DISTINTAS del mismo grupo.
  if (suyo === 'master_character' && otro === 'master_character') return 'otroInterprete';
  if (otro === 'master_environment') return 'lugar';
  if (otro === 'master_scene') return 'escena';
  return 'identidad';
}

// ---------------------------------------------------------------------------
// Clip — se lanza aquí y se recoge en el GET
// ---------------------------------------------------------------------------

async function arrancarClip(proyecto, activo, gen, recorte) {
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
      formatoId: (proyecto.config || {}).formatoId,
      // Con `recorte`, el encargo va más corto y sin negativo: es el reintento
      // de cuando Google lo rechaza por «palabras sensibles» sin decir cuáles.
      prompt: recorte ? vertex.encargoMasCorto(gen.prompt, recorte) : gen.prompt,
      negativePrompt: recorte ? '' : gen.negativePrompt,
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
async function arrancarMusica(proyecto, activo, gen, inicio) {
  const spec = activo.spec || {};
  const durationSec = Number(spec.durationSec || (proyecto.plan && proyecto.plan.music && proyecto.plan.music.durationSec) || 60);
  const fragmentos = vertex.fragmentosNecesarios(durationSec);

  const registrado = await anotar(proyecto.id, (p) => {
    const a = dominio.getAsset(p, activo.id);
    const g = generacionDe(a, gen.id);
    if (g.status !== 'generating') return;
    g.trabajo = { tipo: 'musica', fragmentos, hechos: [], durationSec, tropiezos: 0, desde: Date.now() };
  });

  try {
    return await hacerFragmento(registrado, activo.id, gen.id, 1, inicio);
  } catch (e) {
    const mensaje = motivoLegible(e);
    // Si lo que falló fue el reloj —y no algo que esté mal— reintentar aquí es
    // volver a jugársela al mismo dado: esta función dura sesenta segundos y no
    // se puede alargar. Se le encarga a una máquina de Cloud Build y se vuelve
    // enseguida; el latido preguntará por ella.
    if (!esFalloDeReloj(mensaje)) throw e;
    const fresca = generacionDe(dominio.getAsset(registrado, activo.id), gen.id);
    const salida = await encargarComposicion(registrado, activo, fresca);
    return salida.proyecto;
  }
}

/**
 * Volver a lanzar el clip con el encargo recortado.
 *
 * POR QUÉ NO SE ARREGLA EN EL ENVÍO. Se intentó, y no servía: Veo ACEPTA el
 * envío, devuelve su operación como si todo fuera bien, y sólo al terminar dice
 * que el prompt llevaba palabras sensibles. Para cuando se sabe, esa operación
 * ya está cerrada y lo único que se puede hacer es lanzar otra.
 *
 * El recorte quita el prompt negativo y va cortando el encargo por el final,
 * donde están las listas largas. Se conserva siempre lo que describe la toma:
 * un clip generado con menos contexto es peor que uno completo, pero es
 * infinitamente mejor que ninguno.
 *
 * El contador vive en el trabajo, así que sobrevive a que la función muera
 * entre una consulta y la siguiente — que en Vercel es lo normal.
 */
async function relanzarMasCorto(proyecto, activo, gen, recorte) {
  try {
    await arrancarClip(proyecto, activo, gen, recorte);
  } catch (e) {
    return anotarFallo(proyecto.id, activo.id, gen.id, motivoLegible(e));
  }

  return anotar(proyecto.id, (p) => {
    const a = dominio.getAsset(p, activo.id);
    const g = generacionDe(a, gen.id);
    if (!g || !g.trabajo) return;
    g.trabajo.recortes = recorte;
    // Se le cuenta al usuario, porque un clip con menos contexto puede no
    // encajar con los demás y eso hay que mirarlo antes de aprobarlo.
    g.aviso = recorte === 1
      ? 'Google rechazó el encargo por las palabras que llevaba. Se ha vuelto a lanzar sin el ' +
        'prompt negativo. El resultado puede tener más defectos de lo normal.'
      : 'Google volvió a rechazarlo. Se ha lanzado con el encargo recortado, sin las notas de ' +
        'continuidad. Este clip puede no encajar del todo con los demás: compáralo antes de aprobarlo.';
  });
}

/** El trabajo apuntado en una generación, si lo tiene. */
function trabajoDe(gen) {
  return (gen && gen.trabajo) || null;
}

/** Genera el fragmento `indice`, lo guarda en el bucket y apunta el avance. */
/**
 * Lo que queda de los 60 segundos de la función, menos lo que hace falta
 * después para subir el audio y guardar el proyecto.
 *
 * Se calcula en vez de fijarse porque la petición ya ha gastado tiempo antes de
 * llegar aquí —leer el proyecto del bucket, escribir el registro de la
 * generación— y ese tiempo hay que descontarlo o la función muere igualmente,
 * que es justo lo que se quiere evitar.
 */
// LO QUE HAY QUE DEJAR LIBRE DESPUÉS DE LA LLAMADA, y por qué ahora es menos.
//
// Eran doce segundos, y era un margen de sobra: lo que queda por hacer es subir
// un archivo de audio de dos o tres megas al bucket y escribir el proyecto —
// cuestión de dos o tres segundos. Doce eran doce segundos que NO se le estaban
// dando a Lyria, y el usuario se quedó sin música por eso: «Google tardó más de
// 45 s en responder y la función de Vercel se corta a los 60».
//
// Seis deja margen de sobra para guardar y le devuelve a la composición todo lo
// demás. El tope de la función son sesenta segundos y en el plan gratuito de
// Vercel no se puede subir, así que cada segundo que no se reserva aquí es un
// segundo más de los que Lyria necesita.
const RESERVA_PARA_GUARDAR_MS = 6000;

function presupuestoRestante(inicio) {
  const gastado = Date.now() - (inicio || Date.now());
  return Math.max(8000, 59000 - gastado - RESERVA_PARA_GUARDAR_MS);
}

async function hacerFragmento(proyecto, activoId, genId, indice, inicio) {
  const activo = dominio.getAsset(proyecto, activoId);
  const gen = generacionDe(activo, genId);
  const { token, projectId } = await auth();

  let r;
  try {
    r = await vertex.generarMusica({
      token,
      projectId,
      // El encargo en inglés, que es el idioma que entiende Lyria. Los cortos
      // creados antes de esto no lo tienen: para esos, vertex.js traduce lo
      // que puede del español, que es peor pero genera.
      prompt: (activo.spec && activo.spec.promptEn) || gen.prompt,
      negativePrompt: gen.negativePrompt,
      // LA DURACIÓN VA AQUÍ Y ES LO MÁS IMPORTANTE DE ESTA LLAMADA. Lyria no
      // tiene ningún parámetro de duración: la única forma de pedir tres
      // minutos es la línea de tiempo que `vertex.js` escribe dentro del
      // prompt a partir de este número. Sin él, el modelo entrega treinta
      // segundos y el corto se queda sin música a los treinta segundos.
      segundos: (trabajoDe(gen) || {}).durationSec,
      // Los instrumentos que se VEN tocando: la línea de tiempo los necesita
      // para exigir que suenen desde el primer segundo.
      instrumentos: (proyecto.plan && proyecto.plan.music && proyecto.plan.music.instrumentationEn) || [],
      presupuestoMs: presupuestoRestante(inicio),
    });
  } catch (e) {
    throw prefijar(e, `No se pudo componer el fragmento ${indice}`);
  }

  const bytes = Buffer.from(r.base64, 'base64');
  // Qué formato traía el audio y cuál se le puso. Si la pieza vuelve a sonar
  // mal, esto es la mitad del diagnóstico y ahorra otra ronda de preguntas.
  if (r.formato) {
    await anotar(proyecto.id, (p) => {
      const a = dominio.getAsset(p, activoId);
      const g = generacionDe(a, genId);
      if (g && g.provider) g.provider.formato = r.formato;
    });
  }
  // La EXTENSIÓN Y EL TIPO REALES, mirados en los bytes por vertex.js. Guardar
  // un MP3 con nombre .wav y tipo audio/wav es lo que hacía que ni el navegador
  // ni ffmpeg supieran qué tenían delante.
  const ruta = almacen.rutaGeneracion(
    proyecto.id, activo, gen.index,
    sufijoFragmento(indice, r.extension || '.wav'),
  );
  await almacen.subirMedio(ruta, bytes, r.mimeType || 'audio/wav');

  // El avance se guarda en el bucket y en el proyecto porque la petición que
  // haga el fragmento siguiente será otra, en otra instancia: aquí no hay
  // memoria que compartir.
  return anotar(proyecto.id, (p) => {
    const a = dominio.getAsset(p, activoId);
    const g = generacionDe(a, genId);
    if (!g.trabajo || g.trabajo.tipo !== 'musica') return;
    // Se apunta si el material se puede editar y con qué tipo se guardó: el
    // paso de cerrar es otra petición, en otra instancia, y no tiene forma de
    // saberlo si no queda escrito aquí.
    g.trabajo.editable = r.editable !== false;
    g.trabajo.mimeType = r.mimeType || 'audio/wav';
    const hechos = g.trabajo.hechos || (g.trabajo.hechos = []);
    // Dos pestañas abiertas pueden pedir el mismo fragmento a la vez; el
    // archivo se sobreescribe solo, pero la lista no debe duplicarse.
    if (!hechos.some((h) => h.indice === indice)) hechos.push({ indice, ruta, bytes: bytes.length });
    hechos.sort((x, y) => x.indice - y.indice);
  });
}

// La extensión viene del formato REAL del audio, no de una constante: un MP3
// guardado como .wav no lo sabe abrir ni el navegador ni ffmpeg.
/** La extensión de una ruta, con el punto. Devuelve '.wav' si no la tiene. */
function extensionDeRuta(ruta) {
  const m = /(\.[a-z0-9]{2,5})$/i.exec(String(ruta || ''));
  return m ? m[1] : '.wav';
}

const sufijoFragmento = (indice, extension) =>
  '_f' + String(indice).padStart(2, '0') + (extension || '.wav');

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

  // Si el audio NO es WAV —Lyria puede devolver MP3, OGG o M4A— no se toca.
  //
  // Abrir un MP3 con un lector de WAV para ajustarle la duración y ponerle
  // fundidos es lo mismo que envolverlo en una cabecera falsa: se leen bytes
  // comprimidos como si fueran muestras y sale ruido. Y no hace falta: el
  // montaje mezcla con ffmpeg, que lee cualquiera de esos formatos y ya ajusta
  // la música al metraje. Los fundidos y la duración exacta son una mejora
  // agradable, no un requisito, y desde luego no valen romper la pieza.
  const primero = t.hechos[0];
  const editable = t.editable !== false && String(primero && primero.ruta).endsWith('.wav');

  if (!editable) {
    const ruta = almacen.rutaGeneracion(
      proyecto.id, activo, gen.index, extensionDeRuta(primero && primero.ruta),
    );
    await gcsCopy(token, cfg.bucket, primero.ruta, cfg.bucket, ruta);
    const actualizado = await cerrar(proyecto.id, activo.id, gen.id, {
      path: ruta,
      bytes: Number(primero.bytes) || 0,
      mimeType: t.mimeType || 'audio/mpeg',
      durationSec: t.durationSec,
    }, Date.now() - Date.parse(gen.createdAt || new Date().toISOString()));
    for (const h of t.hechos) {
      try { await gcsDelete(token, cfg.bucket, h.ruta); } catch (e) { /* da igual */ }
    }
    return actualizado;
  }

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

// ---------------------------------------------------------------------------
// DELETE — parar
// ---------------------------------------------------------------------------
//
// EL PROBLEMA, con las palabras del usuario: «la generación se reintenta
// automáticamente, pero si se mantiene fallando, yo no puedo pararla, así yo
// reinicie la página, se sigue reintentando».
//
// Y no había forma de pararla, porque lo que reintenta NO VIVE EN EL NAVEGADOR.
// Vive en el proyecto, en el bucket: mientras una generación esté en
// «generando», cualquier pestaña que abra el corto la empuja otra vez. Recargar
// no paraba nada — abría otro empujador. Y cada empujón contra Veo o contra
// Lyria se paga.
//
// Parar la cierra en el proyecto. A partir de ahí ninguna pestaña, ni ahora ni
// mañana, la va a volver a empujar; y el activo vuelve a poder generarse a mano
// cuando al usuario le dé la gana.

/** Lo que se le dice a cada tipo de activo cuando el usuario lo para. */
function motivoDeParada(kind) {
  if (kind === 'clip') {
    return 'Parada por ti. Veo ya había aceptado el encargo, así que ese intento se paga ' +
      'igual; lo que se ha parado es la espera y los reintentos automáticos.';
  }
  if (kind === 'music') {
    return 'Parada por ti. Ya no se va a reintentar sola: vuelve a generarla cuando quieras.';
  }
  return 'Parada por ti. Vuelve a generarla cuando quieras.';
}

async function parar(res, id, activoId, genId) {
  const leido = await almacen.leerProyecto(id);
  if (!leido) throw new dominio.DomainError(`Proyecto no encontrado: ${id}`, 404);

  // Se miran ANTES de tocar nada: hay trabajos con vida propia fuera de aquí
  // —una composición en una máquina de Cloud Build— y hay que decirles que
  // paren, o seguirían componiendo para nadie.
  const paraCancelar = [];
  for (const a of leido.proyecto.assets || []) {
    if (activoId && a.id !== activoId) continue;
    for (const g of a.generations || []) {
      if (g.status !== 'generating') continue;
      if (genId && g.id !== genId) continue;
      if (g.trabajo && g.trabajo.build && g.trabajo.build.id) paraCancelar.push(g.trabajo.build.id);
    }
  }

  const paradas = [];
  const proyecto = await anotar(id, (p) => {
    paradas.length = 0;
    for (const a of p.assets || []) {
      if (activoId && a.id !== activoId) continue;
      for (const g of a.generations || []) {
        if (g.status !== 'generating') continue;
        if (genId && g.id !== genId) continue;
        delete g.trabajo;
        dominio.stopGeneration(p, a, g, motivoDeParada(a.kind));
        paradas.push({ activo: a.id, label: a.label, gen: g.id });
      }
    }
  });

  // De mejor esfuerzo: si no se puede cancelar el trabajo de fuera, la
  // generación se queda parada igual. Lo que no puede pasar es lo contrario.
  if (paraCancelar.length) {
    try {
      const { token, projectId } = await auth();
      for (const b of paraCancelar) await compositor.cancelarComposicion(token, projectId, b);
    } catch (e) { /* la generación ya está parada, que es lo que importa */ }
  }

  // La interfaz repinta con lo que devuelve ESTA respuesta, y pinta cada medio
  // con `gen.file.url`: sin firmar aquí, parar dejaría la pantalla en blanco.
  res.setHeader('Cache-Control', 'no-store');
  const salida = paraEnviar(proyecto);
  return res.status(200).json({
    proyecto: salida,
    estado: computeProductionStatus(salida),
    paradas,
  });
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
    // ─── RECHAZADO POR LAS PALABRAS: SE VUELVE A LANZAR CON MENOS TEXTO ───
    //
    // Google dice que el encargo lleva palabras sensibles pero no dice cuáles.
    // Perseguirlas de una en una es un juego que paga el usuario con su tiempo,
    // y ya se le fueron dos tardes. Así que se reintenta solo, con el encargo
    // recortado por el final —que es donde están las listas largas y donde el
    // filtro encuentra más de lo que marcar— conservando siempre lo que
    // describe la toma.
    //
    // Se cuentan los recortes en el propio trabajo para no repetirlos sin fin:
    // dos, y si Google sigue sin querer, se le cuenta al usuario.
    const recortes = Number(t.recortes || 0);
    if (r.rechazoPorPalabras && recortes < 2) {
      return { proyecto: await relanzarMasCorto(proyecto, activo, gen, recortes + 1) };
    }
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
  const tope = t.build ? ESPERA_MAX_MUSICA_BUILD_MS : ESPERA_MAX_MUSICA_MS;

  if (transcurrido > tope) {
    return {
      proyecto: await anotarFallo(
        proyecto.id, activo.id, gen.id,
        `La música lleva ${Math.round(transcurrido / 60000)} minutos sin completarse (${hechos.length} de ${total} fragmentos). Vuelve a generarla.`,
      ),
    };
  }

  // La composición está en manos de una máquina de Cloud Build: aquí sólo se
  // pregunta si terminó. Ninguna llamada a Lyria sale ya de esta función.
  if (t.build) return seguirComposicion(proyecto, activo, gen);

  const siguiente = siguienteFragmento(hechos, total);

  // Todos hechos: toca unirlos y cerrar.
  if (siguiente === null) {
    try {
      const proyectoFinal = await unirYCerrar(proyecto, activo, gen);
      return { proyecto: proyectoFinal };
    } catch (e) {
      // ESTE `catch` FALTABA, Y ESO HIZO INVISIBLE UN FALLO REAL. Lyria devolvía
      // PCM crudo guardado como si fuera WAV, y aquí se rechazaba con un
      // mensaje perfectamente claro que nadie llegaba a ver: el error subía sin
      // que se apuntara en la generación, la petición devolvía un 500 que la
      // interfaz descartaba, el activo seguía en «generando» y el latido volvía
      // a intentarlo. Cuatro minutos de ruedecita hasta que saltaba el
      // vigilante, con la causa escrita y tirada a la basura en cada vuelta.
      //
      // Unir tampoco se reintenta: si el material guardado no se puede abrir,
      // no se va a poder abrir dentro de cinco segundos.
      return {
        proyecto: await anotarFallo(proyecto.id, activo.id, gen.id, motivoLegible(e)),
      };
    }
  }

  let actualizado;
  try {
    actualizado = await hacerFragmento(proyecto, activo.id, gen.id, siguiente, Date.now());
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

const AVISO_COMPONIENDO_FUERA =
  'La pieza no cabía en el minuto que dura una función de Vercel, así que se está ' +
  'componiendo en una máquina de Google que no tiene ese límite. Tarda unos minutos ' +
  'más y no hay que hacer nada: la página lo va comprobando sola.';

/**
 * Encarga la pieza a una máquina de Cloud Build y vuelve enseguida.
 *
 * A partir de aquí esta generación ya no llama a Lyria desde Vercel: el latido
 * pregunta por el trabajo y punto. Es lo que hace que una pieza de tres minutos
 * —que no cabe en sesenta segundos ninguna vez— se pueda componer.
 */
async function encargarComposicion(proyecto, activo, gen) {
  const { token, projectId, sa } = await auth();
  const t = gen.trabajo || {};

  const encargo = vertex.encargoMusica({
    projectId,
    // El mismo encargo que se le habría mandado desde aquí, letra por letra.
    prompt: (activo.spec && activo.spec.promptEn) || gen.prompt,
    segundos: t.durationSec,
    instrumentos: (proyecto.plan && proyecto.plan.music && proyecto.plan.music.instrumentationEn) || [],
  });

  // Carpeta propia, aparte de la del activo: aquí dentro va el papeleo del
  // encargo —lo que se pidió, lo que contestó Google, el motivo si falla— y no
  // debe confundirse con las pistas de música del corto.
  const carpeta = almacen.rutaProyecto(proyecto.id) +
    '/composiciones/' + Date.now().toString(36) + '_' + dominio.shortId(6);

  const { buildId } = await compositor.lanzarComposicion({
    token,
    projectId,
    // Con la MISMA cuenta que usa Vercel: así hereda el permiso de llamar a
    // Lyria y no hay que tocar nada en la consola de Google.
    cuentaEmail: sa.client_email,
    bucket: cfg.bucket,
    carpeta,
    url: encargo.url,
    cuerpo: encargo.cuerpo,
  });

  const actualizado = await anotar(proyecto.id, (p) => {
    const a = dominio.getAsset(p, activo.id);
    const g = generacionDe(a, gen.id);
    if (!g.trabajo || g.trabajo.tipo !== 'musica') return;
    g.trabajo.build = { id: buildId, carpeta, desde: Date.now() };
    g.trabajo.desde = Date.now();
    // Se le cuenta al usuario, o vería una espera mucho más larga de lo normal
    // sin ninguna explicación.
    g.aviso = AVISO_COMPONIENDO_FUERA;
  });

  return {
    proyecto: actualizado,
    progreso: {
      fase: 'musica',
      hechos: (t.hechos || []).length,
      total: Number(t.fragmentos) || 1,
      texto: 'Componiendo la música en una máquina de Google…',
      aviso: AVISO_COMPONIENDO_FUERA,
    },
  };
}

/** ¿Terminó ya la máquina? Y si terminó, guardar lo que dejó. */
async function seguirComposicion(proyecto, activo, gen) {
  const t = gen.trabajo;
  const b = t.build || {};
  const { token, projectId } = await auth();

  let r;
  try {
    r = await compositor.estadoComposicion(token, projectId, b.id, cfg.bucket, b.carpeta);
  } catch (e) {
    // Una consulta que falla no es la composición fallando: se vuelve a mirar
    // en el siguiente latido.
    r = { estado: 'desconocido', error: motivoLegible(e) };
  }

  if (r.estado === 'componiendo' || r.estado === 'desconocido') {
    return {
      proyecto,
      progreso: {
        fase: 'musica',
        hechos: (t.hechos || []).length,
        total: Number(t.fragmentos) || 1,
        texto: r.fase === 'en cola'
          ? 'La composición está en cola en Google…'
          : 'Componiendo la música en una máquina de Google…',
        transcurridoMs: Date.now() - (b.desde || Date.now()),
      },
    };
  }

  if (r.estado === 'fallo') {
    return { proyecto: await anotarFallo(proyecto.id, activo.id, gen.id, r.error) };
  }

  // Terminó bien. Qué es lo que dejó se decide con la MISMA tabla de firmas de
  // siempre, mirando sólo los primeros bytes: el archivo entero puede ser de
  // treinta megas y no hace falta bajárselo para saber qué es.
  const q = vertex.reconocerAudio(Buffer.from(r.cabeceraHex || '', 'hex'), r.mimeType);
  const ruta = almacen.rutaGeneracion(
    proyecto.id, activo, gen.index, sufijoFragmento(1, q.extension),
  );

  let tamano = 0;
  if (q.intacto) {
    // No hay que tocarle ni un byte: se copia dentro del propio bucket, sin
    // pasar por aquí. Bajar y volver a subir treinta megas dentro de una
    // función que se corta al minuto es volver a tener el problema de siempre.
    tamano = await gcsCopy(token, cfg.bucket, r.objeto, cfg.bucket, ruta, q.tipo);
  } else {
    // WAV o PCM crudo: hay que arreglarle la cabecera, así que sí se baja. Un
    // WAV que necesita ese arreglo lo trae mal declarado, no grande.
    const crudo = await bajarObjeto(token, cfg.bucket, r.objeto);
    const listo = vertex.prepararAudio(crudo, r.mimeType, t.durationSec);
    await almacen.subirMedio(ruta, listo.bytes, listo.tipo);
    tamano = listo.bytes.length;
  }

  const actualizado = await anotar(proyecto.id, (p) => {
    const a = dominio.getAsset(p, activo.id);
    const g = generacionDe(a, gen.id);
    if (g && g.provider) g.provider.formato = q.descripcion;
    if (!g.trabajo || g.trabajo.tipo !== 'musica') return;
    g.trabajo.editable = q.editable !== false;
    g.trabajo.mimeType = q.tipo;
    g.trabajo.build = null;
    const hechos = g.trabajo.hechos || (g.trabajo.hechos = []);
    if (!hechos.some((h) => h.indice === 1)) hechos.push({ indice: 1, ruta, bytes: tamano });
  });

  // El siguiente latido encuentra el fragmento hecho y cierra la pieza. No se
  // hace aquí: unir y cerrar es trabajo de su propia petición.
  return {
    proyecto: actualizado,
    progreso: {
      fase: 'uniendo',
      hechos: 1,
      total: Number(t.fragmentos) || 1,
      texto: 'Uniendo los fragmentos de la pieza…',
    },
  };
}

async function tropezarMusica(proyecto, activo, gen, mensaje) {
  // EL RELOJ NO SE ARREGLA REINTENTANDO EN EL MISMO SITIO. Si la pieza no cupo
  // en el minuto de la función, volver a pedirla desde la función es volver a
  // jugársela al mismo dado. La primera vez que pasa se le encarga el trabajo a
  // una máquina de Cloud Build, que no tiene ese límite; los reintentos de aquí
  // se quedan para lo que sí puede salir bien a la segunda.
  if (esFalloDeReloj(mensaje) && !(gen.trabajo && gen.trabajo.build)) {
    try {
      return await encargarComposicion(proyecto, activo, gen);
    } catch (e) {
      // Si no se pudo ni lanzar —falta un permiso, la API está apagada—, se
      // sigue contando el tropiezo con el motivo delante, para que se lea.
      mensaje = motivoLegible(e) + ' El intento anterior fue: ' + mensaje;
    }
  }

  const previos = Number((gen.trabajo && gen.trabajo.tropiezos) || 0) + 1;
  const tope = topeDeTropiezos(mensaje);

  if (previos >= tope) {
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
const bajarObjeto = gcsDescargar;

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

// Se exponen para las pruebas.
module.exports.presupuestoRestante = presupuestoRestante;
module.exports.esFalloDeReloj = esFalloDeReloj;
module.exports.topeDeTropiezos = topeDeTropiezos;
module.exports.TROPIEZOS_MAX_MUSICA = TROPIEZOS_MAX_MUSICA;
module.exports.TROPIEZOS_MAX_MUSICA_POR_RELOJ = TROPIEZOS_MAX_MUSICA_POR_RELOJ;
