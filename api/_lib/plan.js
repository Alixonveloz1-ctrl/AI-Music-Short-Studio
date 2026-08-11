// ════════════════════════════════════════════════════════════════
// EL PLAN DE PRODUCCIÓN — donde se juntan las dos mitades.
//
// El Productor decide la ESTRUCTURA solo con números: cuántas tomas,
// cuánto dura cada una, cómo se parten en clips y dónde se reutiliza
// material. Eso no lo toca ninguna IA, y por eso la duración total
// siempre cuadra al segundo.
//
// El planificador creativo (Claude o el interno) escribe la CAPA
// CREATIVA: concepto, biblia visual y una descripción por toma.
//
// Aquí se cosen las dos y sale el plan con el que se generan todos los
// activos. La separación importa: se puede cambiar quién escribe la
// parte creativa sin que cambien la duración, el número de tomas ni la
// cadena de continuidad.
// ════════════════════════════════════════════════════════════════
const { planStructure } = require('./productor');
const { buildVisualBible } = require('./arte');
const { plan: planificar } = require('./planificador');
const {
  INSTRUMENTS_BY_ID, FORMATIONS_BY_ID, SCENARIOS_BY_ID, generoDe,
} = require('./catalogo');

/**
 * Construye el plan completo a partir de la configuración del usuario.
 *
 * Devuelve `{ plan, avisos }`. Los avisos no son fallos: el caso normal es
 * «Claude no pudo, se usó el planificador interno», y el proyecto se crea
 * igualmente. Que la creación de un proyecto nunca falle por la capa creativa
 * es deliberado — hay un plan determinista detrás precisamente para eso.
 */
async function construirPlan(config) {
  const avisos = [];
  const estructura = planStructure(config.durationSec);

  // Cuántas veces sale cada plano en pantalla. El Director lo necesita: una
  // toma que va a volver tres veces no se escribe igual que una que solo se ve
  // una vez, y de eso depende que la mitad del corto se pueda montar con
  // material repetido sin que cante.
  const apariciones = new Map();
  let anterior = null;
  for (const entradaTl of estructura.timeline) {
    if (entradaTl.shotId === anterior) continue; // dos clips de la misma toma
    anterior = entradaTl.shotId;
    apariciones.set(entradaTl.shotId, (apariciones.get(entradaTl.shotId) || 0) + 1);
  }

  const entrada = {
    config,
    runtimeSec: config.durationSec,
    shots: estructura.shots.map((s) => ({
      index: s.index,
      label: s.label,
      beat: s.beat,
      shotType: s.shotType,
      cameraMove: s.cameraMove,
      durationSec: s.durationSec,
      reusable: s.reusable,
      apariciones: apariciones.get(s.id) || 1,
    })),
  };

  const resultado = await planificar(entrada);
  const brief = resultado.brief;
  const plannedBy = resultado.plannedBy;
  for (const aviso of resultado.warnings || []) avisos.push(aviso);

  const bible = buildVisualBible(config, brief);

  const shots = estructura.shots.map((planned) => {
    const creative = brief.shots.find((s) => s.index === planned.index);
    return {
      id: planned.id,
      index: planned.index,
      label: planned.label,
      beat: planned.beat,
      shotType: planned.shotType,
      cameraMove: planned.cameraMove,
      // Quién sale en la toma: 'todos' o el número del intérprete. Sin esto,
      // el Director de Arte no sabe a quién poner en el encuadre y un dúo
      // acaba con la misma persona en todas las tomas.
      subject: (creative && creative.subject) || 'todos',
      purpose: (creative && creative.purpose) || 'Sostener la continuidad narrativa del corto',
      description:
        (creative && creative.description) ||
        'Plano del intérprete tocando ' + bible.instrument.names.join(' y ') +
          ' en ' + bible.environment.location + '.',
      durationSec: planned.durationSec,
      reusable: planned.reusable,
      clips: planned.clips.map((clip) => ({
        id: clip.id,
        shotId: clip.shotId,
        index: clip.index,
        suffix: clip.suffix,
        label: clip.label,
        durationSec: clip.durationSec,
        motionNote: '',
      })),
    };
  });

  // Las notas de movimiento se rellenan cuando las tomas ya están descritas:
  // dependen de cuántos clips tiene la toma, no del clip por separado.
  for (const shot of shots) {
    const total = shot.clips.length;
    shot.clips.forEach((clip, i) => {
      clip.motionNote =
        total === 1
          ? 'Toma completa en un solo clip.'
          : i === 0
            ? 'Arranque del movimiento de cámara y de la frase musical.'
            : i === total - 1
              ? 'Cierre del movimiento; la cámara se estabiliza al final.'
              : 'Continuación del movimiento sin cambios de dirección.';
    });
  }

  const timeline = estructura.timeline.map((e) => ({
    index: e.index,
    shotId: e.shotId,
    clipId: e.clipId,
    clipAssetId: e.clipId,
    startSec: e.startSec,
    durationSec: e.durationSec,
    reused: e.reused,
    transitionIn: e.transitionIn,
  }));

  const plan = {
    concept: {
      title: brief.title,
      logline: brief.logline,
      emotionalIntent: brief.emotionalIntent,
      emotionalArc: brief.emotionalArc,
      mood: brief.mood,
      palette: brief.palette,
      timeOfDay: brief.timeOfDay,
    },
    visualBible: bible,
    shots,
    timeline,
    music: briefMusical(config, brief, bible),
    ambient: briefAmbiental(config, brief),
    delivery: {
      title: brief.title,
      description: brief.delivery.description,
      hashtags: brief.delivery.hashtags,
    },
    notes: brief.notes,
    plannedBy,
    plannedAt: new Date().toISOString(),
    economics: estructura.economics,
  };

  for (const shot of shots) shot.description = String(shot.description).trim();

  return { plan, avisos };
}

