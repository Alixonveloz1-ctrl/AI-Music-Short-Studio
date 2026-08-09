/**
 * Runs one generation for one asset, end to end.
 *
 * The shape of this service is dictated by PRD §4 and §46: it produces a
 * generation and leaves it in REVIEW. It has no code path that approves
 * anything — approval only ever happens through an explicit user action.
 *
 * Long provider calls (Veo can take minutes) happen *outside* the project
 * lock, so reviewing one asset is never blocked by another asset rendering.
 */
import path from 'node:path';
import {
  FORMATIONS_BY_ID,
  OUTPUT_FPS,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  SCENARIOS_BY_ID,
  canGenerate,
  computeCurrentStage,
  hasApprovedVersion,
  type Asset,
  type FileRef,
  type Generation,
  type Project,
} from '@ams/shared';
import type { AppConfig } from '../config.js';
import { ProjectRepository } from '../storage/repository.js';
import { assetRelativeDir, assetUrl, generationRelativePath } from '../storage/paths.js';
import {
  DomainError,
  approvedGenerationOf,
  completeGeneration,
  failGeneration,
  getAsset,
  startGeneration,
  unlockAsset,
} from '../domain/stateMachine.js';
import type { ProviderBundle, ReferenceFile } from '../providers/types.js';
import type { ProjectEventBus } from './events.js';

export interface GenerateResult {
  generation: Generation;
  project: Project;
}

const REFERENCE_ROLES: Record<string, string> = {
  master_character: 'personaje',
  master_environment: 'escenario',
  master_scene: 'escena',
};

