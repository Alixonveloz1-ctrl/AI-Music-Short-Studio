/**
 * Turns a finished production plan into the concrete list of assets the user
 * will review one by one (PRD §5, §20, §26, §29, §31).
 *
 * Every asset starts PENDING with no generations: nothing exists until the
 * user asks for it, and nothing advances until the user approves it.
 */
import {
  ASSET_KIND_STAGE,
  type Asset,
  type AssetSpec,
  type ProductionPlan,
  type Project,
  type ProjectConfig,
  type ProjectEvent,
  type ProjectEventType,
} from '@ams/shared';
import { eventId, projectId } from './ids.js';
import {
  buildCharacterPrompt,
  buildEnvironmentPrompt,
  buildScenePrompt,
  buildShotImagePrompt,
  buildClipPrompt,
  NEGATIVE_VIDEO_EXTRA,
} from '../team/artDirector.js';

export const MASTER_CHARACTER_ID = 'master_character';
export const MASTER_ENVIRONMENT_ID = 'master_environment';
export const MASTER_SCENE_ID = 'master_scene';
export const MUSIC_ASSET_ID = 'music';
export const AMBIENT_ASSET_ID = 'ambient';

function asset(partial: Omit<Asset, 'status' | 'locked' | 'approvedGenerationId' | 'generations' | 'stale'>): Asset {
  return {
    ...partial,
    status: 'pending',
    locked: false,
    approvedGenerationId: null,
    generations: [],
    stale: false,
  };
}

export function buildAssets(config: ProjectConfig, plan: ProductionPlan): Asset[] {
  const bible = plan.visualBible;
  const assets: Asset[] = [];
  let order = 0;
  const next = () => (order += 10);

  const characterSpec: AssetSpec = {
    objective: 'Definir el aspecto oficial del intérprete para todo el corto.',
    prompt: buildCharacterPrompt(bible, config),
    negativePrompt: bible.negativePrompt,
    referenceAssetIds: [],
    continuityNotes: bible.continuityRules.slice(0, 4),
  };
  assets.push(
    asset({
      id: MASTER_CHARACTER_ID,
      kind: 'master_character',
      stage: ASSET_KIND_STAGE.master_character,
      label: 'Personaje maestro',
      order: next(),
      spec: characterSpec,
      dependsOn: [],
    }),
  );

  assets.push(
    asset({
      id: MASTER_ENVIRONMENT_ID,
      kind: 'master_environment',
      stage: ASSET_KIND_STAGE.master_environment,
      label: 'Escenario maestro',
      order: next(),
      spec: {
        objective: 'Definir el aspecto oficial del escenario para todo el corto.',
        prompt: buildEnvironmentPrompt(bible),
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
        referenceAssetIds: [MASTER_CHARACTER_ID, MASTER_ENVIRONMENT_ID],
        continuityNotes: bible.continuityRules,
      },
      dependsOn: [MASTER_CHARACTER_ID, MASTER_ENVIRONMENT_ID],
    }),
  );

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
          prompt: buildShotImagePrompt(bible, shot),
          negativePrompt: bible.negativePrompt,
          referenceAssetIds: [MASTER_SCENE_ID, MASTER_CHARACTER_ID, MASTER_ENVIRONMENT_ID],
          continuityNotes: bible.continuityRules,
        },
        dependsOn: [MASTER_SCENE_ID],
      }),
    );
  }

  for (const shot of plan.shots) {
    shot.clips.forEach((clip, index) => {
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
      void index;
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

export function createProject(config: ProjectConfig, plan: ProductionPlan): Project {
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
    delivery: { ...plan.delivery },
    events: [
      makeEvent('project_created', `Proyecto creado: ${plan.concept.title}`),
      makeEvent(
        'plan_ready',
        `Plan de producción listo: ${plan.shots.length} tomas, ${plan.timeline.length} cortes, ${plan.economics.reusedSlots} reutilizaciones.`,
      ),
    ],
  };
}

export function makeEvent(
  type: ProjectEventType,
  message: string,
  extra: Partial<Pick<ProjectEvent, 'assetId' | 'generationId' | 'stage'>> = {},
): ProjectEvent {
  return {
    id: eventId(),
    at: new Date().toISOString(),
    type,
    message,
    ...extra,
  };
}

/** Append an audit-log entry to a project and return it. */
export function makeEventAndPush(
  project: Project,
  type: ProjectEventType,
  message: string,
  extra: Partial<Pick<ProjectEvent, 'assetId' | 'generationId' | 'stage'>> = {},
): ProjectEvent {
  const event = makeEvent(type, message, extra);
  project.events.push(event);
  project.updatedAt = event.at;
  return event;
}
