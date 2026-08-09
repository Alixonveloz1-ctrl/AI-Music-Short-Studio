/**
 * Procedural instrumental music and ambience for the offline audio providers.
 *
 * The PRD is explicit that the product is instrumental only (§28, §31): there
 * is no voice anywhere in this synthesiser, by construction. What it does
 * produce is a real, listenable piece with an arc — intro, build, climax,
 * resolution — so the "listen, then approve or regenerate" loop (§29) is
 * genuinely exercisable offline.
 */
import { AUDIO_SAMPLE_RATE, INSTRUMENTS_BY_ID, type AmbientBrief, type MusicBrief } from '@ams/shared';
import { createRng } from '../util/rng.js';
import { encodeWav, finalizeBuffer } from './wav.js';

const NOTE_OFFSETS: Record<string, number> = {
  do: 0,
  'do#': 1,
  re: 2,
  'reb': 1,
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

const SCALES: Record<string, number[]> = {
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

type Timbre = 'bowed' | 'plucked' | 'wind' | 'keys' | 'mallet' | 'drone';

const HARMONICS: Record<Timbre, number[]> = {
  bowed: [1, 0.62, 0.42, 0.26, 0.18, 0.11, 0.07],
  plucked: [1, 0.52, 0.3, 0.18, 0.1],
  wind: [1, 0.28, 0.14, 0.07],
  keys: [1, 0.44, 0.26, 0.14, 0.08],
  mallet: [1, 0.36, 0.2, 0.55, 0.12],
  drone: [1, 0.5, 0.33, 0.25, 0.2],
};

function normalizeKeyword(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function parseRootMidi(key: string): number {
  const normalized = normalizeKeyword(key);
  const token = normalized.split(/\s+/)[0] ?? 'la';
  const semitone = NOTE_OFFSETS[token] ?? 9; // default A
  // Place the tonic in a comfortable mid register.
  return 57 + semitone; // A3 = 57
}

export function parseScale(scale: string, key: string): number[] {
  const normalized = normalizeKeyword(scale);
  // Longest name first: "pentatonica menor" must not be swallowed by "menor".
  const entries = Object.entries(SCALES).sort((a, b) => b[0].length - a[0].length);
  for (const [name, steps] of entries) {
    if (normalized.includes(name)) return steps;
  }
  return normalizeKeyword(key).includes('mayor') ? (SCALES['mayor'] as number[]) : (SCALES['menor'] as number[]);
}

export function timbreForInstruments(instrumentIds: string[]): Timbre {
  const categories = instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id)?.categoryId)
    .filter((c): c is string => Boolean(c));
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

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface EnvelopeShape {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

const ENVELOPES: Record<Timbre, EnvelopeShape> = {
  bowed: { attack: 0.14, decay: 0.1, sustain: 0.82, release: 0.35 },
  plucked: { attack: 0.005, decay: 0.5, sustain: 0.12, release: 0.4 },
  wind: { attack: 0.09, decay: 0.08, sustain: 0.85, release: 0.3 },
  keys: { attack: 0.008, decay: 0.7, sustain: 0.25, release: 0.6 },
  mallet: { attack: 0.002, decay: 0.35, sustain: 0.05, release: 0.3 },
  drone: { attack: 1.5, decay: 0.5, sustain: 0.9, release: 2.5 },
};

function envelopeAt(shape: EnvelopeShape, t: number, duration: number): number {
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

function addNote(
  out: Float32Array,
  sampleRate: number,
  startSec: number,
  durationSec: number,
  freq: number,
  amplitude: number,
  timbre: Timbre,
  rng: () => number,
): void {
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
      const gain = harmonics[h] as number;
      sample += gain * Math.sin(2 * Math.PI * f * (h + 1) * t);
    }
    sample /= harmonics.length;
    if (timbre === 'wind') {
      sample += (rng() - 0.5) * 0.08 * env;
    }
    out[index] = (out[index] as number) + sample * env * amplitude;
  }
}

/** Cheap Schroeder-style reverb; enough to place the music in a room. */
function applyReverb(buffer: Float32Array, sampleRate: number, mix: number, decay: number): void {
  if (mix <= 0) return;
  const combDelays = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => Math.floor(d * sampleRate));
  const combGains = [decay, decay * 0.96, decay * 0.92, decay * 0.88];
  const wet = new Float32Array(buffer.length);

  for (let c = 0; c < combDelays.length; c += 1) {
    const delay = combDelays[c] as number;
    const gain = combGains[c] as number;
    const line = new Float32Array(delay);
    let pointer = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const delayed = line[pointer] as number;
      wet[i] = (wet[i] as number) + delayed * 0.25;
      line[pointer] = (buffer[i] as number) + delayed * gain;
      pointer = (pointer + 1) % delay;
    }
  }

  const apDelay = Math.floor(0.005 * sampleRate);
  const apLine = new Float32Array(apDelay);
  let apPointer = 0;
  const apGain = 0.5;
  for (let i = 0; i < wet.length; i += 1) {
    const delayed = apLine[apPointer] as number;
    const input = wet[i] as number;
    const output = -apGain * input + delayed;
    apLine[apPointer] = input + apGain * output;
    apPointer = (apPointer + 1) % apDelay;
    wet[i] = output;
  }

  for (let i = 0; i < buffer.length; i += 1) {
    buffer[i] = (buffer[i] as number) * (1 - mix) + (wet[i] as number) * mix;
  }
}

