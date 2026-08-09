// ════════════════════════════════════════════════════════════════
// AUDIO — síntesis instrumental, lectura/escritura de WAV y unión de
// fragmentos, todo en JavaScript puro.
//
// EL PRODUCTO ES INSTRUMENTAL (PRD §3, §28, §31). Aquí no hay voz por
// construcción: no existe ningún oscilador ni capa que imite una voz.
//
// Este módulo hace dos cosas que conviene no confundir:
//
//   1. SINTETIZAR sonido propio (renderMusic, renderAmbient). Es el
//      proveedor interno: produce una pieza real, con arco narrativo,
//      para que el ciclo «escuchar → aprobar o regenerar» (PRD §29) se
//      pueda ejercitar sin gastar cuota de Vertex.
//
//   2. UNIR el audio que devuelve Lyria (decodeWav, unirFragmentos).
//      Lyria entrega fragmentos de unos 30 segundos, así que un corto
//      de tres minutos son seis archivos sueltos. El usuario tiene que
//      escuchar UNA pista y aprobarla, no seis.
//
// POR QUÉ SE UNEN AQUÍ Y NO CON FFMPEG. Antes esto lo hacía ffmpeg. En
// Vercel no hay ffmpeg, y montar Cloud Build solo para pegar seis WAV
// sería tardar minutos en algo que en memoria son milisegundos: un WAV
// PCM no está comprimido, unirlos es aritmética sobre las muestras.
//
// Sin dependencias: solo Buffer y Math.
// ════════════════════════════════════════════════════════════════
const { AUDIO_SAMPLE_RATE } = require('./constantes');
const { INSTRUMENTS_BY_ID } = require('./catalogo');

// Copia local del mulberry32 del planificador, que no lo exporta. Se duplica a
// propósito: son ocho líneas y así el sintetizador no depende del módulo de
// planificación, con el que no comparte nada más.
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

// ─────────────────────────────────────────────────────────────────
// WAV — escritura
// ─────────────────────────────────────────────────────────────────

/** Escritor mínimo de WAV PCM de 16 bits. */
function encodeWav(samples, sampleRate, channels = 1) {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // tamaño del chunk PCM
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }
  return buffer;
}

/** Normaliza al pico objetivo y aplica fundidos simétricos. */
function finalizeBuffer(samples, sampleRate, options = {}) {
  const peakTarget = options.peak ?? 0.89;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  const gain = peak > 0 ? peakTarget / peak : 1;
  const fadeIn = Math.floor((options.fadeInSec ?? 1.2) * sampleRate);
  const fadeOut = Math.floor((options.fadeOutSec ?? 2.2) * sampleRate);
  for (let i = 0; i < samples.length; i += 1) {
    let value = samples[i] * gain;
    if (i < fadeIn) value *= i / fadeIn;
    const fromEnd = samples.length - 1 - i;
    if (fromEnd < fadeOut) value *= fromEnd / fadeOut;
    samples[i] = value;
  }
  return samples;
}

// ─────────────────────────────────────────────────────────────────
// WAV — lectura
// ─────────────────────────────────────────────────────────────────

/** Lee la cabecera `fmt ` y devuelve el formato real del audio. */
function leerFmt(buf, inicio, tam) {
  if (tam < 16) {
    throw new Error('WAV inválido: el chunk «fmt » mide ' + tam + ' bytes y hacen falta al menos 16.');
  }
  let formato = buf.readUInt16LE(inicio);
  const channels = buf.readUInt16LE(inicio + 2);
  const sampleRate = buf.readUInt32LE(inicio + 4);
  const bits = buf.readUInt16LE(inicio + 14);

  // WAVE_FORMAT_EXTENSIBLE (0xFFFE) no dice el formato en su sitio: lo esconde
  // en los dos primeros bytes del GUID del subformato. Sin esto, un WAV
  // perfectamente normal de 24 bits se rechazaría por «formato desconocido».
  if (formato === 0xfffe && tam >= 40) formato = buf.readUInt16LE(inicio + 24);

  if (channels < 1) throw new Error('WAV inválido: declara ' + channels + ' canales.');
  if (sampleRate < 1) throw new Error('WAV inválido: declara ' + sampleRate + ' Hz de frecuencia de muestreo.');
  return { formato, channels, sampleRate, bits };
}

