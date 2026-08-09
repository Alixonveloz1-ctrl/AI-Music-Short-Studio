import { STAGES, STAGE_LABELS, type Stage } from './constants.js';
import type { Asset, Project, ProductionStatus, ProjectSummary, StageProgress } from './types.js';

/** Stages that hold generated assets, in production order. */
export const ASSET_STAGES: Stage[] = ['images', 'videos', 'music', 'ambient'];

/**
 * An asset counts as approved once it has an official, approved generation
 * (PRD §22, §38). That stays true while the user is regenerating a replacement,
 * so re-opening one asset never makes the rest of the production look blocked.
 */
export function hasApprovedVersion(asset: Asset): boolean {
  return asset.approvedGenerationId !== null;
}

export function assetsForStage(project: Project, stage: Stage): Asset[] {
  return project.assets.filter((a) => a.stage === stage).sort((a, b) => a.order - b.order);
}

export function isStageComplete(project: Project, stage: Stage): boolean {
  const assets = assetsForStage(project, stage);
  if (assets.length === 0) return true;
  return assets.every((a) => hasApprovedVersion(a) && !a.stale);
}

/**
 * The stage the studio is currently working in. Stages advance strictly in
 * order (PRD §5): videos only open once every image is approved, music once
 * every clip is approved, and so on.
 */
export function computeCurrentStage(project: Project): Stage {
  for (const stage of ASSET_STAGES) {
    if (!isStageComplete(project, stage)) return stage;
  }
  if (project.finalCut.status === 'approved' || project.finalCut.status === 'exported') {
    return 'delivery';
  }
  return 'edit';
}

export function stageIsOpen(project: Project, stage: Stage): boolean {
  const idx = ASSET_STAGES.indexOf(stage);
  if (idx === -1) return false;
  for (let i = 0; i < idx; i += 1) {
    const previous = ASSET_STAGES[i];
    if (previous && !isStageComplete(project, previous)) return false;
  }
  return true;
}

/**
 * An asset can be generated when its stage is open and every asset it
 * references has been approved (PRD §4, §17, §32).
 */
export function blockingDependencies(project: Project, asset: Asset): Asset[] {
  const byId = new Map(project.assets.map((a) => [a.id, a] as const));
  const blocking: Asset[] = [];
  for (const depId of asset.dependsOn) {
    const dep = byId.get(depId);
    if (!dep) continue;
    if (!hasApprovedVersion(dep) || dep.stale) blocking.push(dep);
  }
  return blocking;
}

export function canGenerate(
  project: Project,
  asset: Asset,
): { ok: true } | { ok: false; reason: string } {
  if (!stageIsOpen(project, asset.stage)) {
    return {
      ok: false,
      reason: `La etapa "${STAGE_LABELS[asset.stage]}" todavía no está abierta: falta aprobar la etapa anterior.`,
    };
  }
  const blocking = blockingDependencies(project, asset);
  if (blocking.length > 0) {
    return {
      ok: false,
      reason: `Faltan activos aprobados: ${blocking.map((b) => b.label).join(', ')}.`,
    };
  }
  if (asset.status === 'generating') {
    return { ok: false, reason: 'Ya hay una generación en curso para este activo.' };
  }
  if (asset.locked) {
    return {
      ok: false,
      reason: 'El activo está aprobado y bloqueado. Desbloquéalo para regenerarlo.',
    };
  }
  return { ok: true };
}

export function computeProductionStatus(project: Project): ProductionStatus {
  const stages: StageProgress[] = STAGES.map((stage) => {
    const assets = assetsForStage(project, stage);
    const approved = assets.filter((a) => hasApprovedVersion(a) && !a.stale).length;
    let state: StageProgress['state'];
    if (stage === 'concept') {
      state = 'complete';
    } else if (stage === 'edit') {
      state =
        project.finalCut.status === 'approved' || project.finalCut.status === 'exported'
          ? 'complete'
          : ASSET_STAGES.every((s) => isStageComplete(project, s))
            ? 'active'
            : 'pending';
    } else if (stage === 'delivery') {
      state = project.finalCut.status === 'exported' ? 'complete' : 'pending';
    } else if (isStageComplete(project, stage)) {
      state = 'complete';
    } else if (stageIsOpen(project, stage)) {
      state = 'active';
    } else {
      state = 'pending';
    }
    return {
      stage,
      label: STAGE_LABELS[stage],
      state,
      approved,
      total: assets.length,
    };
  });

  const rows = project.assets
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((a) => ({
      assetId: a.id,
      label: a.label,
      status: a.status,
      stale: a.stale,
      stage: a.stage,
    }));

  let nextActionableAssetId: string | null = null;
  const ordered = project.assets.slice().sort((a, b) => a.order - b.order);
  // Anything already waiting for a decision comes first (PRD §45).
  const inReview = ordered.find((a) => a.status === 'review');
  if (inReview) {
    nextActionableAssetId = inReview.id;
  } else {
    const generatable = ordered.find(
      (a) => (!hasApprovedVersion(a) || a.stale) && canGenerate(project, a).ok,
    );
    nextActionableAssetId = generatable?.id ?? null;
  }

  return {
    stages,
    rows,
    nextActionableAssetId,
    readyForEdit: ASSET_STAGES.every((s) => isStageComplete(project, s)),
  };
}

export function summarizeProject(project: Project): ProjectSummary {
  const approvedAssets = project.assets.filter((a) => hasApprovedVersion(a) && !a.stale).length;
  return {
    id: project.id,
    title: project.delivery.title || project.plan.concept.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    durationSec: project.config.durationSec,
    currentStage: project.currentStage,
    approvedAssets,
    totalAssets: project.assets.length,
    finalCutStatus: project.finalCut.status,
  };
}

export function formatTimecode(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}
