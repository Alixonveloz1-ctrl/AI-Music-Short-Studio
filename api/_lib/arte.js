/**
 * El Director de Arte (PRD §16) y el Director de Fotografía (PRD §18).
 *
 * El Director de Arte es el dueño de la *biblia visual*: una única descripción
 * del personaje, el instrumento, el entorno, la luz y el acabado a partir de la
 * cual se compone absolutamente todo prompt del proyecto. Eso es lo que evita
 * que cada generación parezca una película distinta (PRD §17).
 *
 * Los prompts se escriben en español, igual que el resto del producto, y se le
 * muestran al usuario tal cual (PRD §19).
 */
const {
  FORMATIONS_BY_ID,
  INSTRUMENTS_BY_ID,
  PERFORMER_TYPES_BY_ID,
  SCENARIOS_BY_ID,
  VISUAL_STYLES_BY_ID,
} = require('./catalogo.js');

const SHOT_TYPE_LABELS = {
  establishing_wide: 'plano general de situación',
  wide: 'plano general',
  medium: 'plano medio',
  close_up: 'primer plano',
  face: 'primer plano del rostro',
  hands: 'plano detalle de las manos sobre el instrumento',
  instrument_detail: 'plano detalle del instrumento',
  detail: 'plano detalle del entorno',
  over_shoulder: 'plano por encima del hombro',
  low_angle: 'contrapicado',
  high_angle: 'picado',
  profile: 'plano lateral de perfil',
};

const CAMERA_MOVE_LABELS = {
  static: 'cámara fija',
  slow_push_in: 'acercamiento lento de cámara',
  slow_pull_out: 'alejamiento lento de cámara',
  pan_left: 'panorámica hacia la izquierda',
  pan_right: 'panorámica hacia la derecha',
  tilt_up: 'inclinación de cámara hacia arriba',
  tilt_down: 'inclinación de cámara hacia abajo',
  lateral_track_left: 'travelling lateral hacia la izquierda',
  lateral_track_right: 'travelling lateral hacia la derecha',
  handheld_drift: 'cámara en mano con deriva muy sutil',
  crane_up: 'grúa ascendente',
};

function shotTypeLabel(shotType) {
  return SHOT_TYPE_LABELS[shotType];
}

function cameraMoveLabel(move) {
  return CAMERA_MOVE_LABELS[move];
}

/**
 * Cosas que nunca queremos ver en un cortometraje musical.
 *
 * Cubre los fallos típicos de los generadores (manos y dedos, instrumentos
 * imposibles, texto y marcas de agua) y, sobre todo, que nadie cante: el
 * producto es instrumental, así que un cantante o una boca abierta cantando son
 * un defecto, no una variante aceptable.
 */
const BASE_NEGATIVE = [
  'manos deformes',
  'dedos de más o de menos',
  'anatomía imposible',
  'instrumento deformado o incompleto',
  'cuerdas o teclas mal alineadas',
  'rostro distorsionado',
  'ojos asimétricos',
  'texto',
  'logotipos',
  'marcas de agua',
  'subtítulos',
  'micrófono de voz',
  'cantante cantando',
  'boca abierta cantando',
  'collage',
  'doble exposición no intencionada',
  'baja resolución',
];

