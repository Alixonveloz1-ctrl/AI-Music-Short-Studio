/**
 * The built-in production team.
 *
 * This is a deterministic planner: no network, no API key, no randomness that
 * is not seeded from the project configuration. It plays the Director, the
 * Screenwriter and the Art Director well enough to produce a complete,
 * coherent creative brief so the studio is fully usable offline — and it is
 * also the fallback whenever the Claude-backed planner is unavailable.
 */
import {
  FORMATIONS_BY_ID,
  INSTRUMENTS_BY_ID,
  PERFORMER_TYPES_BY_ID,
  SCENARIOS_BY_ID,
  VISUAL_STYLES_BY_ID,
  type CreativeBrief,
} from '@ams/shared';
import { createRng, hashString, pickFrom } from '../util/rng.js';
import type { PlannerInput } from './planner.js';
import { shotTypeLabel } from './artDirector.js';

const TITLE_PATTERNS = [
  (instrument: string, place: string) => `Susurros de ${instrument}`,
  (instrument: string, place: string) => `${instrument} en ${place}`,
  (instrument: string) => `El eco del ${instrument}`,
  (instrument: string, place: string) => `Últimas luces sobre ${place}`,
  (instrument: string) => `Respiración de ${instrument}`,
  (instrument: string, place: string) => `${place} en silencio`,
];

const MOOD_SETS: string[][] = [
  ['melancólico', 'sereno', 'íntimo'],
  ['contemplativo', 'cálido', 'nostálgico'],
  ['solemne', 'amplio', 'reverente'],
  ['esperanzado', 'luminoso', 'sereno'],
  ['tenso', 'misterioso', 'contenido'],
];

const TIMES_OF_DAY = [
  'amanecer temprano, luz baja y dorada',
  'media mañana con luz difusa',
  'hora dorada del atardecer',
  'crepúsculo azul justo tras la puesta de sol',
  'noche cerrada con luz práctica cálida',
];

const HAIR_OPTIONS = [
  'cabello largo y oscuro recogido en una coleta baja, con mechones sueltos junto al rostro',
  'cabello corto y ondulado, castaño, peinado hacia un lado',
  'cabello negro liso hasta los hombros, raya al medio',
  'cabello recogido en un moño bajo, con un mechón cayendo sobre la sien izquierda',
  'cabello rizado y voluminoso, castaño claro, a la altura de la mandíbula',
];

const FACE_OPTIONS = [
  'rostro ovalado, cejas finas y rectas, ojos oscuros de mirada baja y concentrada, nariz recta, labios discretos',
  'rostro anguloso, pómulos marcados, ojos almendrados de color avellana, mirada serena, mandíbula definida',
  'rostro redondeado y suave, ojos grandes y oscuros, cejas ligeramente arqueadas, expresión tranquila',
  'rostro alargado, ojos hundidos de mirada intensa, cejas pobladas, boca pequeña y firme',
];

const WARDROBE_OPTIONS = [
  'túnica larga de lino color crudo con cinturón trenzado y mangas amplias',
  'abrigo de lana gris oscuro sobre camisa clara, cuello alto',
  'vestido sencillo de tejido fluido en tono tierra, sin estampado',
  'chaqueta corta de terciopelo azul profundo sobre camisa blanca',
  'jersey de punto grueso color arena y pantalón oscuro',
];

const BUILD_OPTIONS = [
  'complexión delgada, hombros estrechos, postura erguida',
  'complexión media, espalda ancha, postura relajada',
  'complexión menuda, manos finas y expresivas',
];

