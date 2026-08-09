import type {
  AssetKind,
  AssetStatus,
  Beat,
  CameraMove,
  DurationSec,
  FinalCutStatus,
  GenerationStatus,
  ShotType,
  Stage,
  Transition,
} from './constants.js';

// ---------------------------------------------------------------------------
// Project configuration — everything the user chooses on the setup screen.
// ---------------------------------------------------------------------------

export interface ProjectConfig {
  /** Instrument ids from the catalogue; at least one (PRD §6). */
  instrumentIds: string[];
  /** Formation id (PRD §7). */
  formationId: string;
  /** Performer gender id (PRD §8). */
  performerGenderId: string;
  /** Performer visual type id (PRD §8). */
  performerTypeId: string;
  /** Scenario id (PRD §9). */
  scenarioId: string;
  /** Free-text scenario when `scenarioId === 'other'` or to refine a preset. */
  scenarioCustom?: string;
  /** Visual style id (PRD §10). */
  visualStyleId: string;
  /** Free-text style instructions (PRD §10). */
  visualStyleCustom?: string;
  /** The user's free creative direction (PRD §11). */
  creativeDirection: string;
  /** 60 | 120 | 180 (PRD §12). */
  durationSec: DurationSec;
  /** Optional project title override; otherwise the Director names the short. */
  titleHint?: string;
}

// ---------------------------------------------------------------------------
// Production plan — what the AI production team prepares before generating.
// ---------------------------------------------------------------------------

export interface Concept {
  title: string;
  logline: string;
  emotionalIntent: string;
  emotionalArc: string;
  mood: string[];
  palette: string[];
  timeOfDay: string;
}

export interface CharacterBible {
  summary: string;
  face: string;
  hair: string;
  wardrobe: string;
  build: string;
  apparentAge: string;
  accessories: string[];
}

export interface InstrumentBible {
  names: string[];
  appearance: string;
  scale: string;
  positioning: string;
  physicalRelation: string;
}

export interface EnvironmentBible {
  location: string;
  primaryElements: string[];
  secondaryElements: string[];
  atmosphere: string;
}

export interface LightingBible {
  timeOfDay: string;
  direction: string;
  intensity: string;
  atmosphere: string;
}

export interface AestheticBible {
  style: string;
  treatment: string;
  photography: string;
  finish: string;
}

/**
 * The Art Director's continuity contract (PRD §16, §17). Every prompt in the
 * project is composed from this, which is what keeps every shot looking like
 * the same film.
 */
export interface VisualBible {
  character: CharacterBible;
  instrument: InstrumentBible;
  environment: EnvironmentBible;
  lighting: LightingBible;
  aesthetic: AestheticBible;
  continuityRules: string[];
  negativePrompt: string;
}

export interface Clip {
  id: string;
  shotId: string;
  /** 0-based index inside the shot. */
  index: number;
  /** 'A' | 'B' | 'C' … as shown in the PRD's SHOT 04 / CLIP 04A example. */
  suffix: string;
  label: string;
  durationSec: number;
  /** What the camera and the performer do during this specific clip. */
  motionNote: string;
}

export interface Shot {
  id: string;
  index: number;
  label: string;
  beat: Beat;
  shotType: ShotType;
  cameraMove: CameraMove;
  /** Why this shot exists in the edit. */
  purpose: string;
  /** What the audience sees. */
  description: string;
  /** Canonical length of the shot's footage. */
  durationSec: number;
  /** The Producer marks shots whose footage can appear more than once (§25). */
  reusable: boolean;
  clips: Clip[];
}

export interface TimelineEntry {
  index: number;
  shotId: string;
  clipId: string;
  /** Asset id of the approved clip this slot plays. */
  clipAssetId: string;
  startSec: number;
  durationSec: number;
  /** True when this slot replays footage already used earlier (PRD §33). */
  reused: boolean;
  transitionIn: Transition;
}

export interface MusicBrief {
  title: string;
  /** Instrumental only — the product never generates voice (PRD §28). */
  instrumentation: string[];
  style: string;
  mood: string;
  tempoBpm: number;
  key: string;
  scale: string;
  structure: string;
  durationSec: number;
  prompt: string;
  negativePrompt: string;
}

export interface AmbientBrief {
  layers: string[];
  description: string;
  acoustics: string;
  durationSec: number;
  prompt: string;
}

export interface DeliveryMetadata {
  title: string;
  description: string;
  hashtags: string[];
}

export interface TeamNotes {
  director: string;
  producer: string;
  artDirector: string;
  cinematographer: string;
  screenwriter: string;
  editor: string;
}

