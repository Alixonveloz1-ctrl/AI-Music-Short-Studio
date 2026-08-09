import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

export function shortId(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[(bytes[i] as number) % ALPHABET.length];
  }
  return out;
}

export function projectId(): string {
  return `prj_${shortId(12)}`;
}

export function generationId(): string {
  return `gen_${shortId(12)}`;
}

export function eventId(): string {
  return `evt_${shortId(12)}`;
}