const REVERB_BY_ACOUSTICS: Record<string, { mix: number; decay: number }> = {
  dry: { mix: 0.1, decay: 0.6 },
  natural: { mix: 0.2, decay: 0.72 },
  reverberant: { mix: 0.34, decay: 0.82 },
  cavernous: { mix: 0.45, decay: 0.88 },
};

export interface MusicRenderOptions {
  brief: MusicBrief;
  instrumentIds: string[];
  acoustics: string;
  seed: number;
  sampleRate?: number;
}

export function renderMusic(options: MusicRenderOptions): Buffer {
  const sampleRate = options.sampleRate ?? AUDIO_SAMPLE_RATE;
  const { brief } = options;
  const durationSec = Math.max(5, brief.durationSec);
  const total = Math.ceil(durationSec * sampleRate);
  const out = new Float32Array(total);
  const rng = createRng(options.seed);

  const rootMidi = parseRootMidi(brief.key);
  const scale = parseScale(brief.scale, brief.key);
  const timbre = timbreForInstruments(options.instrumentIds);
  const beatSec = 60 / Math.max(40, Math.min(200, brief.tempoBpm));

  // --- Sustained bed: tonic and fifth, swelling with the arc ---------------
  addNote(out, sampleRate, 0, durationSec * 0.98, midiToHz(rootMidi - 12), 0.11, 'drone', rng);
  addNote(out, sampleRate, durationSec * 0.22, durationSec * 0.7, midiToHz(rootMidi - 5), 0.075, 'drone', rng);

  // --- Melody -------------------------------------------------------------
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

    // Random walk over the scale, biased by where we are in the arc.
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

    const midi = rootMidi + (scale[degree] as number) + octave * 12;
    const amplitude =
      (section === 'intro' ? 0.2 : section === 'build' ? 0.28 : section === 'climax' ? 0.38 : 0.22) *
      (0.85 + rng() * 0.3);
    addNote(out, sampleRate, cursor, noteDuration, midiToHz(midi), amplitude, timbre, rng);

    // A supporting voice appears once the piece opens up.
    if (section !== 'intro' && rng() < 0.4) {
      const harmonyDegree = (degree + 2) % scale.length;
      const harmonyMidi = rootMidi + (scale[harmonyDegree] as number) + (octave - 1) * 12;
      addNote(out, sampleRate, cursor, noteDuration * 0.9, midiToHz(harmonyMidi), amplitude * 0.4, timbre, rng);
    }

    cursor += lengthBeats * beatSec;
  }

  // --- Pulse, only where the arc calls for it -----------------------------
  const pulseStart = durationSec * 0.3;
  const pulseEnd = durationSec * 0.88;
  for (let t = pulseStart; t < pulseEnd; t += beatSec * 2) {
    const intensity = t > durationSec * 0.6 ? 0.1 : 0.055;
    addNote(out, sampleRate, t, beatSec * 0.6, midiToHz(rootMidi - 24), intensity, 'mallet', rng);
  }

  const reverb = REVERB_BY_ACOUSTICS[options.acoustics] ?? REVERB_BY_ACOUSTICS['natural'];
  applyReverb(out, sampleRate, reverb!.mix, reverb!.decay);
  finalizeBuffer(out, sampleRate, { peak: 0.86, fadeInSec: 1.5, fadeOutSec: 2.8 });
  return encodeWav(out, sampleRate, 1);
}