export interface ProductionPlan {
  concept: Concept;
  visualBible: VisualBible;
  shots: Shot[];
  timeline: TimelineEntry[];
  music: MusicBrief;
  ambient: AmbientBrief;
  delivery: DeliveryMetadata;
  notes: TeamNotes;
  /** Which planner produced the creative layer. */
  plannedBy: 'claude' | 'heuristic';
  plannedAt: string;
  /** Total footage seconds actually generated vs. final runtime (reuse saving). */
  economics: {
    runtimeSec: number;
    generatedFootageSec: number;
    uniqueShots: number;
    timelineSlots: number;
    reusedSlots: number;
  };
}

// ---------------------------------------------------------------------------
// Assets and generations — the approval model (PRD §20–§23, §35, §37, §38).
// ---------------------------------------------------------------------------

export interface FileRef {
  /** Path relative to the project directory. */
  path: string;
  /** URL the web app can load. */
  url: string;
  mimeType: string;
  bytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface ProviderInfo {
  name: string;
  model: string;
  mode: 'mock' | 'vertex' | 'lyria';
}

export interface Generation {
  id: string;
  assetId: string;
  /** 1-based: "Generation #1", "Generation #2"… (PRD §21). */
  index: number;
  status: GenerationStatus;
  createdAt: string;
  completedAt?: string;
  /** The exact prompt used, which the user is allowed to inspect (PRD §19). */
  prompt: string;
  negativePrompt?: string;
  /** Approved assets used as visual references (PRD §17). */
  referenceAssetIds: string[];
  provider: ProviderInfo;
  seed: number;
  file?: FileRef;
  error?: string;
  /** How long the generation took, in ms. */
  elapsedMs?: number;
}

export interface AssetSpec {
  /** What this asset must show. */
  objective: string;
  prompt: string;
  negativePrompt: string;
  referenceAssetIds: string[];
  continuityNotes: string[];
  durationSec?: number;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  stage: Stage;
  label: string;
  order: number;
  shotId?: string;
  clipId?: string;
  status: AssetStatus;
  /** Approved assets are the official, locked version (PRD §23, §38). */
  locked: boolean;
  approvedGenerationId: string | null;
  generations: Generation[];
  spec: AssetSpec;
  /** Assets that must be approved before this one can be generated. */
  dependsOn: string[];
  /** Set when an upstream approved asset was replaced after this was approved. */
  stale: boolean;
  staleReason?: string;
}

export interface FinalCut {
  status: FinalCutStatus;
  preview?: FileRef;
  export?: FileRef;
  /** Snapshot of which generation of each asset the current cut was built from. */
  builtFrom?: Record<string, string>;
  builtAt?: string;
  approvedAt?: string;
  error?: string;
  /** Human-readable edit decision list shown next to the preview (PRD §33). */
  edl?: Array<{
    index: number;
    timecode: string;
    label: string;
    durationSec: number;
    reused: boolean;
  }>;
}

export type ProjectEventType =
  | 'project_created'
  | 'plan_ready'
  | 'generation_started'
  | 'generation_ready'
  | 'generation_failed'
  | 'generation_approved'
  | 'generation_rejected'
  | 'asset_unlocked'
  | 'asset_stale'
  | 'stage_completed'
  | 'cut_building'
  | 'cut_ready'
  | 'cut_failed'
  | 'cut_approved'
  | 'exported';

export interface ProjectEvent {
  id: string;
  at: string;
  type: ProjectEventType;
  message: string;
  assetId?: string;
  generationId?: string;
  stage?: Stage;
}

export interface Project {
  id: string;
  createdAt: string;
  updatedAt: string;
  config: ProjectConfig;
  plan: ProductionPlan;
  assets: Asset[];
  /** Stage the user is currently working in. */
  currentStage: Stage;
  finalCut: FinalCut;
  delivery: DeliveryMetadata;
  events: ProjectEvent[];
}

/** Compact record used by the project list screen. */
export interface ProjectSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  durationSec: number;
  currentStage: Stage;
  approvedAssets: number;
  totalAssets: number;
  finalCutStatus: FinalCutStatus;
}

// ---------------------------------------------------------------------------
// API payloads
// ---------------------------------------------------------------------------

export interface StageProgress {
  stage: Stage;
  label: string;
  state: 'pending' | 'active' | 'complete';
  approved: number;
  total: number;
}

export interface ProductionStatus {
  stages: StageProgress[];
  /** Flat board matching PRD §36. */
  rows: Array<{
    assetId: string;
    label: string;
    status: AssetStatus;
    stale: boolean;
    stage: Stage;
  }>;
  /** The asset the user should look at next, if any. */
  nextActionableAssetId: string | null;
  readyForEdit: boolean;
}

export interface GenerateOptions {
  /** Regenerating an approved (locked) asset requires an explicit unlock. */
  unlock?: boolean;
  /** Optional prompt override so the user can steer a stubborn asset. */
  promptOverride?: string;
}

export type StreamEvent =
  | { type: 'project'; project: Project }
  | { type: 'event'; event: ProjectEvent }
  | { type: 'ping' };
