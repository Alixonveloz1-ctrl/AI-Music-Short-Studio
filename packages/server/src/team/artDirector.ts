/**
 * The Art Director (PRD §16) and the Director of Photography (PRD §18).
 *
 * The Art Director owns the *visual bible*: one description of the character,
 * the instrument, the environment, the light and the finish that every single
 * prompt in the project is composed from. That is what stops each generation
 * from looking like a different film (PRD §17).
 *
 * Prompts are written in Spanish, matching the rest of the product, and are
 * shown verbatim to the user (PRD §19).
 */
import {
  FORMATIONS_BY_ID,
  INSTRUMENTS_BY_ID,
  PERFORMER_TYPES_BY_ID,
  SCENARIOS_BY_ID,
  VISUAL_STYLES_BY_ID,
  type CreativeBrief,
  type ProjectConfig,
  type Shot,
  type VisualBible,
  type CameraMove,
  type ShotType,
} from '@ams/shared';

const SHOT_TYPE_LABELS: Record<ShotType, string> = {
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

const CAMERA_MOVE_LABELS: Record<CameraMove, string> = {
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

export function shotTypeLabel(shotType: ShotType): string {
  return SHOT_TYPE_LABELS[shotType];
}

export function cameraMoveLabel(move: CameraMove): string {
  return CAMERA_MOVE_LABELS[move];
}

/** Things we never want to see in a musical short. */
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

export function buildVisualBible(config: ProjectConfig, brief: CreativeBrief): VisualBible {
  const instruments = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
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

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

function block(title: string, lines: Array<string | undefined | null>): string {
  const body = lines.filter((l): l is string => Boolean(l && l.trim())).map((l) => `- ${l}`);
  if (body.length === 0) return '';
  return `${title}:\n${body.join('\n')}`;
}

function joinBlocks(blocks: string[]): string {
  return blocks.filter((b) => b.trim().length > 0).join('\n\n');
}

const CONTINUITY_HEADER =
  'CONTINUIDAD OBLIGATORIA (usa las imágenes de referencia aprobadas como verdad visual)';

/** MASTER CHARACTER — the first link of the continuity chain (PRD §17). */
export function buildCharacterPrompt(bible: VisualBible, config: ProjectConfig): string {
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

/** MASTER ENVIRONMENT — the location without the performer. */
export function buildEnvironmentPrompt(bible: VisualBible): string {
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

/** MASTER SCENE — character and environment together; the anchor for shots. */
export function buildScenePrompt(bible: VisualBible, config: ProjectConfig): string {
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

/** Per-shot still image, composed from the bible plus the shot's own intent. */
export function buildShotImagePrompt(
  bible: VisualBible,
  shot: Pick<Shot, 'label' | 'shotType' | 'cameraMove' | 'purpose' | 'description' | 'beat'>,
): string {
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

/** Per-clip video prompt, anchored on the shot's approved still. */
export function buildClipPrompt(
  bible: VisualBible,
  shot: Pick<Shot, 'label' | 'shotType' | 'cameraMove' | 'description' | 'purpose'>,
  clip: { label: string; index: number; durationSec: number },
  totalClips: number,
): string {
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

function beatLabel(beat: Shot['beat']): string {
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

export const NEGATIVE_VIDEO_EXTRA = [
  'parpadeo entre fotogramas',
  'morphing del rostro',
  'dedos que se funden',
  'instrumento que cambia de forma',
  'cambio de plano brusco',
].join(', ');
