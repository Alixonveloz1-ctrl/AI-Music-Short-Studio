/**
 * Procedural still renderer for the offline image provider.
 *
 * These are placeholders, not art: their job is to give the review loop
 * something real to look at — a distinct, legible frame per shot with the
 * shot's identity burned in — so the whole approve/regenerate flow can be
 * exercised without any cloud credentials.
 */
import type { ShotType } from '@ams/shared';
import { encodePng } from './png.js';
import { drawText, fillRect, measureText, type DrawTarget } from './font.js';
import { createRng } from '../util/rng.js';

export interface StillOptions {
  width: number;
  height: number;
  seed: number;
  /** Drives the colour scheme. */
  timeOfDay: string;
  outdoor: boolean;
  shotType: ShotType;
  performerCount: number;
  /** Lines burned into the frame so a reviewer can identify it instantly. */
  captions: string[];
  /** Small tag drawn top-right, e.g. "GEN #2". */
  badge?: string;
}

type Rgb = [number, number, number];

function hsl(h: number, s: number, l: number): Rgb {
  const hh = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(channel(hh + 1 / 3) * 255),
    Math.round(channel(hh) * 255),
    Math.round(channel(hh - 1 / 3) * 255),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

interface Palette {
  skyTop: Rgb;
  skyBottom: Rgb;
  sun: Rgb;
  hillFar: Rgb;
  hillMid: Rgb;
  hillNear: Rgb;
  ground: Rgb;
  figure: Rgb;
  accent: Rgb;
  caption: Rgb;
}

function derivePalette(timeOfDay: string, seed: number): Palette {
  const text = timeOfDay.toLowerCase();
  let baseHue = 205;
  let lightness = 0.5;
  if (text.includes('amanecer') || text.includes('dorada') || text.includes('atardecer')) {
    baseHue = 28;
    lightness = 0.52;
  } else if (text.includes('crepúsculo') || text.includes('crepusculo')) {
    baseHue = 250;
    lightness = 0.38;
  } else if (text.includes('noche')) {
    baseHue = 225;
    lightness = 0.22;
  } else if (text.includes('mañana') || text.includes('manana') || text.includes('difusa')) {
    baseHue = 195;
    lightness = 0.62;
  }
  const jitter = (createRng(seed)() - 0.5) * 18;
  const hue = baseHue + jitter;
  return {
    skyTop: hsl(hue + 12, 0.45, Math.max(0.08, lightness - 0.22)),
    skyBottom: hsl(hue - 18, 0.62, Math.min(0.85, lightness + 0.18)),
    sun: hsl(hue - 26, 0.85, Math.min(0.92, lightness + 0.34)),
    hillFar: hsl(hue + 6, 0.3, Math.max(0.1, lightness - 0.16)),
    hillMid: hsl(hue + 2, 0.34, Math.max(0.07, lightness - 0.26)),
    hillNear: hsl(hue - 4, 0.4, Math.max(0.05, lightness - 0.34)),
    ground: hsl(hue - 8, 0.3, Math.max(0.04, lightness - 0.4)),
    figure: hsl(hue - 12, 0.35, Math.max(0.03, lightness - 0.44)),
    accent: hsl(hue + 150, 0.55, Math.min(0.75, lightness + 0.2)),
    caption: [235, 232, 225],
  };
}

/**
 * Where the interesting part of the figure sits, per shot type. A detail shot
 * has to frame the hands or the face — anchoring every figure at the horizon
 * would push them out of frame and leave the reviewer looking at shins.
 */
type Focus = 'body' | 'face' | 'hands' | 'instrument';

const SHOT_FOCUS: Record<ShotType, Focus> = {
  establishing_wide: 'body',
  wide: 'body',
  medium: 'body',
  close_up: 'face',
  face: 'face',
  hands: 'hands',
  instrument_detail: 'instrument',
  detail: 'instrument',
  over_shoulder: 'face',
  low_angle: 'body',
  high_angle: 'body',
  profile: 'face',
};

/** Distance above the feet of each focus point, as a fraction of figure height. */
const FOCUS_OFFSET: Record<Focus, number> = {
  body: 0.5,
  face: 0.92,
  hands: 0.66,
  instrument: 0.7,
};

/** How much of the frame the performer fills, per shot type. */
const FIGURE_SCALE: Record<ShotType, number> = {
  establishing_wide: 0.2,
  wide: 0.34,
  medium: 0.62,
  close_up: 1.5,
  face: 2.4,
  hands: 3.2,
  instrument_detail: 2.8,
  detail: 2.0,
  over_shoulder: 1.1,
  low_angle: 0.9,
  high_angle: 0.55,
  profile: 0.8,
};

export function renderStill(options: StillOptions): Buffer {
  const { width, height, seed } = options;
  const rng = createRng(seed);
  const palette = derivePalette(options.timeOfDay, seed);
  const data = new Uint8Array(width * height * 3);
  const target: DrawTarget = { width, height, data };

  const horizonY = Math.round(height * (options.outdoor ? 0.62 : 0.72));

  // --- Sky / back wall gradient --------------------------------------------
  for (let y = 0; y < horizonY; y += 1) {
    const t = y / Math.max(1, horizonY);
    const color = lerpRgb(palette.skyTop, palette.skyBottom, Math.pow(t, 0.85));
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 3;
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
    }
  }

  // --- Ground --------------------------------------------------------------
  for (let y = horizonY; y < height; y += 1) {
    const t = (y - horizonY) / Math.max(1, height - horizonY);
    const color = lerpRgb(palette.hillNear, palette.ground, Math.pow(t, 0.6));
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 3;
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
    }
  }

  // --- Key light -----------------------------------------------------------
  const sunX = Math.round(width * (0.2 + rng() * 0.6));
  const sunY = Math.round(horizonY * (0.25 + rng() * 0.4));
  const sunR = Math.round(Math.min(width, height) * 0.05);
  drawGlow(target, sunX, sunY, sunR * 7, palette.sun, 0.32);
  drawDisc(target, sunX, sunY, sunR, palette.sun, 0.9);

  if (options.outdoor) {
    drawRidge(target, horizonY, width, height, palette.hillFar, 0.055, 2.1, rng(), 0.55);
    drawRidge(target, horizonY, width, height, palette.hillMid, 0.085, 1.4, rng(), 0.75);
    drawRidge(target, horizonY, width, height, palette.hillNear, 0.12, 0.9, rng(), 1);
  } else {
    drawInterior(target, horizonY, palette, rng);
  }

  // --- Performers ----------------------------------------------------------
  const scale = FIGURE_SCALE[options.shotType] ?? 0.6;
  // The master environment plate is deliberately empty (PRD §16).
  const count = Math.max(0, Math.min(6, options.performerCount));
  const spacing = width / (count + 1);
  const focus = SHOT_FOCUS[options.shotType] ?? 'body';
  for (let i = 0; i < count; i += 1) {
    const cx = Math.round(spacing * (i + 1) + (rng() - 0.5) * spacing * 0.15);
    const figureHeight = height * scale * (i === 0 ? 1 : 0.9);
    // Wide framings keep the feet on the ground; closer framings slide the
    // figure so the shot's subject lands near the middle of the frame.
    const baseY =
      scale <= 0.7 ? horizonY : height * 0.52 + figureHeight * (FOCUS_OFFSET[focus] ?? 0.5);
    drawPerformer(target, cx, baseY, figureHeight, palette, options.shotType);
  }

  // --- Atmosphere ----------------------------------------------------------
  drawLightShaft(target, sunX, sunY, horizonY, palette.sun, 0.08);
  applyVignette(target, 0.55);
  applyGrain(target, seed, 6);

  // --- Caption -------------------------------------------------------------
  const captionScale = Math.max(2, Math.round(width / 480));
  const lineHeight = captionScale * 11;
  const boxHeight = lineHeight * options.captions.length + captionScale * 10;
  fillRect(target, 0, height - boxHeight, width, boxHeight, [8, 9, 12], 0.62);
  fillRect(target, 0, height - boxHeight, captionScale * 3, boxHeight, palette.accent, 0.9);
  options.captions.forEach((line, index) => {
    drawText(
      target,
      line,
      captionScale * 8,
      height - boxHeight + captionScale * 5 + index * lineHeight,
      index === 0 ? captionScale : Math.max(1, captionScale - 1),
      index === 0 ? palette.caption : [186, 184, 178],
    );
  });

  if (options.badge) {
    const badgeScale = Math.max(2, Math.round(width / 560));
    const textWidth = measureText(options.badge, badgeScale);
    const padding = badgeScale * 5;
    fillRect(
      target,
      width - textWidth - padding * 3,
      padding,
      textWidth + padding * 2,
      badgeScale * 7 + padding * 2,
      [8, 9, 12],
      0.66,
    );
    drawText(target, options.badge, width - textWidth - padding * 2, padding * 2, badgeScale, palette.caption);
  }

  return encodePng(width, height, data);
}

