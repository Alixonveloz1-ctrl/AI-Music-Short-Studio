/**
 * The approval state machine.
 *
 * This module is the enforcement point for the product's founding rule
 * (PRD §4, §46): a generation that finished successfully is *not* approved.
 * It lands in REVIEW and stays there until the user says otherwise. Nothing
 * downstream can consume it until then.
 */
import {
  computeCurrentStage,
  hasApprovedVersion,
  type Asset,
  type FileRef,
  type Generation,
  type Project,
  type ProviderInfo,
} from '@ams/shared';
import { generationId } from './ids.js';
import { makeEvent } from './project.js';

export class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function getAsset(project: Project, assetId: string): Asset {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new DomainError(`Activo desconocido: ${assetId}`, 404);
  return asset;
}

export function getGeneration(asset: Asset, genId: string): Generation {
  const generation = asset.generations.find((g) => g.id === genId);
  if (!generation) throw new DomainError(`Generación desconocida: ${genId}`, 404);
  return generation;
}

export function approvedGenerationOf(asset: Asset): Generation | null {
  if (!asset.approvedGenerationId) return null;
  return asset.generations.find((g) => g.id === asset.approvedGenerationId) ?? null;
}

export function approvedFileOf(asset: Asset): FileRef | null {
  return approvedGenerationOf(asset)?.file ?? null;
}

/** Direct dependents of an asset. */
export function dependentsOf(project: Project, assetId: string): Asset[] {
  return project.assets.filter((a) => a.dependsOn.includes(assetId));
}

/** Every asset that (transitively) builds on this one. */
export function transitiveDependents(project: Project, assetId: string): Asset[] {
  const out = new Map<string, Asset>();
  const queue = [assetId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const dependent of dependentsOf(project, current)) {
      if (out.has(dependent.id)) continue;
      out.set(dependent.id, dependent);
      queue.push(dependent.id);
    }
  }
  return Array.from(out.values());
}

export function startGeneration(
  project: Project,
  asset: Asset,
  args: {
    prompt: string;
    negativePrompt?: string;
    referenceAssetIds: string[];
    provider: ProviderInfo;
    seed: number;
  },
): Generation {
  const generation: Generation = {
    id: generationId(),
    assetId: asset.id,
    index: asset.generations.length + 1,
    status: 'generating',
    createdAt: new Date().toISOString(),
    prompt: args.prompt,
    negativePrompt: args.negativePrompt,
    referenceAssetIds: args.referenceAssetIds,
    provider: args.provider,
    seed: args.seed,
  };
  asset.generations.push(generation);
  asset.status = 'generating';
  asset.locked = false;
  project.events.push(
    makeEvent('generation_started', `${asset.label}: generación #${generation.index} en curso`, {
      assetId: asset.id,
      generationId: generation.id,
      stage: asset.stage,
    }),
  );
  touch(project);
  return generation;
}

/**
 * A finished generation goes to REVIEW — never straight to approved. This is
 * the single most important transition in the product (PRD §46).
 */
export function completeGeneration(
  project: Project,
  asset: Asset,
  generation: Generation,
  file: FileRef,
  elapsedMs: number,
): void {
  generation.status = 'review';
  generation.file = file;
  generation.completedAt = new Date().toISOString();
  generation.elapsedMs = elapsedMs;
  asset.status = 'review';
  project.events.push(
    makeEvent(
      'generation_ready',
      `${asset.label}: generación #${generation.index} lista para revisión`,
      { assetId: asset.id, generationId: generation.id, stage: asset.stage },
    ),
  );
  touch(project);
}

export function failGeneration(
  project: Project,
  asset: Asset,
  generation: Generation,
  error: string,
): void {
  generation.status = 'failed';
  generation.error = error;
  generation.completedAt = new Date().toISOString();
  asset.status = restingStatus(asset);
  asset.locked = hasApprovedVersion(asset);
  project.events.push(
    makeEvent('generation_failed', `${asset.label}: la generación #${generation.index} falló — ${error}`, {
      assetId: asset.id,
      generationId: generation.id,
      stage: asset.stage,
    }),
  );
  touch(project);
}

