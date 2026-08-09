/** Minimal 16-bit PCM WAV writer. */
export function encodeWav(samples: Float32Array, sampleRate: number, channels = 1): Buffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
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
    const clamped = Math.max(-1, Math.min(1, samples[i] as number));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }
  return buffer;
}

/** Peak-normalise to a target level and apply symmetric fades. */
export function finalizeBuffer(
  samples: Float32Array,
  sampleRate: number,
  options: { peak?: number; fadeInSec?: number; fadeOutSec?: number } = {},
): Float32Array {
  const peakTarget = options.peak ?? 0.89;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i] as number);
    if (v > peak) peak = v;
  }
  const gain = peak > 0 ? peakTarget / peak : 1;
  const fadeIn = Math.floor((options.fadeInSec ?? 1.2) * sampleRate);
  const fadeOut = Math.floor((options.fadeOutSec ?? 2.2) * sampleRate);
  for (let i = 0; i < samples.length; i += 1) {
    let value = (samples[i] as number) * gain;
    if (i < fadeIn) value *= i / fadeIn;
    const fromEnd = samples.length - 1 - i;
    if (fromEnd < fadeOut) value *= fromEnd / fadeOut;
    samples[i] = value;
  }
  return samples;
}
