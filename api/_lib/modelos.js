// ════════════════════════════════════════════════════════════════
// LOS MODELOS QUE SE PUEDEN ELEGIR
//
// Hasta ahora el modelo de imagen y el de vídeo eran fijos y sólo se
// cambiaban con una variable de entorno, o sea: no se cambiaban. Pero
// el vídeo es LO CARO de este producto —un corto son decenas de clips
// y Veo cobra por segundo generado—, así que decidir entre un corto
// barato y uno bueno tiene que poder hacerse desde la aplicación, corto
// a corto.
//
// Las dos listas van ORDENADAS DEL MÁS BARATO AL MÁS CARO. Ese orden es
// el producto: es lo que deja al usuario ver de un vistazo qué le va a
// costar el capricho.
//
// ─── DE DÓNDE SALEN LOS PRECIOS ───
//
// De la tabla oficial de tarifas de Vertex AI:
//
//   https://cloud.google.com/vertex-ai/generative-ai/pricing
//   (secciones «Imagen», «Veo» y «Gemini»), consultada el 2026-08-10.
//
// Se citan porque están verificados. Ninguna cifra de este archivo es
// una estimación: un precio inventado hace que el usuario presupueste
// mal, que es peor que no dar precio ninguno. Si algún día se añade un
// modelo cuyo precio no se pueda comprobar en esa página, va SIN cifra
// y con «precio sin confirmar» en su frase.
//
// Los precios de vídeo que se citan son los de VÍDEO SIN AUDIO a 720p,
// que es lo único que este producto pide: el corto es instrumental y la
// música se compone aparte, así que `generateAudio` va siempre a false
// (ver vertex.js). Pagar la tarifa con audio sería pagar por una pista
// que se tira.
//
// Los modelos de imagen de Gemini («Nano Banana») se facturan por token
// y no por imagen; la cifra por imagen es la que la propia tabla de
// Google da en su nota al pie para una salida de 1K, y por eso lleva
// «≈»: sube con la resolución.
//
// ─── LAS REGIONES NO SON TODAS IGUALES ───
//
// Cada modelo trae la suya. Los modelos de imagen de Gemini más nuevos
// SOLO se sirven desde el endpoint «global»; pedirlos a us-central1
// devuelve un 404 de «modelo no encontrado» que no se entiende. Por eso
// la región viaja pegada al modelo y no en una variable suelta.
// ════════════════════════════════════════════════════════════════

// La región normal de este proyecto. Se lee del entorno en cada acceso, igual
// que en gcp.js, para que las pruebas puedan variarla.
function regionPorDefecto() {
  return (process.env.GCP_LOCATION || '').trim() || 'us-central1';
}

/** El valor de una variable SÓLO si está puesta de verdad (no su valor por defecto). */
function delEntorno(nombre) {
  return (process.env[nombre] || '').trim();
}

// ─── Catálogo de imagen ───
//
// Del más barato al más caro. Precio por imagen, tarifas oficiales de Vertex AI
// consultadas el 2026-08-10 (ver cabecera).

