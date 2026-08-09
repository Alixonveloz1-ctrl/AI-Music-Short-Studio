import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  canGenerate,
  computeProductionStatus,
  hasApprovedVersion,
  type Project,
} from '@ams/shared';
import { BASE_CONFIG, makeStudio, type TestStudio } from './helpers.js';
import { MASTER_CHARACTER_ID, MASTER_ENVIRONMENT_ID, MASTER_SCENE_ID } from '../domain/project.js';

let studio: TestStudio;

beforeAll(async () => {
  studio = await makeStudio();
});

afterAll(async () => {
  await studio.cleanup();
});

function asset(project: Project, id: string) {
  const found = project.assets.find((a) => a.id === id);
  if (!found) throw new Error(`missing asset ${id}`);
  return found;
}

describe('The approval rule (PRD §4, §46)', () => {
  it('creates every asset pending, with nothing generated and nothing approved', async () => {
    const { project } = await studio.projects.create(BASE_CONFIG);
    expect(project.assets.length).toBeGreaterThan(10);
    for (const a of project.assets) {
      expect(a.status).toBe('pending');
      expect(a.generations).toHaveLength(0);
      expect(a.approvedGenerationId).toBeNull();
      expect(a.locked).toBe(false);
    }
    expect(project.finalCut.status).toBe('pending');
  });

  it('leaves a successful generation in review — never approved', async () => {
    const { project: created } = await studio.projects.create(BASE_CONFIG);
    const project = await studio.generation.startAndWait(created.id, MASTER_CHARACTER_ID);
    const character = asset(project, MASTER_CHARACTER_ID);

    expect(character.status).toBe('review');
    expect(character.generations).toHaveLength(1);
    expect(character.generations[0]?.status).toBe('review');
    expect(character.generations[0]?.file).toBeDefined();
    expect(character.approvedGenerationId).toBeNull();
    expect(hasApprovedVersion(character)).toBe(false);
  });

  it('only moves an asset forward when the user approves it explicitly', async () => {
    const { project: created } = await studio.projects.create(BASE_CONFIG);
    let project = await studio.generation.startAndWait(created.id, MASTER_CHARACTER_ID);
    const generationId = asset(project, MASTER_CHARACTER_ID).generations[0]!.id;

    project = await studio.projects.approve(project.id, MASTER_CHARACTER_ID, generationId);
    const character = asset(project, MASTER_CHARACTER_ID);
    expect(character.status).toBe('approved');
    expect(character.locked).toBe(true);
    expect(character.approvedGenerationId).toBe(generationId);
  });

  it('blocks a downstream asset until its references are approved (PRD §17, §32)', async () => {
    const { project: created } = await studio.projects.create(BASE_CONFIG);
    const scene = asset(created, MASTER_SCENE_ID);
    expect(canGenerate(created, scene).ok).toBe(false);

    await expect(studio.generation.start(created.id, MASTER_SCENE_ID)).rejects.toThrow(
      /activos aprobados/i,
    );
  });

  it('refuses to open the video stage while an image is unapproved (PRD §5)', async () => {
    const { project } = await studio.projects.create(BASE_CONFIG);
    const clip = project.assets.find((a) => a.kind === 'clip');
    expect(clip).toBeDefined();
    expect(canGenerate(project, clip!).ok).toBe(false);
    await expect(studio.generation.start(project.id, clip!.id)).rejects.toThrow(/etapa/i);
  });

  it('keeps every generation as history and uses only the approved one (PRD §21, §38)', async () => {
    const { project: created } = await studio.projects.create(BASE_CONFIG);
    let project = await studio.generation.startAndWait(created.id, MASTER_CHARACTER_ID);
    const first = asset(project, MASTER_CHARACTER_ID).generations[0]!;

    project = await studio.projects.reject(project.id, MASTER_CHARACTER_ID, first.id);
    expect(asset(project, MASTER_CHARACTER_ID).status).toBe('pending');

    project = await studio.generation.startAndWait(project.id, MASTER_CHARACTER_ID);
    const second = asset(project, MASTER_CHARACTER_ID).generations[1]!;
    expect(second.index).toBe(2);
    // A regeneration must actually be a different take.
    expect(second.seed).not.toBe(first.seed);

    project = await studio.projects.approve(project.id, MASTER_CHARACTER_ID, second.id);
    const character = asset(project, MASTER_CHARACTER_ID);
    expect(character.generations).toHaveLength(2);
    expect(character.generations[0]?.status).toBe('rejected');
    expect(character.approvedGenerationId).toBe(second.id);
  });

  it('will not approve a generation that is not in review', async () => {
    const { project: created } = await studio.projects.create(BASE_CONFIG);
    const project = await studio.generation.startAndWait(created.id, MASTER_CHARACTER_ID);
    const generationId = asset(project, MASTER_CHARACTER_ID).generations[0]!.id;
    await studio.projects.approve(project.id, MASTER_CHARACTER_ID, generationId);
    // Approving twice is a no-op; rejecting then re-approving is not allowed.
    await studio.projects.reject(project.id, MASTER_CHARACTER_ID, generationId);
    await expect(
      studio.projects.approve(project.id, MASTER_CHARACTER_ID, generationId),
    ).rejects.toThrow(/revisión/i);
  });
});

