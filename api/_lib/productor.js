/**
 * El Productor (PRD §15).
 *
 * Decide *qué tiene que existir*: cuántas tomas necesita el corto, cuánto dura
 * cada una, cómo se parte una toma larga en clips generables y — lo más
 * importante — dónde se puede reutilizar material ya aprobado en lugar de
 * generar algo nuevo (PRD §25, §33). La capa creativa nunca toca estos números,
 * así que la aritmética de duración es siempre exacta sea cual sea el
 * planificador que escriba el brief.
 */
const { MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } = require('./constantes.js');

// Formas de los objetos que devuelve este módulo (antes eran interfaces):
//
// PlannedClip:          { id, shotId, index, suffix, label, durationSec }
// PlannedShot:          { id, index, label, beat, shotType, cameraMove,
//                         durationSec, reusable, clips }
// PlannedTimelineEntry: { index, shotId, clipId, startSec, durationSec,
//                         reused, transitionIn, beat }
// Structure:            { shots, timeline, economics }
//   economics:          { runtimeSec, generatedFootageSec, uniqueShots,
//                         timelineSlots, reusedSlots }

/**
 * Reparto del metraje por bloque narrativo.
 *
 * `weight` es la parte del corto que se lleva cada bloque. Antes había también
 * un `baseSlotSec` por bloque —planos de 8 en la apertura, de 6 en el
 * desarrollo, de 4 en el clímax— para darle ritmo al montaje. Se ha quitado:
 * todos los huecos duran ahora lo que dura una generación de Veo, ocho
 * segundos, porque un hueco más corto significa pagar ocho y tirar el resto.
 * El peso sigue mandando el ritmo, pero repartiendo CUÁNTOS planos se lleva
 * cada bloque en vez de cuánto dura cada uno.
 */
const BEAT_PLAN = [
  { beat: 'opening', weight: 0.18 },
  { beat: 'development', weight: 0.4 },
  { beat: 'climax', weight: 0.27 },
  { beat: 'closing', weight: 0.15 },
];

/** Gramática de planos por bloque (PRD §18 — el vocabulario del director de fotografía). */
const SHOT_GRAMMAR = {
  opening: ['establishing_wide', 'wide', 'detail', 'medium'],
  development: [
    'medium',
    'hands',
    'instrument_detail',
    'close_up',
    'profile',
    'wide',
    'over_shoulder',
    'detail',
  ],
  climax: ['close_up', 'face', 'hands', 'low_angle', 'wide', 'instrument_detail', 'high_angle', 'medium'],
  closing: ['wide', 'face', 'establishing_wide', 'detail'],
};

const CAMERA_BY_SHOT = {
  establishing_wide: ['slow_push_in', 'crane_up', 'static'],
  wide: ['lateral_track_left', 'slow_pull_out', 'static'],
  medium: ['slow_push_in', 'handheld_drift', 'static'],
  close_up: ['slow_push_in', 'static'],
  face: ['slow_push_in', 'static'],
  hands: ['static', 'lateral_track_right'],
  instrument_detail: ['slow_push_in', 'lateral_track_left'],
  detail: ['static', 'slow_push_in'],
  over_shoulder: ['handheld_drift', 'static'],
  low_angle: ['tilt_up', 'slow_push_in'],
  high_angle: ['tilt_down', 'slow_pull_out'],
  profile: ['lateral_track_right', 'static'],
};

/**
 * LA MITAD DEL CORTO SE REUTILIZA. Esa es la regla, y no es una optimización
 * que se aplica al final: condiciona cómo se planifica desde el principio.
 *
 * Generar vídeo es lo caro de esta herramienta. Un plano general de la
 * intérprete que aparece tres veces se genera UNA y se coloca tres. Para que
 * eso se pueda hacer sin que el corto parezca un bucle, el Director tiene que
 * diseñar los planos pensando ya en que van a volver.
 */
const PROPORCION_REPETIDA = 0.5;