function buildVisualBible(config, brief) {
  const instruments = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id))
    .filter((i) => Boolean(i));
  const scenario = SCENARIOS_BY_ID.get(config.scenarioId);
  const style = VISUAL_STYLES_BY_ID.get(config.visualStyleId);
  const formation = FORMATIONS_BY_ID.get(config.formationId);
  const performerType = PERFORMER_TYPES_BY_ID.get(config.performerTypeId);

  const instrumentNames = instruments.map((i) => i.name);
  const postures = instruments.map((i) => `${i.name}: ${i.posture}`);
  const techniques = instruments.map((i) => `${i.name} se toca con ${i.technique}`);

  const location = config.scenarioCustom?.trim()
    ? `${scenario?.label ?? 'Escenario'} — ${config.scenarioCustom.trim()}`
    : brief.environment.location;

  const treatment = config.visualStyleCustom?.trim()
    ? `${style?.treatment ?? ''}. Indicaciones del usuario: ${config.visualStyleCustom.trim()}`
    : (style?.treatment ?? 'imagen cinematográfica');

  return {
    character: {
      summary: `${performerType?.descriptor ?? 'un intérprete'} — ${brief.character.summary}`,
      face: brief.character.face,
      hair: brief.character.hair,
      wardrobe: brief.character.wardrobe,
      build: brief.character.build,
      apparentAge: brief.character.apparentAge,
      accessories: brief.character.accessories,
    },
    instrument: {
      names: instrumentNames,
      appearance: brief.instrumentAppearance,
      scale: 'proporción realista respecto al cuerpo del intérprete',
      positioning: postures.join('; '),
      physicalRelation: techniques.join('; '),
    },
    environment: {
      location,
      primaryElements: dedupe([...(scenario?.elements ?? []), ...brief.environment.primaryElements]),
      secondaryElements: brief.environment.secondaryElements,
      atmosphere: brief.environment.atmosphere,
    },
    lighting: {
      timeOfDay: brief.timeOfDay,
      direction: brief.lighting.direction,
      intensity: brief.lighting.intensity,
      atmosphere: brief.lighting.atmosphere,
    },
    aesthetic: {
      style: style?.label ?? 'Cinematográfico',
      treatment,
      photography: style?.photography ?? 'fotografía cinematográfica',
      finish: `paleta dominante: ${brief.palette.join(', ')}`,
    },
    continuityRules: dedupe([
      `Mismo rostro en todas las tomas: ${brief.character.face}`,
      `Mismo cabello: ${brief.character.hair}`,
      `Mismo vestuario: ${brief.character.wardrobe}`,
      `Mismo instrumento: ${instrumentNames.join(' + ')} — ${brief.instrumentAppearance}`,
      `Misma relación física intérprete-instrumento: ${postures.join('; ')}`,
      `Mismo escenario y mismos elementos: ${location}`,
      `Misma iluminación: ${brief.lighting.direction}, ${brief.lighting.intensity}`,
      `Formación visible: ${formation?.description ?? 'un intérprete'}`,
      ...brief.continuityRules,
    ]),
    negativePrompt: BASE_NEGATIVE.join(', '),
  };
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

// Un bloque vacío devuelve cadena vacía para que joinBlocks lo descarte: así no
// aparecen encabezados sueltos sin viñetas debajo en el prompt final.
function block(title, lines) {
  const body = lines.filter((l) => Boolean(l && l.trim())).map((l) => `- ${l}`);
  if (body.length === 0) return '';
  return `${title}:\n${body.join('\n')}`;
}

function joinBlocks(blocks) {
  return blocks.filter((b) => b.trim().length > 0).join('\n\n');
}

const CONTINUITY_HEADER =
  'CONTINUIDAD OBLIGATORIA (usa las imágenes de referencia aprobadas como verdad visual)';

/** PERSONAJE MAESTRO — el primer eslabón de la cadena de continuidad (PRD §17). */
function buildCharacterPrompt(bible, config) {
  const formation = FORMATIONS_BY_ID.get(config.formationId);
  return joinBlocks([
    `RETRATO MAESTRO DE PERSONAJE. Retrato de cuerpo entero de ${bible.character.summary}, sosteniendo su ${bible.instrument.names.join(' y ')} en posición de interpretación, sobre fondo neutro y limpio.`,
    block('Personaje', [
      `Rostro: ${bible.character.face}`,
      `Cabello: ${bible.character.hair}`,
      `Complexión: ${bible.character.build}`,
      `Edad aparente: ${bible.character.apparentAge}`,
      `Vestuario: ${bible.character.wardrobe}`,
      bible.character.accessories.length ? `Accesorios: ${bible.character.accessories.join(', ')}` : null,
    ]),
    block('Instrumento', [
      `Instrumento: ${bible.instrument.names.join(' + ')}`,
      `Apariencia: ${bible.instrument.appearance}`,
      `Posición: ${bible.instrument.positioning}`,
      `Escala: ${bible.instrument.scale}`,
    ]),
    block('Estilo', [
      bible.aesthetic.treatment,
      bible.aesthetic.photography,
      bible.aesthetic.finish,
    ]),
    block('Requisitos', [
      'Manos completas y correctas, cinco dedos por mano',
      'El instrumento debe estar completo y bien construido',
      'Sin texto ni marcas de agua',
      `Formación de referencia: ${formation?.description ?? 'solista'}`,
      'Esta imagen será la referencia oficial del personaje para todo el corto',
    ]),
  ]);
}

/** ESCENARIO MAESTRO — la localización sin el intérprete. */
function buildEnvironmentPrompt(bible) {
  return joinBlocks([
    `PLANO MAESTRO DE ESCENARIO. ${bible.environment.location}, sin personas en el encuadre.`,
    block('Elementos principales', bible.environment.primaryElements),
    block('Elementos secundarios', bible.environment.secondaryElements),
    block('Iluminación', [
      `Momento del día: ${bible.lighting.timeOfDay}`,
      `Dirección: ${bible.lighting.direction}`,
      `Intensidad: ${bible.lighting.intensity}`,
      `Atmósfera: ${bible.lighting.atmosphere}`,
    ]),
    block('Estilo', [bible.aesthetic.treatment, bible.aesthetic.photography, bible.aesthetic.finish]),
    block('Requisitos', [
      'Composición amplia y legible, con espacio para colocar al intérprete después',
      'Esta imagen será la referencia oficial del escenario para todo el corto',
    ]),
  ]);
}