/**
 * Lee un WAV PCM y devuelve `{ samples, sampleRate, channels }`, con las
 * muestras INTERCALADAS (canal 0, canal 1, canal 0, …) y normalizadas a -1..1.
 *
 * RECORRE LOS CHUNKS DE VERDAD, no da por hecho que la cabecera mide 44 bytes.
 * Muchos codificadores meten chunks extra (LIST, fact, bext, JUNK) antes de
 * `data`; si se saltan 44 bytes a ciegas se empieza a leer audio en mitad de
 * unos metadatos y el resultado suena a ruido blanco. Este fallo es silencioso
 * —el archivo se abre y dura lo que toca— así que cuesta muchísimo de ver.
 *
 * Admite PCM entero de 8, 16, 24 y 32 bits y coma flotante de 32 y 64. Lyria
 * devuelve 16 bits; el resto está por si el audio entra por otra vía.
 */
function decodeWav(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  if (buf.length < 12) {
    throw new Error('WAV inválido: el archivo mide ' + buf.length + ' bytes, ni siquiera cabe la cabecera RIFF.');
  }
  const riff = buf.toString('ascii', 0, 4);
  if (riff === 'RIFX') {
    throw new Error('WAV en formato RIFX (big-endian), que no se admite. Hay que reconvertirlo a RIFF little-endian.');
  }
  if (riff !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('No es un WAV: la cabecera dice «' + riff + '» en vez de «RIFF…WAVE».');
  }

  let fmt = null;
  let dataInicio = -1;
  let dataBytes = 0;

  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const cuerpo = pos + 8;
    let tam = buf.readUInt32LE(pos + 4);
    // Un tamaño mayor que lo que queda de archivo pasa constantemente con audio
    // escrito en streaming (se reserva 0xFFFFFFFF y nunca se corrige al cerrar).
    // Se recorta en vez de reventar: los bytes que hay son audio válido.
    if (tam > buf.length - cuerpo) tam = buf.length - cuerpo;

    if (id === 'fmt ') fmt = leerFmt(buf, cuerpo, tam);
    else if (id === 'data') {
      dataInicio = cuerpo;
      dataBytes = tam;
    }

    // Los chunks se alinean a byte par; el de relleno no cuenta en el tamaño.
    pos = cuerpo + tam + (tam % 2);
  }

  if (!fmt) throw new Error('WAV inválido: no aparece el chunk «fmt » por ninguna parte.');
  if (dataInicio < 0) throw new Error('WAV inválido: no aparece el chunk «data» por ninguna parte.');

  const { formato, channels, sampleRate, bits } = fmt;
  const esFloat = formato === 3;
  if (formato !== 1 && formato !== 3) {
    throw new Error(
      'WAV comprimido o de formato desconocido (código ' + formato + '). Solo se admite PCM sin comprimir.',
    );
  }
  if (esFloat && bits !== 32 && bits !== 64) {
    throw new Error('WAV en coma flotante de ' + bits + ' bits, que no se admite (solo 32 y 64).');
  }
  if (!esFloat && bits !== 8 && bits !== 16 && bits !== 24 && bits !== 32) {
    throw new Error('WAV PCM de ' + bits + ' bits, que no se admite (solo 8, 16, 24 y 32).');
  }

  const bytes = bits / 8;
  const total = Math.floor(dataBytes / bytes);
  const samples = new Float32Array(total);

  if (esFloat && bits === 32) {
    for (let i = 0; i < total; i += 1) samples[i] = buf.readFloatLE(dataInicio + i * 4);
  } else if (esFloat) {
    for (let i = 0; i < total; i += 1) samples[i] = buf.readDoubleLE(dataInicio + i * 8);
  } else if (bits === 8) {
    // El PCM de 8 bits es el único sin signo del formato: el silencio es 128.
    for (let i = 0; i < total; i += 1) samples[i] = (buf[dataInicio + i] - 128) / 128;
  } else if (bits === 16) {
    for (let i = 0; i < total; i += 1) samples[i] = buf.readInt16LE(dataInicio + i * 2) / 32768;
  } else if (bits === 24) {
    // No hay readInt24LE: se montan los tres bytes y se extiende el signo.
    for (let i = 0; i < total; i += 1) {
      const o = dataInicio + i * 3;
      let v = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      samples[i] = v / 8388608;
    }
  } else {
    for (let i = 0; i < total; i += 1) samples[i] = buf.readInt32LE(dataInicio + i * 4) / 2147483648;
  }

  return { samples, sampleRate, channels };
}

