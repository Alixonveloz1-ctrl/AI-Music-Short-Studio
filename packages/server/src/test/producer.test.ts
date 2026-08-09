import { describe, expect, it } from 'vitest';
import { DURATIONS_SEC, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from '@ams/shared';
import { planStructure, splitShotIntoClips } from '../team/producer.js';

describe('Producer — structure planning', () => {
  for (const duration of DURATIONS_SEC) {
    describe(`${duration}s short`, () => {
      const structure = planStructure(duration);

      it('produces a timeline that lasts exactly the requested duration', () => {
        const total = structure.timeline.reduce((sum, entry) => sum + entry.durationSec, 0);
        expect(total).toBe(duration);
        expect(structure.economics.runtimeSec).toBe(duration);
      });

      it('lays the timeline out contiguously with no gaps or overlaps', () => {
        let cursor = 0;
        for (const entry of structure.timeline) {
          expect(entry.startSec).toBe(cursor);
          cursor += entry.durationSec;
        }
      });

      it('never asks a model for a clip longer than it can generate', () => {
        for (const shot of structure.shots) {
          for (const clip of shot.clips) {
            expect(clip.durationSec).toBeLessThanOrEqual(MAX_CLIP_SECONDS);
            expect(clip.durationSec).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS);
          }
          const clipTotal = shot.clips.reduce((sum, clip) => sum + clip.durationSec, 0);
          expect(clipTotal).toBe(shot.durationSec);
        }
      });

      it('only plays footage a shot actually has', () => {
        const byShot = new Map(structure.shots.map((s) => [s.id, s] as const));
        for (const entry of structure.timeline) {
          const shot = byShot.get(entry.shotId);
          expect(shot, `unknown shot ${entry.shotId}`).toBeDefined();
          const clip = shot!.clips.find((c) => c.id === entry.clipId);
          expect(clip, `unknown clip ${entry.clipId}`).toBeDefined();
          expect(entry.durationSec).toBeLessThanOrEqual(clip!.durationSec);
        }
      });

      it('reuses approved footage instead of generating everything twice', () => {
        expect(structure.economics.reusedSlots).toBeGreaterThan(0);
        expect(structure.economics.generatedFootageSec).toBeLessThan(duration);
      });

      it('only reuses shots the Producer marked as reusable', () => {
        const byShot = new Map(structure.shots.map((s) => [s.id, s] as const));
        for (const entry of structure.timeline) {
          if (!entry.reused) continue;
          expect(byShot.get(entry.shotId)?.reusable).toBe(true);
        }
      });

      it('opens on an establishing shot and closes by rhyming with it', () => {
        expect(structure.shots[0]?.shotType).toBe('establishing_wide');
        const last = structure.timeline[structure.timeline.length - 1];
        expect(last?.reused).toBe(true);
        expect(last?.shotId).toBe(structure.shots[0]?.id);
      });

      it('is deterministic', () => {
        const again = planStructure(duration);
        expect(JSON.stringify(again)).toBe(JSON.stringify(structure));
      });
    });
  }

  it('spreads reuse across the available footage rather than replaying one shot', () => {
    const structure = planStructure(180);
    const counts = new Map<string, number>();
    for (const entry of structure.timeline) {
      if (!entry.reused) continue;
      counts.set(entry.shotId, (counts.get(entry.shotId) ?? 0) + 1);
    }
    expect(counts.size).toBeGreaterThan(2);
  });

  it('scales the shot count with the runtime', () => {
    const short = planStructure(60).economics.uniqueShots;
    const medium = planStructure(120).economics.uniqueShots;
    const long = planStructure(180).economics.uniqueShots;
    expect(medium).toBeGreaterThan(short);
    expect(long).toBeGreaterThan(medium);
  });
});

describe('Producer — clip splitting', () => {
  it('keeps a short shot as a single clip', () => {
    const clips = splitShotIntoClips('shot_01', 1, 6);
    expect(clips).toHaveLength(1);
    expect(clips[0]?.label).toBe('Clip 01A');
  });

  it('splits a long shot into balanced clips', () => {
    const clips = splitShotIntoClips('shot_04', 4, 22);
    expect(clips.length).toBeGreaterThan(2);
    expect(clips.reduce((sum, c) => sum + c.durationSec, 0)).toBe(22);
    expect(clips.map((c) => c.suffix)).toEqual(['A', 'B', 'C']);
  });

  it('never leaves a sliver of a clip behind', () => {
    for (let duration = MIN_CLIP_SECONDS; duration <= 40; duration += 1) {
      const clips = splitShotIntoClips('shot_09', 9, duration);
      expect(clips.reduce((sum, c) => sum + c.durationSec, 0)).toBe(duration);
      for (const clip of clips) {
        expect(clip.durationSec).toBeGreaterThanOrEqual(MIN_CLIP_SECONDS);
        expect(clip.durationSec).toBeLessThanOrEqual(MAX_CLIP_SECONDS);
      }
    }
  });
});