/**
 * Un plano solo aguanta repetirse si TERMINA DONDE EMPEZÓ.
 *
 * Un `slow_push_in` acaba más cerca de lo que empezó: al repetirlo, el
 * espectador ve un salto hacia atrás. Un `static` o una deriva lateral lenta
 * dejan la cámara en un sitio equivalente, así que el mismo material vuelve sin
 * que se note. Esta es la parte del diseño que hace posible la regla de arriba.
 */
const MOVIMIENTOS_QUE_AGUANTAN_VOLVER = new Set([
  'static',
  'lateral_track_left',
  'lateral_track_right',
  'handheld_drift',
]);

/**
 * Tipos de plano que llevan un momento de interpretación único: la cara en el
 * clímax, la mirada sostenida. Repetir uno de esos no es ahorrar, es delatar el
 * truco. Nunca se reutilizan aunque su movimiento lo permitiera.
 */
const TIPOS_IRREPETIBLES = new Set([
  'face',
  'close_up',
  'over_shoulder',
  'low_angle',
]);

const CLIP_SUFFIXES = 'ABCDEFGH';

/**
 * Reparte el metraje del corto en huecos DE OCHO SEGUNDOS.
 *
 * POR QUÉ OCHO Y NO LO QUE PIDA EL RITMO. Antes cada bloque tenía su propia
 * duración de hueco —8 en la apertura, 6 en el desarrollo, 4 en el clímax— y
 * cada clip se generaba justo del largo de su hueco. Eso venía de cuando cada
 * plano se usaba una sola vez.
 *
 * Desde que la mitad del corto se monta con material repetido, ese reparto
 * cuesta dinero de verdad: ocho segundos de Veo cuestan lo mismo que cuatro
 * —se paga por vídeo, no por segundo— así que un hueco de cuatro segundos era
 * pagar ocho y tirar cuatro. Y recortarlos en el montaje es exactamente el
 * mismo desperdicio con otro nombre.
 *
 * Así que el hueco vale lo que vale una generación: ocho segundos, enteros y
 * usados. Menos planos y más largos, sí, pero ni un segundo pagado que no se
 * vea en pantalla.
 *
 * EL SOBRANTE. Sesenta y ciento ochenta no son múltiplos de ocho: sobran cuatro
 * segundos en los dos casos. Ese hueco corto se pone el ÚLTIMO y se obliga a
 * que lo ocupe un plano REPETIDO — uno que ya se vio entero antes. Así los
 * cuatro segundos que no caben no son metraje perdido: son la segunda
 * aparición, más corta, de un clip que ya se aprovechó completo.
 */
function repartirHuecos(runtimeSec) {
  const enteros = Math.floor(runtimeSec / MAX_CLIP_SECONDS);
  const sobra = runtimeSec - enteros * MAX_CLIP_SECONDS;
  const huecos = new Array(enteros).fill(MAX_CLIP_SECONDS);
  if (sobra > 0) huecos.push(sobra);
  return huecos;
}

/**
 * Cuántos huecos le tocan a cada bloque, según su peso narrativo.
 *
 * Los pesos siguen mandando el RITMO —el desarrollo se lleva más planos que la
 * apertura— pero ahora reparten huecos en vez de segundos, porque todos los
 * huecos duran lo mismo.
 */
function repartirPorBloque(totalHuecos) {
  const cuentas = [];
  let asignados = 0;
  BEAT_PLAN.forEach((plan, i) => {
    const ultimo = i === BEAT_PLAN.length - 1;
    // Al último le queda el resto, para que la suma cuadre exactamente.
    const cuantos = ultimo
      ? totalHuecos - asignados
      : Math.max(1, Math.round(totalHuecos * plan.weight));
    asignados += cuantos;
    cuentas.push(Math.max(0, cuantos));
  });
  return cuentas;
}