/**
 * El encargo para el compositor.
 *
 * La última línea no es un adorno: el producto es instrumental por definición
 * (§3, §28) y una voz colada arruina el corto entero, así que la prohibición
 * viaja en el prompt Y en el prompt negativo.
 */
/**
 * EL PROMPT DE MÚSICA EN INGLÉS.
 *
 * Lyria es el ÚNICO servicio de toda la herramienta que no entiende español:
 * contesta «Unsupported language detected. Please use one of the supported
 * languages: en» y no compone nada. Y traducir la prosa palabra por palabra
 * devuelve espanglish —«Instrumentación: Erhu. Carácter: tense»— que es peor
 * que el original.
 *
 * Así que el encargo se escribe DOS VECES desde los mismos datos: en español
 * para enseñárselo al usuario (PRD §19) y en inglés para mandárselo al modelo.
 * No es una traducción, es la misma ficha compuesta en dos idiomas, y por eso
 * sale exacta: los campos son cerrados —instrumentos, formación, carácter,
 * tonalidad, escala— y de cada uno se sabe su equivalente.
 *
 * Lo que NO viaja al inglés: la estructura por secciones y la intención
 * emocional, que son prosa libre del planificador. La estructura la sustituye
 * la línea de tiempo [MM:SS] que arma vertex.js, que es más precisa y además es
 * la única forma de pedirle la duración. Y la paleta de color no le dice nada a
 * un modelo de música.
 */

