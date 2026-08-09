import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { access } from 'node:fs/promises';
import { hasApprovedVersion, type Project } from '@ams/shared';
import { BASE_CONFIG, makeStudio, type TestStudio } from './helpers.js';
import { probeDurationSec } from '../media/ffmpeg.js';

let studio: TestStudio;
let project: Project;

beforeAll(async () => {
  studio = await makeStudio();
  const created = await studio.projects.create(BASE_CONFIG);
  project = created.project;

  // Walk the whole production the way a user would: generate, then approve.
  for (const target of [...project.assets].sort((a, b) => a.order - b.order)) {
    project = await studio.generation.startAndWait(project.id, target.id);
    const current = project.assets.find((a) => a.id === target.id)!;
    const generation = current.generations.at(-1)!;
    if (generation.status === 'failed') {
      throw new Error(`${target.label} failed: ${generation.error}`);
    }
    project = await studio.projects.approve(project.id, target.id, generation.id);
  }
}, 900_000);

afterAll(async () => {
  await studio.cleanup();
});

describe('Full production run (offline providers)', () => {
  it('approves every asset', () => {
    for (const a of project.assets) {
      expect(hasApprovedVersion(a), `${a.label} not approved`).toBe(true);
      expect(a.stale).toBe(false);
    }
  });

  it('writes every approved file to disk', async () => {
    for (const a of project.assets) {
      const generation = a.generations.find((g) => g.id === a.approvedGenerationId)!;
      const absolute = studio.repo.absolutePath(project.id, generation.file!.path);
      await expect(access(absolute)).resolves.toBeUndefined();
      expect(generation.file!.bytes).toBeGreaterThan(1000);
    }
  });

  it('anchors each shot still on approved references (PRD §17)', () => {
    const shotImage = project.assets.find((a) => a.kind === 'shot_image')!;
    const generation = shotImage.generations.at(-1)!;
    expect(generation.referenceAssetIds).toContain('master_scene');
    expect(generation.referenceAssetIds).toContain('master_character');
  });

  it('anchors each clip on its own approved still', () => {
    for (const clip of project.assets.filter((a) => a.kind === 'clip')) {
      const generation = clip.generations.at(-1)!;
      expect(generation.referenceAssetIds).toEqual([`${clip.shotId}_image`]);
    }
  });

  it('refuses to export before the final cut is approved (PRD §34)', async () => {
    await expect(studio.editor.exportFinal(project.id)).rejects.toThrow(/Aprueba el montaje/i);
  });

  it('assembles a preview whose length matches the requested duration', async () => {
    project = await studio.editor.assemble(project.id);
    expect(project.finalCut.status).toBe('review');
    const preview = project.finalCut.preview!;
    const absolute = studio.repo.absolutePath(project.id, preview.path);
    const duration = await probeDurationSec(absolute);
    expect(duration).toBeGreaterThan(BASE_CONFIG.durationSec - 1);
    expect(duration).toBeLessThan(BASE_CONFIG.durationSec + 1);
    expect(preview.width).toBe(1920);
    expect(preview.height).toBe(1080);
  }, 600_000);

  it('records an edit decision list that reuses approved footage (PRD §33)', () => {
    const edl = project.finalCut.edl!;
    expect(edl.length).toBe(project.plan.timeline.length);
    expect(edl.some((entry) => entry.reused)).toBe(true);
    const total = edl.reduce((sum, entry) => sum + entry.durationSec, 0);
    expect(total).toBe(BASE_CONFIG.durationSec);
  });

  it('exports an MP4 plus its delivery metadata once approved (PRD §42)', async () => {
    project = await studio.editor.approveFinal(project.id);
    expect(project.finalCut.status).toBe('approved');

    project = await studio.editor.exportFinal(project.id);
    expect(project.finalCut.status).toBe('exported');

    const exported = project.finalCut.export!;
    expect(exported.mimeType).toBe('video/mp4');
    await expect(
      access(studio.repo.absolutePath(project.id, exported.path)),
    ).resolves.toBeUndefined();
    await expect(
      access(studio.repo.absolutePath(project.id, 'final/project_final.json')),
    ).resolves.toBeUndefined();

    expect(project.delivery.title.length).toBeGreaterThan(2);
    expect(project.delivery.description.length).toBeGreaterThan(10);
    expect(project.delivery.hashtags.length).toBeGreaterThanOrEqual(3);
    for (const tag of project.delivery.hashtags) expect(tag.startsWith('#')).toBe(true);
  }, 600_000);

  it('invalidates the cut when an approved asset is replaced afterwards', async () => {
    const music = project.assets.find((a) => a.kind === 'music')!;
    let updated = await studio.generation.startAndWait(project.id, music.id, { unlock: true });
    const replacement = updated.assets.find((a) => a.id === music.id)!.generations.at(-1)!;
    updated = await studio.projects.approve(updated.id, music.id, replacement.id);
    expect(updated.finalCut.status).toBe('pending');
  }, 600_000);
});
