// ════════════════════════════════════════════════════════════════
// VERTEX AI — imagen, vídeo y música.
//
//   Imagen  ·  :predict               responde en el momento
//   Veo     ·  :predictLongRunning    devuelve una operación y se pregunta
//   Lyria   ·  :predict               responde un fragmento de ~30 s
//
// TODO ESTO ESTÁ PENSADO PARA 60 SEGUNDOS. Una función de Vercel no
// puede esperar a Veo, que tarda minutos. Por eso el vídeo se lanza y
// se pregunta, y la música se genera por fragmentos: cada llamada hace
// un trozo y guarda el avance, en vez de intentarlo todo de una vez y
// morir a mitad sin dejar nada.
//
// El modelo que se configure es el que se usa. Si falla, se devuelve el
// error de Google tal cual: nunca se sustituye por otro a espaldas del
// usuario, porque entonces el corto sale distinto y nadie sabe por qué.
// ════════════════════════════════════════════════════════════════
const { cfg, vertexUrl } = require('./gcp');
const { OUTPUT_ASPECT_RATIO } = require('./constantes');

class ProveedorError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ProveedorError';
    this.status = status || 502;
  }
}

async function llamar(url, token, projectId, cuerpo) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      // Sin esta cabecera, la cuota se carga contra el proyecto del modelo y no
      // contra el del usuario; algunos modelos rechazan la llamada por eso.
      'X-Goog-User-Project': projectId,
    },
    body: JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let d = {};
  try { d = JSON.parse(texto); } catch (e) { /* respuesta no-JSON */ }

  if (!r.ok) {
    const msg = (d.error && (d.error.message || d.error.status)) || texto.slice(0, 300);
    throw new ProveedorError(traducir(r.status, msg), r.status);
  }
  return d;
}

/** Los rechazos de Vertex nombran cosas que no significan nada para el usuario. */
function traducir(status, msg) {
  const m = String(msg);
  if (/has not been used|SERVICE_DISABLED|is disabled/i.test(m)) {
    return 'la API de Vertex AI no está habilitada en este proyecto (aiplatform.googleapis.com). ' + m;
  }
  if (status === 403 && /permission|denied/i.test(m)) {
    return 'a la cuenta de servicio le falta el rol "Usuario de Vertex AI" (roles/aiplatform.user). ' + m;
  }
  if (status === 404 && /model|publisher/i.test(m)) {
    return 'ese modelo no existe o no está disponible en esta región para tu proyecto. ' +
      'Se puede cambiar con la variable correspondiente sin tocar el código. ' + m;
  }
  if (status === 429) {
    return 'Google está limitando las peticiones (cuota). Espera un momento y reintenta. ' + m;
  }
  if (/quota|Quota exceeded/i.test(m)) {
    return 'cuota agotada o a cero para este modelo. Revísala en IAM y administración → Cuotas. ' + m;
  }
  return m;
}

// ─── Imagen ───

/**
 * Genera una imagen. Devuelve los bytes en base64 — quien llama decide dónde
 * guardarlos, porque la ruta depende del proyecto y del activo.
 *
 * Las referencias aprobadas viajan solo si el modelo configurado sabe usarlas.
 * El resto de modelos reciben únicamente el prompt, que de todas formas ya
 * lleva dentro el contrato de continuidad completo.
 */
async function generarImagen(opciones) {
  const { token, projectId, prompt, negativePrompt, seed, referencias } = opciones;
  const modelo = cfg.imageModel;
  const instancia = { prompt: String(prompt).slice(0, 4000) };

  const admiteReferencias = /capability|customization/i.test(modelo);
  if (admiteReferencias && referencias && referencias.length) {
    instancia.referenceImages = referencias.slice(0, 4).map((ref, i) => ({
      referenceType: 'REFERENCE_TYPE_SUBJECT',
      referenceId: i + 1,
      referenceImage: { bytesBase64Encoded: ref.base64 },
    }));
  }

  const parametros = {
    sampleCount: 1,
    aspectRatio: OUTPUT_ASPECT_RATIO,
    // Personas adultas tocando instrumentos: sin esto Imagen rechaza casi todo
    // el catálogo, porque en todos los planos hay alguien.
    personGeneration: 'allow_adult',
    safetySetting: 'block_only_high',
  };
  if (Number.isInteger(seed)) parametros.seed = seed;
  if (negativePrompt) parametros.negativePrompt = String(negativePrompt).slice(0, 1000);

  const d = await llamar(
    vertexUrl(projectId, cfg.imageLocation, modelo, 'predict'),
    token, projectId,
    { instances: [instancia], parameters: parametros },
  );

  const p = (d.predictions || [])[0];
  if (!p) throw new ProveedorError('Imagen no devolvió ninguna imagen.');
  if (p.raiFilteredReason) {
    throw new ProveedorError(
      'los filtros de contenido bloquearon esta imagen: ' + p.raiFilteredReason +
      '. Cambia la descripción de la toma y vuelve a generar.',
    );
  }
  const base64 = p.bytesBase64Encoded || p.imageBytes;
  if (!base64) throw new ProveedorError('Imagen respondió sin datos de imagen.');

  return { base64, mimeType: p.mimeType || 'image/png', modelo };
}

