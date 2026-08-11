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
const { INSTRUMENTS_BY_ID, FORMATIONS_BY_ID, SCENARIOS_BY_ID } = require('./catalogo');

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
 * Lo que el usuario escribió, en una línea, para dárselo a Lyria como contexto.
 *
 * Su petición fue clara: «no es que lo pongas literal en el prompt, sólo te
 * digo qué esperaba: el director debería poder interpretar, darle contexto a la
 * situación». Esto es justo eso — no se le manda como una orden de género, se le
 * manda como el mundo en el que ocurre la pieza, que es lo que un compositor
 * necesita saber antes de escribir la primera nota.
 *
 * Va en inglés a trompicones si el usuario escribió en español, y da igual:
 * Lyria entiende «postapocaliptico» perfectamente en un texto por lo demás
 * inglés, y traducirlo a mano sería inventarse lo que quiso decir.
 */
function contextoDelUsuario(config) {
  const partes = [config.creativeDirection, config.scenarioCustom, config.visualStyleCustom]
    .map((t) => String(t || '').trim())
    .filter(Boolean);
  if (!partes.length) return '';
  return partes.join('. ').replace(/\s+/g, ' ').slice(0, 300);
}

function promptMusicalEn(config, brief, instrumentos, formacion, escenario, contexto) {
  const nombres = instrumentos.map(instrumentoEn);
  return [
    'Instrumental music for a short film. ' + config.durationSec + ' seconds long.',
    'Instruments: ' + (nombres.join(', ') || 'a single solo instrument') +
      '. Ensemble: ' + String((formacion && formacion.id) || 'solo').replace(/_/g, ' ') + '.',
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
    contexto ? 'Context for the piece: ' + contexto : null,
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
  const capas = brief.ambient.layers.length
    ? brief.ambient.layers
    : (escenario && escenario.ambience) || ['ambiente neutro'];

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
  };
}

module.exports = { construirPlan, briefMusical, briefAmbiental };