const IMAGEN = [
  {
    id: 'imagen-4.0-fast-generate-001',
    etiqueta: 'Imagen 4 Fast',
    nivel: 'economico',
    para: 'Lo más barato del catálogo (0,02 $ por imagen). Para buscar encuadres, ' +
      'probar escenarios y descartar ideas sin que la exploración salga cara.',
    region: 'us-central1',
  },
  {
    id: 'gemini-2.5-flash-image',
    etiqueta: 'Nano Banana (Gemini 2.5 Flash Image)',
    nivel: 'economico',
    para: 'Barato (≈0,039 $ por imagen de 1K) y, a diferencia de los Imagen, ' +
      'acepta las imágenes ya aprobadas como referencia: es el más barato que ' +
      'mantiene la cara del intérprete y el escenario de una toma a la siguiente.',
    region: 'us-central1',
  },
  {
    id: 'imagen-4.0-generate-001',
    etiqueta: 'Imagen 4',
    nivel: 'equilibrado',
    para: 'El término medio (0,04 $ por imagen). Buen detalle fotográfico ' +
      'partiendo sólo del texto de la toma; es lo que han usado los cortos ' +
      'anteriores de esta herramienta.',
    region: 'us-central1',
  },
  {
    id: 'imagen-3.0-capability-001',
    etiqueta: 'Imagen 3 Personalización',
    nivel: 'equilibrado',
    para: 'Mismo precio que Imagen 4 (0,04 $ por imagen) pero sabe copiar un ' +
      'sujeto de las imágenes de referencia. Útil si el intérprete se te ' +
      'desdibuja entre tomas y no quieres irte a los modelos de Gemini.',
    region: 'us-central1',
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    etiqueta: 'Imagen 4 Ultra',
    nivel: 'calidad',
    para: 'El Imagen más fino (0,06 $ por imagen): sigue la descripción al pie ' +
      'de la letra. Para el plano que se mira dos veces, no para las 30 tomas.',
    region: 'us-central1',
  },
  {
    id: 'gemini-3.1-flash-image',
    etiqueta: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
    nivel: 'calidad',
    para: 'Caro (≈0,067 $ por imagen de 1K) y muy bueno respetando varias ' +
      'referencias a la vez. La opción si la continuidad del personaje es ' +
      'lo que más te importa del corto.',
    region: 'global',
  },
  {
    id: 'gemini-3-pro-image',
    etiqueta: 'Nano Banana Pro (Gemini 3 Pro Image)',
    nivel: 'calidad',
    para: 'Lo más caro con diferencia (≈0,134 $ por imagen de 1K, más de seis ' +
      'veces Imagen 4 Fast). Composiciones difíciles, muchos músicos en cuadro, ' +
      'instrumentos que tienen que estar bien construidos.',
    region: 'global',
  },
];

// ─── Catálogo de vídeo ───
//
// Del más barato al más caro. Precio por SEGUNDO de vídeo sin audio a 720p,
// tarifas oficiales de Vertex AI consultadas el 2026-08-10.
//
// Aquí es donde se decide el presupuesto del corto: un minuto de película son
// unos 60 segundos de clip que pagar, así que entre el primero y el tercero de
// esta lista hay casi siete veces la factura.
//
// Veo 2 no está: cuesta 0,50 $/s —más que ningún Veo 3.x— y es más antiguo, así
// que elegirlo sería pagar más por menos. Veo 3 y Veo 3 Fast tampoco: valen
// exactamente lo mismo que sus equivalentes de 3.1 y están superados por ellos.

const VIDEO = [
  {
    id: 'veo-3.1-lite-generate-001',
    etiqueta: 'Veo 3.1 Lite',
    nivel: 'economico',
    para: 'El corto barato (0,03 $ por segundo). Un corto de 3 minutos se queda ' +
      'en unos pocos euros de vídeo. Movimiento sencillo y planos que no piden ' +
      'acrobacias de cámara.',
    region: 'us-central1',
  },
  {
    id: 'veo-3.1-fast-generate-001',
    etiqueta: 'Veo 3.1 Fast',
    nivel: 'equilibrado',
    para: 'Casi el triple que Lite (0,08 $ por segundo) a cambio de bastante más ' +
      'solidez: manos sobre el instrumento, movimiento de cámara, ropa que se ' +
      'mueve como debe. El punto razonable para un corto que se enseña.',
    region: 'us-central1',
  },
  {
    id: 'veo-3.1-generate-001',
    etiqueta: 'Veo 3.1',
    nivel: 'calidad',
    para: 'Casi siete veces Lite (0,20 $ por segundo). Sólo si el corto es el ' +
      'resultado final y no te importa que tres minutos de película cuesten ' +
      'como una cena. Mira el coste antes de lanzar los 30 clips.',
    region: 'us-central1',
  },
];