// ─── Vídeo (Veo) ───

// Duraciones que acepta cada modelo. Pedir una que no admite es un rechazo, y
// pedir más segundos de los que la toma necesita es peor: el modelo rellena el
// sobrante inventando movimiento.
const DURACIONES = {
  'veo-3.1-generate-001': [4, 6, 8],
  'veo-3.1-fast-generate-001': [4, 6, 8],
  'veo-3.1-lite-generate-001': [4, 6, 8],
  'veo-2.0-generate-001': [5, 6, 7, 8],
};

/**
 * La duración admitida más cercana a la pedida.
 *
 * En el empate gana la MÁS CORTA, porque Veo cobra por segundo generado y el
 * montaje recorta el clip a su hueco de todas formas.
 */
function duracionValida(modelo, pedida) {
  const opciones = DURACIONES[modelo] || [4, 6, 8];
  const d = Number(pedida);
  if (!Number.isFinite(d) || d <= 0) return opciones[opciones.length - 1];
  return opciones.reduce((mejor, o) => {
    const da = Math.abs(o - d);
    const dm = Math.abs(mejor - d);
    return da < dm || (da === dm && o < mejor) ? o : mejor;
  });
}

/** ¿El rechazo es «este modelo no tiene fotograma final» y no «tu petición está mal»? */
function rechazaFotogramaFinal(msg) {
  const m = String(msg || '').toLowerCase();
  return (
    m.indexOf('lastframe') !== -1 ||
    (m.indexOf('last frame') !== -1 && /not support|unsupported|invalid|not allowed|no admite/.test(m))
  );
}

/**
 * Lanza la generación de un clip. Devuelve la operación, no el vídeo: Veo tarda
 * minutos y aquí hay 60 segundos.
 *
 * `imagenBase64` es la imagen aprobada de la toma, que fija cómo empieza el
 * clip. `fotogramaFinalBase64` es la imagen de la toma siguiente: cuando el
 * modelo la acepta, interpola entre las dos y el corte entre clips deja de
 * notarse, porque el clip termina exactamente donde empieza el siguiente.
 */
async function iniciarVideo(opciones) {
  const {
    token, projectId, prompt, negativePrompt,
    imagenBase64, imagenMime, fotogramaFinalBase64, fotogramaFinalMime,
    durationSec, bucket, prefijo,
  } = opciones;

  const modelo = cfg.veoModel;
  const tipo = (t) => (t === 'image/jpeg' || t === 'image/png' ? t : 'image/png');

  const parametros = {
    aspectRatio: OUTPUT_ASPECT_RATIO,
    sampleCount: 1,
    durationSeconds: duracionValida(modelo, durationSec),
    // El corto es instrumental: la música se compone aparte y el audio que
    // invente Veo solo puede estorbar.
    generateAudio: false,
    personGeneration: 'allow_adult',
  };
  if (negativePrompt) parametros.negativePrompt = String(negativePrompt).slice(0, 1000);
  // Veo escribe el clip directamente en el bucket. Así el MP4 nunca pasa por
  // una función de Vercel, que tiene un límite de tamaño de respuesta.
  if (bucket) parametros.storageUri = 'gs://' + bucket + '/' + prefijo + '/veo/';

  const base = { prompt: String(prompt).slice(0, 4000) };
  if (imagenBase64) {
    base.image = { bytesBase64Encoded: imagenBase64, mimeType: tipo(imagenMime) };
  }

  const url = vertexUrl(projectId, cfg.veoLocation, modelo, 'predictLongRunning');
  const pedir = async (conFinal) => {
    const instancia = conFinal
      ? Object.assign({}, base, {
          lastFrame: {
            bytesBase64Encoded: fotogramaFinalBase64,
            mimeType: tipo(fotogramaFinalMime),
          },
        })
      : base;
    try {
      const d = await llamar(url, token, projectId, { instances: [instancia], parameters: parametros });
      return { ok: true, d };
    } catch (e) {
      return { ok: false, e };
    }
  };

  // Se pide primero el clip interpolado. No todos los niveles de Veo aceptan un
  // fotograma final y la documentación de Google se contradice sobre cuáles,
  // así que la pregunta la responde el propio modelo: si rechaza ESE campo, se
  // reintenta con EL MISMO modelo sin él y se avisa. Nunca se cambia de modelo.
  let r = await pedir(Boolean(fotogramaFinalBase64));
  let aviso = null;
  if (!r.ok && fotogramaFinalBase64 && rechazaFotogramaFinal(r.e.message)) {
    aviso = modelo + ' no acepta fotograma final: el clip se generó solo con la imagen inicial.';
    r = await pedir(false);
  }
  if (!r.ok) throw r.e;

  const nombre = r.d.name;
  if (!nombre) throw new ProveedorError('Veo aceptó la petición pero no devolvió la operación.');

  return {
    operationName: nombre,
    modelo,
    durationSec: parametros.durationSeconds,
    interpolado: Boolean(fotogramaFinalBase64) && !aviso,
    aviso,
  };
}