/**
 * Parte una toma en clips, y CADA CLIP SE PIDE AL MÁXIMO QUE DA EL MODELO.
 *
 * POR QUÉ SIEMPRE OCHO SEGUNDOS. Antes cada clip se pedía de la longitud exacta
 * de su hueco en el montaje: un plano de clímax de cuatro segundos generaba
 * cuatro segundos de vídeo. Eso tenía sentido cuando cada toma se usaba una
 * sola vez, pero desde que la mitad del corto se monta con material repetido
 * (PRD §15, §25, §33) es tirar dinero: una toma que va a volver dos o tres
 * veces, en huecos de distinta duración, se queda sin metraje para la segunda.
 *
 * Ocho segundos es el tope de Veo, y una generación de ocho cuesta lo mismo que
 * una de cuatro —se paga por vídeo, no por segundo—, así que pedir menos es
 * regalar la mitad del material. Lo que sobre lo recorta el montaje, que es
 * gratis y no se nota.
 *
 * Del recorte se encarga `montaje.js`: si el clip es más largo que su hueco, lo
 * corta; si fuera más corto, lo retima. Con esto lo normal pasa a ser el
 * recorte, que no toca la velocidad del movimiento.
 */
function splitShotIntoClips(shotId, shotIndex, durationSec) {
  const count = Math.max(1, Math.ceil(durationSec / MAX_CLIP_SECONDS));
  const padded = String(shotIndex).padStart(2, '0');
  return Array.from({ length: count }, (unused, index) => {
    // Si alguna vez hubiera más de ocho clips, se numeran en lugar de quedarse
    // sin sufijo: CLIP_SUFFIXES fuera de rango da undefined.
    const suffix = CLIP_SUFFIXES[index] ?? String(index + 1);
    return {
      id: `${shotId}_clip_${suffix.toLowerCase()}`,
      shotId,
      index,
      suffix,
      label: `Clip ${padded}${suffix}`,
      durationSec: MAX_CLIP_SECONDS,
    };
  });
}

function clipAssetId(clipId) {
  return clipId;
}

function shotImageAssetId(shotId) {
  return `${shotId}_image`;
}

/**
 * Construye la lista de tomas y la línea de tiempo de montaje para un metraje dado.
 *
 * La línea de tiempo es la fuente de verdad: se traza primero para que sume
 * exactamente la duración pedida, y la lista de tomas es lo que esa línea de
 * tiempo necesita — menos los huecos que el Productor decide rellenar con
 * material que ya existe.
 */
