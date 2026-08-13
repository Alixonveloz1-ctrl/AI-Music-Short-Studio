// ════════════════════════════════════════════════════════════════
// VERTEX AI — imagen, vídeo y música.
//
//   Imagen  ·  :predict               responde en el momento
//   Veo     ·  :predictLongRunning    devuelve una operación y se pregunta
//   Lyria   ·  :generateContent       compone la pieza entera (hasta 184 s)
//
// TODO ESTO ESTÁ PENSADO PARA 60 SEGUNDOS. Una función de Vercel no
// puede esperar a Veo, que tarda minutos: por eso el vídeo se lanza y
// se pregunta. La música sí cabe en una llamada, y va entera en una:
// cosida a partir de trozos de treinta segundos no era una pieza, era
// una lista de fragmentos con cinco costuras.
//
// Y LYRIA SOLO ENTIENDE INGLÉS. Es el único sitio de toda la
// herramienta donde el texto no va en español. El encargo se compone
// aparte, en inglés, en api/_lib/plan.js.
//
// El modelo que se configure es el que se usa. Si falla, se devuelve el
// error de Google tal cual: nunca se sustituye por otro a espaldas del
// usuario, porque entonces el corto sale distinto y nadie sabe por qué.
//
// EL MODELO LO ELIGE EL PROYECTO. Imagen y vídeo llegan aquí como un id
// que viene guardado en el corto (ver api/_lib/modelos.js), no de una
// constante: el usuario decide si quiere un corto barato o uno bueno.
// Lo que este módulo no hace nunca es elegir por él.
// ════════════════════════════════════════════════════════════════
const { cfg, vertexUrl } = require('./gcp');
const modelos = require('./modelos');
const { OUTPUT_ASPECT_RATIO, formato } = require('./constantes');

/**
 * La proporción que pidió el proyecto.
 *
 * Va en el prompt de cada imagen y de cada clip. Si no llega, se usa la del
 * formato por defecto en vez de fallar: quedarse sin generar por un id raro
 * sería peor que generar en el formato de siempre.
 */
function proporcionDe(formatoId) {
  return formatoId ? formato(formatoId).proporcion : OUTPUT_ASPECT_RATIO;
}

/**
 * Qué hay que hacer con cada imagen de referencia.
 *
 * ESTO NO ES UN DETALLE DE REDACCIÓN. Antes todas las referencias llevaban el
 * mismo texto —«copia de ella la identidad: la misma cara, el mismo pelo…»— y
 * al generar el retrato del SEGUNDO intérprete se le adjuntaba el del primero.
 * Es decir: se le pedía explícitamente que copiara esa cara, y salían las dos
 * músicas siendo la misma persona. La instrucción pegada a la imagen gana
 * siempre a cualquier matiz que vaya en el texto del prompt.
 *
 * Una imagen de referencia sin decir PARA QUÉ es una imagen que el modelo
 * interpreta como quiere.
 */
const TEXTO_DE_REFERENCIA = {
  // La misma persona o el mismo objeto: manténlo igual.
  identidad:
    '↑ REFERENCIA YA APROBADA. Copia de ella la identidad: la misma cara, el ' +
    'mismo pelo, la misma ropa y el mismo instrumento. NO copies su encuadre ' +
    'ni su pose: esta imagen nueva es otro plano.',

  // OTRO intérprete del mismo grupo: tiene que diferenciarse.
  otroInterprete:
    '↑ ESTE ES OTRO INTÉRPRETE DEL GRUPO, NO la persona que hay que dibujar ' +
    'ahora. La persona de la imagen nueva tiene que ser CLARAMENTE DISTINTA de ' +
    'esta: otro rostro, otro peinado y otro color de ropa. Lo ÚNICO que se ' +
    'copia de aquí es el estilo de dibujo, la calidad del trazo y la luz, para ' +
    'que las dos parezcan de la misma película. NO repitas esta cara.',

  // El lugar donde ocurre todo.
  lugar:
    '↑ EL ESCENARIO YA APROBADO. La imagen nueva ocurre EN ESTE MISMO SITIO: ' +
    'la misma arquitectura, los mismos objetos, la misma hora del día y la ' +
    'misma luz. Cambia solo el punto de vista.',

  // La escena maestra: dónde está cada cual dentro del lugar.
  escena:
    '↑ LA ESCENA YA APROBADA: el intérprete dentro de su escenario. De aquí se ' +
    'conservan las identidades, el lugar y la luz. La imagen nueva es OTRO ' +
    'PLANO del mismo momento, con otro encuadre.',
};

class ProveedorError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ProveedorError';
    this.status = status || 502;
  }
}

/**
 * El tiempo máximo que se espera a Vertex antes de rendirse.
 *
 * ESTO NO ES UNA PRECAUCIÓN, ES UN FALLO QUE PASÓ. La llamada a Lyria no tenía
 * límite, así que cuando el modelo tardaba más de lo que dura una función de
 * Vercel, la función MORÍA. No lanzaba una excepción: se apagaba. Nadie
 * capturaba nada, no se apuntaba ningún error, y el activo se quedaba en
 * «generando» para siempre. El latido volvía a intentarlo, moría igual, y así
 * media hora, con el usuario mirando una ruedecita que no significaba nada.
 *
 * Un límite propio, por debajo del de Vercel, convierte eso en un error escrito
 * y visible: «tardó más de 45 s». Con eso el usuario sabe qué pasó y el contador
 * de tropiezos puede pararlo en tres intentos en vez de en veinte minutos.
 */
const ESPERA_MAX_MS = 45000;