/** ¿Terminó el clip? Devuelve el objeto del bucket cuando está listo. */
async function consultarVideo(opciones) {
  const { token, projectId, operationName, modelo } = opciones;
  // La operación pertenece al modelo que la lanzó, así que hay que preguntarle
  // A ESE. Con el modelo fijo en el código, elegir otro en la interfaz rompía
  // la consulta sin que se entendiera por qué.
  const url = vertexUrl(projectId, cfg.veoLocation, modelo || cfg.veoModel, 'fetchPredictOperation');
  const d = await llamar(url, token, projectId, { operationName });

  if (!d.done) return { listo: false };

  const resp = d.response || {};
  if (resp.raiMediaFilteredCount > 0 && !(resp.videos || []).length) {
    return {
      listo: true,
      error: 'los filtros de contenido bloquearon este clip. Cambia la descripción de la toma.',
    };
  }
  const video = (resp.videos || [])[0];
  if (!video) return { listo: true, error: 'Veo terminó pero no devolvió ningún vídeo.' };

  if (video.gcsUri) {
    const sin = video.gcsUri.replace('gs://', '');
    const corte = sin.indexOf('/');
    return { listo: true, bucket: sin.slice(0, corte), objeto: sin.slice(corte + 1) };
  }
  if (video.bytesBase64Encoded) return { listo: true, base64: video.bytesBase64Encoded };
  return { listo: true, error: 'Veo terminó pero no devolvió ni archivo ni datos.' };
}

// ─── Música (Lyria) ───

// Lyria devuelve un fragmento de unos 30 segundos por llamada, así que un corto
// de tres minutos son seis. Se generan de una en una, guardando el avance: seis
// llamadas seguidas no caben en los 60 segundos de una función.
const SEGUNDOS_POR_FRAGMENTO = 30;

const SIN_VOZ = 'vocals, singing, voice, lyrics, spoken word, rap, choir, chanting, humming';

/**
 * Un fragmento de música instrumental.
 *
 * El prompt negativo contra la voz no es opcional ni decorativo: el producto es
 * instrumental por definición (§3, §28) y una voz colada arruina el corto
 * entero.
 */
async function generarMusica(opciones) {
  const { token, projectId, prompt, negativePrompt, seed } = opciones;
  const modelo = cfg.musicModel;

  const instancia = {
    prompt: String(prompt).slice(0, 2000),
    negative_prompt: [SIN_VOZ, negativePrompt].filter(Boolean).join(', '),
  };
  // Lyria rechaza seed y sample_count juntos, así que el seed solo viaja cuando
  // se pide un único fragmento — que es siempre en este flujo.
  if (Number.isInteger(seed)) instancia.seed = seed;

  const d = await llamar(
    vertexUrl(projectId, cfg.musicLocation, modelo, 'predict'),
    token, projectId,
    { instances: [instancia], parameters: {} },
  );

  const preds = Array.isArray(d.predictions) ? d.predictions : [];
  // Según la versión del modelo el audio viene bajo un nombre u otro; se
  // aceptan los tres en vez de fijar uno y romperse en la siguiente versión.
  const p = preds.find((x) => x && (x.bytesBase64Encoded || x.audioContent || x.audio));
  if (!p) {
    const pista = preds.length ? Object.keys(preds[0] || {}).join(', ') : 'sin predictions';
    throw new ProveedorError('Lyria no devolvió audio (' + pista + ').');
  }

  return {
    base64: p.bytesBase64Encoded || p.audioContent || p.audio,
    mimeType: p.mimeType || 'audio/wav',
    modelo,
    segundos: SEGUNDOS_POR_FRAGMENTO,
  };
}

/** Cuántos fragmentos hacen falta para cubrir la película. */
function fragmentosNecesarios(segundos) {
  return Math.max(1, Math.ceil(Number(segundos) / SEGUNDOS_POR_FRAGMENTO));
}

module.exports = {
  ProveedorError,
  generarImagen,
  iniciarVideo,
  consultarVideo,
  duracionValida,
  generarMusica,
  fragmentosNecesarios,
  SEGUNDOS_POR_FRAGMENTO,
  SIN_VOZ,
};
