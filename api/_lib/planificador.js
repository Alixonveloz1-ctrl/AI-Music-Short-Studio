/**
 * El equipo de dirección: Director, Guionista y Director de Arte.
 *
 * Hay dos planificadores y siempre existe uno de los dos:
 *
 *  - `buildHeuristicBrief` es determinista: sin red, sin clave de API y sin
 *    ninguna aleatoriedad que no venga sembrada desde la configuración del
 *    proyecto. Con la misma configuración produce siempre el mismo plan, para
 *    que la lista de tomas que el usuario aprueba no le cambie por debajo entre
 *    despliegues. Hace que el estudio sea usable sin clave y es además la red
 *    de seguridad cuando Claude falla.
 *
 *  - `planWithClaude` pide el brief al modelo. Nunca decide la ESTRUCTURA: el
 *    número de tomas, las duraciones, los cortes en clips y el plan de
 *    reutilización son cosa del Productor y se quedan en código (PRD §12, §15).
 *
 * `plan` combina los dos: intenta Claude si hay clave y, si algo va mal, cae al
 * determinista devolviendo el aviso. Crear un proyecto NUNCA debe fallar por
 * culpa del planificador.
 *
 * Entrada (`input`), tal y como la arma el Productor:
 *   { config, runtimeSec, shots: [ { index, label, beat, shotType, cameraMove, durationSec } ] }
 *
 * Salida de `plan`:
 *   { brief, plannedBy: 'claude' | 'heuristic', warnings: [] }
 */
const {
  FORMATIONS_BY_ID,
  INSTRUMENTS_BY_ID,
  PERFORMER_TYPES_BY_ID,
  SCENARIOS_BY_ID,
  VISUAL_STYLES_BY_ID,
} = require('./catalogo.js');
const { shotTypeLabel, cameraMoveLabel } = require('./arte.js');
const { creativeBriefJsonSchema, normalizeCreativeBrief } = require('./brief.js');

// --- Generador de números pseudoaleatorios determinista (mulberry32) --------
// El determinismo es el motivo de tener esto en lugar de Math.random: con la
// misma configuración el equipo de producción debe proponer siempre el mismo
// plan.

function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash estable de 32 bits (FNV-1a) para sembrar el generador desde la configuración. */
function hashString(value) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pickFrom(rng, items) {
  if (items.length === 0) throw new Error('pickFrom llamado con una lista vacía');
  // El mínimo protege contra el caso límite de que rng() devuelva exactamente 1.
  const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
  return items[index];
}

// --- Material del planificador determinista --------------------------------

const TITLE_PATTERNS = [
  (instrument, place) => `Susurros de ${instrument}`,
  (instrument, place) => `${instrument} en ${place}`,
  (instrument) => `El eco del ${instrument}`,
  (instrument, place) => `Últimas luces sobre ${place}`,
  (instrument) => `Respiración de ${instrument}`,
  (instrument, place) => `${place} en silencio`,
];

