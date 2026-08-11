/**
 * Constantes de todo el producto.
 *
 * La regla más importante del producto (PRD §4) está codificada aquí y también
 * en la máquina de estados: la IA propone y genera, el usuario revisa, aprueba
 * o regenera, y solo los elementos aprobados avanzan.
 */

/** Las únicas duraciones que admite el producto (PRD §12). */
const DURATIONS_SEC = [60, 120, 180];

/**
 * Duración máxima de un único clip de vídeo generado. Los modelos de vídeo
 * generan tomas cortas, así que un plano más largo se parte en varios clips que
 * el editor vuelve a unir (PRD §24).
 */
const MAX_CLIP_SECONDS = 8;

/** Los clips más cortos que esto parecen fallos, así que los cortes los evitan. */
const MIN_CLIP_SECONDS = 2;

/** Geometría de salida del corto terminado. */
// Los dos formatos entre los que se elige al crear el corto.
//
// No es un detalle de presentación: el formato entra en el prompt de CADA
// imagen y de CADA clip, así que no se puede cambiar a mitad de producción sin
// que unas tomas salgan apaisadas y otras verticales.
//
// El vertical es el de redes; el apaisado, el de cine y YouTube.
const FORMATOS = [
  {
    id: 'vertical',
    etiqueta: 'Vertical',
    proporcion: '9:16',
    ancho: 1080,
    alto: 1920,
    para: 'Para Reels, TikTok y Shorts. Ocupa la pantalla entera del móvil.',
  },
  {
    id: 'horizontal',
    etiqueta: 'Apaisado',
    proporcion: '16:9',
    ancho: 1920,
    alto: 1080,
    para: 'Para YouTube y para verlo en una pantalla grande.',
  },
];

const FORMATO_POR_DEFECTO = 'vertical';

/** El formato con ese id, o el de por defecto. Nunca devuelve nada vacío. */
function formato(id) {
  return FORMATOS.find((f) => f.id === id) ||
    FORMATOS.find((f) => f.id === FORMATO_POR_DEFECTO) ||
    FORMATOS[0];
}

// Medidas del apaisado. Se conservan porque hay código que todavía las usa como
// valor por defecto; lo que manda es el formato del proyecto.
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const OUTPUT_FPS = 24;
const OUTPUT_ASPECT_RATIO = '16:9';

/** Frecuencia de muestreo que usan los proveedores internos de síntesis de audio. */
const AUDIO_SAMPLE_RATE = 44100;

/** Etapas de producción, en orden (PRD §5, §44). */
const STAGES = [
  'concept',
  'images',
  'videos',
  'music',
  'edit',
  'delivery',
];

const STAGE_LABELS = {
  concept: 'Concepto y plan',
  images: 'Imágenes',
  videos: 'Vídeos',
  music: 'Música',
  edit: 'Edición',
  delivery: 'Entrega',
};

/** Estados de los elementos (PRD §35). */
const ASSET_STATUSES = ['pending', 'generating', 'review', 'approved'];

const GENERATION_STATUSES = [
  'generating',
  'review',
  'approved',
  'rejected',
  'failed',
];

const ASSET_STATUS_LABELS = {
  pending: 'PENDIENTE',
  generating: 'GENERANDO',
  review: 'REVISIÓN',
  approved: 'APROBADO',
};

const ASSET_KINDS = [
  'master_character',
  'master_environment',
  'master_scene',
  'shot_image',
  'clip',
  'music',
];

const ASSET_KIND_STAGE = {
  master_character: 'images',
  master_environment: 'images',
  master_scene: 'images',
  shot_image: 'images',
  clip: 'videos',
  music: 'music',
};

/** Tipo de medio de cada elemento: 'image' | 'video' | 'audio'. */
const ASSET_KIND_MEDIA = {
  master_character: 'image',
  master_environment: 'image',
  master_scene: 'image',
  shot_image: 'image',
  clip: 'video',
  music: 'audio',
};

/** Pulsos narrativos que usa el Director para dar forma al corto. */
const BEATS = ['opening', 'development', 'climax', 'closing'];

const SHOT_TYPES = [
  'establishing_wide',
  'wide',
  'medium',
  'close_up',
  'face',
  'hands',
  'instrument_detail',
  'detail',
  'over_shoulder',
  'low_angle',
  'high_angle',
  'profile',
];

const CAMERA_MOVES = [
  'static',
  'slow_push_in',
  'slow_pull_out',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'lateral_track_left',
  'lateral_track_right',
  'handheld_drift',
  'crane_up',
];

/**
 * Transiciones que el Editor puede renderizar de verdad. `dip_to_black` es un
 * fundido a negro corto seguido de una entrada desde negro en la frontera entre
 * bloques — se llama así por lo que hace realmente, en lugar de dar a entender
 * un encadenado que el ensamblador no ejecuta.
 */
// Las transiciones que sabe montar el editor. Cada nombre dice lo que el
// montaje HACE de verdad, no lo que sugiere: 'dissolve' es un encadenado real
// —las dos imágenes se superponen— y no un fundido a negro disimulado.
const TRANSITIONS = ['cut', 'dissolve', 'dip_to_black', 'fade_in', 'fade_out'];

/** Ciclo de vida del montaje final. */
const FINAL_CUT_STATUSES = [
  'pending',
  'building',
  'review',
  'approved',
  'exported',
  'failed',
];

module.exports = {
  DURATIONS_SEC,
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  FORMATOS,
  FORMATO_POR_DEFECTO,
  formato,
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  OUTPUT_FPS,
  OUTPUT_ASPECT_RATIO,
  AUDIO_SAMPLE_RATE,
  STAGES,
  STAGE_LABELS,
  ASSET_STATUSES,
  GENERATION_STATUSES,
  ASSET_STATUS_LABELS,
  ASSET_KINDS,
  ASSET_KIND_STAGE,
  ASSET_KIND_MEDIA,
  BEATS,
  SHOT_TYPES,
  CAMERA_MOVES,
  TRANSITIONS,
  FINAL_CUT_STATUSES,
};
