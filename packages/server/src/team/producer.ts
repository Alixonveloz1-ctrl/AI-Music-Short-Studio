/**
 * The Producer (PRD §15).
 *
 * Decides *what has to exist*: how many shots the short needs, how long each
 * one is, how a long shot is split into generatable clips, and — crucially —
 * where approved footage can be reused instead of generating something new
 * (PRD §25, §33). The creative layer never touches these numbers, so the
 * duration maths is always exact no matter which planner writes the brief.
 */
import {
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  type Beat,
  type CameraMove,
  type ShotType,
  type Transition,
} from '@ams/shared';

export interface PlannedClip {
  id: string;
  shotId: string;
  index: number;
  suffix: string;
  label: string;
  durationSec: number;
}

export interface PlannedShot {
  id: string;
  index: number;
  label: string;
  beat: Beat;
  shotType: ShotType;
  cameraMove: CameraMove;
  durationSec: number;
  reusable: boolean;
  clips: PlannedClip[];
}

export interface PlannedTimelineEntry {
  index: number;
  shotId: string;
  clipId: string;
  startSec: number;
  durationSec: number;
  reused: boolean;
  transitionIn: Transition;
  beat: Beat;
}

export interface Structure {
  shots: PlannedShot[];
  timeline: PlannedTimelineEntry[];
  economics: {
    runtimeSec: number;
    generatedFootageSec: number;
    uniqueShots: number;
    timelineSlots: number;
    reusedSlots: number;
  };
}

interface BeatPlan {
  beat: Beat;
  /** Share of the total runtime. */
  weight: number;
  /** Typical shot length inside the beat — the film's cutting rhythm. */
  baseSlotSec: number;
}

const BEAT_PLAN: BeatPlan[] = [
  { beat: 'opening', weight: 0.18, baseSlotSec: 8 },
  { beat: 'development', weight: 0.4, baseSlotSec: 6 },
  { beat: 'climax', weight: 0.27, baseSlotSec: 4 },
  { beat: 'closing', weight: 0.15, baseSlotSec: 7 },
];

/** Shot grammar per beat (PRD §18 — the Director of Photography's vocabulary). */
const SHOT_GRAMMAR: Record<Beat, ShotType[]> = {
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

const CAMERA_BY_SHOT: Record<ShotType, CameraMove[]> = {
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
 * Shot types whose footage carries no unique performance beat, so the Editor
 * may replay it later without the audience noticing a repeat.
 */
const REUSABLE_SHOT_TYPES = new Set<ShotType>([
  'establishing_wide',
  'wide',
  'detail',
  'instrument_detail',
]);

const CLIP_SUFFIXES = 'ABCDEFGH';

/** Split a beat's seconds into whole-second slots as evenly as possible. */
function splitIntoSlots(totalSec: number, baseSlotSec: number): number[] {
  const count = Math.max(1, Math.round(totalSec / baseSlotSec));
  const base = Math.floor(totalSec / count);
  let remainder = totalSec - base * count;
  const slots: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    slots.push(base + extra);
  }
  return slots;
}

/** Split a shot into clips no longer than the model's per-generation limit. */
export function splitShotIntoClips(shotId: string, shotIndex: number, durationSec: number): PlannedClip[] {
  const count = Math.max(1, Math.ceil(durationSec / MAX_CLIP_SECONDS));
  const base = Math.floor(durationSec / count);
  let remainder = durationSec - base * count;
  const lengths: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    lengths.push(base + extra);
  }
  // Never emit a clip so short it reads as a glitch: fold it into its neighbour.
  for (let i = lengths.length - 1; i > 0; i -= 1) {
    const current = lengths[i] as number;
    if (current < MIN_CLIP_SECONDS) {
      const previous = lengths[i - 1] as number;
      if (previous + current <= MAX_CLIP_SECONDS) {
        lengths[i - 1] = previous + current;
        lengths.splice(i, 1);
      }
    }
  }
  const padded = String(shotIndex).padStart(2, '0');
  return lengths.map((seconds, index) => {
    const suffix = CLIP_SUFFIXES[index] ?? String(index + 1);
    return {
      id: `${shotId}_clip_${suffix.toLowerCase()}`,
      shotId,
      index,
      suffix,
      label: `Clip ${padded}${suffix}`,
      durationSec: seconds,
    };
  });
}

export function clipAssetId(clipId: string): string {
  return clipId;
}

export function shotImageAssetId(shotId: string): string {
  return `${shotId}_image`;
}

/**
 * Build the shot list and the edit timeline for a given runtime.
 *
 * The timeline is the source of truth: it is laid out first so it always sums
 * to exactly the requested duration, and the shot list is whatever that
 * timeline needs — minus the slots the Producer decides to fill with footage
 * that already exists.
 */