describe('Locking and regeneration (PRD §23, §47)', () => {
  it('refuses to regenerate a locked asset without an explicit unlock', async () => {
    const { project: created } = await studio.projects.create(BASE_CONFIG);
    let project = await studio.generation.startAndWait(created.id, MASTER_CHARACTER_ID);
    const generationId = asset(project, MASTER_CHARACTER_ID).generations[0]!.id;
    project = await studio.projects.approve(project.id, MASTER_CHARACTER_ID, generationId);

    await expect(studio.generation.start(project.id, MASTER_CHARACTER_ID)).rejects.toThrow(
      /bloqueado/i,
    );

    const after = await studio.generation.startAndWait(project.id, MASTER_CHARACTER_ID, {
      unlock: true,
    });
    expect(asset(after, MASTER_CHARACTER_ID).generations).toHaveLength(2);
  });

  it('marks dependent material stale when an approved asset is replaced', async () => {
    const { project: created } = await studio.projects.create(BASE_CONFIG);
    let project = created;

    for (const id of [MASTER_CHARACTER_ID, MASTER_ENVIRONMENT_ID, MASTER_SCENE_ID]) {
      project = await studio.generation.startAndWait(project.id, id);
      const generation = asset(project, id).generations.at(-1)!;
      project = await studio.projects.approve(project.id, id, generation.id);
    }

    expect(asset(project, MASTER_SCENE_ID).stale).toBe(false);

    // Replace the character; the scene was built on the old one.
    project = await studio.generation.startAndWait(project.id, MASTER_CHARACTER_ID, {
      unlock: true,
    });
    const replacement = asset(project, MASTER_CHARACTER_ID).generations.at(-1)!;
    project = await studio.projects.approve(project.id, MASTER_CHARACTER_ID, replacement.id);

    const scene = asset(project, MASTER_SCENE_ID);
    expect(scene.stale).toBe(true);
    expect(scene.staleReason).toMatch(/Personaje maestro/);
    // Stale material must not count as approved for anything downstream.
    expect(canGenerate(project, asset(project, `${project.plan.shots[0]!.id}_image`)).ok).toBe(
      false,
    );
  });

  it('regenerating one asset never touches another (PRD §47)', async () => {
    const { project: created } = await studio.projects.create(BASE_CONFIG);
    let project = created;
    for (const id of [MASTER_CHARACTER_ID, MASTER_ENVIRONMENT_ID]) {
      project = await studio.generation.startAndWait(project.id, id);
      const generation = asset(project, id).generations.at(-1)!;
      project = await studio.projects.approve(project.id, id, generation.id);
    }

    const environmentBefore = JSON.stringify(asset(project, MASTER_ENVIRONMENT_ID));
    project = await studio.generation.startAndWait(project.id, MASTER_CHARACTER_ID, {
      unlock: true,
    });
    expect(JSON.stringify(asset(project, MASTER_ENVIRONMENT_ID))).toBe(environmentBefore);
  });
});

describe('Production status', () => {
  it('always points at something the user can act on', async () => {
    const { project } = await studio.projects.create(BASE_CONFIG);
    const status = computeProductionStatus(project);
    expect(status.nextActionableAssetId).toBe(MASTER_CHARACTER_ID);
    expect(status.readyForEdit).toBe(false);
    expect(status.stages.find((s) => s.stage === 'images')?.state).toBe('active');
    expect(status.stages.find((s) => s.stage === 'videos')?.state).toBe('pending');
  });

  it('surfaces an asset waiting for a decision before anything else', async () => {
    const { project: created } = await studio.projects.create(BASE_CONFIG);
    const project = await studio.generation.startAndWait(created.id, MASTER_ENVIRONMENT_ID);
    expect(computeProductionStatus(project).nextActionableAssetId).toBe(MASTER_ENVIRONMENT_ID);
  });
});