export interface AmbientRenderOptions {
  brief: AmbientBrief;
  seed: number;
  sampleRate?: number;
}

interface LayerSpec {
  match: string[];
  build: (ctx: LayerContext) => void;
}

interface LayerContext {
  out: Float32Array;
  sampleRate: number;
  durationSec: number;
  rng: () => number;
}

const AMBIENT_LAYERS: LayerSpec[] = [
  {
    match: ['viento', 'brisa', 'aire'],
    build: ({ out, sampleRate, rng }) => {
      let low = 0;
      for (let i = 0; i < out.length; i += 1) {
        const white = rng() * 2 - 1;
        low = low * 0.995 + white * 0.005;
        const gust = 0.5 + 0.5 * Math.sin((2 * Math.PI * i) / (sampleRate * 11));
        out[i] = (out[i] as number) + low * 26 * gust * 0.35;
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
        out[i] = (out[i] as number) + band * 0.07 * rustle;
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
        out[i] = (out[i] as number) + (low * 0.12 + high * 0.03) * swell;
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
          out[idx] = (out[idx] as number) + Math.sin(2 * Math.PI * sweep * t) * env * 0.05;
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
          out[idx] = (out[idx] as number) + Math.sin(2 * Math.PI * freq * t) * env * 0.02;
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
        out[i] = (out[i] as number) + low * 0.09 * murmur;
      }
    },
  },
  {
    match: ['trafico', 'tráfico', 'urbano', 'ciudad', 'pasos'],
    build: ({ out, sampleRate, rng }) => {
      let low = 0;
      for (let i = 0; i < out.length; i += 1) {
        const white = rng() * 2 - 1;
        low = low * 0.993 + white * 0.007;
        out[i] = (out[i] as number) + low * 18 * 0.3;
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
        out[i] = (out[i] as number) + low * 12 * 0.25 + Math.sin((2 * Math.PI * 52 * i) / sampleRate) * 0.0015;
      }
    },
  },
];

export function renderAmbient(options: AmbientRenderOptions): Buffer {
  const sampleRate = options.sampleRate ?? AUDIO_SAMPLE_RATE;
  const durationSec = Math.max(5, options.brief.durationSec);
  const total = Math.ceil(durationSec * sampleRate);
  const out = new Float32Array(total);
  const rng = createRng(options.seed);
  const ctx: LayerContext = { out, sampleRate, durationSec, rng };

  const wanted = options.brief.layers.map((l) => normalizeKeyword(l));
  let matched = 0;
  for (const layer of AMBIENT_LAYERS) {
    const hit = wanted.some((w) => layer.match.some((m) => w.includes(normalizeKeyword(m))));
    if (!hit) continue;
    layer.build(ctx);
    matched += 1;
  }
  if (matched === 0) {
    // Always give the reviewer *something* to listen to.
    (AMBIENT_LAYERS[7] as LayerSpec).build(ctx);
  }

  const reverb = REVERB_BY_ACOUSTICS[options.brief.acoustics] ?? REVERB_BY_ACOUSTICS['natural'];
  applyReverb(out, sampleRate, (reverb?.mix ?? 0.2) * 0.7, reverb?.decay ?? 0.7);
  finalizeBuffer(out, sampleRate, { peak: 0.55, fadeInSec: 2.5, fadeOutSec: 3 });
  return encodeWav(out, sampleRate, 1);
}

function pickWeighted(rng: () => number, values: number[]): number {
  const index = Math.min(values.length - 1, Math.floor(rng() * values.length));
  return values[index] as number;
}
