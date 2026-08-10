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