// ─────────────────────────────────────────────────────────────────
// Unión de fragmentos
// ─────────────────────────────────────────────────────────────────

/** Encadenado por defecto entre fragmento y fragmento, en segundos. */
const CRUCE_SEC = 0.5;

/**
 * Pega `b` detrás de `a` con un encadenado de igual potencia.
 *
 * POR QUÉ NO SE PEGAN A HUESO. El último valor de un fragmento y el primero del
 * siguiente no tienen por qué parecerse: el salto instantáneo entre los dos es
 * un impulso, y un impulso suena como un «clic». En un corto de tres minutos
 * hay cinco juntas, y el usuario las oye todas.
 *
 * POR QUÉ RAÍZ CUADRADA Y NO RAMPA LINEAL. Dos fragmentos distintos no están
 * correlacionados, así que sus potencias se suman, no sus amplitudes. Con una
 * rampa lineal, en mitad del cruce cada uno vale 0,5 y la potencia total baja a
 * ~0,7: se oye un bache de volumen. Con sqrt(x) y sqrt(1-x) la suma de
 * potencias es constante y el cruce pasa desapercibido.
 */
function encadenar(a, b, canales, cruceFrames) {
  const framesA = a.length / canales;
  const framesB = b.length / canales;
  // El cruce nunca puede comerse más de la mitad de ninguno de los dos trozos.
  const cruce = Math.max(0, Math.min(cruceFrames, Math.floor(framesA / 2), Math.floor(framesB / 2)));
  const out = new Float32Array((framesA + framesB - cruce) * canales);

  out.set(a.subarray(0, (framesA - cruce) * canales), 0);

  const base = (framesA - cruce) * canales;
  for (let f = 0; f < cruce; f += 1) {
    const x = f / cruce;
    const gSale = Math.sqrt(1 - x);
    const gEntra = Math.sqrt(x);
    for (let c = 0; c < canales; c += 1) {
      out[base + f * canales + c] = a[(framesA - cruce + f) * canales + c] * gSale + b[f * canales + c] * gEntra;
    }
  }

  out.set(b.subarray(cruce * canales), framesA * canales);
  return out;
}

/**
 * Une varios WAV en uno solo y devuelve un Buffer WAV de 16 bits.
 *
 * Opciones:
 *   duracionSec  duración objetivo. Si sobra audio se recorta; si falta, se
 *                repite el material (con el mismo encadenado) hasta llegar.
 *   cruceSec     duración del encadenado entre fragmentos (0,5 s por defecto).
 *   fadeInSec    fundido de entrada del resultado.
 *   fadeOutSec   fundido de salida del resultado. Importa: el recorte a la
 *                duración objetivo corta el audio por donde toque, y sin
 *                fundido ese corte seco se oye como un golpe.
 */