// Do Re Mi → C D E. Sin esto la tonalidad llega como «Sol menor» y se ignora.
const NOTAS_EN = { do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' };

function tonalidadEn(texto) {
  const t = String(texto || '').trim().toLowerCase();
  const m = /^(do|re|mi|fa|sol|la|si)\s*(sostenido|bemol|#|b)?\s*(mayor|menor)?/.exec(t);
  if (!m) return String(texto || '');
  const alteracion = m[2] === 'sostenido' || m[2] === '#' ? '#' : (m[2] === 'bemol' || m[2] === 'b' ? 'b' : '');
  const modo = m[3] === 'mayor' ? ' major' : (m[3] === 'menor' ? ' minor' : '');
  return NOTAS_EN[m[1]] + alteracion + modo;
}

// Las cinco primeras son EXACTAMENTE las que sortea el planificador; el resto
// están por si mañana se amplía la lista o el brief lo escribe Claude. Una
// prueba comprueba que la tabla cubre todas las del planificador, para que
// añadir una escala nueva sin traducirla no pase desapercibido.
const ESCALAS_EN = {
  'menor natural': 'natural minor', 'menor armónica': 'harmonic minor',
  'pentatónica menor': 'minor pentatonic', 'modo dórico': 'dorian mode',
  'modo lidio': 'lydian mode',
  'menor melódica': 'melodic minor', 'mayor': 'major', 'menor': 'minor',
  'pentatónica mayor': 'major pentatonic', 'modo frigio': 'phrygian mode',
  'modo mixolidio': 'mixolydian mode', 'modo eólico': 'aeolian mode',
  'modo locrio': 'locrian mode', 'dórico': 'dorian', 'frigio': 'phrygian',
  'lidio': 'lydian', 'mixolidio': 'mixolydian', 'eólico': 'aeolian',
  'locrio': 'locrian', 'blues': 'blues', 'cromática': 'chromatic',
};

const CARACTER_EN = {
  'melancólico': 'melancholic', 'contemplativo': 'contemplative', 'sereno': 'serene',
  'íntimo': 'intimate', 'cálido': 'warm', 'nostálgico': 'nostalgic',
  'solemne': 'solemn', 'amplio': 'expansive', 'reverente': 'reverent',
  'esperanzado': 'hopeful', 'luminoso': 'luminous', 'tenso': 'tense',
  'misterioso': 'mysterious', 'contenido': 'restrained',
  // Los que trae el carácter deducido del contexto. Sin estos, un corto de
  // zombies le pedía a Lyria «desolado, crudo, amenazante» en español y el
  // modelo, que sólo entiende inglés, se los saltaba enteros.
  'oscuro': 'dark', 'amenazante': 'menacing', 'pesado': 'heavy',
  'épico': 'epic', 'eléctrico': 'electric', 'nocturno': 'nocturnal',
  'sintético': 'synthetic', 'crudo': 'raw', 'dramático': 'dramatic',
  'desgastado': 'worn', 'delicado': 'delicate', 'aireado': 'airy',
  'clásico': 'classical', 'urbano': 'urban', 'inquieto': 'restless',
  'enorme': 'huge', 'eufórico': 'euphoric', 'poderoso': 'powerful',
  'sacro': 'sacred', 'antiguo': 'ancient', 'árido': 'arid',
  'desolado': 'desolate', 'cercano': 'close', 'limpio': 'clean',
  'preciso': 'precise', 'con garra': 'gritty', 'agresivo': 'aggressive',
  'implacable': 'relentless', 'siniestro': 'sinister', 'inquietante': 'unsettling',
  'doliente': 'mournful', 'alegre': 'joyful', 'vivo': 'lively',
  'bailable': 'danceable', 'electrónico': 'electronic', 'pulsante': 'pulsing',
  'jazzístico': 'jazzy', 'humeante': 'smoky', 'libre': 'free',
  'tierno': 'tender', 'rítmico': 'rhythm-driven', 'contundente': 'hard-hitting',
  'rotundo': 'bold', 'lírico': 'lyrical', 'expresivo': 'expressive',
  'claro': 'clear', 'articulado': 'articulate', 'brillante': 'bright',
  // Los que trae cada género musical.
  'cinematográfico': 'cinematic', 'elegante': 'elegant', 'flotante': 'floating',
  'sencillo': 'simple', 'festivo': 'festive', 'virtuoso': 'virtuosic',
  'intenso': 'intense', 'pasional': 'passionate', 'romántico': 'romantic',
  'bailable': 'danceable', 'suave': 'soft', 'sofisticado': 'sophisticated',
  'urgente': 'urgent', 'relajado': 'laid-back',
};

const ACUSTICA_EN = { dry: 'dry, close and intimate', natural: 'natural room reverb', hall: 'large hall reverb' };

/**
 * El nombre INGLÉS de un instrumento: SU PROPIO ID.
 *
 * Los ids del catálogo están en inglés por construcción —`drum_kit`,
 * `bass_guitar`, `hurdy_gurdy`, `french_horn`, `timpani`— así que el nombre que
 * Lyria entiende ya estaba escrito, y con guiones bajos por toda diferencia.
 *
 * Antes se usaba el primer alias, y ahí estaba el fallo: el primer alias de la
 * batería es «bateria», el nombre español sin la tilde, que a un modelo inglés
 * no le dice nada. Se probó a descartar el alias que coincidiera con el nombre
 * español, y eso rompía el violín —donde el español y el inglés son la misma
 * palabra— y lo dejaba en «fiddle». La respuesta no era una heurística mejor:
 * era mirar el dato exacto que ya existía.
 */
function instrumentoEn(instrumento) {
  return String(instrumento.id).replace(/_/g, ' ');
}

function sinTildes(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Familias de instrumento que NO llevan la melodía.
 *
 * Pedirle a una batería que «lleve la melodía de principio a fin» es pedirle
 * algo que no puede hacer, y el modelo resuelve esa contradicción metiendo un
 * instrumento melódico que nadie pidió. El usuario lo describió exacto: puso
 * batería y le salió algo que «parece de un xilófono».
 */
const FAMILIAS_SIN_MELODIA = ['percussion'];

function enLista(texto, tabla) {
  return String(texto || '')
    .split(/\s*,\s*/)
    .map((x) => tabla[x.trim().toLowerCase()] || x.trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * El mundo en el que ocurre la pieza, en inglés.
 *
 * Su petición fue clara: «no es que lo pongas literal en el prompt, sólo te
 * digo qué esperaba: el director debería poder interpretar, darle contexto a la
 * situación». Eso es esto — el compositor necesita saber dónde pasa la escena
 * antes de escribir la primera nota.
 *
 * Y NO SE PEGA SU TEXTO TAL CUAL, aunque lo intenté. Lyria rechaza la llamada
 * entera con «Unsupported language detected» en cuanto ve otro idioma, así que
 * «vía pública abandonada» dejaría el corto sin música. Se lee y se convierte
 * en una frase inglesa, igual que se hace con el ambiente y con el carácter.
 *
 * Lo que no reconoce, se calla: una palabra en español dentro del encargo vale
 * menos que nada, porque tumba la llamada entera.
 */
const CONTEXTO_EN = [
  { palabras: ['postapocalip', 'post-apocalip', 'apocalip', 'ruinas', 'zombi', 'zombie', 'devastad'],
    frase: 'a post-apocalyptic wasteland' },
  { palabras: ['abandonad', 'desierta', 'vacio', 'vacío', 'solitari', 'nadie'], frase: 'an abandoned, empty place' },
  { palabras: ['guerra', 'batalla', 'bombard'], frase: 'a war zone' },
  { palabras: ['terror', 'miedo', 'siniestr', 'macabr', 'pesadilla'], frase: 'a horror scene' },
  { palabras: ['funeral', 'duelo', 'luto', 'despedida'], frase: 'a farewell' },
  { palabras: ['fiesta', 'celebra', 'bail'], frase: 'a celebration' },
  { palabras: ['lluvia', 'tormenta'], frase: 'rain and storm' },
  { palabras: ['nieve', 'invierno', 'hielo'], frase: 'deep winter' },
  { palabras: ['noche', 'nocturn', 'madrugada'], frase: 'the middle of the night' },
  { palabras: ['amanecer', 'alba'], frase: 'first light' },
  { palabras: ['atardecer', 'ocaso', 'puesta de sol'], frase: 'sunset' },
  { palabras: ['niebla', 'bruma'], frase: 'thick fog' },
  { palabras: ['mar', 'playa', 'oceano', 'océano'], frase: 'the sea' },
  { palabras: ['bosque', 'selva'], frase: 'deep forest' },
  { palabras: ['desierto', 'arena'], frase: 'a desert' },
  { palabras: ['ciudad', 'urban', 'calle'], frase: 'a city' },
  { palabras: ['espacio', 'galax', 'planeta', 'estrellas'], frase: 'outer space' },
  { palabras: ['sueno', 'sueño', 'onirico', 'onírico', 'irreal'], frase: 'a dream' },
];

function contextoDelUsuario(config) {
  const texto = sinTildes(
    [config.creativeDirection, config.scenarioCustom, config.visualStyleCustom]
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .join('. '),
  );
  if (!texto) return '';
  const frases = [];
  for (const entrada of CONTEXTO_EN) {
    if (entrada.palabras.some((pal) => texto.indexOf(sinTildes(pal)) !== -1)) frases.push(entrada.frase);
  }
  return frases.slice(0, 3).join(', ');
}

/**
 * CÓMO SE TOCA EL INSTRUMENTO, en inglés.
 *
 * El catálogo guarda la técnica en español —«rasgueo rápido de cuatro
 * cuerdas», «arco sobre cuerdas», «baquetas y pedales»— y esa palabra cambia la
 * música entera: un cuatro rasgueado y un cuatro punteado no se parecen en
 * nada. El vídeo SÍ usaba ese dato y la música no, y por eso el personaje
 * rasgueaba joropo mientras sonaba una pieza melancólica de cuerdas pulsadas
 * una a una.
 *
 * No hace falta traducir las 89 técnicas: basta reconocer el gesto, que es un
 * puñado y es lo único que le importa a un compositor.
 */
const GESTOS = [
  { palabras: ['rasgue', 'rasgu'], en: 'strummed hard and fast' },
  { palabras: ['arco'], en: 'bowed' },
  { palabras: ['baqueta', 'pedal', 'golpe', 'maza', 'percut'], en: 'struck' },
  { palabras: ['punteo', 'pulsad', 'pua', 'púa', 'dedos sobre las cuerdas', 'pellizc'], en: 'plucked' },
  { palabras: ['soplo', 'embocadura', 'boquilla', 'aire', 'lengueta', 'lengüeta'], en: 'blown' },
  { palabras: ['tecla'], en: 'played on keys' },
  { palabras: ['fuelle'], en: 'played with bellows' },
  { palabras: ['secuenciad', 'pads'], en: 'sequenced' },
];

function gestoEn(instrumentos) {
  const texto = sinTildes(instrumentos.map((i) => i.technique || '').join(' . '));
  for (const g of GESTOS) {
    if (g.palabras.some((pal) => texto.indexOf(sinTildes(pal)) !== -1)) return g.en;
  }
  return '';
}

// El género —el elegido, el escrito a mano o el que le pega al instrumento— se
// resuelve en el catálogo, no aquí, porque lo lee también la parte visual y un
// require cruzado entre el plan y la dirección de arte sería circular.

function promptMusicalEn(config, brief, instrumentos, formacion, escenario, contexto) {
  const genero = generoDe(config, instrumentos);
  const gesto = gestoEn(instrumentos);
  const nombres = instrumentos.map(instrumentoEn);
  return [
    'Instrumental music for a short film. ' + config.durationSec + ' seconds long.',
    'Instruments: ' + (nombres.join(', ') || 'a single solo instrument') +
      '. Ensemble: ' + String((formacion && formacion.id) || 'solo').replace(/_/g, ' ') + '.',
    // EL GÉNERO VA ARRIBA. Es lo que más define lo que va a componer, más que
    // cualquier adjetivo: «joropo venezolano» dice más que «vivo, festivo».
    genero && genero.en ? 'Genre: ' + genero.en + '.' : '',
    gesto ? 'How it is physically played: ' + gesto + '. Keep that gesture, at whatever intensity the genre calls for.' : '',
    'Mood: ' + (enLista(brief.music.mood, CARACTER_EN) || 'contemplative') + '.',
    // Una batería no tiene tonalidad ni escala. Pedírselas es darle al modelo
    // una instrucción que sólo puede cumplir metiendo un instrumento afinado
    // que nadie pidió — que es de donde salía el xilófono.
    FAMILIAS_SIN_MELODIA.indexOf(instrumentos.length ? instrumentos[0].categoryId : '') !== -1
      ? 'Tempo: around ' + brief.music.tempoBpm + ' BPM. No key and no scale: this is a ' +
        'percussion piece, it is not tuned.'
      : 'Key: ' + tonalidadEn(brief.music.key) +
        '. Scale: ' + (ESCALAS_EN[String(brief.music.scale || '').toLowerCase()] || brief.music.scale) +
        '. Tempo: around ' + brief.music.tempoBpm + ' BPM.',
    'Recording space: ' + (ACUSTICA_EN[(escenario && escenario.acoustics)] || 'natural room reverb') + '.',
    liderazgoEn(instrumentos, nombres),
    // LO QUE ESCRIBIÓ EL USUARIO, tal cual. No es lo mismo que el carácter
    // deducido: aquel son cuatro adjetivos, esto es su frase entera, y Lyria
    // entiende «post-apocalyptic wasteland» mucho mejor que «desolate, raw».
    contexto ? 'This piece plays over: ' + contexto + '.' : null,
  ].filter(Boolean).join('\n');
}

/**
 * Quién lleva la voz cantante, y si la lleva alguien.
 *
 * Una batería sola no toca una melodía: marca el ritmo y la pieza se construye
 * encima. Decirle lo contrario es lo que hacía aparecer un xilófono.
 */
function liderazgoEn(instrumentos, nombres) {
  const familia = instrumentos.length ? instrumentos[0].categoryId : '';
  const sinMelodia = FAMILIAS_SIN_MELODIA.indexOf(familia) !== -1;

  if (nombres.length > 1) {
    return sinMelodia
      ? 'All ' + nombres.length + ' instruments play together throughout, driven by ' +
        nombres[0] + '. The rhythm leads and everything else is built on top of it.'
      : 'All ' + nombres.length + ' instruments play together throughout; ' +
        nombres[0] + ' leads the melody.';
  }
  return sinMelodia
    ? 'This is a SOLO ' + nombres[0] + ' piece and the ' + nombres[0] + ' is the ONLY thing ' +
      'playing. It carries the whole piece with rhythm, dynamics and fills — not with a tune. ' +
      'Do NOT add a melodic instrument to carry a melody: there is no melody instrument here.'
    : 'The solo instrument carries the melody from start to finish.';
}

function briefMusical(config, brief, bible) {
  const instrumentos = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id))
    .filter(Boolean);
  const formacion = FORMATIONS_BY_ID.get(config.formationId);
  const escenario = SCENARIOS_BY_ID.get(config.scenarioId);
  const instrumentacion = instrumentos.map((i) => i.name);

  const prompt = [
    'Pieza musical exclusivamente instrumental de ' + config.durationSec + ' segundos.',
    'Instrumentación: ' + (instrumentacion.join(', ') || 'instrumento solista') +
      '. Formación: ' + ((formacion && formacion.label) || 'Solista') + '.',
    'Estilo: ' + brief.music.style + '.',
    'Carácter: ' + brief.music.mood + '. Intención emocional: ' + brief.emotionalIntent,
    'Tonalidad: ' + brief.music.key + ', ' + brief.music.scale +
      '. Tempo aproximado: ' + brief.music.tempoBpm + ' BPM.',
    'Estructura: ' + brief.music.structure,
    'Espacio sonoro coherente con ' + ((escenario && escenario.label) || 'el escenario') +
      ' (acústica ' + ((escenario && escenario.acoustics) || 'natural') + ').',
    'Paleta emocional del corto: ' + bible.aesthetic.finish + '.',
    'Sin voz, sin coros, sin letra, sin palabras. Solo instrumentos.',
  ].join('\n');

  return {
    title: brief.title,
    instrumentation: instrumentacion,
    // Los mismos, en inglés, que es lo que entiende Lyria.
    instrumentationEn: instrumentos.map(instrumentoEn),
    // El género ya resuelto —el elegido o el que le pega al instrumento— y con
    // cuánta energía se toca. El VÍDEO lee esto: es lo que evita que el
    // personaje rasguee joropo mientras suena una balada.
    genre: generoDe(config, instrumentos),
    style: brief.music.style,
    mood: brief.music.mood,
    tempoBpm: brief.music.tempoBpm,
    key: brief.music.key,
    scale: brief.music.scale,
    structure: brief.music.structure,
    durationSec: config.durationSec,
    prompt,
    // El mismo encargo en inglés, que es lo que se le manda a Lyria. El de
    // arriba, en español, es el que ve el usuario.
    promptEn: promptMusicalEn(config, brief, instrumentos, formacion, escenario, contextoDelUsuario(config)),
    negativePrompt: 'voz, canto, coros, letra, palabras habladas, aplausos, ruido de público',
  };
}

/** El encargo para el lecho ambiental, que siempre va por debajo de la música. */
function briefAmbiental(config, brief) {
  const escenario = SCENARIOS_BY_ID.get(config.scenarioId);
  // Las capas que intentará montar el sintetizador. Se le añade lo que escribió
  // el usuario: sus ocho capas se eligen por palabras sueltas, así que si él
  // escribió «viento» al menos esa la va a acertar. No arregla el sintetizador
  // —no sabe hacer metal chirriando— pero le da lo poco que puede aprovechar.
  const capas = (brief.ambient.layers.length
    ? brief.ambient.layers
    : (escenario && escenario.ambience) || ['ambiente neutro']
  ).concat(String(config.scenarioCustom || '').trim() ? [config.scenarioCustom.trim()] : []);

  const prompt = [
    'Lecho de sonido ambiental de ' + config.durationSec + ' segundos para ' +
      ((escenario && escenario.label) || 'el escenario') + '.',
    'Capas: ' + capas.join(', ') + '.',
    brief.ambient.description,
    'Acústica del espacio: ' + ((escenario && escenario.acoustics) || 'natural') + '.',
    'Debe quedar siempre por debajo de la música. Sin voces, sin palabras, sin música.',
  ].join('\n');

  return {
    layers: capas,
    description: brief.ambient.description,
    acoustics: (escenario && escenario.acoustics) || 'natural',
    durationSec: config.durationSec,
    prompt,
    // El mismo encargo en inglés, para cuando el ambiente se genera con la IA.
    // El sintetizador usa `layers`; la IA usa esto.
    promptEn: promptAmbienteEn(config, escenario, capas),
  };
}

/**
 * EL ENCARGO DEL AMBIENTE EN INGLÉS.
 *
 * Lo que el sintetizador no puede hacer y esto sí: entender dónde ocurre la
 * escena. El usuario lo pidió con su propio ejemplo — «un mundo postapocalíptico
 * lleno de zombis: viento, metal chirriando, gruñidos a lo lejos» — y el
 * sintetizador, con sus ocho capas de viento, agua y pájaros, no tiene con qué.
 *
 * PERO SU TEXTO NO SE PUEDE PEGAR TAL CUAL. Lyria sólo entiende inglés y
 * rechaza el encargo entero con «Unsupported language detected» en cuanto
 * detecta otro idioma; meterle «vía pública abandonada llena de zombis» sería
 * dejar el ambiente sin generar. Así que su texto se LEE y se convierte en
 * sonidos concretos en inglés, igual que se hace con el carácter de la música.
 *
 * Sobre las voces: la pieza musical no lleva ninguna y eso no se toca. Pero un
 * ambiente sí puede llevar presencia humana —una multitud lejana ya existe en el
 * sintetizador— y el ejemplo del usuario la necesita. Se prohíbe lo que es
 * narración —palabras, canto, diálogo— y se deja pasar la textura.
 */

/**
 * Lo que el usuario escribe, convertido en sonidos.
 *
 * No es un traductor: es la lista de sitios y situaciones que cambian por
 * completo a qué suena una escena. Se acumulan todas las que aparezcan, porque
 * «ruinas de noche bajo la lluvia» son las tres cosas a la vez.
 */
const AMBIENTE_ESCRITO = [
  { palabras: ['postapocalip', 'post-apocalip', 'apocalip', 'ruinas', 'ruina', 'zombi', 'zombie', 'devastad'],
    suena: 'wind moving through ruined concrete and broken windows, distant metal groaning and creaking, ' +
      'loose debris shifting, a low ominous rumble underneath, and far-off non-verbal groans' },
  { palabras: ['abandonad', 'desierta', 'desierto', 'vacio', 'vacío', 'solitari', 'nadie'],
    suena: 'an empty place with no people in it: thin wind, hollow distant echoes, long silences' },
  { palabras: ['lluvia', 'lloviendo', 'llueve'], suena: 'steady rain and water dripping off edges' },
  { palabras: ['tormenta', 'truen'], suena: 'gusting wind and distant thunder' },
  { palabras: ['nieve', 'nevad', 'hielo', 'frio', 'frío'], suena: 'the muffled quiet of snow, cold thin wind' },
  { palabras: ['fuego', 'incendi', 'llamas', 'hogera', 'hoguera'], suena: 'crackling fire and settling embers' },
  { palabras: ['guerra', 'batalla', 'bombard'], suena: 'far-off explosions, falling debris, wind over rubble' },
  { palabras: ['fabrica', 'fábrica', 'industrial', 'almacen', 'almacén'],
    suena: 'a low machinery hum, metal ticking as it cools, wide concrete reverb' },
  { palabras: ['cueva', 'tunel', 'túnel', 'subterran', 'subterrán', 'metro'],
    suena: 'water dripping in a deep enclosed space with a long echo' },
  { palabras: ['mar', 'playa', 'oceano', 'océano', 'costa'], suena: 'waves, sea wind and distant gulls' },
  { palabras: ['bosque', 'selva', 'arbol', 'árbol'], suena: 'leaves moving, birds, branches creaking' },
  { palabras: ['ciudad', 'urban', 'calle'], suena: 'distant traffic and the low hum of a city' },
  { palabras: ['multitud', 'gente', 'publico', 'público'], suena: 'a distant crowd murmur, no words audible' },
  { palabras: ['noche', 'nocturn'], suena: 'the stillness of night air, faint distant insects' },
  { palabras: ['viento'], suena: 'wind' },
  { palabras: ['metal', 'chirri', 'oxid'], suena: 'metal creaking and groaning' },
];

/**
 * Las frases de ambiente del catálogo, en inglés.
 *
 * Son 47 en total y todas están aquí: es un vocabulario cerrado, así que se
 * traduce entero en vez de intentar adivinarlo. Lo que no esté se descarta —
 * mejor una capa de menos que una palabra en español que tumbe la llamada.
 */
const AMBIENTE_CATALOGO_EN = {
  'agua corriente': 'running water', 'agua suave': 'gentle water',
  'ambiente de sala': 'room tone of a hall', 'ambiente del público': 'audience presence',
  'ambiente neutro': 'neutral room tone', 'aves acuáticas': 'water birds',
  'brisa': 'a light breeze', 'campanillas lejanas': 'distant small bells',
  'ciudad lejana': 'a distant city', 'crujido de ramas': 'branches creaking',
  'eco abierto': 'open-air echo', 'eco del recinto': 'the echo of a large venue',
  'eco lejano': 'a distant echo', 'gaviotas': 'gulls', 'grillos': 'crickets',
  'hojas': 'leaves', 'insectos': 'insects', 'olas': 'waves', 'palomas': 'pigeons',
  'pasos': 'footsteps', 'pájaros': 'birds', 'pájaros lejanos': 'distant birds',
  'público': 'an audience', 'público en silencio': 'a silent audience',
  'reverberación': 'reverb', 'reverberación cálida': 'warm reverb',
  'reverberación larga': 'long reverb', 'reverberación suave': 'soft reverb',
  'ruido de casa muy leve': 'the very faint noise of a house',
  'rumor urbano': 'an urban murmur', 'sala en silencio': 'a silent hall',
  'silencio amplio': 'wide silence', 'silencio denso': 'dense silence',
  'silencio interior': 'indoor silence', 'silencio tratado': 'treated silence',
  'tráfico lejano': 'distant traffic', 'viento': 'wind',
  'viento de altura': 'high-altitude wind', 'viento de arena': 'wind carrying sand',
  'viento en altura': 'high wind', 'viento entre las hojas': 'wind through leaves',
  'viento marino': 'sea wind', 'viento sobre la hierba': 'wind over grass',
  'viento suave': 'a soft wind', 'voces': 'distant voices', 'voces lejanas': 'far-off voices',
};

const ACUSTICA_AMBIENTE_EN = {
  dry: 'dry and close, almost no reverb',
  natural: 'a natural outdoor space with some distance',
  hall: 'a large reverberant hall',
};

function sonidosEscritos(...textos) {
  const texto = textos.map(sinTildes).filter(Boolean).join(' . ');
  if (!texto) return [];
  const salida = [];
  for (const entrada of AMBIENTE_ESCRITO) {
    if (entrada.palabras.some((pal) => texto.indexOf(sinTildes(pal)) !== -1)) salida.push(entrada.suena);
  }
  return salida;
}

function promptAmbienteEn(config, escenario, capas) {
  // Lo que el usuario describió del LUGAR manda sobre las capas del catálogo:
  // para «Vía pública» el catálogo pide «tráfico lejano, pasos, voces», y eso es
  // justo lo contrario de una calle abandonada en un mundo sin nadie.
  const suyos = sonidosEscritos(config.scenarioCustom, config.creativeDirection);
  const delCatalogo = capas
    .map((c) => AMBIENTE_CATALOGO_EN[String(c).trim().toLowerCase()])
    .filter(Boolean);
  const lista = suyos.length ? suyos : delCatalogo;

  return [
    'The background sound of a place, for a short film.',
    'Setting: ' + ((escenario && escenario.label ? escenarioEn(escenario) : 'an open space')) + '.',
    lista.length ? 'What is heard: ' + lista.join('; ') + '.' : '',
    'Space: ' + (ACUSTICA_AMBIENTE_EN[(escenario && escenario.acoustics)] || ACUSTICA_AMBIENTE_EN.natural) + '.',
    'Whatever this place would really sound like: weather, materials, distance, room tone. ' +
      'Distant non-verbal human or creature presence is allowed if the scene calls for it, ' +
      'but NO words, NO speech, NO singing and NO narration.',
  ].filter(Boolean).join('\n');
}

/** El id del escenario ya está en inglés, igual que el de los instrumentos. */
function escenarioEn(escenario) {
  return String(escenario.id).replace(/_/g, ' ');
}

module.exports = { construirPlan, briefMusical, briefAmbiental };