function planStructure(runtimeSec) {
  // 1. Todos los huecos de ocho segundos —lo que dura una generación de Veo— y
  //    repartidos entre los bloques según su peso narrativo. El único hueco
  //    corto, si lo hay, queda el último.
  const duraciones = repartirHuecos(runtimeSec);
  const porBloque = repartirPorBloque(duraciones.length);
  const beatSlots = [];
  let cursor = 0;
  BEAT_PLAN.forEach((plan, i) => {
    for (let k = 0; k < porBloque[i] && cursor < duraciones.length; k += 1, cursor += 1) {
      beatSlots.push({ beat: plan.beat, durationSec: duraciones[cursor] });
    }
  });

  // 2. Asignar una toma a cada hueco, reutilizando material aprobado donde el
  //    Productor decide que generar algo nuevo no aportaría nada (PRD §15, §25).
  const shots = [];
  const slotAssignments = [];
  const grammarCursor = { opening: 0, development: 0, climax: 0, closing: 0 };
  const reuseCounts = new Map();
  let lastShotType = null;
  let ultimaTomaId = null;

  // La mitad del corto se rellena con material ya generado, y se sabe cuáles
  // ANTES de escribir ningún plano.
  const huecosRepetidos = planificarRepeticiones(beatSlots.length);
  // Si hay un hueco más corto que una generación, tiene que ocuparlo un plano
  // que YA se vio entero: es la única forma de que esos segundos que no caben
  // no sean metraje pagado y tirado. Siempre es el último.
  const ultimo = beatSlots.length - 1;
  if (ultimo >= 0 && beatSlots[ultimo].durationSec < MAX_CLIP_SECONDS) huecosRepetidos.add(ultimo);
  // Cuántos planos distintos hacen falta. El Director los diseña sabiendo que
  // casi todos van a volver, así que casi todos tienen que aguantar volver.
  const tomasNecesarias = beatSlots.length - huecosRepetidos.size;

  beatSlots.forEach((slot, slotIndex) => {
    const reuseCandidate = huecosRepetidos.has(slotIndex)
      ? pickReuseCandidate(shots, reuseCounts, slotIndex, beatSlots.length, ultimaTomaId)
      : null;
    if (reuseCandidate) {
      ultimaTomaId = reuseCandidate.id;
      reuseCounts.set(reuseCandidate.id, (reuseCounts.get(reuseCandidate.id) ?? 0) + 1);
      // La toma reutilizada tiene que ser al menos tan larga como el hueco más
      // largo en el que aparece, o al reproducirla faltaría metraje.
      reuseCandidate.durationSec = Math.max(reuseCandidate.durationSec, slot.durationSec);
      slotAssignments.push({
        shot: reuseCandidate,
        durationSec: slot.durationSec,
        reused: true,
        beat: slot.beat,
      });
      return;
    }

    // Si tocaba repetir y no había material aún, este hueco estrena plano; el
    // plan se cumple igualmente porque más adelante sobran candidatos.
    const grammar = SHOT_GRAMMAR[slot.beat];
    let shotType = grammar[grammarCursor[slot.beat] % grammar.length];
    // Dos planos iguales seguidos parecen un error de montaje: se salta uno.
    if (shotType === lastShotType) {
      grammarCursor[slot.beat] += 1;
      shotType = grammar[grammarCursor[slot.beat] % grammar.length];
    }
    grammarCursor[slot.beat] += 1;
    lastShotType = shotType;

    const index = shots.length + 1;
    const id = `shot_${String(index).padStart(2, '0')}`;

    // ─── Aquí es donde el Director hace que el ahorro sea posible ───
    //
    // Un plano que va a volver tiene que estar RODADO para volver. Mientras
    // falte material repetible para cumplir la mitad, se elige el movimiento
    // que deja la cámara donde empezó; solo cuando ya hay de sobra se permite
    // un movimiento con dirección, que da empaque pero solo sirve una vez.
    const puedeRepetirse = !TIPOS_IRREPETIBLES.has(shotType);
    const repetiblesHastaAhora = shots.filter((t) => t.reusable).length;
    const faltaMaterial = repetiblesHastaAhora < tomasNecesarias * PROPORCION_REPETIDA * 2;

    const moves = CAMERA_BY_SHOT[shotType];
    let cameraMove = moves[index % moves.length];
    if (puedeRepetirse && faltaMaterial) {
      const seguros = moves.filter((m) => MOVIMIENTOS_QUE_AGUANTAN_VOLVER.has(m));
      if (seguros.length) cameraMove = seguros[index % seguros.length];
    }

    const shot = {
      id,
      index,
      label: `Shot ${String(index).padStart(2, '0')}`,
      beat: slot.beat,
      shotType,
      cameraMove,
      durationSec: slot.durationSec,
      // Repetible = ni el tipo de plano ni el movimiento delatan la repetición.
      reusable: puedeRepetirse && MOVIMIENTOS_QUE_AGUANTAN_VOLVER.has(cameraMove),
      clips: [],
    };
    shots.push(shot);
    ultimaTomaId = shot.id;
    slotAssignments.push({ shot, durationSec: slot.durationSec, reused: false, beat: slot.beat });
  });

  // 3. Ahora que la duración canónica de cada toma es definitiva, se parte en clips.
  for (const shot of shots) {
    shot.clips = splitShotIntoClips(shot.id, shot.index, shot.durationSec);
  }

  // 4. Expandir los huecos en entradas de línea de tiempo a nivel de clip.
  const timeline = [];
  let cursorSec = 0;
  let previousBeat = null;
  for (const assignment of slotAssignments) {
    let remaining = assignment.durationSec;
    let firstOfSlot = true;
    for (const clip of assignment.shot.clips) {
      if (remaining <= 0) break;
      const durationSec = Math.min(clip.durationSec, remaining);
      const isFirstEntry = timeline.length === 0;
      const beatChanged = previousBeat !== null && previousBeat !== assignment.beat;
      // Un plano que VUELVE entra encadenado, no a corte.
      //
      // Es la contrapartida de reutilizar la mitad del corto: por muy bien
      // elegido que esté el plano, un corte seco delata que ya se había visto.
      // Medio segundo de superposición desdibuja esa costura y el material
      // repetido pasa por material nuevo. Los estrenos siguen entrando a
      // corte, que es lo que da ritmo.
      const vuelveUnPlano = firstOfSlot && assignment.reused;
      const transitionIn = isFirstEntry
        ? 'fade_in'
        : firstOfSlot && beatChanged
          ? 'dip_to_black'
          : vuelveUnPlano
            ? 'dissolve'
            : 'cut';
      timeline.push({
        index: timeline.length,
        shotId: assignment.shot.id,
        clipId: clip.id,
        startSec: cursorSec,
        durationSec,
        reused: assignment.reused,
        transitionIn,
        beat: assignment.beat,
      });
      cursorSec += durationSec;
      remaining -= durationSec;
      firstOfSlot = false;
    }
    previousBeat = assignment.beat;
  }

  const generatedFootageSec = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  return {
    shots,
    timeline,
    economics: {
      runtimeSec: cursorSec,
      generatedFootageSec,
      uniqueShots: shots.length,
      timelineSlots: slotAssignments.length,
      reusedSlots: slotAssignments.filter((s) => s.reused).length,
    },
  };
}