async function llamar(url, token, projectId, cuerpo, opciones) {
  const limite = (opciones && opciones.timeoutMs) || ESPERA_MAX_MS;
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), limite);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        // Sin esta cabecera, la cuota se carga contra el proyecto del modelo y no
        // contra el del usuario; algunos modelos rechazan la llamada por eso.
        'X-Goog-User-Project': projectId,
      },
      body: JSON.stringify(cuerpo),
      signal: corte.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') {
      throw new ProveedorError(
        'Google tardó más de ' + Math.round(limite / 1000) + ' s en responder y la función ' +
        'de Vercel se corta a los 60. Vuelve a intentarlo: el tiempo de respuesta varía ' +
        'mucho de una vez a otra.',
        504,
      );
    }
    throw new ProveedorError('No se pudo hablar con Vertex AI: ' + (e && e.message), 502);
  } finally {
    clearTimeout(reloj);
  }
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
 * Genera una imagen con el modelo que el proyecto eligió. Devuelve los bytes en
 * base64 — quien llama decide dónde guardarlos, porque la ruta depende del
 * proyecto y del activo.
 *
 * `modeloId` es el del proyecto; si no llega o no vale, se usa el por defecto.
 * Aquí NO se valida: la validación con mensaje va en api/proyectos.js, cuando
 * el usuario todavía puede corregir. A media producción, quedarse sin imagen
 * por un id raro sería peor que generar con el de siempre.
 *
 * Hay dos protocolos, no uno: la familia Imagen se pide por `:predict` con
 * `instances`, y los modelos de imagen de Gemini por `:generateContent` con
 * `contents`. No se parecen en nada, así que van por caminos separados.
 */
async function generarImagen(opciones) {
  const modelo = modelos.modeloImagen(opciones.modeloId);
  const region = modelos.regionImagen(modelo.id);

  // Las referencias aprobadas viajan sólo si EL MODELO ELEGIDO sabe usarlas.
  // Mandárselas a uno que no las entiende es un rechazo; no mandárselas a uno
  // que sí, tira la continuidad que el usuario aprobó toma a toma. El resto de
  // modelos reciben únicamente el prompt, que de todas formas ya lleva dentro
  // el contrato de continuidad completo.
  const referencias = modelos.admiteReferencias(modelo.id)
    ? (opciones.referencias || []).slice(0, 4)
    : [];

  const argumentos = Object.assign({}, opciones, { modelo, region, referencias });
  return modelos.esGemini(modelo.id)
    ? imagenConGemini(argumentos)
    : imagenConImagen(argumentos);
}

/** El camino de siempre: familia Imagen, `:predict`. */
async function imagenConImagen(opciones) {
  const { token, projectId, prompt, negativePrompt, seed, modelo, region, referencias } = opciones;
  const instancia = { prompt: String(prompt).slice(0, 4000) };

  if (referencias.length) {
    instancia.referenceImages = referencias.map((ref, i) => ({
      referenceType: 'REFERENCE_TYPE_SUBJECT',
      referenceId: i + 1,
      referenceImage: { bytesBase64Encoded: ref.base64 },
    }));
  }

  const parametros = {
    sampleCount: 1,
    aspectRatio: proporcionDe(opciones.formatoId),
    // Personas adultas tocando instrumentos: sin esto Imagen rechaza casi todo
    // el catálogo, porque en todos los planos hay alguien.
    personGeneration: 'allow_adult',
    safetySetting: 'block_only_high',
  };
  if (Number.isInteger(seed)) parametros.seed = seed;
  if (negativePrompt) parametros.negativePrompt = String(negativePrompt).slice(0, 1000);

  const d = await llamar(
    vertexUrl(projectId, region, modelo.id, 'predict'),
    token, projectId,
    { instances: [instancia], parameters: parametros },
  );

  const p = (d.predictions || [])[0];
  if (!p) throw new ProveedorError('Imagen no devolvió ninguna imagen.');
  if (p.raiFilteredReason) {
    throw new ProveedorError(
      'los filtros de contenido bloquearon esta imagen: ' + p.raiFilteredReason +
      '. Abre «Ver y editar el prompt» aquí abajo, cambia la palabra que lo dispara ' +
      'y vuelve a generar.',
    );
  }
  const base64 = p.bytesBase64Encoded || p.imageBytes;
  if (!base64) throw new ProveedorError('Imagen respondió sin datos de imagen.');

  return { base64, mimeType: p.mimeType || 'image/png', modelo: modelo.id };
}

/**
 * El camino de los «Nano Banana»: modelos de imagen de Gemini,
 * `:generateContent`.
 *
 * Hay dos diferencias que importan y que no son de forma:
 *
 *  - Las referencias van como partes de la conversación, cada una seguida de
 *    una línea que dice QUÉ hay que copiar de ella. Sin esa línea, el modelo
 *    tiende a reproducir el encuadre de la referencia en vez de la identidad
 *    del personaje, que es justo lo contrario de lo que hace falta.
 *  - No existe `negativePrompt`: lo que no se quiere se dice en el mismo texto.
 */