/** Referencia de las tarifas, por si la pantalla quiere decir de dónde salen. */
const FUENTE_PRECIOS = {
  url: 'https://cloud.google.com/vertex-ai/generative-ai/pricing',
  consultado: '2026-08-10',
  nota: 'Tarifas oficiales de Vertex AI. Las de vídeo son por segundo, sin audio, ' +
    'a 720p, que es lo que genera esta herramienta.',
};

// ─── La vía de escape: IMAGE_MODEL y VEO_MODEL ───
//
// Estas variables mandan SI EXISTEN. No son un resto del pasado: son lo único
// que salva a un proyecto de Google Cloud que no tenga acceso a los modelos de
// la lista (allowlist, cuota a cero, región sin capacidad). Sin ellas, ese
// usuario no podría generar nada y tendría que esperar a un despliegue.
//
// El modelo del entorno se AÑADE al catálogo y pasa a ser el que sale por
// defecto. Se añade AL FINAL a propósito: no sabemos lo que cuesta, así que
// meterlo en medio mentiría sobre el orden de precios, y su frase lo dice.

function modeloDelEntorno(id, familia) {
  return {
    id,
    etiqueta: id,
    nivel: 'equilibrado',
    para: 'Fijado en el entorno con la variable ' + familia + ', así que es el que ' +
      'se usa por defecto. Precio sin confirmar: no está en el catálogo, no lo ' +
      'sabemos y no lo adivinamos.',
    region: regionDeIdDesconocido(id),
    delEntorno: true,
  };
}

/**
 * Región de un modelo que no está en el catálogo.
 *
 * Los modelos de imagen de Gemini se sirven desde «global»; el resto, desde la
 * región normal del proyecto. Acertar aquí evita un 404 que el usuario leería
 * como «el modelo no existe» cuando lo único que pasa es que lo pidió al host
 * equivocado.
 */
function regionDeIdDesconocido(id) {
  return /^gemini/i.test(String(id)) ? 'global' : regionPorDefecto();
}

/**
 * El catálogo con el modelo del entorno añadido, si lo hay.
 *
 * Si la variable apunta a un modelo que YA está en la lista no se duplica: se
 * devuelve la lista tal cual y ese id será el por defecto.
 */
function conEntorno(base, variable) {
  const forzado = delEntorno(variable);
  if (!forzado) return base;
  if (base.some((m) => m.id === forzado)) return base;
  return base.concat([modeloDelEntorno(forzado, variable)]);
}

function catalogoImagen() {
  return conEntorno(IMAGEN, 'IMAGE_MODEL');
}

function catalogoVideo() {
  return conEntorno(VIDEO, 'VEO_MODEL');
}

// ─── Los por defecto ───
//
// Sin variable de entorno, el por defecto NO es el primero de la lista aunque
// sea el más barato: es el que han venido usando los cortos ya empezados.
//
// POR QUÉ: un proyecto creado antes de que esto se pudiera elegir no guarda
// ningún modelo, así que al regenerar una toma cae en el por defecto. Si ese
// por defecto cambiara, la toma 12 saldría de un modelo distinto que las once
// anteriores y el corto perdería la continuidad visual — exactamente lo que
// esta herramienta existe para cuidar. Ahorrar dos céntimos por imagen no vale
// romperle el corto a nadie.
//
// En vídeo no hay conflicto: el más barato ya era el que se usaba.

const IMAGEN_HEREDADO = 'imagen-4.0-generate-001';
const VIDEO_HEREDADO = 'veo-3.1-lite-generate-001';

function porDefectoImagen() {
  return delEntorno('IMAGE_MODEL') || IMAGEN_HEREDADO;
}

function porDefectoVideo() {
  return delEntorno('VEO_MODEL') || VIDEO_HEREDADO;
}

/** Busca por id en una lista, sin sorpresas si llega un número o un objeto. */
function buscar(lista, id) {
  const clave = typeof id === 'string' ? id.trim() : '';
  if (!clave) return null;
  return lista.find((m) => m.id === clave) || null;
}