export function buildHeuristicBrief(input: PlannerInput): CreativeBrief {
  const { config, shots, runtimeSec } = input;
  const seed = hashString(JSON.stringify(config));
  const rng = createRng(seed);

  const instruments = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const lead = instruments[0];
  const leadName = lead?.name ?? 'instrumento';
  const scenario = SCENARIOS_BY_ID.get(config.scenarioId);
  const style = VISUAL_STYLES_BY_ID.get(config.visualStyleId);
  const formation = FORMATIONS_BY_ID.get(config.formationId);
  const performerType = PERFORMER_TYPES_BY_ID.get(config.performerTypeId);

  const placeName = config.scenarioCustom?.trim() || scenario?.label || 'el escenario';
  const mood = pickFrom(rng, MOOD_SETS);
  const timeOfDay = pickFrom(rng, TIMES_OF_DAY);
  const palette = style?.palette ?? ['ámbar', 'azul profundo', 'crema'];

  const titlePattern = pickFrom(rng, TITLE_PATTERNS);
  const title = config.titleHint?.trim() || titlePattern(leadName, placeName);

  const direction = config.creativeDirection.trim();
  const directionSentence = direction
    ? ` La dirección del usuario guía toda la pieza: ${truncate(direction, 220)}`
    : '';

  const logline = truncate(
    `${capitalize(performerType?.descriptor ?? 'un intérprete')} interpreta ${leadName} en ${placeName}; la música avanza de la quietud inicial hasta un clímax contenido y regresa al silencio.${directionSentence}`,
    390,
  );

  const face = pickFrom(rng, FACE_OPTIONS);
  const wardrobe = pickFrom(rng, WARDROBE_OPTIONS);

  const brief: CreativeBrief = {
    title: truncate(title, 78),
    logline,
    emotionalIntent: truncate(
      `Que el espectador sienta ${mood.join(', ')} y perciba la música como algo que ocurre de verdad en ${placeName}.`,
      290,
    ),
    emotionalArc: truncate(
      `Apertura contemplativa que presenta ${placeName} y al intérprete; desarrollo que se acerca progresivamente a las manos y al rostro; clímax donde el movimiento y la luz alcanzan su punto más intenso; cierre que se aleja y devuelve la escena al silencio.`,
      480,
    ),
    mood,
    palette: palette.slice(0, 4),
    timeOfDay,
    character: {
      summary: truncate(
        'con la atención puesta en la interpretación, presencia tranquila y contenida, sin gestos teatrales.',
        380,
      ),
      face: truncate(face, 290),
      hair: truncate(pickFrom(rng, HAIR_OPTIONS), 190),
      wardrobe: truncate(wardrobe, 290),
      build: truncate(pickFrom(rng, BUILD_OPTIONS), 190),
      apparentAge: performerType?.id.startsWith('young') ? 'entre 18 y 24 años' : 'entre 28 y 38 años',
      accessories: lead ? [`funda del ${lead.name}`, 'anillo sencillo en la mano derecha'] : [],
    },
    environment: {
      location: truncate(
        config.scenarioCustom?.trim() ||
          `${scenario?.label ?? 'Escenario'} — ${scenario?.elements.join(', ') ?? 'entorno abierto'}`,
        290,
      ),
      primaryElements: (scenario?.elements.length ? scenario.elements : ['fondo despejado', 'suelo visible']).slice(0, 6),
      secondaryElements: ['partículas de polvo suspendidas en la luz', 'sombras largas en el suelo'],
      atmosphere: truncate(
        `${scenario?.outdoor ? 'Aire en movimiento muy leve' : 'Aire quieto'}, ${mood[0] ?? 'sereno'}, con la música como único acontecimiento.`,
        290,
      ),
    },
    lighting: {
      direction: truncate(
        scenario?.outdoor
          ? 'luz principal lateral y baja, entrando desde la izquierda del encuadre'
          : 'luz principal cenital suave con relleno lateral desde la derecha',
        190,
      ),
      intensity: 'contraste medio-alto, altas luces controladas y sombras con detalle',
      atmosphere: truncate(`niebla muy leve que hace visibles los haces de luz; dominante ${palette[0] ?? 'cálida'}`, 190),
    },
    instrumentAppearance: truncate(
      instruments.length > 0
        ? `${instruments
            .map((i) => `${i.name}: factura tradicional, madera con veta visible y barniz mate desgastado por el uso, ${i.technique}`)
            .join('. ')}. Debe verse siempre el mismo ejemplar de cada instrumento, con las mismas marcas.`
        : 'instrumento de factura tradicional, con el mismo acabado en todas las tomas',
      390,
    ),
    continuityRules: [
      ...(direction ? [`Indicación del usuario, prioritaria: ${truncate(direction, 180)}`] : []),
      'El mismo intérprete, con el mismo rostro y el mismo peinado, en todas las tomas',
      'El mismo ejemplar del instrumento, con el mismo desgaste y los mismos detalles',
      'El mismo vestuario, sin cambios de color ni de prenda',
      'La misma hora del día y la misma dirección de la luz',
      'El mismo escenario, con los mismos elementos en las mismas posiciones',
      'Manos y dedos anatómicamente correctos y en posición coherente con la técnica',
      `Formación visible constante: ${formation?.description ?? 'un intérprete'}`,
    ],
    shots: shots.map((shot) => ({
      index: shot.index,
      purpose: truncate(purposeFor(shot.beat, shot.index, shots.length), 190),
      description: truncate(
        describeShot({
          shotTypeLabel: shotTypeLabel(shot.shotType),
          beat: shot.beat,
          performer: performerType?.descriptor ?? 'el intérprete',
          instrument: leadName,
          place: placeName,
          elements: scenario?.elements ?? [],
          timeOfDay,
        }),
        580,
      ),
    })),
    music: {
      style: truncate(
        `pieza instrumental para ${instruments.map((i) => i.name).join(', ') || 'instrumento solista'}, ${formation?.label.toLowerCase() ?? 'solista'}, de inspiración ${lead?.origin ?? 'contemporánea'}`,
        190,
      ),
      mood: truncate(mood.join(', '), 190),
      tempoBpm: tempoFor(mood[0] ?? 'sereno'),
      key: pickFrom(rng, ['Re menor', 'La menor', 'Mi menor', 'Sol menor', 'Do mayor', 'Fa mayor']),
      scale: pickFrom(rng, [
        'menor natural',
        'menor armónica',
        'pentatónica menor',
        'modo dórico',
        'modo lidio',
      ]),
      structure: truncate(
        `0:00 introducción con el instrumento solo; ${Math.round(runtimeSec * 0.25)}s entra el acompañamiento sostenido; ${Math.round(runtimeSec * 0.6)}s clímax con el registro más agudo y mayor densidad; ${Math.round(runtimeSec * 0.85)}s descenso y resolución en silencio.`,
        390,
      ),
    },
    ambient: {
      layers: (scenario?.ambience.length ? scenario.ambience : ['ambiente neutro']).slice(0, 6),
      description: truncate(
        `Lecho ambiental discreto de ${placeName}, siempre por debajo de la música, sin voces ni palabras. Acústica ${scenario?.acoustics ?? 'natural'}.`,
        390,
      ),
    },
    delivery: {
      description: truncate(
        `${logline.split('.')[0]}. Corto musical instrumental de ${Math.round(runtimeSec / 60)} minuto${runtimeSec >= 120 ? 's' : ''} generado con IA y aprobado plano a plano.`,
        390,
      ),
      hashtags: buildHashtags(instruments.map((i) => i.name), style?.label ?? '', scenario?.label ?? ''),
    },
    notes: {
      director: truncate(
        `El corto se construye sobre una sola idea: la música ocurre en ${placeName} y la cámara solo la acompaña. Se abre en plano general, se acerca progresivamente hasta el rostro y las manos en el clímax, y se cierra volviendo al plano de apertura para cerrar el círculo.`,
        580,
      ),
      producer: truncate(
        `${shots.length} tomas únicas cubren ${runtimeSec} segundos de montaje gracias a la reutilización de los planos generales y de detalle. No se genera ningún activo que ya exista y funcione.`,
        580,
      ),
      artDirector: truncate(
        `Biblia visual cerrada antes de generar: un único rostro, un único vestuario, un único ejemplar del instrumento y una única dirección de luz. Cada imagen posterior parte de las referencias aprobadas.`,
        580,
      ),
      cinematographer: truncate(
        `Progresión de planos general → medio → detalle → rostro, con movimientos de cámara lentos y contenidos. ${style?.photography ?? 'Fotografía cinematográfica'}.`,
        580,
      ),
      screenwriter: truncate(
        `Sin diálogo ni narración. La estructura dramática se apoya únicamente en la música y en la progresión de los planos.`,
        580,
      ),
      editor: truncate(
        `Cortes a tiempo con la respiración musical: más largos en la apertura, más cortos en el clímax. Encadenados suaves en los cambios de bloque, fundido de entrada y de salida.`,
        580,
      ),
    },
  };

  return brief;
}

