'use strict';

/**
 * La máquina de estados de aprobación.
 *
 * Este módulo es el punto donde se hace cumplir la regla fundacional del
 * producto (PRD §4, §46): una generación que ha terminado bien NO está
 * aprobada. Aterriza en REVISIÓN y se queda ahí hasta que el usuario diga otra
 * cosa. Nada aguas abajo puede consumirla hasta entonces.
 *
 * Aquí viven también los identificadores y la construcción del proyecto, que
 * en el original estaban en domain/ids.ts y domain/project.ts.
 */

const { randomBytes } = require('node:crypto');
const { computeCurrentStage, hasApprovedVersion } = require('./progreso.js');

// Los módulos hermanos se cargan de forma perezosa. En CommonJS un require en
// la cabecera se resuelve al cargar el archivo, así que un ciclo entre módulos
// hermanos devolvería un objeto a medio construir; además así este archivo se
// puede cargar por sí solo aunque los prompts todavía no hagan falta.
let _constantes = null;
function constantes() {
  if (!_constantes) _constantes = require('./constantes.js');
  return _constantes;
}

// El director artístico (los constructores de prompts) se carga de forma
// perezosa: `arte.js` no necesita nada de aquí, pero cargarlo arriba del todo
// crearía un ciclo el día que lo necesite, y los ciclos de CommonJS no fallan
// — devuelven un objeto a medio construir, que es mucho peor de diagnosticar.
let _arte = null;
function equipo() {
  if (!_arte) _arte = require('./arte.js');
  return _arte;
}

// El catálogo, por el mismo motivo y con la misma forma.
let _catalogo = null;
function catalogo() {
  if (!_catalogo) _catalogo = require('./catalogo.js');
  return _catalogo;
}

// ---------------------------------------------------------------------------
// Errores de dominio
// ---------------------------------------------------------------------------

/**
 * Error con código HTTP asociado. El orden de los parámetros es (mensaje,
 * estado) y el estado por defecto es 400, igual que en el original: las rutas
 * leen `err.status` para decidir la respuesta.
 */
class DomainError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

// Sin la "l" ni la "1" ni el "0": estos identificadores se leen y se dictan en
// voz alta, y esos caracteres se confunden entre sí.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

function shortId(length = 10) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function projectId() {
  return `prj_${shortId(12)}`;
}

function generationId() {
  return `gen_${shortId(12)}`;
}

function eventId() {
  return `evt_${shortId(12)}`;
}

// ---------------------------------------------------------------------------
// Consultas sobre activos y generaciones
// ---------------------------------------------------------------------------

function getAsset(project, assetId) {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new DomainError(`Activo desconocido: ${assetId}`, 404);
  return asset;
}

function getGeneration(asset, genId) {
  const generation = asset.generations.find((g) => g.id === genId);
  if (!generation) throw new DomainError(`Generación desconocida: ${genId}`, 404);
  return generation;
}

function approvedGenerationOf(asset) {
  if (!asset.approvedGenerationId) return null;
  return asset.generations.find((g) => g.id === asset.approvedGenerationId) || null;
}

function approvedFileOf(asset) {
  const generation = approvedGenerationOf(asset);
  return generation && generation.file ? generation.file : null;
}

/** Dependientes directos de un activo. */
function dependentsOf(project, assetId) {
  return project.assets.filter((a) => a.dependsOn.includes(assetId));
}

/** Todos los activos que (transitivamente) se construyen sobre este. */
function transitiveDependents(project, assetId) {
  const out = new Map();
  const queue = [assetId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const dependent of dependentsOf(project, current)) {
      if (out.has(dependent.id)) continue;
      out.set(dependent.id, dependent);
      queue.push(dependent.id);
    }
  }
  return Array.from(out.values());
}

// ---------------------------------------------------------------------------
// Transiciones de generación
// ---------------------------------------------------------------------------

/**
 * args: { prompt, negativePrompt?, referenceAssetIds, provider, seed }
 * Devuelve la generación creada.
 */