/** ESCENA MAESTRA — personaje y entorno juntos; el ancla de todas las tomas. */
function buildScenePrompt(bible, config) {
  const formation = FORMATIONS_BY_ID.get(config.formationId);
  return joinBlocks([
    `PLANO MAESTRO DE ESCENA. ${bible.character.summary} interpretando su ${bible.instrument.names.join(' y ')} dentro de ${bible.environment.location}.`,
    block('Puesta en escena', [
      formation?.description ?? 'un intérprete en el centro de la escena',
      `Relación con el instrumento: ${bible.instrument.physicalRelation}`,
      `Atmósfera: ${bible.environment.atmosphere}`,
    ]),
    block(CONTINUITY_HEADER, bible.continuityRules),
    block('Estilo', [bible.aesthetic.treatment, bible.aesthetic.photography, bible.aesthetic.finish]),
    block('Requisitos', [
      'El personaje debe ser exactamente el de la referencia de personaje aprobada',
      'El escenario debe ser exactamente el de la referencia de escenario aprobada',
      'Esta imagen será la referencia oficial de la escena para todas las tomas',
    ]),
  ]);
}

/** Imagen fija de cada toma, compuesta con la biblia más la intención de la toma. */
function buildShotImagePrompt(bible, shot) {
  return joinBlocks([
    `${shot.label.toUpperCase()} — ${SHOT_TYPE_LABELS[shot.shotType]}.`,
    shot.description,
    block('Intención', [shot.purpose, `Momento del corto: ${beatLabel(shot.beat)}`]),
    block('Encuadre', [
      `Tipo de plano: ${SHOT_TYPE_LABELS[shot.shotType]}`,
      `Movimiento previsto en el vídeo: ${CAMERA_MOVE_LABELS[shot.cameraMove]}`,
    ]),
    block(CONTINUITY_HEADER, bible.continuityRules),
    block('Estilo', [bible.aesthetic.treatment, bible.aesthetic.photography, bible.aesthetic.finish]),
  ]);
}

/** Prompt de vídeo de cada clip, anclado en la imagen aprobada de su toma. */
function buildClipPrompt(bible, shot, clip, totalClips) {
  const phase =
    totalClips === 1
      ? 'toma completa'
      : clip.index === 0
        ? 'primer tramo de la toma'
        : clip.index === totalClips - 1
          ? 'tramo final de la toma'
          : `tramo intermedio ${clip.index + 1} de ${totalClips}`;
  return joinBlocks([
    `${clip.label.toUpperCase()} (${phase}, ${clip.durationSec} s). Anima la imagen de referencia aprobada de ${shot.label}.`,
    shot.description,
    block('Movimiento', [
      `Cámara: ${CAMERA_MOVE_LABELS[shot.cameraMove]}, muy suave y continuo`,
      'Intérprete: movimiento natural de interpretación, coherente con la técnica del instrumento',
      `Relación intérprete-instrumento: ${bible.instrument.physicalRelation}`,
      `Entorno: ${bible.environment.atmosphere}`,
    ]),
    block(CONTINUITY_HEADER, [
      'El primer fotograma debe coincidir con la imagen de referencia aprobada',
      ...bible.continuityRules,
    ]),
    block('Requisitos', [
      'Sin cortes internos ni cambios de plano',
      'Sin deformaciones en manos, rostro ni instrumento',
      'Sin texto en pantalla',
      'Movimiento contenido: mejor poco movimiento correcto que mucho movimiento roto',
    ]),
  ]);
}

function beatLabel(beat) {
  switch (beat) {
    case 'opening':
      return 'apertura';
    case 'development':
      return 'desarrollo';
    case 'climax':
      return 'clímax';
    case 'closing':
      return 'cierre';
    default:
      return beat;
  }
}

/** Defectos que solo aparecen al animar, así que se añaden solo al prompt de vídeo. */
const NEGATIVE_VIDEO_EXTRA = [
  'parpadeo entre fotogramas',
  'morphing del rostro',
  'dedos que se funden',
  'instrumento que cambia de forma',
  'cambio de plano brusco',
].join(', ');

module.exports = {
  shotTypeLabel,
  cameraMoveLabel,
  buildVisualBible,
  buildCharacterPrompt,
  buildEnvironmentPrompt,
  buildScenePrompt,
  buildShotImagePrompt,
  buildClipPrompt,
  BASE_NEGATIVE,
  NEGATIVE_VIDEO_EXTRA,
};