function purposeFor(beat: string, index: number, total: number): string {
  switch (beat) {
    case 'opening':
      return index === 1
        ? 'Presentar el lugar y situar al espectador antes de que aparezca la música'
        : 'Introducir al intérprete dentro del entorno ya establecido';
    case 'development':
      return 'Acercarse a la interpretación y mostrar el gesto físico de tocar';
    case 'climax':
      return 'Sostener el punto de máxima intensidad emocional de la pieza';
    case 'closing':
      return index === total
        ? 'Cerrar el círculo devolviendo la escena al plano de apertura'
        : 'Iniciar el descenso emocional y abrir el encuadre';
    default:
      return 'Sostener la continuidad narrativa del corto';
  }
}

function describeShot(args: {
  shotTypeLabel: string;
  beat: string;
  performer: string;
  instrument: string;
  place: string;
  elements: string[];
  timeOfDay: string;
}): string {
  const anchor = args.elements[0] ? `, con ${args.elements[0]} en el encuadre` : '';
  const base = `${capitalize(args.shotTypeLabel)} de ${args.performer} interpretando ${args.instrument} en ${args.place}${anchor}.`;
  switch (args.beat) {
    case 'opening':
      return `${base} El intérprete aparece integrado en el entorno, todavía a distancia; la luz de ${args.timeOfDay} define la profundidad del plano.`;
    case 'development':
      return `${base} El gesto de la interpretación es claramente visible: manos, brazos y respiración trabajando sobre el instrumento.`;
    case 'climax':
      return `${base} Máxima cercanía y máxima intensidad: la expresión del rostro y la tensión del gesto dominan el encuadre.`;
    case 'closing':
      return `${base} El movimiento se calma, el encuadre se abre y la figura vuelve a integrarse en el paisaje.`;
    default:
      return base;
  }
}

function tempoFor(mood: string): number {
  const map: Record<string, number> = {
    melancólico: 62,
    contemplativo: 58,
    solemne: 54,
    esperanzado: 78,
    tenso: 88,
    sereno: 66,
  };
  return map[mood] ?? 70;
}

function buildHashtags(instrumentNames: string[], style: string, scenario: string): string[] {
  const tags = new Set<string>();
  for (const name of instrumentNames.slice(0, 3)) tags.add(`#${toTag(name)}`);
  if (style) tags.add(`#${toTag(style)}`);
  if (scenario) tags.add(`#${toTag(scenario)}`);
  tags.add('#MusicaInstrumental');
  tags.add('#AIMusic');
  tags.add('#ShortFilm');
  tags.add('#Cinematic');
  return Array.from(tags).slice(0, 10);
}

function toTag(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