export function planStructure(runtimeSec: number): Structure {
  // 1. Lay out the beats so the slot durations add up to the runtime exactly.
  const beatSlots: Array<{ beat: Beat; durationSec: number }> = [];
  let allocated = 0;
  BEAT_PLAN.forEach((plan, planIndex) => {
    const isLast = planIndex === BEAT_PLAN.length - 1;
    const beatSec = isLast
      ? runtimeSec - allocated
      : Math.max(plan.baseSlotSec, Math.round(runtimeSec * plan.weight));
    allocated += beatSec;
    for (const durationSec of splitIntoSlots(beatSec, plan.baseSlotSec)) {
      beatSlots.push({ beat: plan.beat, durationSec });
    }
  });

  // 2. Assign a shot to every slot, reusing approved-footage candidates where
  //    the Producer decides a new generation would add nothing (PRD §15, §25).
  const shots: PlannedShot[] = [];
  const slotAssignments: Array<{ shot: PlannedShot; durationSec: number; reused: boolean; beat: Beat }> = [];
  const grammarCursor: Record<Beat, number> = { opening: 0, development: 0, climax: 0, closing: 0 };
  const reuseCounts = new Map<string, number>();
  let lastShotType: ShotType | null = null;

  beatSlots.forEach((slot, slotIndex) => {
    const reuseCandidate = pickReuseCandidate(shots, reuseCounts, slotIndex, beatSlots.length);
    if (reuseCandidate) {
      reuseCounts.set(reuseCandidate.id, (reuseCounts.get(reuseCandidate.id) ?? 0) + 1);
      reuseCandidate.durationSec = Math.max(reuseCandidate.durationSec, slot.durationSec);
      slotAssignments.push({
        shot: reuseCandidate,
        durationSec: slot.durationSec,
        reused: true,
        beat: slot.beat,
      });
      return;
    }

    const grammar = SHOT_GRAMMAR[slot.beat];
    let shotType = grammar[grammarCursor[slot.beat] % grammar.length] as ShotType;
    if (shotType === lastShotType) {
      grammarCursor[slot.beat] += 1;
      shotType = grammar[grammarCursor[slot.beat] % grammar.length] as ShotType;
    }
    grammarCursor[slot.beat] += 1;
    lastShotType = shotType;

    const index = shots.length + 1;
    const id = `shot_${String(index).padStart(2, '0')}`;
    const moves = CAMERA_BY_SHOT[shotType];
    const cameraMove = moves[index % moves.length] as CameraMove;
    const shot: PlannedShot = {
      id,
      index,
      label: `Shot ${String(index).padStart(2, '0')}`,
      beat: slot.beat,
      shotType,
      cameraMove,
      durationSec: slot.durationSec,
      reusable: REUSABLE_SHOT_TYPES.has(shotType),
      clips: [],
    };
    shots.push(shot);
    slotAssignments.push({ shot, durationSec: slot.durationSec, reused: false, beat: slot.beat });
  });

  // 3. Now that every shot's canonical length is final, split it into clips.
  for (const shot of shots) {
    shot.clips = splitShotIntoClips(shot.id, shot.index, shot.durationSec);
  }

  // 4. Expand slots into clip-level timeline entries.
  const timeline: PlannedTimelineEntry[] = [];
  let cursorSec = 0;
  let previousBeat: Beat | null = null;
  for (const assignment of slotAssignments) {
    let remaining = assignment.durationSec;
    let firstOfSlot = true;
    for (const clip of assignment.shot.clips) {
      if (remaining <= 0) break;
      const durationSec = Math.min(clip.durationSec, remaining);
      const isFirstEntry = timeline.length === 0;
      const beatChanged = previousBeat !== null && previousBeat !== assignment.beat;
      const transitionIn: Transition = isFirstEntry
        ? 'fade_in'
        : firstOfSlot && beatChanged
          ? 'dip_to_black'
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

function pickReuseCandidate(
  shots: PlannedShot[],
  reuseCounts: Map<string, number>,
  slotIndex: number,
  totalSlots: number,
): PlannedShot | null {
  // Never reuse while the film is still establishing its world.
  if (slotIndex < 3) return null;
  const isFinalSlot = slotIndex === totalSlots - 1;
  const isRecallBeat = slotIndex % 5 === 4;
  if (!isRecallBeat && !isFinalSlot) return null;

  const candidates = shots.filter((shot) => shot.reusable);
  if (candidates.length < 2) return null;

  // The closing slot deliberately rhymes with the opening image.
  if (isFinalSlot) {
    const opener = candidates.find((shot) => shot.beat === 'opening');
    if (opener) return opener;
  }

  // Otherwise spread recalls across the available footage: least-used first,
  // and among equals the most recently introduced, so a single wide shot does
  // not end up carrying the whole film.
  let best: PlannedShot | null = null;
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
