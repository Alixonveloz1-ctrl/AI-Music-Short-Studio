/**
 * A tiny 5x7 bitmap font.
 *
 * Placeholder frames are only useful if you can tell them apart at a glance,
 * so the offline image provider burns the shot label and generation number
 * into the picture. Shipping a font file (or depending on a text renderer)
 * would be heavier than just encoding the glyphs.
 */

const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '(': ['..##.', '.#...', '#....', '#....', '#....', '.#...', '..##.'],
  ')': ['.##..', '...#.', '....#', '....#', '....#', '...#.', '.##..'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

/** Normalise arbitrary text into characters the font can actually draw. */
export function sanitizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split('')
    .map((ch) => (GLYPHS[ch] ? ch : ' '))
    .join('');
}

export function measureText(text: string, scale: number, spacing = 1): number {
  const chars = sanitizeText(text).length;
  if (chars === 0) return 0;
  return chars * (GLYPH_WIDTH + spacing) * scale - spacing * scale;
}

export interface DrawTarget {
  width: number;
  height: number;
  data: Uint8Array; // RGB
}

export function drawText(
  target: DrawTarget,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: [number, number, number],
  spacing = 1,
): void {
  let cursorX = x;
  for (const ch of sanitizeText(text)) {
    const glyph = GLYPHS[ch];
    if (glyph) {
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        const line = glyph[row] as string;
        for (let col = 0; col < GLYPH_WIDTH; col += 1) {
          if (line[col] !== '#') continue;
          fillRect(target, cursorX + col * scale, y + row * scale, scale, scale, color);
        }
      }
    }
    cursorX += (GLYPH_WIDTH + spacing) * scale;
  }
}

export function fillRect(
  target: DrawTarget,
  x: number,
  y: number,
  w: number,
  h: number,
  color: [number, number, number],
  alpha = 1,
): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(target.width, Math.round(x + w));
  const y1 = Math.min(target.height, Math.round(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const idx = (py * target.width + px) * 3;
      if (alpha >= 1) {
        target.data[idx] = color[0];
        target.data[idx + 1] = color[1];
        target.data[idx + 2] = color[2];
      } else {
        target.data[idx] = mix(target.data[idx] as number, color[0], alpha);
        target.data[idx + 1] = mix(target.data[idx + 1] as number, color[1], alpha);
        target.data[idx + 2] = mix(target.data[idx + 2] as number, color[2], alpha);
      }
    }
  }
}

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}