function drawDisc(target: DrawTarget, cx: number, cy: number, r: number, color: Rgb, alpha: number): void {
  const r2 = r * r;
  for (let y = Math.max(0, cy - r); y <= Math.min(target.height - 1, cy + r); y += 1) {
    for (let x = Math.max(0, cx - r); x <= Math.min(target.width - 1, cx + r); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      blend(target, x, y, color, alpha);
    }
  }
}

function drawGlow(target: DrawTarget, cx: number, cy: number, r: number, color: Rgb, alpha: number): void {
  const r2 = r * r;
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(target.height - 1, cy + r);
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(target.width - 1, cx + r);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const falloff = 1 - Math.sqrt(d2) / r;
      blend(target, x, y, color, alpha * falloff * falloff);
    }
  }
}

function drawRidge(
  target: DrawTarget,
  horizonY: number,
  width: number,
  height: number,
  color: Rgb,
  amplitude: number,
  frequency: number,
  phase: number,
  alpha: number,
): void {
  const amp = height * amplitude;
  for (let x = 0; x < width; x += 1) {
    const t = x / width;
    const y =
      horizonY -
      amp *
        (0.55 * Math.sin(t * Math.PI * 2 * frequency + phase * 6.28) +
          0.3 * Math.sin(t * Math.PI * 2 * frequency * 2.3 + phase * 3.1) +
          0.15);
    const top = Math.max(0, Math.round(y));
    for (let py = top; py < horizonY; py += 1) {
      blend(target, x, py, color, alpha);
    }
  }
}