export class GenerationService {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly providers: ProviderBundle,
    private readonly config: AppConfig,
    private readonly bus: ProjectEventBus,
  ) {}

  /**
   * Queue a generation. Returns as soon as the record exists so the UI can show
   * "GENERANDO" immediately; the file lands later and is pushed over SSE.
   */
  async start(
    projectId: string,
    assetId: string,
    options: { unlock?: boolean; promptOverride?: string } = {},
  ): Promise<GenerateResult> {
    const prepared = await this.repo.withLock(projectId, async () => {
      const project = await this.repo.load(projectId);
      const asset = getAsset(project, assetId);

      if (asset.locked && options.unlock) {
        unlockAsset(project, assetId);
      }

      const check = canGenerate(project, asset);
      if (!check.ok) throw new DomainError(check.reason, 409);

      const references = this.resolveReferences(project, asset);
      const prompt = options.promptOverride?.trim() || asset.spec.prompt;
      const provider = this.providerFor(asset).info;
      const seed = deriveSeed(project.id, asset.id, asset.generations.length + 1);

      const generation = startGeneration(project, asset, {
        prompt,
        negativePrompt: asset.spec.negativePrompt,
        referenceAssetIds: references.map((r) => r.assetId),
        provider,
        seed,
      });

      await this.repo.save(project);
      this.publish(project);
      return { project, asset, generation, references };
    });

    // The provider runs unlocked; the result is folded back in afterwards.
    void this.run(projectId, prepared.asset.id, prepared.generation.id, prepared.references);

    return { generation: prepared.generation, project: prepared.project };
  }

  /** Start a generation and wait for it to finish. Used by tests and scripts. */
  async startAndWait(
    projectId: string,
    assetId: string,
    options: { unlock?: boolean; promptOverride?: string } = {},
  ): Promise<Project> {
    const { generation } = await this.start(projectId, assetId, options);
    const inFlight = this.inFlight.get(generation.id);
    if (inFlight) await inFlight;
    return this.repo.load(projectId);
  }

  private readonly inFlight = new Map<string, Promise<void>>();

  private async run(
    projectId: string,
    assetId: string,
    generationId: string,
    references: ReferenceFile[],
  ): Promise<void> {
    const task = this.execute(projectId, assetId, generationId, references).finally(() => {
      this.inFlight.delete(generationId);
    });
    this.inFlight.set(generationId, task);
    await task;
  }

  private async execute(
    projectId: string,
    assetId: string,
    generationId: string,
    references: ReferenceFile[],
  ): Promise<void> {
    const startedAt = Date.now();
    let outcome:
      | { ok: true; file: FileRef }
      | { ok: false; error: string };

    try {
      const project = await this.repo.load(projectId);
      const asset = getAsset(project, assetId);
      const generation = asset.generations.find((g) => g.id === generationId);
      if (!generation) throw new DomainError('La generación desapareció del proyecto.', 404);

      const provider = this.providerFor(asset);
      const relativePath = generationRelativePath(asset, generation.index, provider.extension);
      await this.repo.ensureDir(projectId, assetRelativeDir(asset));
      const outputPath = this.repo.absolutePath(projectId, relativePath);

      const result = await this.dispatch(project, asset, generation, references, outputPath);
      outcome = {
        ok: true,
        file: {
          path: relativePath,
          url: assetUrl(projectId, relativePath),
          mimeType: result.mimeType,
          bytes: result.bytes,
          durationSec: result.durationSec,
          width: result.width,
          height: result.height,
        },
      };
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    await this.repo.withLock(projectId, async () => {
      const project = await this.repo.load(projectId);
      const asset = project.assets.find((a) => a.id === assetId);
      const generation = asset?.generations.find((g) => g.id === generationId);
      if (!asset || !generation) return;
      if (outcome.ok) {
        completeGeneration(project, asset, generation, outcome.file, Date.now() - startedAt);
      } else {
        failGeneration(project, asset, generation, outcome.error);
      }
      project.currentStage = computeCurrentStage(project);
      await this.repo.save(project);
      this.publish(project);
    });
  }

  private async dispatch(
    project: Project,
    asset: Asset,
    generation: Generation,
    references: ReferenceFile[],
    outputPath: string,
  ) {
    const scenario = SCENARIOS_BY_ID.get(project.config.scenarioId);
    const formation = FORMATIONS_BY_ID.get(project.config.formationId);

    switch (asset.kind) {
      case 'master_character':
      case 'master_environment':
      case 'master_scene':
      case 'shot_image': {
        const shot = asset.shotId ? project.plan.shots.find((s) => s.id === asset.shotId) : undefined;
        return this.providers.image.generate({
          prompt: generation.prompt,
          negativePrompt: generation.negativePrompt,
          seed: generation.seed,
          references,
          outputPath,
          width: OUTPUT_WIDTH,
          height: OUTPUT_HEIGHT,
          shotType: shot?.shotType ?? (asset.kind === 'master_character' ? 'medium' : 'wide'),
          performerCount:
            asset.kind === 'master_environment' ? 0 : (formation?.performerCount ?? 1),
          timeOfDay: project.plan.visualBible.lighting.timeOfDay,
          outdoor: scenario?.outdoor ?? true,
          captions: [
            asset.label,
            shot ? `${shot.purpose}` : asset.spec.objective,
            project.plan.concept.title,
          ],
          badge: `GEN ${generation.index}`,
        });
      }
      case 'clip': {
        const shot = project.plan.shots.find((s) => s.id === asset.shotId);
        if (!shot) throw new DomainError(`La toma ${asset.shotId} no existe en el plan.`, 500);
        const sourceReference = references[0];
        return this.providers.video.generate({
          prompt: generation.prompt,
          negativePrompt: generation.negativePrompt,
          seed: generation.seed,
          references,
          outputPath,
          durationSec: asset.spec.durationSec ?? 6,
          cameraMove: shot.cameraMove,
          width: OUTPUT_WIDTH,
          height: OUTPUT_HEIGHT,
          fps: OUTPUT_FPS,
          sourceImagePath: sourceReference?.path,
        });
      }
      case 'music':
        return this.providers.music.generate({
          prompt: generation.prompt,
          negativePrompt: generation.negativePrompt,
          seed: generation.seed,
          references,
          outputPath,
          brief: project.plan.music,
          instrumentIds: project.config.instrumentIds,
          acoustics: scenario?.acoustics ?? 'natural',
        });
      case 'ambient':
        return this.providers.ambient.generate({
          prompt: generation.prompt,
          negativePrompt: generation.negativePrompt,
          seed: generation.seed,
          references,
          outputPath,
          brief: project.plan.ambient,
        });
      default:
        throw new DomainError(`Tipo de activo no soportado: ${asset.kind}`, 500);
    }
  }

  private providerFor(asset: Asset) {
    switch (asset.kind) {
      case 'clip':
        return this.providers.video;
      case 'music':
        return this.providers.music;
      case 'ambient':
        return this.providers.ambient;
      default:
        return this.providers.image;
    }
  }

  /**
   * Approved references only (PRD §17, §22): a generation is always anchored on
   * material the user has already signed off. Shot stills additionally pick up
   * the most recently approved shot still so the film keeps drifting less as it
   * goes.
   */
  resolveReferences(project: Project, asset: Asset): ReferenceFile[] {
    const byId = new Map(project.assets.map((a) => [a.id, a] as const));
    const refs: ReferenceFile[] = [];
    const seen = new Set<string>();

    const push = (candidate: Asset | undefined, role: string) => {
      if (!candidate || seen.has(candidate.id)) return;
      const generation = approvedGenerationOf(candidate);
      if (!generation?.file) return;
      seen.add(candidate.id);
      refs.push({
        assetId: candidate.id,
        path: this.repo.absolutePath(project.id, generation.file.path),
        mimeType: generation.file.mimeType,
        role,
      });
    };

    for (const id of asset.spec.referenceAssetIds) {
      push(byId.get(id), REFERENCE_ROLES[id] ?? 'referencia');
    }

    if (asset.kind === 'shot_image') {
      const previous = project.assets
        .filter(
          (a) => a.kind === 'shot_image' && a.id !== asset.id && hasApprovedVersion(a) && !a.stale,
        )
        .sort((a, b) => a.order - b.order)
        .pop();
      push(previous, 'continuidad de la toma anterior');
    }

    return refs;
  }

  private publish(project: Project): void {
    this.bus.publishProject(project);
    const last = project.events[project.events.length - 1];
    if (last) this.bus.publishEvent(project.id, last);
  }
}

/** Stable per-attempt seed so a regeneration is genuinely a different take. */
export function deriveSeed(projectId: string, assetId: string, attempt: number): number {
  let hash = 2166136261 >>> 0;
  const value = `${projectId}:${assetId}:${attempt}`;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // Keep it inside the range image APIs accept.
  return hash % 2_147_483_647;
}

export function relativeFromAbsolute(repo: ProjectRepository, projectId: string, absolute: string): string {
  return path.relative(repo.projectDir(projectId), absolute).split(path.sep).join('/');
}