/**
 * El modelo de imagen elegido, o el por defecto si el id no vale.
 *
 * Nunca devuelve null: quien genera necesita un modelo sí o sí, y quedarse sin
 * imagen por un id mal escrito sería peor que usar el de siempre. La validación
 * de verdad —la que sí protesta— está en api/proyectos.js, cuando el usuario
 * todavía puede corregir.
 */
function modeloImagen(id) {
  const lista = catalogoImagen();
  return buscar(lista, id) || buscar(lista, porDefectoImagen()) || IMAGEN[0];
}

function modeloVideo(id) {
  const lista = catalogoVideo();
  return buscar(lista, id) || buscar(lista, porDefectoVideo()) || VIDEO[0];
}

/** ¿Está este id en el catálogo? Para validar sin caer en el por defecto. */
function esImagenConocido(id) {
  return Boolean(buscar(catalogoImagen(), id));
}

function esVideoConocido(id) {
  return Boolean(buscar(catalogoVideo(), id));
}

/**
 * La región desde la que pedir un modelo.
 *
 * IMAGE_LOCATION y VEO_LOCATION siguen ganando si están puestas —son la salida
 * cuando un modelo se mueve de región y no se puede esperar a un despliegue—,
 * pero se leen en crudo: sólo mandan si el usuario las escribió, no cuando
 * traen su valor por defecto.
 */
function regionImagen(id) {
  return delEntorno('IMAGE_LOCATION') || modeloImagen(id).region || regionPorDefecto();
}

/**
 * La región de un modelo de vídeo CONCRETO, aunque no esté en el catálogo.
 *
 * Importa para consultar una operación de Veo ya lanzada: la operación vive en
 * el host del modelo que la lanzó, así que preguntar por ella en otra región
 * devuelve «no existe» y se daría por perdido un clip que se está generando —
 * y que ya está pagado.
 */
function regionVideo(id) {
  const forzada = delEntorno('VEO_LOCATION');
  if (forzada) return forzada;
  const encontrado = buscar(catalogoVideo(), id);
  if (encontrado) return encontrado.region || regionPorDefecto();
  return id ? regionDeIdDesconocido(id) : modeloVideo(null).region || regionPorDefecto();
}

/**
 * ¿Este modelo de imagen sabe usar las imágenes ya aprobadas como referencia?
 *
 * Es una pregunta sobre el MODELO ELEGIDO, no sobre una constante: mandarle
 * referencias a un modelo que no las entiende es un 400, y no mandárselas a uno
 * que sí las entiende tira a la basura la continuidad del personaje, que es lo
 * que el usuario aprobó toma a toma.
 *
 * Dos familias las aceptan: los Imagen de personalización (llevan «capability»
 * o «customization» en el nombre) y los modelos de imagen de Gemini, que
 * reciben las referencias como partes de la conversación.
 */
function admiteReferencias(id) {
  const clave = String(id || '');
  return esGemini(clave) || /capability|customization/i.test(clave);
}

/**
 * ¿Se habla con este modelo por `generateContent` (Gemini) o por `predict`
 * (Imagen)? Son dos protocolos distintos y no se parecen en nada.
 */
function esGemini(id) {
  return /^gemini/i.test(String(id || ''));
}

module.exports = {
  FUENTE_PRECIOS,
  modeloImagen,
  modeloVideo,
  porDefectoImagen,
  porDefectoVideo,
  esImagenConocido,
  esVideoConocido,
  regionImagen,
  regionVideo,
  admiteReferencias,
  esGemini,
};

// MODELOS_IMAGEN y MODELOS_VIDEO son ARRAYS para quien los lee, pero se
// calculan en cada acceso, igual que los getters de gcp.js: si fueran
// constantes congeladas al cargar el módulo, un IMAGE_MODEL puesto después
// (las pruebas lo hacen, y un entorno de ejecución perezoso también puede)
// no aparecería nunca en la lista.
Object.defineProperty(module.exports, 'MODELOS_IMAGEN', {
  enumerable: true,
  get: catalogoImagen,
});
Object.defineProperty(module.exports, 'MODELOS_VIDEO', {
  enumerable: true,
  get: catalogoVideo,
});