const MOOD_SETS = [
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

// El color de la ropa es lo que más rápido distingue a dos músicos en un plano
// general, así que a cada uno le toca uno distinto por encima de lo que diga la
// prenda elegida.
const COLOR_OPTIONS = [
  'dominante azul profundo',
  'dominante burdeos apagado',
  'dominante verde musgo',
  'dominante crudo y arena',
];

/**
 * Reparte `cuantos` elementos de `lista` SIN repetir mientras alcancen.
 *
 * Que dos intérpretes salgan con la misma cara es el fallo más visible del
 * corto: son dos personas, y el espectador lo nota al instante. Por eso aquí no
 * se sortea cada uno por su cuenta —eso repite— sino que se baraja la lista y se
 * reparte. Sólo cuando hay más músicos que opciones se vuelve a empezar.
 */
function repartirSinRepetir(rng, lista, cuantos) {
  const salida = [];
  let bolsa = [];
  for (let n = 0; n < cuantos; n += 1) {
    if (bolsa.length === 0) bolsa = lista.slice();
    const i = Math.min(bolsa.length - 1, Math.floor(rng() * bolsa.length));
    salida.push(bolsa[i]);
    bolsa.splice(i, 1);
  }
  return salida;
}

/** El planificador determinista interno. Devuelve un brief creativo completo. */
function buildHeuristicBrief(input) {
  const { config, shots, runtimeSec } = input;
  const seed = hashString(JSON.stringify(config));
  const rng = createRng(seed);

  const instruments = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id))
    .filter((i) => Boolean(i));
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

  // ─── El reparto: una descripción distinta por músico ───
  //
  // El brief tenía UNA descripción de personaje y los dos retratos maestros
  // salían de ella, así que el modelo dibujaba dos veces a la misma chica. Aquí
  // se reparte un rostro, un peinado, una prenda y un color a cada intérprete.
  const cuantosMusicos = Math.max(1, Number(formation && formation.performerCount) || 1);
  const caras = repartirSinRepetir(rng, FACE_OPTIONS, cuantosMusicos);
  const pelos = repartirSinRepetir(rng, HAIR_OPTIONS, cuantosMusicos);
  const ropas = repartirSinRepetir(rng, WARDROBE_OPTIONS, cuantosMusicos);
  const colores = repartirSinRepetir(rng, COLOR_OPTIONS, cuantosMusicos);
  const cuerpos = repartirSinRepetir(rng, BUILD_OPTIONS, cuantosMusicos);
  const edad = performerType?.id.startsWith('young') ? 'entre 18 y 24 años' : 'entre 28 y 38 años';

  const cast = [];
  for (let n = 0; n < cuantosMusicos; n += 1) {
    const suyo = instruments.length ? instruments[n % instruments.length] : null;
    cast.push({
      instrument: suyo ? suyo.name : '',
      summary: truncate(
        `${suyo ? 'toca ' + suyo.name + ', ' : ''}con la atención puesta en la interpretación, presencia tranquila y contenida, sin gestos teatrales.`,
        380,
      ),
      face: truncate(caras[n], 290),
      hair: truncate(pelos[n], 190),
      wardrobe: truncate(`${ropas[n]}, ${colores[n]}`, 290),
      build: truncate(cuerpos[n], 190),
      apparentAge: edad,
      accessories: suyo ? [`funda del ${suyo.name}`] : [],
    });
  }


  const brief = {
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
    // `character` sigue siendo el intérprete principal, para todo lo que habla
    // de «el intérprete» en singular. `cast` es la lista completa.
    character: {
      summary: cast[0].summary,
      face: cast[0].face,
      hair: cast[0].hair,
      wardrobe: cast[0].wardrobe,
      build: cast[0].build,
      apparentAge: cast[0].apparentAge,
      accessories: lead ? [`funda del ${lead.name}`, 'anillo sencillo en la mano derecha'] : [],
    },
    cast,
    environment: {
      location: truncate(
        config.scenarioCustom?.trim() ||
          `${scenario?.label ?? 'Escenario'} — ${scenario?.elements.join(', ') ?? 'entorno abierto'}`,
        290,
      ),
      primaryElements: (scenario?.elements.length
        ? scenario.elements
        : ['fondo despejado', 'suelo visible']
      ).slice(0, 6),
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
      atmosphere: truncate(
        `niebla muy leve que hace visibles los haces de luz; dominante ${palette[0] ?? 'cálida'}`,
        190,
      ),
    },
    instrumentAppearance: truncate(
      instruments.length > 0
        ? `${instruments
            .map(
              (i) =>
                `${i.name}: factura tradicional, madera con veta visible y barniz mate desgastado por el uso, ${i.technique}`,
            )
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
      hashtags: buildHashtags(
        instruments.map((i) => i.name),
        style?.label ?? '',
        scenario?.label ?? '',
      ),
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

function purposeFor(beat, index, total) {
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

function describeShot(args) {
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

function tempoFor(mood) {
  const map = {
    melancólico: 62,
    contemplativo: 58,
    solemne: 54,
    esperanzado: 78,
    tenso: 88,
    sereno: 66,
  };
  return map[mood] ?? 70;
}

function buildHashtags(instrumentNames, style, scenario) {
  const tags = new Set();
  for (const name of instrumentNames.slice(0, 3)) tags.add(`#${toTag(name)}`);
  if (style) tags.add(`#${toTag(style)}`);
  if (scenario) tags.add(`#${toTag(scenario)}`);
  tags.add('#MusicaInstrumental');
  tags.add('#AIMusic');
  tags.add('#ShortFilm');
  tags.add('#Cinematic');
  return Array.from(tags).slice(0, 10);
}

/** Convierte un texto libre en una etiqueta: sin acentos, sin signos y en CamelCase. */
function toTag(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncate(value, max) {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

// --- Planificador con Claude ------------------------------------------------

const SYSTEM_PROMPT = `Eres el equipo de dirección de AI Music Short Studio: Director, Guionista y Director de Arte trabajando juntos.

Preparas la capa creativa de un cortometraje musical instrumental, sin voz, sin diálogo y sin narración.

Reglas que no puedes romper:
- Respeta estrictamente la configuración elegida por el usuario. No cambies el instrumento, la formación, el tipo de intérprete, el escenario, el estilo visual ni la duración.
- No introduzcas cantantes, voces, letras, texto en pantalla ni carteles.
- La continuidad es lo más importante: describe al personaje, el instrumento y el escenario con detalles concretos y repetibles, de modo que todas las tomas parezcan la misma película. Evita adjetivos vagos ("bonito", "épico") y prefiere hechos visuales ("cejas rectas", "barniz mate con una marca junto al puente").
- Escribe una entrada por cada toma de la lista que se te da, en el mismo orden y con el mismo índice, adaptando la descripción al tipo de plano y al momento del corto indicados.

- LA MITAD DEL CORTO SE MONTA CON MATERIAL REPETIDO, y las tomas marcadas como REPETIBLE son las que van a volver dos o tres veces en momentos distintos de la pieza. Esas tomas tienes que escribirlas para que aguanten volver:
  · Describe una acción CONTINUA y sin principio ni final marcados: "el arco recorre la cuerda en un movimiento sostenido", no "levanta el arco y empieza a tocar".
  · Nada que ocurra una sola vez: ni gestos únicos, ni miradas a cámara, ni un cambio de postura, ni entrar o salir de plano, ni empezar o terminar de tocar.
  · Nada que ate la toma a un instante concreto de la música o de la luz: ni "justo en el clímax", ni "cuando el sol termina de ponerse".
  · El estado del personaje y del escenario al terminar la toma tiene que ser el MISMO que al empezar, para que la siguiente vez que aparezca encaje igual de bien.
  Una toma repetible bien escrita es un fragmento de tiempo que podría estar ocurriendo en cualquier momento del corto.

- Las tomas marcadas como ÚNICA son las que llevan el momento irrepetible —la cara en el clímax, la mirada sostenida— y solo se ven una vez. Ahí sí puedes escribir un gesto concreto y un instante que no se repite: es donde va la emoción de la pieza.

- Escribe todo en español.`;

/**
 * Mensaje del usuario: le da al modelo la configuración que no puede
 * contradecir y la lista de tomas que no puede cambiar.
 */
function buildUserPrompt(input) {
  const { config, shots, runtimeSec } = input;
  const instruments = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id))
    .filter((i) => Boolean(i));
  const scenario = SCENARIOS_BY_ID.get(config.scenarioId);
  const style = VISUAL_STYLES_BY_ID.get(config.visualStyleId);
  const formation = FORMATIONS_BY_ID.get(config.formationId);
  const performerType = PERFORMER_TYPES_BY_ID.get(config.performerTypeId);

  const shotLines = shots
    .map((shot) => {
      const veces = Number(shot.apariciones) || 1;
      // La marca va al final y en mayúsculas para que no se pierda entre el
      // resto de la línea: es la que decide cómo hay que escribir la toma.
      const marca = shot.reusable
        ? `REPETIBLE — se ve ${veces} ${veces === 1 ? 'vez' : 'veces'} en el corto`
        : 'ÚNICA — se ve una sola vez';
      return `${shot.index}. ${shot.label} — ${shotTypeLabel(shot.shotType)}, ${cameraMoveLabel(shot.cameraMove)}, ${shot.durationSec} s, bloque "${shot.beat}" · ${marca}`;
    })
    .join('\n');

  const instrumentLines = instruments
    .map((i) => `- ${i.name} (${i.origin}): se toca con ${i.technique}; se sostiene ${i.posture}`)
    .join('\n');

  return `CONFIGURACIÓN DEL CORTO

Instrumentos:
${instrumentLines || '- (sin instrumentos)'}

Formación: ${formation?.label ?? 'Solista'} (${formation?.description ?? ''})
Intérprete: ${performerType?.label ?? ''} — ${performerType?.descriptor ?? ''}
Escenario: ${scenario?.label ?? ''}${config.scenarioCustom ? ` — indicación del usuario: ${config.scenarioCustom}` : ''}
Elementos habituales del escenario: ${scenario?.elements.join(', ') || 'sin definir'}
Estilo visual: ${style?.label ?? ''} — ${style?.treatment ?? ''}${config.visualStyleCustom ? `; indicación del usuario: ${config.visualStyleCustom}` : ''}
Duración total: ${runtimeSec} segundos

DIRECCIÓN CREATIVA DEL USUARIO (texto libre, tiene prioridad sobre tus preferencias):
${config.creativeDirection.trim() || '(el usuario no ha escrito indicaciones adicionales)'}

PLAN DE TOMAS YA DECIDIDO POR EL PRODUCTOR (no lo cambies, solo descríbelo):
${shotLines}

TAREA
Escribe la capa creativa completa: concepto, biblia visual (personaje, instrumento, escenario, luz), una descripción por toma, el brief musical instrumental, las capas de sonido ambiental, los metadatos de publicación y una nota breve por cada rol del equipo.`;
}

/** Modelo por defecto si no se configura ANTHROPIC_MODEL. */
const DEFAULT_MODEL = 'claude-opus-5';

/**
 * Pide el brief creativo a la API de Anthropic con `fetch` directo (sin SDK).
 *
 * Se usa el endpoint normal de mensajes con salida estructurada en lugar de un
 * ayudante que parsee por nosotros: así somos dueños de los caminos de fallo.
 * Un parseo automático convierte tanto un rechazo del modelo como una respuesta
 * cortada en el mismo "no se pudo parsear", y eso oculta POR QUÉ no se pudo
 * escribir el plan. Por eso cada caso se trata aparte, con su propio mensaje.
 */
async function planWithClaude(input, apiKey, model) {
  const fallback = buildHeuristicBrief(input);

  const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: creativeBriefJsonSchema() },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    }),
  });

  if (!respuesta.ok) {
    // El cuerpo del error trae el motivo real (clave inválida, modelo
    // desconocido, límite de peticiones...); merece la pena enseñarlo.
    const detalle = await leerTextoSeguro(respuesta);
    throw new Error(
      `La API de Anthropic respondió ${respuesta.status}${detalle ? `: ${detalle}` : ''}`,
    );
  }

  const datos = await respuesta.json();

  if (datos.stop_reason === 'refusal') {
    throw new Error(
      `El planificador rechazó la petición (${datos.stop_details?.category ?? 'sin categoría'}).`,
    );
  }
  if (datos.stop_reason === 'max_tokens') {
    throw new Error('El plan creativo se cortó por longitud antes de completarse.');
  }

  const text = (Array.isArray(datos.content) ? datos.content : [])
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) {
    throw new Error('El planificador devolvió una respuesta vacía.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('El planificador devolvió un JSON no válido.');
  }

  return normalizeCreativeBrief(parsed, fallback, input.shots.length);
}