async function imagenConGemini(opciones) {
  const { token, projectId, prompt, negativePrompt, modelo, region, referencias } = opciones;

  const partes = [];
  for (const ref of referencias) {
    partes.push({
      inlineData: {
        mimeType: ref.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        data: ref.base64,
      },
    });
    partes.push({ text: TEXTO_DE_REFERENCIA[ref.rol] || TEXTO_DE_REFERENCIA.identidad });
  }

  let texto = String(prompt).slice(0, 4000);
  if (negativePrompt) texto += '\n\nEVITA en la imagen: ' + String(negativePrompt).slice(0, 1000);
  partes.push({ text: texto });

  // El seed no viaja: `generationConfig` no lo admite en todos estos modelos y
  // un campo de más es un 400. Da igual para lo que se usa — regenerar tiene
  // que dar algo distinto, y estos modelos ya son distintos en cada llamada.
  const d = await llamar(
    vertexUrl(projectId, region, modelo.id, 'generateContent'),
    token, projectId,
    {
      contents: [{ role: 'user', parts: partes }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: { aspectRatio: proporcionDe(opciones.formatoId) },
      },
    },
  );

  const candidato = (d.candidates || [])[0];
  const trozos = (candidato && candidato.content && candidato.content.parts) || [];
  const imagen = trozos.find(
    (t) => t.inlineData && String(t.inlineData.mimeType || '').indexOf('image/') === 0,
  );

  if (!imagen) {
    // Sin imagen, el motivo está en `finishReason`, y casi siempre es el filtro
    // de contenido. Se dice cuál para que se pueda reescribir la toma: «no se
    // pudo generar» a secas no deja al usuario hacer nada.
    const motivo = (candidato && candidato.finishReason) ||
      (d.promptFeedback && d.promptFeedback.blockReason) || 'desconocido';
    if (/SAFETY|BLOCK|PROHIBITED|RECITATION/i.test(motivo)) {
      throw new ProveedorError(
        'los filtros de contenido bloquearon esta imagen (' + motivo +
        '). Abre «Ver y editar el prompt» aquí abajo, cambia la palabra que lo dispara ' +
        'y vuelve a generar.',
      );
    }
    throw new ProveedorError(modelo.etiqueta + ' respondió sin imagen (' + motivo + ').');
  }

  return {
    // Google devuelve el base64 en bloques con saltos de línea; Buffer los
    // tolera, pero se limpian para que lo que se guarda sea siempre lo mismo.
    base64: String(imagen.inlineData.data).replace(/\s+/g, ''),
    mimeType: imagen.inlineData.mimeType || 'image/png',
    modelo: modelo.id,
  };
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
/**
 * ¿Veo rechazó el ENCARGO, antes de generar nada, por las palabras que lleva?
 *
 * El mensaje literal: «The prompt could not be submitted. This prompt contains
 * sensitive words that violate Google's Responsible AI practices.» No es que el
 * clip saliera mal — es que ni se intentó.
 */
function rechazaPorPalabras(msg) {
  const m = String(msg || '').toLowerCase();
  return (
    m.indexOf('could not be submitted') !== -1 ||
    m.indexOf('sensitive word') !== -1 ||
    (m.indexOf('responsible ai') !== -1 && m.indexOf('prompt') !== -1)
  );
}

/**
 * El mismo encargo, con menos texto donde puede estar la palabra que molesta.
 *
 * POR QUÉ ESTO Y NO SEGUIR ADIVINANDO PALABRAS. El filtro no dice CUÁL es la
 * palabra, sólo que hay una. Perseguirlas de una en una es un juego que el
 * usuario paga con su tiempo: ya se le fue una tarde en nueve intentos.
 *
 * Los bloques van de más esencial a menos: lo primero es qué se ve y qué se
 * mueve, y lo último son las listas largas de continuidad y de requisitos, que
 * es donde se acumulan las descripciones de cuerpos y de defectos — justo el
 * vocabulario que un filtro de contenido mira con lupa. Quitando desde el final
 * se conserva siempre lo que hace falta para que el clip tenga sentido.
 */
function encargoMasCorto(prompt, nivel) {
  const bloques = String(prompt || '').split('\n\n');
  // Nivel 1: se quita el último bloque. Nivel 2: se queda sólo con los tres
  // primeros, que son la cabecera del clip, la descripción y el movimiento.
  if (nivel <= 1) return bloques.slice(0, Math.max(3, bloques.length - 1)).join('\n\n');
  return bloques.slice(0, 3).join('\n\n');
}

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

  // El nivel de Veo lo eligió el usuario al crear el corto y está guardado en
  // el proyecto: entre el más barato y el mejor hay casi siete veces la
  // factura, así que esa decisión es suya y no del código.
  const elegido = modelos.modeloVideo(opciones.modeloId);
  const modelo = elegido.id;
  const region = modelos.regionVideo(modelo);
  const tipo = (t) => (t === 'image/jpeg' || t === 'image/png' ? t : 'image/png');

  const parametros = {
    aspectRatio: proporcionDe(opciones.formatoId),
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

  const url = vertexUrl(projectId, region, modelo, 'predictLongRunning');
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

  // ─── SI RECHAZA EL ENCARGO POR LAS PALABRAS, SE INSISTE CON MENOS TEXTO ───
  //
  // Google contesta «this prompt contains sensitive words» y no dice cuál. El
  // usuario se comió nueve intentos seguidos contra ese muro sin nada que
  // tocar. Un rechazo así ocurre ANTES de generar, así que no se factura: se
  // puede reintentar sin que le cueste dinero.
  //
  // Se prueba primero SIN EL PROMPT NEGATIVO, que es donde estaban las palabras
  // marcadas —la lista de defectos anatómicos— y lo menos imprescindible de
  // todo. Después, con el encargo recortado por el final.
  if (!r.ok && rechazaPorPalabras(r.e.message)) {
    const negativoOriginal = parametros.negativePrompt;
    delete parametros.negativePrompt;
    r = await pedir(Boolean(fotogramaFinalBase64) && !aviso);
    if (r.ok) {
      aviso = 'Google rechazó el encargo por las palabras que llevaba. Se generó sin el ' +
        'prompt negativo, que es donde suelen estar. El resultado puede tener más defectos ' +
        'de lo normal: míralo con calma antes de aprobarlo.';
    } else if (rechazaPorPalabras(r.e.message)) {
      // Todavía. Se recorta el encargo, de menos a más, quedándose siempre con
      // lo que describe la toma.
      for (let nivel = 1; nivel <= 2 && !r.ok; nivel += 1) {
        base.prompt = encargoMasCorto(prompt, nivel);
        r = await pedir(false);
        if (r.ok) {
          aviso = 'Google rechazó el encargo por las palabras que llevaba. Se generó con una ' +
            'versión recortada, sin el prompt negativo ni las notas de continuidad. Este clip ' +
            'puede no encajar del todo con los demás: compáralo antes de aprobarlo.';
        }
      }
    }
    if (!r.ok) parametros.negativePrompt = negativoOriginal;
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

/**
 * Qué contestó Google, en una línea que quepa en la pantalla de un móvil.
 *
 * No es un volcado: es la forma de la respuesta más los valores cortos. Con
 * esto se distingue «vino vacía» de «vino con campos que no esperábamos», que
 * es justo lo que no se podía saber cuando el mensaje era «no devolvió ningún
 * vídeo» y nada más.
 */
function resumen(d) {
  const resp = (d && d.response) || {};
  const partes = [];
  for (const clave of Object.keys(resp).slice(0, 12)) {
    const valor = resp[clave];
    if (valor === null || valor === undefined) { partes.push(clave + '=null'); continue; }
    if (Array.isArray(valor)) { partes.push(clave + '[' + valor.length + ']'); continue; }
    if (typeof valor === 'object') { partes.push(clave + '{' + Object.keys(valor).join(',') + '}'); continue; }
    partes.push(clave + '=' + String(valor).slice(0, 60));
  }
  return partes.length ? partes.join(', ') : '(una respuesta vacía)';
}

/** ¿Terminó el clip? Devuelve el objeto del bucket cuando está listo. */
async function consultarVideo(opciones) {
  const { token, projectId, operationName, modelo } = opciones;
  // La operación pertenece al modelo que la lanzó, así que hay que preguntarle
  // A ESE, y en SU región. Con el modelo fijo en el código, elegir otro en la
  // interfaz rompía la consulta sin que se entendiera por qué; ahora que además
  // se puede cambiar de modelo entre un corto y el siguiente, el id se guarda
  // con el trabajo y se usa tal cual: preguntar por la operación en otro sitio
  // devuelve «no existe» y daría por perdido un clip que se está generando y
  // que ya está pagado.
  const deLaOperacion = modelo || modelos.porDefectoVideo();
  const url = vertexUrl(
    projectId, modelos.regionVideo(deLaOperacion), deLaOperacion, 'fetchPredictOperation',
  );
  const d = await llamar(url, token, projectId, { operationName });

  if (!d.done) return { listo: false };

  // LA OPERACIÓN PUDO TERMINAR MAL, y eso no se leía en ninguna parte.
  //
  // Una operación larga de Google acaba de una de dos maneras: con `response`
  // si salió bien, o con `error` si no. Aquí sólo se miraba `response`, así que
  // CUALQUIER fallo —una cuota agotada, un parámetro que el modelo no admite,
  // un error interno— se contaba como «terminó y no devolvió ningún vídeo».
  //
  // El usuario lo pagó caro: nueve intentos seguidos del mismo clip, los nueve
  // con el mismo mensaje inútil, sin una sola pista de qué estaba pasando. Ese
  // mensaje no describía el fallo: describía que no sabíamos cuál era.
  if (d.error) {
    const motivo = String(d.error.message || d.error.status || ('código ' + d.error.code));
    return {
      listo: true,
      error: 'Veo no pudo generar el clip: ' + motivo.slice(0, 400),
      // AQUÍ ES DONDE LLEGA DE VERDAD EL RECHAZO POR PALABRAS, y costó verlo.
      //
      // Se dio por hecho que Google rechazaba el ENVÍO, y el reintento con menos
      // texto se puso allí. Pero Veo acepta el envío, devuelve su operación como
      // si todo fuera bien, y sólo al terminar dice que el prompt tenía palabras
      // sensibles. El reintento nunca llegaba a ejecutarse — el usuario veía el
      // mismo error una y otra vez sobre un arreglo que no se estaba aplicando.
      //
      // Se marca para que quien empuja la generación pueda volver a lanzarla con
      // el encargo recortado, que es lo único que se puede hacer sin saber cuál
      // es la palabra.
      rechazoPorPalabras: rechazaPorPalabras(motivo),
    };
  }

  const resp = d.response || {};

  // Los filtros de contenido. `raiMediaFilteredReasons` viene a veces sin el
  // contador, así que valen las dos señales: con una sola se escapaban casos
  // que acababan en el mensaje genérico de abajo.
  const razonesRai = resp.raiMediaFilteredReasons || resp.raiMediaFilteredReason;
  const filtrados = Number(resp.raiMediaFilteredCount || 0) > 0 ||
    (Array.isArray(razonesRai) ? razonesRai.length > 0 : Boolean(razonesRai));
  if (filtrados && !(resp.videos || []).length) {
    const detalle = Array.isArray(razonesRai) ? razonesRai.join('; ') : (razonesRai || '');
    return {
      listo: true,
      error: 'los filtros de contenido bloquearon este clip' +
        (detalle ? ' (' + String(detalle).slice(0, 300) + ')' : '') +
        '. Abre «Ver y editar el prompt» aquí abajo, cambia la palabra que lo dispara ' +
        'y vuelve a generar.',
    };
  }

  const video = (resp.videos || [])[0];
  if (!video) {
    // Si se llega aquí, Veo dijo que terminó bien y aun así no hay vídeo ni
    // motivo. Antes esto era un callejón sin salida; ahora se cuenta QUÉ
    // contestó, que es lo único con lo que se puede diagnosticar desde un
    // teléfono sin poder abrir los registros de Google.
    return { listo: true, error: 'Veo terminó sin vídeo y sin decir por qué. Contestó: ' + resumen(d) };
  }

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
/**
 * LA MÚSICA: UNA SOLA PIEZA, DEL PRIMER SEGUNDO AL ÚLTIMO.
 *
 * DOS FALLOS ARREGLADOS AQUÍ.
 *
 * El primero, el que se veía: Lyria contestaba «Unsupported language detected.
 * Please use one of the supported languages: en». El prompt iba en español,
 * igual que todo el resto del producto, y este modelo solo entiende inglés. Es
 * el ÚNICO sitio de la herramienta donde el texto tiene que ir en inglés, así
 * que se traduce aquí dentro y el usuario sigue viendo su prompt en español.
 *
 * El segundo, el de fondo: se estaba usando `lyria-002`, que entrega trozos de
 * treinta segundos, y el corto se cosía a partir de cuatro o seis trozos. Un
 * corto musical con seis costuras no es una pieza, es una lista de fragmentos.
 * `lyria-3-pro-preview` compone hasta 184 segundos de una vez, que cubre los
 * tres minutos del corto más largo.
 *
 * CÓMO SE LLAMA, que no es evidente. Lyria NO usa `:predict` ni tiene endpoint
 * propio: se pide igual que un modelo de imagen de Gemini, con
 * `:generateContent` y `responseModalities: ['AUDIO','TEXT']`, y SIEMPRE desde
 * la región «global». No existe `negative_prompt`: todo va dentro del prompt.
 *
 * Y LA DURACIÓN NO ES UN PARÁMETRO. No hay campo de API para pedirla —
 * `maxOutputTokens` lo rechaza con «invalid argument»— así que la única forma
 * de pedir tres minutos es escribir una línea de tiempo con marcas [MM:SS]
 * dentro del propio prompt. Sin ella el modelo entrega unos treinta segundos y
 * se acabó.
 */
const MODELO_MUSICA_PRO = 'lyria-3-pro-preview';
const REGION_MUSICA = 'global';

/** Lo máximo que compone el modelo de una vez. El corto más largo son 180 s. */
const SEGUNDOS_MAX_PIEZA = 184;

function mmss(segundos) {
  const m = Math.floor(segundos / 60);
  const s = Math.round(segundos % 60);
  return '[' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ']';
}

/**
 * La línea de tiempo que se le pide al modelo.
 *
 * Aquí este producto se aparta a propósito de cómo lo usa un canal narrado. Allí
 * la música va DEBAJO de una voz, así que se le pide plana: sin crescendo y sin
 * clímax, porque cualquier pico taparía la narración. Aquí no hay voz y la
 * música ES la pieza (PRD §3), así que se le pide justo lo contrario: el arco
 * emocional completo, que es lo que el montaje va a acompañar plano a plano.
 */
function lineaDeTiempo(total, instrumentos) {
  const lista = (instrumentos || []).filter(Boolean);
  const suena = lista.length ? lista.join(' and ') : 'the instrument';

  return (
    // LO PRIMERO, PORQUE ES LO QUE FALLABA. El usuario puso un solista de
    // batería y los veinte primeros segundos fueron un chelo: la música
    // arrancaba sin el instrumento que se ve tocando en pantalla, y el
    // personaje aporreaba en silencio. La culpa era de esta misma línea de
    // tiempo, que pedía «open sparse and quiet, the main instrument almost
    // alone» — y a una pieza de un solo instrumento, «escaso» sólo se le puede
    // obedecer metiendo otro.
    //
    // Así que ahora «escaso» significa MENOS DE ESE MISMO INSTRUMENTO, nunca
    // otro distinto, y el primer segundo lo tiene que ocupar él.
    'THE FIRST SECOND: ' + suena + ' is already playing at ' + mmss(0) + '. ' +
    'The very first sound of the piece is ' + suena + ' — not silence, not an intro, ' +
    'not another instrument warming up. Someone is filmed playing ' + suena + ' from ' +
    'frame one, so if it is not audible from the start the film is out of sync.\n' +
    'ONLY THESE INSTRUMENTS: ' + suena + '. Do not add any instrument that is not in ' +
    'that list, not even quietly underneath and not even as an intro.\n\n' +
    'STRUCTURE — the piece lasts the FULL ' + Math.round(total) + ' seconds, from the first ' +
    'second to the last. Follow this timeline exactly:\n' +
    mmss(0) + ' ' + suena + ' enters immediately, playing sparsely: fewer notes and less ' +
    'force, but clearly present and clearly ' + suena + '.\n' +
    mmss(total * 0.25) + ' It fills out. More movement and more body, same instruments.\n' +
    mmss(total * 0.55) + ' Build steadily toward the emotional peak.\n' +
    mmss(total * 0.75) + ' The peak of the piece: fullest and strongest, but never noisy.\n' +
    mmss(total * 0.9) + ' Come back down. Strip it away.\n' +
    mmss(total) + ' End resolved and calm. Do not fade out abruptly and do not stop early: ' +
    'the music must still be playing at ' + mmss(total) + '.'
  );
}

/**
 * Traduce a inglés lo justo para Lyria.
 *
 * No es un traductor: es un diccionario de los términos musicales que este
 * producto genera. El prompt de música lo escribe `api/_lib/audio.js` a partir
 * de la ficha musical del brief —tempo, tonalidad, escala, instrumentos,
 * atmósfera— así que el vocabulario es cerrado y conocido. Lo que no esté en la
 * tabla pasa tal cual: un nombre de instrumento en español dentro de un prompt
 * por lo demás inglés no rompe nada, y es infinitamente mejor que llamar a un
 * traductor y que la generación dependa de otro servicio más.
 */
const AL_INGLES = [
  [/\bpieza instrumental\b/gi, 'instrumental piece'],
  [/\bsin voz\b/gi, 'no vocals'],
  [/\bsin letra\b/gi, 'no lyrics'],
  [/\bcompás\b/gi, 'time signature'],
  [/\btonalidad\b/gi, 'key'],
  [/\bescala\b/gi, 'scale'],
  [/\bmenor natural\b/gi, 'natural minor'],
  [/\bpentatónica menor\b/gi, 'minor pentatonic'],
  [/\bpentatónica mayor\b/gi, 'major pentatonic'],
  [/\bmenor armónica\b/gi, 'harmonic minor'],
  [/\bmenor\b/gi, 'minor'],
  [/\bmayor\b/gi, 'major'],
  [/\bdórico\b/gi, 'dorian'], [/\bfrigio\b/gi, 'phrygian'],
  [/\blidio\b/gi, 'lydian'], [/\bmixolidio\b/gi, 'mixolydian'],
  [/\beólico\b/gi, 'aeolian'], [/\blocrio\b/gi, 'locrian'],
  [/\bmelancólic[oa]\b/gi, 'melancholic'],
  [/\bcontemplativ[oa]\b/gi, 'contemplative'],
  [/\bseren[oa]\b/gi, 'serene'], [/\bíntim[oa]\b/gi, 'intimate'],
  [/\bcálid[oa]\b/gi, 'warm'], [/\bnostálgic[oa]\b/gi, 'nostalgic'],
  [/\bsolemne\b/gi, 'solemn'], [/\bampli[oa]\b/gi, 'expansive'],
  [/\breverente\b/gi, 'reverent'], [/\besperanzad[oa]\b/gi, 'hopeful'],
  [/\bluminos[oa]\b/gi, 'luminous'], [/\btens[oa]\b/gi, 'tense'],
  [/\bmisterios[oa]\b/gi, 'mysterious'], [/\bcontenid[oa]\b/gi, 'restrained'],
  [/\bviolonchelo\b/gi, 'cello'], [/\bviolín\b/gi, 'violin'],
  [/\bguitarra\b/gi, 'guitar'],
  [/\bflauta\b/gi, 'flute'], [/\barpa\b/gi, 'harp'],
  [/\btambor(es)?\b/gi, 'drums'], [/\bpercusión\b/gi, 'percussion'],
  [/\bcuerdas\b/gi, 'strings'], [/\bviento\b/gi, 'winds'],
  [/\bmetales\b/gi, 'brass'], [/\bteclados?\b/gi, 'keyboards'],
  [/\bsolista\b/gi, 'solo'], [/\bdúo\b/gi, 'duo'], [/\btrío\b/gi, 'trio'],
  [/\bcuarteto\b/gi, 'quartet'], [/\borquesta\b/gi, 'orchestra'],
  [/\bensamble\b/gi, 'ensemble'], [/\bbanda\b/gi, 'band'],
  [/\bestructura\b/gi, 'structure'], [/\bsecciones?\b/gi, 'sections'],
  [/\bcorto(metraje)?\b/gi, 'short film'],
  [/\bde inspiración\b/gi, 'inspired by'],
];

/**
 * Marcas de que un texto está en español y hay que traducirlo.
 *
 * POR QUÉ NO SE TRADUCE SIEMPRE. Esta tabla es el respaldo para los cortos
 * creados antes de que el encargo se escribiera en inglés: aquéllos guardan el
 * prompt en español y sin esto Lyria los rechazaría enteros. Pero pasarla por
 * encima de un texto que YA está en inglés no es inofensivo — las reglas van con
 * la marca `i`, así que «Tempo:» salía convertido en «tempo:».
 *
 * Daba igual para el modelo, pero no da igual como comportamiento: desde que el
 * usuario puede reescribir el prompt a mano, lo que escribe tiene que llegar tal
 * cual. Un texto que ya está en inglés se manda sin tocar.
 */
const MARCAS_DE_ESPANOL = /[áéíóúüñ¿¡]|\b(pieza|sin voz|sin letra|tonalidad|escala|menor|mayor|violonchelo|guitarra|flauta|arpa|tambores?|percusion|cuerdas|viento|carácter|caracter)\b/i;

function aIngles(texto) {
  const t = String(texto || '');
  if (!MARCAS_DE_ESPANOL.test(t)) return t;
  let salida = t;
  for (const [de, a] of AL_INGLES) salida = salida.replace(de, a);
  return salida;
}

/** La orden de que no cante nadie, en inglés, delante y detrás. */
const SOLO_INSTRUMENTAL =
  'INSTRUMENTAL ONLY. No vocals, no singing, no choir, no lyrics, no spoken word, ' +
  'no human voice of any kind. This is the score of a music short film: the music IS the piece.';

/**
 * El encargo exacto que se le manda a Lyria: adónde va y qué lleva dentro.
 *
 * Está separado de `generarMusica` porque hay DOS caminos que mandan esto
 * mismo. El de aquí, que llama y espera dentro de la función de Vercel, y el de
 * `compositor.js`, que se lo encarga a una máquina de Cloud Build cuando el
 * minuto de la función no da. Los dos tienen que pedir literalmente lo mismo o
 * la música saldría distinta según por dónde se pidiera, que es la clase de
 * diferencia que luego no hay quien encuentre.
 */
function encargoMusica(opciones) {
  const { projectId, prompt } = opciones;
  const total = Math.min(SEGUNDOS_MAX_PIEZA, Math.max(20, Number(opciones.segundos) || 60));

  const texto =
    SOLO_INSTRUMENTAL + '\n\n' +
    aIngles(prompt).slice(0, 2000) + '\n\n' +
    // El prompt negativo del proyecto está en español, como todo lo demás, y
    // aquí no puede entrar ni una palabra que no sea inglesa. Además Lyria no
    // tiene campo `negative_prompt`: lo que se quiere evitar se dice en prosa,
    // y en este producto siempre es lo mismo, así que va escrito en inglés de
    // una vez en lugar de traducirse a trompicones.
    'AVOID: any voice, singing, humming, choir, spoken word, applause, crowd noise, ' +
    'sound effects and silence. Only played instruments, from the first second to the last.\n\n' +
    lineaDeTiempo(total, opciones.instrumentos) + '\n\n' +
    SOLO_INSTRUMENTAL;

  return {
    url: vertexUrl(projectId, REGION_MUSICA, MODELO_MUSICA_PRO, 'generateContent'),
    cuerpo: {
      contents: [{ role: 'user', parts: [{ text: texto }] }],
      // El ÚNICO campo válido aquí. Añadir maxOutputTokens hace que Vertex
      // conteste «Request contains an invalid argument».
      generationConfig: { responseModalities: ['AUDIO', 'TEXT'] },
    },
    segundos: total,
    modelo: MODELO_MUSICA_PRO,
  };
}

/**
 * Compone la pieza entera. Un solo intento, un solo archivo.
 *
 * `segundos` es la duración del corto. Si llega algo fuera de rango se recorta
 * al máximo del modelo en vez de fallar: mejor una pieza de 184 s que ninguna.
 */
async function generarMusica(opciones) {
  const { token, projectId } = opciones;
  const encargo = encargoMusica(opciones);
  const total = encargo.segundos;

  // Componer tres minutos de música es lo más lento que hace esta herramienta
  // dentro de una sola petición, así que se le da todo el margen que cabe: la
  // función se corta a los 60 s y después de esto todavía hay que subir el
  // audio al bucket y guardar el proyecto.
  const d = await llamar(
    encargo.url, token, projectId, encargo.cuerpo,
    { timeoutMs: Number(opciones.presupuestoMs) || 45000 },
  );

  const audio = juntarAudio(d, total);
  if (!audio) {
    const cand = d && d.candidates && d.candidates[0];
    const razon = (cand && cand.finishReason) || 'sin finishReason';
    let texto = '';
    if (cand && cand.content && Array.isArray(cand.content.parts)) {
      for (const p of cand.content.parts) if (p && typeof p.text === 'string') texto += p.text;
    }
    throw new ProveedorError(
      'Lyria no devolvió audio (' + razon + ')' + (texto ? ': ' + texto.slice(0, 160) : '') + '.',
    );
  }

  return {
    base64: audio.base64,
    mimeType: audio.mimeType,
    extension: audio.extension,
    editable: audio.editable,
    modelo: MODELO_MUSICA_PRO,
    segundos: total,
    formato: audio.formato,
    formatoDeclarado: audio.original,
  };
}

// AQUÍ ESTABA `generarAmbiente`, que le pedía a Lyria un lecho de sonido de
// lugar en vez de una pieza musical, con la orden «esto no es música» delante y
// detrás para que no compusiera.
//
// Se ha borrado con el resto del ambiente. No funcionaba: la generación fallaba
// una y otra vez y, las veces que salía, venía con música dentro — que es
// exactamente lo que esas dos órdenes intentaban evitar. Pedirle a un modelo de
// música que no haga música resultó no ser una batalla ganable.

/**
 * Saca el audio de la respuesta SIN REINTERPRETARLO.
 *
 * ESTE ES EL FALLO QUE COSTÓ TRES RONDAS, y estaba resuelto desde hacía tiempo
 * en el otro estudio del usuario, con el motivo escrito en un comentario:
 * envolver audio COMPRIMIDO en una cabecera WAV que dice «esto es PCM» es
 * exactamente lo que produce ruido blanco.
 *
 * Lyria no devuelve siempre lo mismo. A veces manda PCM crudo, a veces manda un
 * archivo ya empaquetado —MP3, OGG, M4A—. Un MP3 son bytes comprimidos: si se
 * les pega delante una cabecera que declara «muestras de 16 bits a 48 kHz», el
 * reproductor los lee como muestras y suena a estática. Da igual lo fina que
 * sea la deducción del formato: el error no estaba en adivinar mal la
 * frecuencia, estaba en tocar unos bytes que no había que tocar.
 *
 * La regla, por tanto, es la de aquel comentario: EL FORMATO SE MIRA EN LOS
 * BYTES, no en la etiqueta, y sólo se añade cabecera cuando el audio es PCM de
 * verdad. Cualquier otra cosa se guarda intacta, con su extensión y su tipo, y
 * ya la lee ffmpeg en el montaje. Mejor un archivo sin tocar que uno
 * reinterpretado mal.
 */
function juntarAudio(d, segundosPedidos) {
  const cand = d && Array.isArray(d.candidates) ? d.candidates[0] : null;
  const partes = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const trozos = [];
  let mimeType = '';
  for (const p of partes) {
    const dato = (p && (p.inlineData || p.inline_data)) || null;
    if (!dato || !dato.data) continue;
    const suyo = dato.mimeType || dato.mime_type || '';
    // Una parte de imagen aquí sería un error del modelo, pero colarla en el
    // audio lo dejaría inservible sin decir por qué.
    if (suyo.indexOf('image') === 0) continue;
    if (!mimeType) mimeType = suyo;
    let buf = Buffer.from(dato.data, 'base64');
    // Del segundo trozo en adelante, fuera la cabecera RIFF: dos cabeceras
    // seguidas en medio del audio suenan como un chasquido.
    if (trozos.length && esRiff(buf)) buf = buf.slice(44);
    trozos.push(buf);
  }
  if (!trozos.length) return null;

  const crudo = trozos.length === 1 ? trozos[0] : Buffer.concat(trozos);
  const listo = prepararAudio(crudo, mimeType, segundosPedidos);
  return {
    base64: listo.bytes.toString('base64'),
    mimeType: listo.tipo,
    extension: listo.extension,
    // `true` sólo cuando el resultado es un WAV que se puede abrir y editar.
    editable: listo.editable,
    formato: listo.descripcion,
    original: mimeType || 'sin declarar',
  };
}

function esRiff(buf) {
  return buf.length > 44 && buf.toString('latin1', 0, 4) === 'RIFF';
}

/**
 * Qué es realmente este montón de bytes, mirando su firma.
 *
 * Los cuatro primeros bytes de casi cualquier formato de audio lo identifican
 * sin lugar a dudas. Se mira eso antes que el mimeType porque la etiqueta puede
 * venir con un valor genérico y los bytes no mienten.
 */
function reconocerAudio(cabecera, mimeType) {
  const buf = Buffer.isBuffer(cabecera) ? cabecera : Buffer.from(cabecera || []);
  const firma = buf.toString('latin1', 0, 4);

  // `intacto` quiere decir que a estos bytes no hay que hacerles NADA. Cuando
  // el audio ya está en el bucket —lo dejó ahí una máquina de Cloud Build— eso
  // es lo que permite copiarlo a su sitio sin bajárselo: un corto de tres
  // minutos en PCM son treinta y cuatro megas, y bajarlos y volverlos a subir
  // dentro de una función que se corta al minuto es pedir otro problema.

  // El WAV va el primero, como en `prepararAudio`: sí se toca —hay que
  // corregirle el tamaño declarado en la cabecera— y su firma manda sobre
  // cualquier otra comprobación.
  if (firma === 'RIFF') {
    return { tipo: 'audio/wav', extension: '.wav', editable: true, intacto: false, descripcion: 'WAV de Google' };
  }
  if (firma === 'OggS') return { tipo: 'audio/ogg', extension: '.ogg', editable: false, intacto: true, descripcion: 'OGG' };
  if (firma === 'fLaC') return { tipo: 'audio/flac', extension: '.flac', editable: false, intacto: true, descripcion: 'FLAC' };
  if (buf.toString('latin1', 4, 8) === 'ftyp') return { tipo: 'audio/mp4', extension: '.m4a', editable: false, intacto: true, descripcion: 'M4A' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { tipo: 'audio/webm', extension: '.webm', editable: false, intacto: true, descripcion: 'WebM' };
  }
  if (firma.slice(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return { tipo: 'audio/mpeg', extension: '.mp3', editable: false, intacto: true, descripcion: 'MP3' };
  }

  // Y al PCM crudo hay que ponerle la cabecera entera. Sólo AQUÍ se envuelve, y
  // sólo si la etiqueta dice que es PCM: es el único caso en el que añadir una
  // cabecera es correcto.
  if (/l16|pcm|linear/i.test(mimeType || '')) {
    return { tipo: 'audio/wav', extension: '.wav', editable: true, intacto: false, descripcion: 'PCM' };
  }

  // Ni firma ni etiqueta útil. Se guarda TAL CUAL: un archivo intacto que quizá
  // ffmpeg sepa leer es mejor que uno que se ha roto al reinterpretarlo.
  const sub = (/audio\/([a-z0-9.+-]+)/i.exec(mimeType || '') || [])[1] || 'bin';
  return {
    tipo: mimeType || 'application/octet-stream',
    extension: '.' + sub.replace(/[^a-z0-9]/gi, ''),
    editable: false,
    intacto: true,
    descripcion: 'desconocido (' + (mimeType || 'sin mimeType') + ', empieza por ' +
      buf.toString('hex', 0, 4) + ')',
  };
}

/**
 * Lo mismo, pero con los bytes en la mano y ya arreglados.
 *
 * La tabla de firmas no se repite aquí: la decide `reconocerAudio` y esto sólo
 * hace el trabajo que haya que hacer. Dos tablas serían dos tablas que pueden
 * separarse, y ésta ya costó tres rondas de depuración una vez.
 */
function prepararAudio(buf, mimeType, segundosPedidos) {
  const q = reconocerAudio(buf.subarray(0, 16), mimeType);

  // Ya viene empaquetado: NO SE TOCA NI UN BYTE.
  if (q.intacto) {
    return { bytes: buf, tipo: q.tipo, extension: q.extension, editable: q.editable, descripcion: q.descripcion };
  }

  if (buf.toString('latin1', 0, 4) === 'RIFF') {
    return {
      bytes: corregirTamanoWav(buf), tipo: q.tipo, extension: q.extension,
      editable: q.editable, descripcion: q.descripcion,
    };
  }

  const puesto = cabeceraWav(buf, mimeType, segundosPedidos);
  return {
    bytes: puesto.wav, tipo: q.tipo, extension: q.extension, editable: q.editable,
    descripcion: 'PCM ' + puesto.formato.rate + ' Hz · ' +
      (puesto.formato.canales === 2 ? 'estéreo' : 'mono') + ' (' + puesto.formato.origen + ')',
  };
}

/**
 * Los formatos de PCM que salen de un generador de audio, con sus bytes por
 * segundo (16 bits = 2 bytes por muestra y canal). De más a menos probable en
 * un modelo de música.
 */
const FORMATOS_PCM = [
  { rate: 48000, canales: 2 },
  { rate: 44100, canales: 2 },
  { rate: 48000, canales: 1 },
  { rate: 24000, canales: 2 },
  { rate: 44100, canales: 1 },
  { rate: 24000, canales: 1 },
  { rate: 22050, canales: 1 },
  { rate: 16000, canales: 1 },
];

/**
 * Qué formato tiene un bloque de PCM crudo.
 *
 * Google declara la frecuencia en el mimeType pero casi nunca los canales, y
 * suponer uno es razonable para una voz y está mal para música. Así que lo que
 * no venga declarado SE DEDUCE: se sabe cuántos segundos se pidieron y cuántos
 * bytes han llegado, y de ahí salen los bytes por segundo, que señalan un único
 * formato de los que existen en la práctica. Es una medición, no una
 * suposición.
 */
function formatoDelPcm(pcm, mimeType, segundosPedidos) {
  const rateDeclarado = parseInt((/rate=(\d+)/.exec(mimeType || '') || [])[1], 10) || 0;
  const canalesDeclarados = parseInt((/channels=(\d+)/.exec(mimeType || '') || [])[1], 10) || 0;

  if (rateDeclarado && canalesDeclarados) {
    return { rate: rateDeclarado, canales: canalesDeclarados, origen: 'declarado' };
  }

  const segundos = Number(segundosPedidos) || 0;
  if (segundos <= 0 || pcm.length < 1000) {
    return { rate: rateDeclarado || 48000, canales: canalesDeclarados || 2, origen: 'por defecto' };
  }

  const medidos = pcm.length / segundos;
  // Si el mimeType declaró la frecuencia, se le hace caso en eso y sólo se
  // deduce lo que calla.
  const candidatos = rateDeclarado ? FORMATOS_PCM.filter((f) => f.rate === rateDeclarado) : FORMATOS_PCM;
  const lista = candidatos.length ? candidatos : FORMATOS_PCM;

  let mejor = lista[0];
  let mejorError = Infinity;
  for (const f of lista) {
    const suyos = f.rate * f.canales * 2;
    const error = Math.abs(suyos - medidos) / suyos;
    if (error < mejorError) { mejorError = error; mejor = f; }
  }
  // Si ni el mejor candidato se acerca, la duración real no es la pedida y la
  // medición no vale.
  if (mejorError > 0.25) {
    return {
      rate: rateDeclarado || 48000,
      canales: canalesDeclarados || 2,
      origen: 'sin encaje (' + Math.round(medidos) + ' B/s)',
    };
  }
  return { rate: mejor.rate, canales: mejor.canales, origen: 'deducido de los bytes' };
}

/** Le pone cabecera WAV a un bloque de PCM crudo. Sólo se llama para PCM real. */
function cabeceraWav(pcm, mimeType, segundosPedidos) {
  const f = formatoDelPcm(pcm, mimeType, segundosPedidos);
  const bits = 16;
  const bloque = (f.canales * bits) / 8;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);              // 1 = PCM sin comprimir
  h.writeUInt16LE(f.canales, 22);
  h.writeUInt32LE(f.rate, 24);
  h.writeUInt32LE(f.rate * bloque, 28);
  h.writeUInt16LE(bloque, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return { wav: Buffer.concat([h, pcm]), formato: f };
}

/**
 * Corrige el tamaño declarado de un WAV tras pegar varios trozos.
 *
 * La cabecera del primero sigue diciendo lo que medía ÉL. Un lector estricto
 * —ffmpeg lo es— se cree ese número y deja de leer ahí, así que la pieza sale
 * con la duración del primer trozo y no la del conjunto.
 */
function corregirTamanoWav(buf) {
  const out = Buffer.from(buf);
  out.writeUInt32LE(out.length - 8, 4);
  if (out.toString('latin1', 36, 40) === 'data') out.writeUInt32LE(out.length - 44, 40);
  return out;
}

/**
 * Cuántas llamadas hacen falta para cubrir la película.
 *
 * Ahora siempre UNA: el modelo compone los tres minutos de una vez. Se mantiene
 * la función porque `api/generar.js` la usa para llevar la cuenta del avance, y
 * porque si algún día vuelve a hacer falta trocear, el sitio ya existe.
 */
function fragmentosNecesarios(segundos) {
  return Number(segundos) > SEGUNDOS_MAX_PIEZA ? Math.ceil(Number(segundos) / SEGUNDOS_MAX_PIEZA) : 1;
}

module.exports = {
  ProveedorError,
  TEXTO_DE_REFERENCIA,
  generarImagen,
  iniciarVideo,
  consultarVideo,
  duracionValida,
  aIngles,
  rechazaPorPalabras,
  encargoMasCorto,
  generarMusica,
  encargoMusica,
  fragmentosNecesarios,
  SEGUNDOS_POR_FRAGMENTO,
  SEGUNDOS_MAX_PIEZA,
  MODELO_MUSICA_PRO,
  aIngles,
  lineaDeTiempo,
  juntarAudio,
  cabeceraWav,
  formatoDelPcm,
  prepararAudio,
  reconocerAudio,
  SIN_VOZ,
};