export function approveGeneration(project: Project, assetId: string, genId: string): Asset {
  const asset = getAsset(project, assetId);
  const generation = getGeneration(asset, genId);
  if (generation.status === 'approved') return asset;
  if (generation.status !== 'review') {
    throw new DomainError(
      `Solo se puede aprobar una generación en revisión (estado actual: ${generation.status}).`,
    );
  }
  if (!generation.file) {
    throw new DomainError('La generación no tiene archivo asociado.');
  }

  const previousApprovedId = asset.approvedGenerationId;
  // Only one official version exists at a time (PRD §38).
  for (const other of asset.generations) {
    if (other.id !== generation.id && other.status === 'approved') {
      other.status = 'rejected';
    }
  }
  generation.status = 'approved';
  asset.approvedGenerationId = generation.id;
  asset.status = 'approved';
  asset.locked = true;
  asset.stale = false;
  delete asset.staleReason;

  project.events.push(
    makeEvent('generation_approved', `${asset.label}: generación #${generation.index} APROBADA y bloqueada`, {
      assetId: asset.id,
      generationId: generation.id,
      stage: asset.stage,
    }),
  );

  // Replacing an already-approved version invalidates whatever was built on it.
  if (previousApprovedId && previousApprovedId !== generation.id) {
    markDependentsStale(project, asset, `Se aprobó una versión nueva de "${asset.label}".`);
    invalidateFinalCut(project, `Se aprobó una versión nueva de "${asset.label}".`);
  } else {
    invalidateFinalCutIfBuilt(project, asset);
  }

  project.currentStage = computeCurrentStage(project);
  touch(project);
  return asset;
}

export function rejectGeneration(project: Project, assetId: string, genId: string): Asset {
  const asset = getAsset(project, assetId);
  const generation = getGeneration(asset, genId);
  if (generation.status === 'rejected') return asset;
  if (generation.status !== 'review' && generation.status !== 'approved') {
    throw new DomainError(
      `Solo se puede descartar una generación en revisión o aprobada (estado actual: ${generation.status}).`,
    );
  }

  const wasApproved = asset.approvedGenerationId === generation.id;
  generation.status = 'rejected';
  if (wasApproved) {
    asset.approvedGenerationId = null;
    markDependentsStale(project, asset, `Se descartó la versión aprobada de "${asset.label}".`);
    invalidateFinalCut(project, `Se descartó la versión aprobada de "${asset.label}".`);
  }
  asset.status = restingStatus(asset);
  asset.locked = hasApprovedVersion(asset);

  project.events.push(
    makeEvent('generation_rejected', `${asset.label}: generación #${generation.index} descartada`, {
      assetId: asset.id,
      generationId: generation.id,
      stage: asset.stage,
    }),
  );
  project.currentStage = computeCurrentStage(project);
  touch(project);
  return asset;
}

/**
 * Approved assets are LOCKED (PRD §23). Regenerating one is allowed, but it
 * has to be a deliberate act, so the lock has to be lifted first.
 */
export function unlockAsset(project: Project, assetId: string): Asset {
  const asset = getAsset(project, assetId);
  if (!asset.locked) return asset;
  asset.locked = false;
  project.events.push(
    makeEvent('asset_unlocked', `${asset.label}: desbloqueado para regenerar`, {
      assetId: asset.id,
      stage: asset.stage,
    }),
  );
  touch(project);
  return asset;
}

export function markDependentsStale(project: Project, asset: Asset, reason: string): void {
  for (const dependent of transitiveDependents(project, asset.id)) {
    if (!hasApprovedVersion(dependent) && dependent.generations.length === 0) continue;
    if (dependent.stale) continue;
    dependent.stale = true;
    dependent.staleReason = reason;
    project.events.push(
      makeEvent('asset_stale', `${dependent.label}: marcado como desactualizado — ${reason}`, {
        assetId: dependent.id,
        stage: dependent.stage,
      }),
    );
  }
}

export function invalidateFinalCut(project: Project, reason: string): void {
  if (project.finalCut.status === 'pending') return;
  project.finalCut = {
    status: 'pending',
    error: undefined,
    builtFrom: undefined,
    edl: project.finalCut.edl,
    preview: project.finalCut.preview,
    export: project.finalCut.export,
  };
  project.events.push(makeEvent('cut_failed', `El montaje debe rehacerse: ${reason}`));
}

function invalidateFinalCutIfBuilt(project: Project, asset: Asset): void {
  const builtFrom = project.finalCut.builtFrom;
  if (!builtFrom) return;
  const usedGeneration = builtFrom[asset.id];
  if (usedGeneration && usedGeneration !== asset.approvedGenerationId) {
    invalidateFinalCut(project, `"${asset.label}" cambió después de montar.`);
  }
}

function restingStatus(asset: Asset): Asset['status'] {
  return hasApprovedVersion(asset) ? 'approved' : 'pending';
}

export function touch(project: Project): void {
  project.updatedAt = new Date().toISOString();
}