/** Lee el cuerpo de una respuesta de error sin arriesgarse a lanzar otra excepción. */
async function leerTextoSeguro(respuesta) {
  try {
    const texto = await respuesta.text();
    return texto.slice(0, 500);
  } catch {
    return '';
  }
}

/**
 * Planifica el brief creativo. Nunca lanza por culpa de Claude: si algo falla,
 * devuelve el brief determinista y el aviso correspondiente.
 *
 * `opciones`:
 *   - apiKey: clave de Anthropic (por defecto ANTHROPIC_API_KEY)
 *   - model:  modelo a usar   (por defecto ANTHROPIC_MODEL)
 *   - modo:   'auto' | 'claude' | 'heuristic' (por defecto 'auto')
 *
 * Sin clave, 'auto' usa el determinista sin quejarse: es un modo de trabajo
 * válido, no un error. Solo 'claude' exige la clave y avisa si falta.
 */
async function plan(input, opciones) {
  const config = opciones ?? {};
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const model = config.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const modo = config.modo ?? 'auto';

  const warnings = [];
  const heuristico = buildHeuristicBrief(input);

  if (modo === 'heuristic') {
    return { brief: heuristico, plannedBy: 'heuristic', warnings };
  }

  if (!apiKey) {
    if (modo === 'claude') {
      warnings.push(
        'El planificador de Claude necesita ANTHROPIC_API_KEY. Se ha usado el planificador interno.',
      );
    }
    return { brief: heuristico, plannedBy: 'heuristic', warnings };
  }

  try {
    const brief = await planWithClaude(input, apiKey, model);
    return { brief, plannedBy: 'claude', warnings };
  } catch (error) {
    warnings.push(
      `El planificador de Claude no pudo completar el brief (${mensajeDeError(error)}). Se ha usado el planificador interno.`,
    );
    return { brief: heuristico, plannedBy: 'heuristic', warnings };
  }
}

function mensajeDeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

module.exports = {
  buildHeuristicBrief,
  buildUserPrompt,
  planWithClaude,
  plan,
  SYSTEM_PROMPT,
};
