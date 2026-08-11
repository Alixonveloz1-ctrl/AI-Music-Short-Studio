'use strict';

/**
 * Progreso de producción: qué etapa está abierta, qué activo puede generarse
 * y cuánto lleva aprobado el proyecto.
 *
 * Este módulo sólo LEE el proyecto. Quien cambia estados es dominio.js. Aquí
 * vive la mitad "consulta" de la regla del producto: nada cuenta como
 * terminado si el usuario no lo ha aprobado.
 */

// Las constantes viven en un archivo hermano y se cargan de forma perezosa.
// En CommonJS un require en la cabecera se resuelve en el momento de cargar el
// archivo, así que un ciclo entre módulos hermanos devolvería un objeto a
// medio construir. Cargar dentro de la función que lo usa evita ese problema y
// permite que este archivo se pueda cargar por sí solo.
let _constantes = null;
function constantes() {
  if (!_constantes) _constantes = require('./constantes.js');
  return _constantes;
}

/** Etapas que contienen activos generados, en orden de producción. */
const ASSET_STAGES = ['images', 'videos', 'music'];

/**
 * Un activo cuenta como aprobado en cuanto tiene una generación oficial
 * aprobada (PRD §22, §38). Eso sigue siendo cierto mientras el usuario está
 * regenerando un reemplazo, así que reabrir un activo nunca hace que el resto
 * de la producción parezca bloqueada.
 */
function hasApprovedVersion(asset) {
  return asset.approvedGenerationId !== null;
}

function assetsForStage(project, stage) {
  return project.assets.filter((a) => a.stage === stage).sort((a, b) => a.order - b.order);
}

function isStageComplete(project, stage) {
  const assets = assetsForStage(project, stage);
  if (assets.length === 0) return true;
  return assets.every((a) => hasApprovedVersion(a) && !a.stale);
}

/**
 * La etapa en la que está trabajando el estudio ahora mismo. Las etapas
 * avanzan en orden estricto (PRD §5): los vídeos sólo se abren cuando todas
 * las imágenes están aprobadas, la música cuando lo están todos los clips, etc.
 */
function computeCurrentStage(project) {
  for (const stage of ASSET_STAGES) {
    if (!isStageComplete(project, stage)) return stage;
  }
  if (project.finalCut.status === 'approved' || project.finalCut.status === 'exported') {
    return 'delivery';
  }
  return 'edit';
}

function stageIsOpen(project, stage) {
  const idx = ASSET_STAGES.indexOf(stage);
  if (idx === -1) return false;
  for (let i = 0; i < idx; i += 1) {
    const previous = ASSET_STAGES[i];
    if (previous && !isStageComplete(project, previous)) return false;
  }
  return true;
}

/**
 * Un activo se puede generar cuando su etapa está abierta y todos los activos
 * a los que hace referencia están aprobados (PRD §4, §17, §32).
 */
function blockingDependencies(project, asset) {
  const byId = new Map(project.assets.map((a) => [a.id, a]));
  const blocking = [];
  for (const depId of asset.dependsOn) {
    const dep = byId.get(depId);
    if (!dep) continue;
    if (!hasApprovedVersion(dep) || dep.stale) blocking.push(dep);
  }
  return blocking;
}

/** Devuelve { ok: true } o { ok: false, reason }. */
function canGenerate(project, asset) {
  const { STAGE_LABELS } = constantes();
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

/**
 * Estado de producción completo: { stages, rows, nextActionableAssetId,
 * readyForEdit, missingForEdit }.
 */
function computeProductionStatus(project) {
  const { STAGES, STAGE_LABELS } = constantes();
  const stages = STAGES.map((stage) => {
    const assets = assetsForStage(project, stage);
    const approved = assets.filter((a) => hasApprovedVersion(a) && !a.stale).length;
    let state;
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

  let nextActionableAssetId = null;
  const ordered = project.assets.slice().sort((a, b) => a.order - b.order);
  // Lo que ya está esperando una decisión del usuario va primero (PRD §45).
  const inReview = ordered.find((a) => a.status === 'review');
  if (inReview) {
    nextActionableAssetId = inReview.id;
  } else {
    const generatable = ordered.find(
      (a) => (!hasApprovedVersion(a) || a.stale) && canGenerate(project, a).ok,
    );
    nextActionableAssetId = generatable ? generatable.id : null;
  }

  return {
    stages,
    rows,
    nextActionableAssetId,
    readyForEdit: ASSET_STAGES.every((s) => isStageComplete(project, s)),
    // Los NOMBRES de lo que falta para poder montar, no solo un sí/no. El
    // servidor ya lo sabe calcular y lo redacta bien cuando rechaza un
    // montaje; sin mandarlo aquí, el panel tenía que volver a deducirlo por su
    // cuenta y las dos versiones podían no decir lo mismo.
    missingForEdit: project.assets
      .filter((a) => ASSET_STAGES.indexOf(a.stage) !== -1)
      .filter((a) => !hasApprovedVersion(a) || a.stale)
      .map((a) => a.label),
  };
}

/** Ficha compacta del proyecto para la pantalla de listado. */
function summarizeProject(project) {
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

function formatTimecode(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60)
    .toString()
    .padStart(2, '0');
  const ss = (total % 60).toString().padStart(2, '0');
  return `${mm}:${ss}`;
}

module.exports = {
  ASSET_STAGES,
  hasApprovedVersion,
  assetsForStage,
  isStageComplete,
  computeCurrentStage,
  stageIsOpen,
  blockingDependencies,
  canGenerate,
  computeProductionStatus,
  summarizeProject,
  formatTimecode,
};
