// ════════════════════════════════════════════════════════════════
// LOS MODELOS QUE SE PUEDEN ELEGIR
//
// DE DÓNDE SALE ESTA LISTA: de los estudios que el usuario ya tiene en
// producción (Anime AI Studio y Legado de Hierro), no de una búsqueda.
// Son los modelos que ya ha usado y con los que ya sabe qué esperar.
//
// POR QUÉ NO HAY NINGÚN MODELO DE LA FAMILIA IMAGEN
//
// Porque no aceptan imágenes de referencia. Está comprobado a base de
// usarlos: dan muy buena imagen suelta, pero no se les puede decir
// «este es el personaje, mantenlo». Y en esta herramienta la
// continuidad ES el producto — la misma intérprete y el mismo
// instrumento en las treinta tomas del corto. Un modelo que no sostiene
// la cara entre planos no sirve aquí por bueno que sea.
//
// Los modelos de imagen de Gemini (los «Nano Banana») sí las aceptan:
// se les pasan las imágenes ya aprobadas como parte de la petición.
// Por eso son los tres únicos del catálogo.
//
// POR QUÉ NO HAY PRECIOS
//
// Porque cambian, dependen de la cuenta y de la región, y un número
// desfasado hace presupuestar mal. Lo que no cambia es el ORDEN: cuál
// es el barato y cuál el caro. Eso es lo que hace falta para elegir.
// ════════════════════════════════════════════════════════════════

// Los mismos nombres que pinta la interfaz (verde / violeta / ámbar).
const { cfg } = require('./gcp.js');

const NIVELES = ['economico', 'equilibrado', 'calidad'];

/**
 * Imagen, del más barato al más caro.
 *
 * `region` importa: los Gemini 3.x solo se sirven desde el endpoint
 * «global», y pedirlos a una región concreta devuelve un 404 que parece
 * «no tienes acceso» sin serlo.
 */
const MODELOS_IMAGEN = [
  {
    id: 'gemini-2.5-flash-image',
    etiqueta: 'Nano Banana',
    nivel: 'economico',
    para: 'El más barato. Acepta las imágenes aprobadas como referencia, así que mantiene el personaje entre tomas. Para probar ideas y para cortos donde la imagen no tiene que lucirse.',
    region: 'us-central1',
  },
  {
    id: 'gemini-3.1-flash-image',
    etiqueta: 'Nano Banana 2',
    nivel: 'equilibrado',
    para: 'Coste medio. Sostiene varias referencias a la vez mejor que el anterior: la cara, el instrumento y el escenario juntos. Es el que conviene por defecto.',
    region: 'global',
  },
  {
    id: 'gemini-3-pro-image',
    etiqueta: 'Nano Banana Pro',
    nivel: 'calidad',
    para: 'El más caro, varias veces el anterior. Para cuadros difíciles: varios músicos a la vez, instrumentos que tienen que estar bien construidos. Un corto son decenas de imágenes, así que sale caro de verdad.',
    region: 'global',
  },
];

/** Vídeo, del más barato al más caro. */
const MODELOS_VIDEO = [
  {
    id: 'veo-3.1-lite-generate-001',
    etiqueta: 'Veo 3.1 Lite',
    nivel: 'economico',
    para: 'El más barato. Movimiento sencillo: alguien tocando, la cámara quieta o con una deriva lenta. Es lo que pide la mayoría de los planos de un corto musical.',
    region: '',
  },
  {
    id: 'veo-3.1-fast-generate-001',
    etiqueta: 'Veo 3.1 Fast',
    nivel: 'equilibrado',
    para: 'Coste medio. Bastante más sólido con las manos sobre el instrumento y con la ropa en movimiento. El punto razonable para un corto que se va a enseñar.',
    region: '',
  },
  {
    id: 'veo-3.1-generate-001',
    etiqueta: 'Veo 3.1',
    nivel: 'calidad',
    para: 'El más caro con diferencia. Solo si el corto es el resultado final. El vídeo es lo que más cuesta de esta herramienta, y este multiplica esa parte.',
    region: '',
  },
];

/** Música. No se elige: solo hay uno. */
const MODELO_MUSICA = 'lyria-002';

// ─── Vía de escape por variable de entorno ───
//
// Si un proyecto no tiene acceso a alguno de estos modelos, IMAGE_MODEL o
// VEO_MODEL lo sustituyen sin tocar código. El id que se ponga ahí se añade al
// catálogo y pasa a ser el que sale por defecto.

function delEntorno(nombre) {
  return (process.env[nombre] || '').trim();
}

