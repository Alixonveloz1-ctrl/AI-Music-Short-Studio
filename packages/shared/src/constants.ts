/**
 * Product-wide constants.
 *
 * The single most important rule of this product (PRD §4) is encoded here as
 * well as in the state machine: the AI proposes and generates, the user
 * reviews, approves or regenerates, and only approved assets move forward.
 */

/** The only durations the product supports (PRD §12). */
export const DURATIONS_SEC = [60, 120, 180] as const;
export type DurationSec = (typeof DURATIONS_SEC)[number];

/**
 * Maximum length of a single generated video clip. Video models generate short
 * takes, so a longer shot is split into several clips that the editor joins
 * back together (PRD §24).
 */
export const MAX_CLIP_SECONDS = 8;

/** Clips shorter than this look like glitches, so splits avoid them. */
export const MIN_CLIP_SECONDS = 2;

/** Output geometry of the finished short. */
export const OUTPUT_WIDTH = 1920;
export const OUTPUT_HEIGHT = 1080;
export const OUTPUT_FPS = 24;
export const OUTPUT_ASPECT_RATIO = '16:9';

/** Sample rate used by the built-in audio synthesis providers. */
export const AUDIO_SAMPLE_RATE = 44_100;

/** Ordered production stages (PRD §5, §44). */
export const STAGES = [
  'concept',
  'images',
  'videos',
  'music',
  'ambient',
  'edit',
  'delivery',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  concept: 'Concepto y plan',
  images: 'Imágenes',
  videos: 'Vídeos',
  music: 'Música',
  ambient: 'Sonido ambiental',
  edit: 'Edición',
  delivery: 'Entrega',
};

/** Element states (PRD §35). */
export const ASSET_STATUSES = ['pending', 'generating', 'review', 'approved'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const GENERATION_STATUSES = [
  'generating',
  'review',
  'approved',
  'rejected',
  'failed',
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  pending: 'PENDIENTE',
  generating: 'GENERANDO',
  review: 'REVISIÓN',
  approved: 'APROBADO',
};

export const ASSET_KINDS = [
  'master_character',
  'master_environment',
  'master_scene',
  'shot_image',
  'clip',
  'music',
  'ambient',
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_KIND_STAGE: Record<AssetKind, Stage> = {
  master_character: 'images',
  master_environment: 'images',
  master_scene: 'images',
  shot_image: 'images',
  clip: 'videos',
  music: 'music',
  ambient: 'ambient',
};

export const ASSET_KIND_MEDIA: Record<AssetKind, 'image' | 'video' | 'audio'> = {
  master_character: 'image',
  master_environment: 'image',
  master_scene: 'image',
  shot_image: 'image',
  clip: 'video',
  music: 'audio',
  ambient: 'audio',
};

/** Narrative beats used by the Director to shape the short. */
export const BEATS = ['opening', 'development', 'climax', 'closing'] as const;
export type Beat = (typeof BEATS)[number];

export const SHOT_TYPES = [
  'establishing_wide',
  'wide',
  'medium',
  'close_up',
  'face',
  'hands',
  'instrument_detail',
  'detail',
  'over_shoulder',
  'low_angle',
  'high_angle',
  'profile',
] as const;
export type ShotType = (typeof SHOT_TYPES)[number];

export const CAMERA_MOVES = [
  'static',
  'slow_push_in',
  'slow_pull_out',
  'pan_left',
  'pan_right',
  'tilt_up',
  'tilt_down',
  'lateral_track_left',
  'lateral_track_right',
  'handheld_drift',
  'crane_up',
] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

/**
 * Transitions the Editor can actually render. `dip_to_black` is a short fade
 * out / fade in across a block boundary — named for what it does rather than
 * implying a cross-dissolve the assembler does not perform.
 */
export const TRANSITIONS = ['cut', 'dip_to_black', 'fade_in', 'fade_out'] as const;
export type Transition = (typeof TRANSITIONS)[number];

/** Final cut lifecycle. */
export const FINAL_CUT_STATUSES = [
  'pending',
  'building',
  'review',
  'approved',
  'exported',
  'failed',
] as const;
export type FinalCutStatus = (typeof FINAL_CUT_STATUSES)[number];