function drawInterior(target: DrawTarget, horizonY: number, palette: Palette, rng: () => number): void {
  const { width } = target;
  // A window and its light pool: enough to read as "indoors".
  const windowW = Math.round(width * 0.18);
  const windowH = Math.round(horizonY * 0.52);
  const windowX = Math.round(width * (0.08 + rng() * 0.12));
  const windowY = Math.round(horizonY * 0.16);
  fillRect(target, windowX, windowY, windowW, windowH, palette.sun, 0.55);
  fillRect(target, windowX, windowY + windowH / 2 - 2, windowW, 4, palette.ground, 0.7);
  fillRect(target, windowX + windowW / 2 - 2, windowY, 4, windowH, palette.ground, 0.7);
  fillRect(target, 0, horizonY - 6, width, 6, palette.hillNear, 0.8);
}

function drawPerformer(
  target: DrawTarget,
  cx: number,
  baseY: number,
  figureHeight: number,
  palette: Palette,
  shotType: ShotType,
): void {
  const h = figureHeight;
  const headR = Math.max(2, h * 0.085);
  const headY = baseY - h + headR;
  const shoulderY = headY + headR * 1.85;
  const hipY = baseY - h * 0.42;
  const bodyHalfTop = h * 0.13;
  const bodyHalfBottom = h * 0.095;

  // Contact shadow grounds the figure when the feet are inside the frame.
  if (baseY < target.height) {
    drawGlow(target, Math.round(cx), Math.round(baseY), Math.round(h * 0.18), [0, 0, 0], 0.35);
  }

  // Neck, so the head does not float above the shoulders.
  fillRect(
    target,
    cx - headR * 0.42,
    headY + headR * 0.7,
    headR * 0.84,
    Math.max(1, shoulderY - headY),
    palette.figure,
    0.94,
  );

  // Torso as a tapered column.
  for (let y = Math.round(shoulderY); y < Math.round(hipY); y += 1) {
    const t = (y - shoulderY) / Math.max(1, hipY - shoulderY);
    const halfWidth = lerp(bodyHalfTop, bodyHalfBottom, t);
    fillRect(target, cx - halfWidth, y, halfWidth * 2, 1, palette.figure, 0.94);
  }
  // Legs.
  for (let y = Math.round(hipY); y < Math.round(baseY); y += 1) {
    const t = (y - hipY) / Math.max(1, baseY - hipY);
    const spread = lerp(h * 0.02, h * 0.06, t);
    const legWidth = Math.max(1, h * 0.05);
    fillRect(target, cx - spread - legWidth, y, legWidth, 1, palette.figure, 0.94);
    fillRect(target, cx + spread, y, legWidth, 1, palette.figure, 0.94);
  }
  // Head.
  drawDisc(target, Math.round(cx), Math.round(headY), Math.round(headR), palette.figure, 0.96);

  // The instrument sits in front of the torso, held at playing height.
  const instrumentTop = shoulderY + h * 0.05;
  const instrumentH = h * 0.3;
  const instrumentW = h * 0.075;
  fillRect(target, cx + h * 0.03, instrumentTop, instrumentW, instrumentH, palette.accent, 0.85);
  fillRect(
    target,
    cx + h * 0.03 + instrumentW * 0.35,
    instrumentTop - h * 0.22,
    Math.max(1, instrumentW * 0.3),
    h * 0.24,
    palette.accent,
    0.8,
  );
  // Arms reaching towards it.
  const armY = shoulderY + h * 0.06;
  fillRect(target, cx - bodyHalfTop, armY, h * 0.12, Math.max(1, h * 0.028), palette.figure, 0.9);
  fillRect(target, cx, armY + h * 0.08, h * 0.13, Math.max(1, h * 0.028), palette.figure, 0.9);

  if (shotType === 'hands' || shotType === 'instrument_detail') {
    // Emphasise the contact point for detail shots.
    drawGlow(target, Math.round(cx + h * 0.05), Math.round(instrumentTop + instrumentH * 0.4), Math.round(h * 0.12), palette.sun, 0.25);
  }
}