/**
 * Qué huecos de la línea de tiempo se van a rellenar con material ya generado.
 *
 * Se decide ANTES de repartir las tomas, no sobre la marcha: así el Director
 * sabe cuántos planos distintos tiene que escribir y puede diseñarlos para que
 * vuelvan. La cuenta sale igual en 1, 2 y 3 minutos — siempre la mitad.
 *
 * Los dos primeros huecos nunca se repiten: todavía se está presentando el
 * mundo y no hay nada que recordar. Del resto se eligen posiciones repartidas,
 * para que las repeticiones no se amontonen al final.
 *
 * Dos repeticiones seguidas SÍ se permiten, siempre que sean de planos
 * distintos: lo que canta no es que vuelva material, es que vuelva el MISMO
 * material dos veces seguidas. De eso se encarga `pickReuseCandidate`.
 */
function planificarRepeticiones(totalSlots) {
  const huecos = new Set();
  const primero = 2;
  const objetivo = Math.floor(totalSlots * PROPORCION_REPETIDA);
  const disponibles = totalSlots - primero;
  if (objetivo <= 0 || disponibles <= 0) return huecos;

  for (let k = 0; k < objetivo; k += 1) {
    const pos = primero + Math.round(((k + 0.5) * disponibles) / objetivo);
    huecos.add(Math.min(totalSlots - 1, Math.max(primero, pos)));
  }
  // El redondeo puede hacer que dos posiciones caigan en el mismo hueco. Se
  // rellena con los que queden libres para que la mitad se cumpla de verdad.
  for (let i = primero; i < totalSlots && huecos.size < objetivo; i += 1) {
    huecos.add(i);
  }
  return huecos;
}

function pickReuseCandidate(shots, reuseCounts, slotIndex, totalSlots, ultimaTomaId) {
  const candidates = shots.filter((shot) => shot.reusable && shot.id !== ultimaTomaId);
  // Con un solo plano disponible, repetirlo sería ponerlo dos veces seguidas.
  if (!candidates.length) return null;

  const isFinalSlot = slotIndex === totalSlots - 1;

  // El hueco de cierre rima a propósito con la imagen de apertura.
  if (isFinalSlot) {
    const opener = candidates.find((shot) => shot.beat === 'opening');
    if (opener) return opener;
  }

  // Si no, repartir los recuerdos entre el material disponible: primero el menos
  // usado y, entre iguales, el introducido más recientemente, para que un solo
  // plano general no acabe cargando con toda la película.
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const uses = reuseCounts.get(candidate.id) ?? 0;
    const score = uses * 1000 - candidate.index;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

module.exports = {
  splitShotIntoClips,
  clipAssetId,
  shotImageAssetId,
  planStructure,
};
