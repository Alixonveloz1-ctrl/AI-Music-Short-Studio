import { describe, expect, it } from 'vitest';
import {
  normalizeCreativeBrief,
  projectConfigSchema,
  type CreativeBrief,
  type ProjectConfig,
} from '@ams/shared';
import { loadConfig } from '../config.js';
import { buildProductionPlan } from '../team/index.js';
import { buildHeuristicBrief } from '../team/heuristicPlanner.js';
import { planStructure } from '../team/producer.js';
import { buildAssets } from '../domain/project.js';
import { BASE_CONFIG } from './helpers.js';

const appConfig = {
  ...loadConfig(),
  planner: { mode: 'heuristic' as const, model: 'claude-opus-5', apiKey: '' },
};

describe('Project configuration validation', () => {
  it('accepts a well-formed configuration', () => {
    expect(projectConfigSchema.safeParse(BASE_CONFIG).success).toBe(true);
  });

  it('rejects durations the product does not support (PRD §12)', () => {
    const result = projectConfigSchema.safeParse({ ...BASE_CONFIG, durationSec: 90 });
    expect(result.success).toBe(false);
  });

  it('rejects a performer type that contradicts the selected performer (PRD §8)', () => {
    const result = projectConfigSchema.safeParse({
      ...BASE_CONFIG,
      performerGenderId: 'male',
      performerTypeId: 'adult_woman',
    });
    expect(result.success).toBe(false);
  });

  it('requires a description when the scenario or style is "otro"', () => {
    expect(
      projectConfigSchema.safeParse({ ...BASE_CONFIG, scenarioId: 'other' }).success,
    ).toBe(false);
    expect(
      projectConfigSchema.safeParse({
        ...BASE_CONFIG,
        scenarioId: 'other',
        scenarioCustom: 'Un puente de piedra sobre un río helado',
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown instrument', () => {
    const result = projectConfigSchema.safeParse({ ...BASE_CONFIG, instrumentIds: ['kazoo-x'] });
    expect(result.success).toBe(false);
  });
});

describe('Production plan', () => {
  it('builds a complete, self-consistent plan offline', async () => {
    const { plan, warnings } = await buildProductionPlan(BASE_CONFIG, appConfig);
    expect(warnings).toEqual([]);
    expect(plan.plannedBy).toBe('heuristic');
    expect(plan.concept.title.length).toBeGreaterThan(2);
    expect(plan.shots.length).toBeGreaterThan(4);
    expect(plan.visualBible.continuityRules.length).toBeGreaterThan(4);
    expect(plan.timeline.every((entry) => plan.shots.some((s) => s.id === entry.shotId))).toBe(true);
  });

  it('respects the user configuration rather than inventing its own (PRD §14)', async () => {
    const config: ProjectConfig = {
      ...BASE_CONFIG,
      instrumentIds: ['taiko', 'shakuhachi'],
      scenarioId: 'temple',
      visualStyleId: 'cinematic_realistic',
      formationId: 'duo',
      durationSec: 120,
    };
    const { plan } = await buildProductionPlan(config, appConfig);
    expect(plan.visualBible.instrument.names).toEqual(['Taiko', 'Shakuhachi']);
    expect(plan.music.instrumentation).toEqual(['Taiko', 'Shakuhachi']);
    expect(plan.visualBible.aesthetic.style).toBe('Cinematográfico realista');
    expect(plan.visualBible.environment.location.toLowerCase()).toContain('templo');
    expect(plan.music.durationSec).toBe(120);
    expect(plan.ambient.durationSec).toBe(120);
  });

  it('carries the user creative direction into the continuity contract (PRD §11)', async () => {
    const { plan } = await buildProductionPlan(BASE_CONFIG, appConfig);
    const rules = plan.visualBible.continuityRules.join(' ');
    expect(rules).toContain('niebla baja');
  });

  it('keeps the music instrumental (PRD §28)', async () => {
    const { plan } = await buildProductionPlan(BASE_CONFIG, appConfig);
    expect(plan.music.prompt).toMatch(/sin voz/i);
    expect(plan.music.negativePrompt).toMatch(/voz/i);
  });

  it('names the film once and uses that name everywhere', async () => {
    const { plan } = await buildProductionPlan(BASE_CONFIG, appConfig);
    expect(plan.delivery.title).toBe(plan.concept.title);
    expect(plan.music.title).toBe(plan.concept.title);
  });
});

describe('Prompt composition (PRD §16, §19)', () => {
  it('composes every prompt from the shared visual bible', async () => {
    const { plan } = await buildProductionPlan(BASE_CONFIG, appConfig);
    const assets = buildAssets(BASE_CONFIG, plan);
    const face = plan.visualBible.character.face;

    for (const asset of assets.filter((a) => a.kind === 'shot_image')) {
      expect(asset.spec.prompt).toContain(face);
      expect(asset.spec.negativePrompt).toContain('manos deformes');
      expect(asset.spec.referenceAssetIds).toContain('master_scene');
    }
  });

  it('gives every clip its own shot still as the reference', async () => {
    const { plan } = await buildProductionPlan(BASE_CONFIG, appConfig);
    const assets = buildAssets(BASE_CONFIG, plan);
    for (const clip of assets.filter((a) => a.kind === 'clip')) {
      expect(clip.dependsOn).toEqual([`${clip.shotId}_image`]);
      expect(clip.spec.durationSec).toBeGreaterThan(0);
    }
  });

  it('creates exactly one asset per planned still, clip, music and ambience track', async () => {
    const { plan } = await buildProductionPlan(BASE_CONFIG, appConfig);
    const assets = buildAssets(BASE_CONFIG, plan);
    const expected =
      3 + plan.shots.length + plan.shots.reduce((sum, s) => sum + s.clips.length, 0) + 2;
    expect(assets).toHaveLength(expected);
    expect(new Set(assets.map((a) => a.id)).size).toBe(assets.length);
  });
});

describe('Creative brief normalisation', () => {
  const structure = planStructure(60);
  const input = {
    config: BASE_CONFIG,
    runtimeSec: 60,
    shots: structure.shots.map((s) => ({
      index: s.index,
      label: s.label,
      beat: s.beat,
      shotType: s.shotType,
      cameraMove: s.cameraMove,
      durationSec: s.durationSec,
    })),
  };
  const fallback: CreativeBrief = buildHeuristicBrief(input);

  it('fills the gaps in a partial brief from the fallback', () => {
    const normalized = normalizeCreativeBrief({ title: 'Niebla' }, fallback, input.shots.length);
    expect(normalized.title).toBe('Niebla');
    expect(normalized.character.face).toBe(fallback.character.face);
    expect(normalized.shots).toHaveLength(input.shots.length);
  });

  it('clamps runaway text instead of rejecting the brief', () => {
    const normalized = normalizeCreativeBrief(
      { title: 'x'.repeat(400), music: { tempoBpm: 9000 } },
      fallback,
      input.shots.length,
    );
    expect(normalized.title.length).toBeLessThanOrEqual(78);
    expect(normalized.music.tempoBpm).toBe(fallback.music.tempoBpm);
  });

  it('always returns one entry per planned shot, in order', () => {
    const normalized = normalizeCreativeBrief(
      { shots: [{ index: 3, purpose: 'p3', description: 'd3' }] },
      fallback,
      input.shots.length,
    );
    expect(normalized.shots.map((s) => s.index)).toEqual(
      input.shots.map((s) => s.index),
    );
    expect(normalized.shots[2]?.purpose).toBe('p3');
  });

  it('normalises hashtags so they are usable as-is', () => {
    const normalized = normalizeCreativeBrief(
      { delivery: { description: 'ok', hashtags: ['Erhu', '#Anime'] } },
      fallback,
      input.shots.length,
    );
    expect(normalized.delivery.hashtags).toEqual(['#Erhu', '#Anime']);
  });

  it('survives complete garbage', () => {
    const normalized = normalizeCreativeBrief(null, fallback, input.shots.length);
    expect(normalized.title).toBe(fallback.title);
    expect(normalized.shots).toHaveLength(input.shots.length);
  });
});