function startGeneration(project, asset, args) {
  const generation = {
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
 * Una generación terminada pasa a REVISIÓN — nunca directamente a aprobada.
 * Esta es la transición más importante del producto (PRD §46).
 */
function completeGeneration(project, asset, generation, file, elapsedMs) {
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

function failGeneration(project, asset, generation, error) {
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

/**
 * Aprobar es SIEMPRE un acto explícito del usuario: sólo se llega aquí desde
 * la ruta de aprobación, nunca desde el final de una generación.
 */
function approveGeneration(project, assetId, genId) {
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
  // Sólo existe una versión oficial a la vez (PRD §38).
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

  // Sustituir una versión ya aprobada invalida todo lo que se construyó encima.
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

function rejectGeneration(project, assetId, genId) {
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
 * Los activos aprobados quedan BLOQUEADOS (PRD §23). Regenerar uno está
 * permitido, pero tiene que ser un acto deliberado, así que primero hay que
 * levantar el bloqueo.
 */
function unlockAsset(project, assetId) {
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

/** Marca como desactualizados los dependientes TRANSITIVOS, no sólo los directos. */
function markDependentsStale(project, asset, reason) {
  for (const dependent of transitiveDependents(project, asset.id)) {
    // Un dependiente que nunca se ha generado no está "desactualizado": todavía
    // no existe nada que pueda quedarse obsoleto.
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

function invalidateFinalCut(project, reason) {
  if (project.finalCut.status === 'pending') return;
  // Se conservan edl / preview / export para que el usuario siga viendo el
  // montaje anterior mientras rehace el nuevo; lo que se pierde es su validez.
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

function invalidateFinalCutIfBuilt(project, asset) {
  const builtFrom = project.finalCut.builtFrom;
  if (!builtFrom) return;
  const usedGeneration = builtFrom[asset.id];
  if (usedGeneration && usedGeneration !== asset.approvedGenerationId) {
    invalidateFinalCut(project, `"${asset.label}" cambió después de montar.`);
  }
}

function restingStatus(asset) {
  return hasApprovedVersion(asset) ? 'approved' : 'pending';
}

function touch(project) {
  project.updatedAt = new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Construcción del proyecto (original: domain/project.ts)
//
// Convierte un plan de producción terminado en la lista concreta de activos
// que el usuario revisará uno a uno (PRD §5, §20, §26, §29, §31).
//
// Todos los activos nacen PENDIENTE y sin generaciones: no existe nada hasta
// que el usuario lo pide, y nada avanza hasta que el usuario lo aprueba.
// ---------------------------------------------------------------------------

const MASTER_CHARACTER_ID = 'master_character';

// Cuántos retratos maestros individuales se piden como mucho. Más allá, aprobar
// uno a uno deja de tener sentido y manda la escena maestra.
const MAX_PERSONAJES_MAESTROS = 4;
const MASTER_ENVIRONMENT_ID = 'master_environment';
const MASTER_SCENE_ID = 'master_scene';
const MUSIC_ASSET_ID = 'music';
const AMBIENT_ASSET_ID = 'ambient';

// Rellena los campos de estado que NUNCA los define quien crea el activo:
// así es imposible construir un activo que nazca aprobado o bloqueado.
function asset(partial) {
  return Object.assign({}, partial, {
    status: 'pending',
    locked: false,
    approvedGenerationId: null,
    generations: [],
    stale: false,
  });
}

function buildAssets(config, plan) {
  const { ASSET_KIND_STAGE } = constantes();
  const {
    buildCharacterPrompt,
    buildEnvironmentPrompt,
    buildScenePrompt,
    buildShotImagePrompt,
    buildClipPrompt,
    NEGATIVE_VIDEO_EXTRA,
  } = equipo();

  const bible = plan.visualBible;
  const assets = [];
  // El orden salta de 10 en 10 para poder intercalar activos más adelante sin
  // renumerar todo.
  let order = 0;
  const next = () => (order += 10);

  // ─── Un retrato maestro POR INTÉRPRETE ───
  //
  // Con los dos músicos en la misma imagen no se puede usar ninguno como
  // referencia limpia: al generar una toma, el modelo recibe una imagen con dos
  // personas y acaba mezclando caras, ropas e instrumentos. Separados, cada
  // toma pide exactamente la identidad que necesita.
  //
  // Se topa en CUATRO. Para una orquesta de veinticuatro no tiene sentido
  // aprobar veinticuatro retratos uno a uno: a partir de ahí el grupo se trata
  // como conjunto y quien manda es la escena maestra.
  const formacion = catalogo().FORMATIONS_BY_ID.get(config.formationId);
  const cuantosToca = Math.max(1, Number(formacion && formacion.performerCount) || 1);
  const cuantos = Math.min(cuantosToca, MAX_PERSONAJES_MAESTROS);

  const nombresInstrumentos = (config.instrumentIds || [])
    .map((id) => catalogo().INSTRUMENTS_BY_ID.get(id))
    .filter(Boolean)
    .map((i) => i.name);

  const idsPersonajes = [];
  for (let n = 1; n <= cuantos; n += 1) {
    // A cada intérprete le toca un instrumento de los elegidos. Si hay menos
    // instrumentos que músicos —un dúo de violines— se reparten en ciclo.
    const suyo = nombresInstrumentos.length
      ? nombresInstrumentos[(n - 1) % nombresInstrumentos.length]
      : '';
    const id = n === 1 ? MASTER_CHARACTER_ID : `${MASTER_CHARACTER_ID}_${n}`;
    idsPersonajes.push(id);
    assets.push(
      asset({
        id,
        kind: 'master_character',
        stage: ASSET_KIND_STAGE.master_character,
        label: cuantos > 1
          ? `Intérprete ${n}${suyo ? ' — ' + suyo : ''}`
          : 'Personaje maestro',
        order: next(),
        spec: {
          objective: cuantos > 1
            ? `Definir el aspecto oficial del intérprete ${n} de ${cuantos} para todo el corto.`
            : 'Definir el aspecto oficial del intérprete para todo el corto.',
          prompt: buildCharacterPrompt(bible, config, n, cuantos, suyo),
          negativePrompt: bible.negativePrompt,
          // Cada intérprete ve a los anteriores para no repetir su cara: el
          // requisito de ser distinto solo se puede cumplir si sabe de quién.
          referenceAssetIds: idsPersonajes.slice(0, -1),
          continuityNotes: bible.continuityRules.slice(0, 4),
        },
        dependsOn: idsPersonajes.slice(0, -1),
      }),
    );
  }

  assets.push(
    asset({
      id: MASTER_ENVIRONMENT_ID,
      kind: 'master_environment',
      stage: ASSET_KIND_STAGE.master_environment,
      label: 'Escenario maestro',
      order: next(),
      spec: {
        objective: 'Definir el aspecto oficial del escenario para todo el corto.',
        prompt: buildEnvironmentPrompt(bible, config),
        negativePrompt: bible.negativePrompt,
        referenceAssetIds: [],
        continuityNotes: [
          `Elementos que deben repetirse: ${bible.environment.primaryElements.join(', ')}`,
        ],
      },
      dependsOn: [],
    }),
  );

  assets.push(
    asset({
      id: MASTER_SCENE_ID,
      kind: 'master_scene',
      stage: ASSET_KIND_STAGE.master_scene,
      label: 'Escena maestra',
      order: next(),
      spec: {
        objective: 'Fijar la relación entre el intérprete, el instrumento y el escenario.',
        prompt: buildScenePrompt(bible, config),
        negativePrompt: bible.negativePrompt,
        referenceAssetIds: idsPersonajes.concat([MASTER_ENVIRONMENT_ID]),
        continuityNotes: bible.continuityRules,
      },
      dependsOn: idsPersonajes.concat([MASTER_ENVIRONMENT_ID]),
    }),
  );

  // Primero TODAS las imágenes de toma y después TODOS los clips: el orden de
  // esta lista es el orden en que el usuario revisa, y así no salta entre etapas.
  for (const shot of plan.shots) {
    const imageId = `${shot.id}_image`;
    assets.push(
      asset({
        id: imageId,
        kind: 'shot_image',
        stage: ASSET_KIND_STAGE.shot_image,
        label: `${shot.label} — imagen`,
        order: next(),
        shotId: shot.id,
        spec: {
          objective: shot.purpose,
          prompt: buildShotImagePrompt(bible, shot, config),
          negativePrompt: bible.negativePrompt,
          // La escena maestra va PRIMERA: ya contiene a todos los
          // intérpretes en su sitio, así que es la referencia que más
          // información da por imagen. Detrás, el escenario y los retratos.
          //
          // Y de los retratos van SÓLO los de quien sale en esta toma. Mandarle
          // los cuatro para un primer plano de uno es enseñarle cuatro caras y
          // pedirle que dibuje una: unas veces mezcla rasgos y otras mete a
          // alguien de más en el encuadre.
          referenceAssetIds: [MASTER_SCENE_ID, MASTER_ENVIRONMENT_ID].concat(
            typeof shot.subject === 'number' && idsPersonajes[shot.subject - 1]
              ? [idsPersonajes[shot.subject - 1]]
              : idsPersonajes,
          ),
          continuityNotes: bible.continuityRules,
        },
        dependsOn: [MASTER_SCENE_ID],
      }),
    );
  }

  for (const shot of plan.shots) {
    shot.clips.forEach((clip) => {
      assets.push(
        asset({
          id: clip.id,
          kind: 'clip',
          stage: ASSET_KIND_STAGE.clip,
          label: `${shot.label} — ${clip.label}`,
          order: next(),
          shotId: shot.id,
          clipId: clip.id,
          spec: {
            objective: `${shot.purpose} (${clip.motionNote})`,
            prompt: buildClipPrompt(bible, shot, clip, shot.clips.length),
            negativePrompt: `${bible.negativePrompt}, ${NEGATIVE_VIDEO_EXTRA}`,
            referenceAssetIds: [`${shot.id}_image`],
            continuityNotes: [
              'El primer fotograma debe coincidir con la imagen aprobada de la toma',
              ...bible.continuityRules.slice(0, 4),
            ],
            durationSec: clip.durationSec,
          },
          dependsOn: [`${shot.id}_image`],
        }),
      );
    });
  }

  assets.push(
    asset({
      id: MUSIC_ASSET_ID,
      kind: 'music',
      stage: ASSET_KIND_STAGE.music,
      label: `Música — ${plan.music.title}`,
      order: next(),
      spec: {
        objective: 'Componer la pieza instrumental completa del corto.',
        prompt: plan.music.prompt,
        // Lyria sólo entiende inglés. El usuario ve el de arriba, en español;
        // a Google se le manda éste. Se guarda en el activo para que un corto
        // creado hoy se siga generando igual mañana.
        promptEn: plan.music.promptEn || '',
        negativePrompt: plan.music.negativePrompt,
        referenceAssetIds: [],
        continuityNotes: [
          'Exclusivamente instrumental: sin voz, sin coros y sin letra',
          `Duración objetivo: ${plan.music.durationSec} s`,
        ],
        durationSec: plan.music.durationSec,
      },
      dependsOn: [],
    }),
  );

  assets.push(
    asset({
      id: AMBIENT_ASSET_ID,
      kind: 'ambient',
      stage: ASSET_KIND_STAGE.ambient,
      label: 'Sonido ambiental',
      order: next(),
      spec: {
        objective: 'Crear el lecho ambiental coherente con el escenario.',
        prompt: plan.ambient.prompt,
        negativePrompt: 'voces, palabras, música',
        referenceAssetIds: [],
        continuityNotes: [`Capas: ${plan.ambient.layers.join(', ')}`],
        durationSec: plan.ambient.durationSec,
      },
      dependsOn: [],
    }),
  );

  return assets;
}

function createProject(config, plan) {
  const now = new Date().toISOString();
  const assets = buildAssets(config, plan);
  return {
    id: projectId(),
    createdAt: now,
    updatedAt: now,
    config,
    plan,
    assets,
    currentStage: 'images',
    finalCut: { status: 'pending' },
    delivery: Object.assign({}, plan.delivery),
    events: [
      makeEvent('project_created', `Proyecto creado: ${plan.concept.title}`),
      makeEvent(
        'plan_ready',
        `Plan de producción listo: ${plan.shots.length} tomas, ${plan.timeline.length} cortes, ${plan.economics.reusedSlots} reutilizaciones.`,
      ),
    ],
  };
}

/** extra admite { assetId, generationId, stage }. */
function makeEvent(type, message, extra = {}) {
  return Object.assign(
    {
      id: eventId(),
      at: new Date().toISOString(),
      type,
      message,
    },
    extra,
  );
}

/** Añade una entrada al registro de auditoría del proyecto y la devuelve. */
function makeEventAndPush(project, type, message, extra = {}) {
  const event = makeEvent(type, message, extra);
  project.events.push(event);
  project.updatedAt = event.at;
  return event;
}

module.exports = {
  DomainError,
  shortId,
  projectId,
  generationId,
  eventId,
  getAsset,
  getGeneration,
  approvedGenerationOf,
  approvedFileOf,
  dependentsOf,
  transitiveDependents,
  startGeneration,
  completeGeneration,
  failGeneration,
  approveGeneration,
  rejectGeneration,
  unlockAsset,
  markDependentsStale,
  invalidateFinalCut,
  touch,
  MASTER_CHARACTER_ID,
  MASTER_ENVIRONMENT_ID,
  MASTER_SCENE_ID,
  MUSIC_ASSET_ID,
  AMBIENT_ASSET_ID,
  buildAssets,
  createProject,
  makeEvent,
  makeEventAndPush,
};
