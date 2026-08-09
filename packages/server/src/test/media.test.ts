import { describe, expect, it } from 'vitest';
import { AUDIO_SAMPLE_RATE, type AmbientBrief, type MusicBrief } from '@ams/shared';
import { encodePng } from '../media/png.js';
import { encodeWav } from '../media/wav.js';
import { renderStill } from '../media/procedural.js';
import { parseRootMidi, parseScale, renderAmbient, renderMusic, timbreForInstruments } from '../media/synth.js';
import { measureText, sanitizeText } from '../media/font.js';

describe('PNG encoder', () => {
  it('writes a valid PNG signature and chunk layout', () => {
    const rgb = new Uint8Array(4 * 3 * 3).fill(120);
    const png = encodePng(4, 3, rgb);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(4);
    expect(png.readUInt32BE(20)).toBe(3);
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('rejects a mis-sized pixel buffer rather than writing a corrupt file', () => {
    expect(() => encodePng(4, 3, new Uint8Array(10))).toThrow(/tamaño incorrecto/);
  });
});

describe('WAV encoder', () => {
  it('writes a 16-bit PCM header that matches the payload', () => {
    const samples = new Float32Array(100).fill(0.5);
    const wav = encodeWav(samples, 44100, 1);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(44100);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(200);
    expect(wav.length).toBe(44 + 200);
  });

  it('clamps out-of-range samples instead of wrapping around', () => {
    const wav = encodeWav(new Float32Array([2, -2]), 8000, 1);
    expect(wav.readInt16LE(44)).toBe(32767);
    expect(wav.readInt16LE(46)).toBe(-32767);
  });
});

describe('Bitmap font', () => {
  it('strips accents and unsupported characters so text always renders', () => {
    expect(sanitizeText('Guzheng · añil')).toBe('GUZHENG   ANIL');
  });

  it('measures text width consistently with what it draws', () => {
    expect(measureText('AB', 2)).toBe(2 * (5 + 1) * 2 - 1 * 2);
  });
});

describe('Procedural stills', () => {
  const base = {
    width: 320,
    height: 180,
    seed: 42,
    timeOfDay: 'hora dorada del atardecer',
    outdoor: true,
    performerCount: 1,
    captions: ['SHOT 01', 'plano general'],
    badge: 'GEN 1',
  } as const;

  it('renders a decodable PNG of the requested size', () => {
    const png = renderStill({ ...base, shotType: 'wide' });
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(320);
    expect(png.readUInt32BE(20)).toBe(180);
  });

  it('is deterministic for the same seed and different across seeds', () => {
    const a = renderStill({ ...base, shotType: 'wide' });
    const b = renderStill({ ...base, shotType: 'wide' });
    const c = renderStill({ ...base, shotType: 'wide', seed: 43 });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('frames different shot types differently', () => {
    const wide = renderStill({ ...base, shotType: 'establishing_wide' });
    const hands = renderStill({ ...base, shotType: 'hands' });
    expect(wide.equals(hands)).toBe(false);
  });

  it('leaves the master environment plate empty of performers', () => {
    const empty = renderStill({ ...base, shotType: 'wide', performerCount: 0 });
    const peopled = renderStill({ ...base, shotType: 'wide', performerCount: 1 });
    expect(empty.equals(peopled)).toBe(false);
  });
});

describe('Music synthesis', () => {
  const brief: MusicBrief = {
    title: 'Prueba',
    instrumentation: ['Erhu'],
    style: 'instrumental',
    mood: 'sereno',
    tempoBpm: 70,
    key: 'Re menor',
    scale: 'menor natural',
    structure: 'intro, desarrollo, clímax, resolución',
    durationSec: 6,
    prompt: 'x',
    negativePrompt: 'voz',
  };

  it('reads the key and scale the brief asked for', () => {
    expect(parseRootMidi('Re menor') % 12).toBe(parseRootMidi('Re mayor') % 12);
    expect(parseScale('menor natural', 'Re menor')).toEqual([0, 2, 3, 5, 7, 8, 10]);
    expect(parseScale('pentatónica menor', 'La menor')).toEqual([0, 3, 5, 7, 10]);
    expect(parseScale('modo dórico', 'Re')).toEqual([0, 2, 3, 5, 7, 9, 10]);
  });

  it('picks a timbre from the chosen instruments', () => {
    expect(timbreForInstruments(['erhu'])).toBe('bowed');
    expect(timbreForInstruments(['guzheng'])).toBe('plucked');
    expect(timbreForInstruments(['shakuhachi'])).toBe('wind');
    expect(timbreForInstruments(['piano'])).toBe('keys');
    expect(timbreForInstruments(['taiko'])).toBe('mallet');
  });

  it('renders audible audio of the requested length', () => {
    const wav = renderMusic({ brief, instrumentIds: ['erhu'], acoustics: 'natural', seed: 7 });
    const expectedSamples = Math.ceil(6 * AUDIO_SAMPLE_RATE);
    expect(wav.readUInt32LE(40)).toBe(expectedSamples * 2);

    // Not silence: check the peak of the middle of the piece.
    let peak = 0;
    for (let i = 44 + expectedSamples; i < wav.length - 2; i += 2) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    }
    expect(peak).toBeGreaterThan(3000);
  });

  it('is deterministic per seed', () => {
    const a = renderMusic({ brief, instrumentIds: ['erhu'], acoustics: 'dry', seed: 11 });
    const b = renderMusic({ brief, instrumentIds: ['erhu'], acoustics: 'dry', seed: 11 });
    const c = renderMusic({ brief, instrumentIds: ['erhu'], acoustics: 'dry', seed: 12 });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});

describe('Ambience synthesis', () => {
  const brief: AmbientBrief = {
    layers: ['viento suave', 'pájaros', 'hojas'],
    description: 'bosque al amanecer',
    acoustics: 'natural',
    durationSec: 5,
    prompt: 'x',
  };

  it('renders the requested length', () => {
    const wav = renderAmbient({ brief, seed: 3 });
    expect(wav.readUInt32LE(40)).toBe(Math.ceil(5 * AUDIO_SAMPLE_RATE) * 2);
  });

  it('still produces a bed when no layer matches a known recipe', () => {
    const wav = renderAmbient({ brief: { ...brief, layers: ['algo inventado'] }, seed: 3 });
    let peak = 0;
    for (let i = 44 + 200_000; i < wav.length - 2; i += 2) {
      peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    }
    expect(peak).toBeGreaterThan(500);
  });
});