function conElDelEntorno(lista, variable) {
  const forzado = delEntorno(variable);
  if (!forzado) return lista;
  if (lista.some((m) => m.id === forzado)) {
    // Ya está en el catálogo: solo cambia cuál sale por defecto, y de eso se
    // encarga porDefecto*(). La lista no se toca.
    return lista;
  }
  return [
    {
      id: forzado,
      etiqueta: forzado,
      nivel: 'equilibrado',
      para: 'Puesto a mano en la variable ' + variable + ' de Vercel. No sabemos qué cuesta ni cómo se comporta.',
      region: '',
      delEntorno: true,
    },
  ].concat(lista);
}

function imagenes() {
  return conElDelEntorno(MODELOS_IMAGEN, 'IMAGE_MODEL');
}

function videos() {
  return conElDelEntorno(MODELOS_VIDEO, 'VEO_MODEL');
}

function porDefectoImagen() {
  return delEntorno('IMAGE_MODEL') || 'gemini-3.1-flash-image';
}

function porDefectoVideo() {
  return delEntorno('VEO_MODEL') || 'veo-3.1-lite-generate-001';
}

/**
 * El modelo con ese id, o el de por defecto si no vale.
 *
 * Nunca devuelve null: un id viejo o mal escrito no puede dejar un proyecto sin
 * poder generar. La validación de lo que llega de fuera se hace en
 * api/proyectos.js, que sí rechaza un id desconocido con un 400.
 */
function modeloImagen(id) {
  const lista = imagenes();
  return lista.find((m) => m.id === id) || lista.find((m) => m.id === porDefectoImagen()) || lista[0];
}

function modeloVideo(id) {
  const lista = videos();
  return lista.find((m) => m.id === id) || lista.find((m) => m.id === porDefectoVideo()) || lista[0];
}

/** ¿Existe ese id en el catálogo? Para validar lo que manda la interfaz. */
function existeImagen(id) {
  return imagenes().some((m) => m.id === id);
}

function existeVideo(id) {
  return videos().some((m) => m.id === id);
}

/**
 * La región desde la que se sirve un modelo.
 *
 * Los Gemini 3.x solo están en «global». Los que no la declaran usan la región
 * general del proyecto, que se puede cambiar con GCP_LOCATION.
 *
 * EL FALLO QUE ARREGLA EL ÚLTIMO `||`. Los modelos de Veo llevan `region: ''` a
 * propósito, para heredar la del proyecto. Pero quien llamaba —vertex.js— lo
 * hacía sin pasar `porDefecto`, así que la región salía `undefined` y la URL
 * quedaba en:
 *
 *   https://undefined-aiplatform.googleapis.com/.../locations/undefined/...
 *
 * googleapis.com resuelve cualquier subdominio, así que eso no daba un error de
 * red: daba la página 404 en HTML de Google, que el usuario veía como un muro
 * de `<!DOCTYPE html>` en la ficha del clip. El vídeo no funcionaba en absoluto.
 *
 * La región nunca puede quedar sin valor, así que el último recurso es la del
 * proyecto. Nadie que llame a esto puede volver a producir una URL rota por
 * olvidarse de un argumento.
 */
function regionDe(modelo, porDefecto) {
  return (modelo && modelo.region) || porDefecto || cfg.location;
}

/**
 * ¿Este modelo acepta imágenes de referencia?
 *
 * Todos los del catálogo, sí: es el motivo por el que están y ninguno de la
 * familia Imagen. Se deja como función porque si algún día entra por variable
 * de entorno un modelo que no las acepte, mandárselas sería un rechazo seco.
 */
function admiteReferencias(id) {
  return esGemini(id);
}

/** Los modelos de imagen de Gemini se llaman por :generateContent, no :predict. */
function esGemini(id) {
  return String(id || '').indexOf('gemini') === 0;
}

function regionImagen(id, porDefecto) {
  return regionDe(modeloImagen(id), porDefecto);
}

function regionVideo(id, porDefecto) {
  return regionDe(modeloVideo(id), porDefecto);
}

module.exports = {
  NIVELES,
  // Los catálogos se leen como propiedades en varios sitios, así que se
  // exponen ya resueltos con la vía de escape del entorno aplicada: si se
  // exportara la constante a secas, un modelo puesto en IMAGE_MODEL no
  // aparecería en la pantalla de elección.
  get MODELOS_IMAGEN() { return imagenes(); },
  get MODELOS_VIDEO() { return videos(); },
  MODELO_MUSICA,
  imagenes,
  videos,
  modeloImagen,
  modeloVideo,
  existeImagen,
  existeVideo,
  esImagenConocido: existeImagen,
  esVideoConocido: existeVideo,
  porDefectoImagen,
  porDefectoVideo,
  regionDe,
  regionImagen,
  regionVideo,
  admiteReferencias,
  esGemini,
};