function drawLightShaft(
  target: DrawTarget,
  sunX: number,
  sunY: number,
  horizonY: number,
  color: Rgb,
  alpha: number,
): void {
  const { width } = target;
  const bottom = horizonY;
  const spread = width * 0.16;
  for (let y = sunY; y < bottom; y += 1) {
    const t = (y - sunY) / Math.max(1, bottom - sunY);
    const halfWidth = spread * t;
    const fade = alpha * (1 - t) * 0.9;
    const x0 = Math.max(0, Math.round(sunX - halfWidth));
    const x1 = Math.min(width - 1, Math.round(sunX + halfWidth));
    for (let x = x0; x <= x1; x += 1) {
      blend(target, x, y, color, fade);
    }
  }
}

function applyVignette(target: DrawTarget, strength: number): void {
  const { width, height, data } = target;
  const cx = width / 2;
  const cy = height / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / maxD;
      const factor = 1 - strength * Math.pow(d, 2.4);
      const idx = (y * width + x) * 3;
      data[idx] = Math.max(0, Math.round((data[idx] as number) * factor));
      data[idx + 1] = Math.max(0, Math.round((data[idx + 1] as number) * factor));
      data[idx + 2] = Math.max(0, Math.round((data[idx + 2] as number) * factor));
    }
  }
}

function applyGrain(target: DrawTarget, seed: number, amount: number): void {
  const rng = createRng(seed ^ 0x9e3779b9);
  const { data } = target;
  for (let i = 0; i < data.length; i += 3) {
    const noise = (rng() - 0.5) * amount * 2;
    data[i] = clamp255((data[i] as number) + noise);
    data[i + 1] = clamp255((data[i + 1] as number) + noise);
    data[i + 2] = clamp255((data[i + 2] as number) + noise);
  }
}

function clamp255(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
}

function blend(target: DrawTarget, x: number, y: number, color: Rgb, alpha: number): void {
  if (alpha <= 0) return;
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= target.width || py >= target.height) return;
  const a = alpha > 1 ? 1 : alpha;
  const idx = (py * target.width + px) * 3;
  const data = target.data;
  data[idx] = Math.round((data[idx] as number) * (1 - a) + color[0] * a);
  data[idx + 1] = Math.round((data[idx + 1] as number) * (1 - a) + color[1] * a);
  data[idx + 2] = Math.round((data[idx + 2] as number) * (1 - a) + color[2] * a);
}