function unirFragmentos(buffers, opciones = {}) {
  const lista = (Array.isArray(buffers) ? buffers : []).filter(Boolean);
  if (lista.length === 0) throw new Error('unirFragmentos no recibió ningún fragmento que unir.');

  const trozos = lista.map((b, i) => {
    let leido;
    try {
      leido = decodeWav(b);
    } catch (e) {
      throw new Error('El fragmento ' + (i + 1) + ' de ' + lista.length + ' no se pudo leer: ' + e.message);
    }
    if (leido.samples.length === 0) {
      throw new Error('El fragmento ' + (i + 1) + ' de ' + lista.length + ' no contiene ninguna muestra de audio.');
    }
    return leido;
  });

  const sampleRate = trozos[0].sampleRate;
  const canales = trozos[0].channels;
  for (let i = 1; i < trozos.length; i += 1) {
    // No se disimula remuestreando: cambiar la frecuencia a ojo altera el tono y
    // la duración, y el usuario aprobaría una pista que no es la que se generó.
    if (trozos[i].sampleRate !== sampleRate) {
      throw new Error(
        'Los fragmentos no comparten frecuencia de muestreo: el 1 va a ' + sampleRate + ' Hz y el ' +
          (i + 1) + ' a ' + trozos[i].sampleRate + ' Hz. Hay que regenerarlos todos con la misma frecuencia.',
      );
    }
    if (trozos[i].channels !== canales) {
      throw new Error(
        'Los fragmentos no comparten número de canales: el 1 tiene ' + canales + ' y el ' +
          (i + 1) + ' tiene ' + trozos[i].channels + '. Hay que regenerarlos todos con el mismo formato.',
      );
    }
  }

  const cruceFrames = Math.max(0, Math.round((opciones.cruceSec ?? CRUCE_SEC) * sampleRate));

  let mezcla = trozos[0].samples;
  for (let i = 1; i < trozos.length; i += 1) {
    mezcla = encadenar(mezcla, trozos[i].samples, canales, cruceFrames);
  }

  const objetivoSec = Number(opciones.duracionSec ?? opciones.segundos ?? 0);
  if (Number.isFinite(objetivoSec) && objetivoSec > 0) {
    const framesObjetivo = Math.round(objetivoSec * sampleRate);
    // Si falta audio se vuelve a recorrer la lista de fragmentos, encadenando
    // igual que antes. Cada vuelta añade al menos la mitad de un fragmento, así
    // que el bucle siempre avanza (los fragmentos vacíos ya se han rechazado).
    let siguiente = 0;
    while (mezcla.length / canales < framesObjetivo) {
      mezcla = encadenar(mezcla, trozos[siguiente % trozos.length].samples, canales, cruceFrames);
      siguiente += 1;
    }
    if (mezcla.length / canales > framesObjetivo) {
      mezcla = mezcla.subarray(0, framesObjetivo * canales);
    }
  }

  const frames = mezcla.length / canales;

  // El cruce suma dos señales, así que puede pasarse de 1 y saturar. encodeWav
  // recortaría a 1 —que es distorsión audible, justo en la junta—, así que si el
  // pico se ha ido se baja el conjunto en vez de recortar solo las puntas.
  let pico = 0;
  for (let i = 0; i < mezcla.length; i += 1) {
    const v = Math.abs(mezcla[i]);
    if (v > pico) pico = v;
  }
  const ganancia = pico > 0.999 ? 0.99 / pico : 1;

  const fadeIn = Math.min(Math.round((opciones.fadeInSec ?? 0.5) * sampleRate), Math.floor(frames / 2));
  const fadeOut = Math.min(Math.round((opciones.fadeOutSec ?? 1.5) * sampleRate), frames - fadeIn);

  for (let f = 0; f < frames; f += 1) {
    let g = ganancia;
    if (fadeIn > 0 && f < fadeIn) g *= f / fadeIn;
    const desdeElFinal = frames - 1 - f;
    if (fadeOut > 0 && desdeElFinal < fadeOut) g *= desdeElFinal / fadeOut;
    if (g === 1) continue;
    for (let c = 0; c < canales; c += 1) mezcla[f * canales + c] *= g;
  }

  return encodeWav(mezcla, sampleRate, canales);
}

// ─────────────────────────────────────────────────────────────────
// Notas, escalas y timbres
// ─────────────────────────────────────────────────────────────────

const NOTE_OFFSETS = {
  do: 0,
  'do#': 1,
  re: 2,
  reb: 1,
  're#': 3,
  mi: 4,
  mib: 3,
  fa: 5,
  'fa#': 6,
  sol: 7,
  solb: 6,
  'sol#': 8,
  la: 9,
  lab: 8,
  'la#': 10,
  si: 11,
  sib: 10,
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

const SCALES = {
  mayor: [0, 2, 4, 5, 7, 9, 11],
  menor: [0, 2, 3, 5, 7, 8, 10],
  'menor natural': [0, 2, 3, 5, 7, 8, 10],
  'menor armonica': [0, 2, 3, 5, 7, 8, 11],
  'pentatonica menor': [0, 3, 5, 7, 10],
  'pentatonica mayor': [0, 2, 4, 7, 9],
  dorico: [0, 2, 3, 5, 7, 9, 10],
  frigio: [0, 1, 3, 5, 7, 8, 10],
  lidio: [0, 2, 4, 6, 7, 9, 11],
  mixolidio: [0, 2, 4, 5, 7, 9, 10],
};

const HARMONICS = {
  bowed: [1, 0.62, 0.42, 0.26, 0.18, 0.11, 0.07],
  plucked: [1, 0.52, 0.3, 0.18, 0.1],
  wind: [1, 0.28, 0.14, 0.07],
  keys: [1, 0.44, 0.26, 0.14, 0.08],
  mallet: [1, 0.36, 0.2, 0.55, 0.12],
  drone: [1, 0.5, 0.33, 0.25, 0.2],
};

// El rango de acentos va escrito con los escapes \u0300-\u036f a propósito: poner
// los caracteres combinantes literales en el código fuente daba problemas
// (se pegan al corchete anterior y el patrón deja de ser lo que parece).
function normalizeKeyword(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseRootMidi(key) {
  const normalized = normalizeKeyword(key);
  const token = normalized.split(/\s+/)[0] ?? 'la';
  const semitone = NOTE_OFFSETS[token] ?? 9; // por defecto, la
  // Coloca la tónica en un registro medio cómodo.
  return 57 + semitone; // la3 = 57
}

function parseScale(scale, key) {
  const normalized = normalizeKeyword(scale);
  // Nombre más largo primero: «pentatonica menor» no se puede tragar «menor».
  const entries = Object.entries(SCALES).sort((a, b) => b[0].length - a[0].length);
  for (const [name, steps] of entries) {
    if (normalized.includes(name)) return steps;
  }
  return normalizeKeyword(key).includes('mayor') ? SCALES.mayor : SCALES.menor;
}

function timbreForInstruments(instrumentIds) {
  const categories = instrumentIds
    .map((id) => (INSTRUMENTS_BY_ID.get(id) || {}).categoryId)
    .filter((c) => Boolean(c));
  if (categories.includes('strings')) {
    const bowed = instrumentIds.some((id) =>
      ['violin', 'viola', 'cello', 'double_bass', 'erhu', 'morin_khuur', 'sarangi', 'hardanger_fiddle'].includes(id),
    );
    return bowed ? 'bowed' : 'plucked';
  }
  if (categories.includes('woodwind') || categories.includes('brass')) return 'wind';
  if (categories.includes('keyboards') || categories.includes('electronic')) return 'keys';
  if (categories.includes('percussion')) return 'mallet';
  return 'bowed';
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ─────────────────────────────────────────────────────────────────
// Síntesis
// ─────────────────────────────────────────────────────────────────

const ENVELOPES = {
  bowed: { attack: 0.14, decay: 0.1, sustain: 0.82, release: 0.35 },
  plucked: { attack: 0.005, decay: 0.5, sustain: 0.12, release: 0.4 },
  wind: { attack: 0.09, decay: 0.08, sustain: 0.85, release: 0.3 },
  keys: { attack: 0.008, decay: 0.7, sustain: 0.25, release: 0.6 },
  mallet: { attack: 0.002, decay: 0.35, sustain: 0.05, release: 0.3 },
  drone: { attack: 1.5, decay: 0.5, sustain: 0.9, release: 2.5 },
};

function envelopeAt(shape, t, duration) {
  if (t < 0 || t > duration + shape.release) return 0;
  if (t < shape.attack) return t / shape.attack;
  const afterAttack = t - shape.attack;
  if (afterAttack < shape.decay) {
    return 1 + (shape.sustain - 1) * (afterAttack / shape.decay);
  }
  if (t < duration) return shape.sustain;
  const releaseT = (t - duration) / shape.release;
  return shape.sustain * Math.max(0, 1 - releaseT);
}

function addNote(out, sampleRate, startSec, durationSec, freq, amplitude, timbre, rng) {
  const shape = ENVELOPES[timbre];
  const harmonics = HARMONICS[timbre];
  const start = Math.floor(startSec * sampleRate);
  const total = Math.ceil((durationSec + shape.release) * sampleRate);
  const vibratoRate = 4.6 + rng() * 1.4;
  const vibratoDepth = timbre === 'bowed' ? 0.006 : timbre === 'wind' ? 0.004 : 0;
  const detune = 1 + (rng() - 0.5) * 0.002;

  for (let i = 0; i < total; i += 1) {
    const index = start + i;
    if (index < 0 || index >= out.length) continue;
    const t = i / sampleRate;
    const env = envelopeAt(shape, t, durationSec);
    if (env <= 0) continue;
    const vib = vibratoDepth > 0 ? 1 + vibratoDepth * Math.sin(2 * Math.PI * vibratoRate * t) : 1;
    const f = freq * detune * vib;
    let sample = 0;
    for (let h = 0; h < harmonics.length; h += 1) {
      sample += harmonics[h] * Math.sin(2 * Math.PI * f * (h + 1) * t);
    }
    sample /= harmonics.length;
    if (timbre === 'wind') {
      sample += (rng() - 0.5) * 0.08 * env;
    }
    out[index] = out[index] + sample * env * amplitude;
  }
}

/** Reverberación barata al estilo Schroeder; basta para situar la música en una sala. */
function applyReverb(buffer, sampleRate, mix, decay) {
  if (mix <= 0) return;
  const combDelays = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.floor(d * sampleRate));
  const combGains = [decay, decay * 0.96, decay * 0.92, decay * 0.88];
  const wet = new Float32Array(buffer.length);

  for (let c = 0; c < combDelays.length; c += 1) {
    const delay = combDelays[c];
    const gain = combGains[c];
    const line = new Float32Array(delay);
    let pointer = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const delayed = line[pointer];
      wet[i] = wet[i] + delayed * 0.25;
      line[pointer] = buffer[i] + delayed * gain;
      pointer = (pointer + 1) % delay;
    }
  }

  const apDelay = Math.floor(0.005 * sampleRate);
  const apLine = new Float32Array(apDelay);
  let apPointer = 0;
  const apGain = 0.5;
  for (let i = 0; i < wet.length; i += 1) {
    const delayed = apLine[apPointer];
    const input = wet[i];
    const output = -apGain * input + delayed;
    apLine[apPointer] = input + apGain * output;
    apPointer = (apPointer + 1) % apDelay;
    wet[i] = output;
  }

  for (let i = 0; i < buffer.length; i += 1) {
    buffer[i] = buffer[i] * (1 - mix) + wet[i] * mix;
  }
}

const REVERB_BY_ACOUSTICS = {
  dry: { mix: 0.1, decay: 0.6 },
  natural: { mix: 0.2, decay: 0.72 },
  reverberant: { mix: 0.34, decay: 0.82 },
  cavernous: { mix: 0.45, decay: 0.88 },
};

function pickWeighted(rng, values) {
  const index = Math.min(values.length - 1, Math.floor(rng() * values.length));
  return values[index];
}

/**
 * Sintetiza la pieza instrumental.
 *
 * opciones: { brief, instrumentIds, acoustics, seed, sampleRate? }
 */
function renderMusic(options) {
  const sampleRate = options.sampleRate ?? AUDIO_SAMPLE_RATE;
  const brief = options.brief;
  const durationSec = Math.max(5, brief.durationSec);
  const total = Math.ceil(durationSec * sampleRate);
  const out = new Float32Array(total);
  const rng = createRng(options.seed);

  const rootMidi = parseRootMidi(brief.key);
  const scale = parseScale(brief.scale, brief.key);
  const timbre = timbreForInstruments(options.instrumentIds);
  const beatSec = 60 / Math.max(40, Math.min(200, brief.tempoBpm));

  // --- Lecho sostenido: tónica y quinta, creciendo con el arco --------------
  addNote(out, sampleRate, 0, durationSec * 0.98, midiToHz(rootMidi - 12), 0.11, 'drone', rng);
  addNote(out, sampleRate, durationSec * 0.22, durationSec * 0.7, midiToHz(rootMidi - 5), 0.075, 'drone', rng);

  // --- Melodía --------------------------------------------------------------
  let cursor = beatSec * 2;
  let degree = 0;
  let octave = 0;
  while (cursor < durationSec - beatSec) {
    const progress = cursor / durationSec;
    const section = progress < 0.25 ? 'intro' : progress < 0.6 ? 'build' : progress < 0.85 ? 'climax' : 'resolve';

    const lengthBeats =
      section === 'climax'
        ? pickWeighted(rng, [1, 1, 1, 2])
        : section === 'intro'
          ? pickWeighted(rng, [2, 3, 4])
          : pickWeighted(rng, [1, 2, 2, 3]);
    const noteDuration = lengthBeats * beatSec * 0.92;

    // Paseo aleatorio por la escala, sesgado según dónde estemos en el arco.
    const bias = section === 'build' || section === 'climax' ? 0.62 : 0.36;
    const step = rng() < bias ? 1 : -1;
    const jump = rng() < 0.14 ? 2 : 1;
    degree += step * jump;
    if (degree >= scale.length) {
      degree -= scale.length;
      octave = Math.min(2, octave + 1);
    }
    if (degree < 0) {
      degree += scale.length;
      octave = Math.max(-1, octave - 1);
    }
    if (section === 'resolve' && progress > 0.93) {
      degree = 0;
      octave = 0;
    }

    const midi = rootMidi + scale[degree] + octave * 12;
    const amplitude =
      (section === 'intro' ? 0.2 : section === 'build' ? 0.28 : section === 'climax' ? 0.38 : 0.22) *
      (0.85 + rng() * 0.3);
    addNote(out, sampleRate, cursor, noteDuration, midiToHz(midi), amplitude, timbre, rng);

    // Una voz de apoyo aparece cuando la pieza ya se ha abierto.
    if (section !== 'intro' && rng() < 0.4) {
      const harmonyDegree = (degree + 2) % scale.length;
      const harmonyMidi = rootMidi + scale[harmonyDegree] + (octave - 1) * 12;
      addNote(out, sampleRate, cursor, noteDuration * 0.9, midiToHz(harmonyMidi), amplitude * 0.4, timbre, rng);
    }

    cursor += lengthBeats * beatSec;
  }

  // --- Pulso, solo donde el arco lo pide ------------------------------------
  const pulseStart = durationSec * 0.3;
  const pulseEnd = durationSec * 0.88;
  for (let t = pulseStart; t < pulseEnd; t += beatSec * 2) {
    const intensity = t > durationSec * 0.6 ? 0.1 : 0.055;
    addNote(out, sampleRate, t, beatSec * 0.6, midiToHz(rootMidi - 24), intensity, 'mallet', rng);
  }

  const reverb = REVERB_BY_ACOUSTICS[options.acoustics] || REVERB_BY_ACOUSTICS.natural;
  applyReverb(out, sampleRate, reverb.mix, reverb.decay);
  finalizeBuffer(out, sampleRate, { peak: 0.86, fadeInSec: 1.5, fadeOutSec: 2.8 });
  return encodeWav(out, sampleRate, 1);
}

const AMBIENT_LAYERS = [
  {
    match: ['viento', 'brisa', 'aire'],
    build: ({ out, sampleRate, rng }) => {
      let low = 0;
      for (let i = 0; i < out.length; i += 1) {
        const white = rng() * 2 - 1;
        low = low * 0.995 + white * 0.005;
        const gust = 0.5 + 0.5 * Math.sin((2 * Math.PI * i) / (sampleRate * 11));
        out[i] = out[i] + low * 26 * gust * 0.35;
      }
    },
  },
  {
    match: ['hoja', 'hierba', 'arena'],
    build: ({ out, sampleRate, rng }) => {
      let band = 0;
      let prev = 0;
      for (let i = 0; i < out.length; i += 1) {
        const white = rng() * 2 - 1;
        band = band * 0.86 + (white - prev) * 0.14;
        prev = white;
        const rustle = 0.5 + 0.5 * Math.sin((2 * Math.PI * i) / (sampleRate * 3.7));
        out[i] = out[i] + band * 0.07 * rustle;
      }
    },
  },
  {
    match: ['agua', 'ola', 'rio', 'río', 'corriente'],
    build: ({ out, sampleRate, rng }) => {
      let low = 0;
      let high = 0;
      for (let i = 0; i < out.length; i += 1) {
        const white = rng() * 2 - 1;
        low = low * 0.9 + white * 0.1;
        high = high * 0.6 + white * 0.4;
        const swell = 0.55 + 0.45 * Math.sin((2 * Math.PI * i) / (sampleRate * 6.3));
        out[i] = out[i] + (low * 0.12 + high * 0.03) * swell;
      }
    },
  },
  {
    match: ['pajaro', 'pájaro', 'ave', 'gaviota'],
    build: ({ out, sampleRate, durationSec, rng }) => {
      const calls = Math.max(3, Math.floor(durationSec / 7));
      for (let c = 0; c < calls; c += 1) {
        const start = rng() * (durationSec - 1);
        const baseFreq = 1800 + rng() * 1600;
        const length = 0.09 + rng() * 0.16;
        const startIndex = Math.floor(start * sampleRate);
        const count = Math.floor(length * sampleRate);
        for (let i = 0; i < count; i += 1) {
          const idx = startIndex + i;
          if (idx >= out.length) break;
          const t = i / sampleRate;
          const env = Math.sin((Math.PI * i) / count);
          const sweep = baseFreq * (1 + 0.35 * Math.sin(2 * Math.PI * 9 * t));
          out[idx] = out[idx] + Math.sin(2 * Math.PI * sweep * t) * env * 0.05;
        }
      }
    },
  },
  {
    match: ['insecto', 'grillo'],
    build: ({ out, sampleRate, durationSec, rng }) => {
      const chirps = Math.max(8, Math.floor(durationSec * 1.5));
      for (let c = 0; c < chirps; c += 1) {
        const start = rng() * (durationSec - 0.2);
        const startIndex = Math.floor(start * sampleRate);
        const count = Math.floor(0.045 * sampleRate);
        const freq = 4200 + rng() * 900;
        for (let i = 0; i < count; i += 1) {
          const idx = startIndex + i;
          if (idx >= out.length) break;
          const t = i / sampleRate;
          const env = Math.sin((Math.PI * i) / count);
          out[idx] = out[idx] + Math.sin(2 * Math.PI * freq * t) * env * 0.02;
        }
      }
    },
  },
  {
    match: ['publico', 'público', 'voces', 'gente', 'sala', 'ambiente'],
    build: ({ out, sampleRate, rng }) => {
      let low = 0;
      for (let i = 0; i < out.length; i += 1) {
        const white = rng() * 2 - 1;
        low = low * 0.97 + white * 0.03;
        const murmur = 0.6 + 0.4 * Math.sin((2 * Math.PI * i) / (sampleRate * 4.1));
        out[i] = out[i] + low * 0.09 * murmur;
      }
    },
  },
  {
    match: ['trafico', 'tráfico', 'urbano', 'ciudad', 'pasos'],
    build: ({ out, rng }) => {
      let low = 0;
      for (let i = 0; i < out.length; i += 1) {
        const white = rng() * 2 - 1;
        low = low * 0.993 + white * 0.007;
        out[i] = out[i] + low * 18 * 0.3;
      }
    },
  },
  {
    match: ['reverberacion', 'reverberación', 'silencio', 'eco', 'zumbido'],
    build: ({ out, sampleRate, rng }) => {
      let low = 0;
      for (let i = 0; i < out.length; i += 1) {
        const white = rng() * 2 - 1;
        low = low * 0.998 + white * 0.002;
        out[i] = out[i] + low * 12 * 0.25 + Math.sin((2 * Math.PI * 52 * i) / sampleRate) * 0.0015;
      }
    },
  },
];

/**
 * Sintetiza el lecho ambiental.
 *
 * opciones: { brief, seed, sampleRate? }
 */
function renderAmbient(options) {
  const sampleRate = options.sampleRate ?? AUDIO_SAMPLE_RATE;
  const durationSec = Math.max(5, options.brief.durationSec);
  const total = Math.ceil(durationSec * sampleRate);
  const out = new Float32Array(total);
  const rng = createRng(options.seed);
  const ctx = { out, sampleRate, durationSec, rng };

  const wanted = options.brief.layers.map((l) => normalizeKeyword(l));
  let matched = 0;
  for (const layer of AMBIENT_LAYERS) {
    const hit = wanted.some((w) => layer.match.some((m) => w.includes(normalizeKeyword(m))));
    if (!hit) continue;
    layer.build(ctx);
    matched += 1;
  }
  if (matched === 0) {
    // Que el revisor tenga *algo* que escuchar: el lecho de sala vacía.
    AMBIENT_LAYERS[7].build(ctx);
  }

  const reverb = REVERB_BY_ACOUSTICS[options.brief.acoustics] || REVERB_BY_ACOUSTICS.natural;
  applyReverb(out, sampleRate, (reverb.mix ?? 0.2) * 0.7, reverb.decay ?? 0.7);
  finalizeBuffer(out, sampleRate, { peak: 0.55, fadeInSec: 2.5, fadeOutSec: 3 });
  return encodeWav(out, sampleRate, 1);
}

module.exports = {
  encodeWav,
  decodeWav,
  finalizeBuffer,
  unirFragmentos,
  parseRootMidi,
  parseScale,
  timbreForInstruments,
  renderMusic,
  renderAmbient,
  CRUCE_SEC,
};
