/**
 * The AI production team (PRD §13).
 *
 * `buildProductionPlan` runs the whole pre-production pass: the Producer lays
 * out the structure, a planner writes the creative brief, the Art Director
 * turns it into a continuity contract, and the Director of Photography /
 * Editor turn that into per-shot prompts and an edit timeline.
 */
import {
  INSTRUMENTS_BY_ID,
  FORMATIONS_BY_ID,
  SCENARIOS_BY_ID,
  type AmbientBrief,
  type CreativeBrief,
  type MusicBrief,
  type ProductionPlan,
  type ProjectConfig,
  type Shot,
  type TimelineEntry,
  type VisualBible,
} from '@ams/shared';
import type { AppConfig } from '../config.js';
import { planStructure, shotImageAssetId } from './producer.js';
import { buildHeuristicBrief } from './heuristicPlanner.js';
import { ClaudePlanner, createAnthropicClient } from './claudePlanner.js';
import type { Planner, PlannerInput } from './planner.js';
import { buildClipPrompt, buildShotImagePrompt, buildVisualBible } from './artDirector.js';

export * from './producer.js';
export * from './artDirector.js';

export interface PlanResult {
  plan: ProductionPlan;
  /** Non-fatal problems worth surfacing (e.g. the Claude planner failed). */
  warnings: string[];
}

export function selectPlanner(config: AppConfig): Planner | null {
  const { mode, apiKey, model } = config.planner;
  if (mode === 'heuristic') return null;
  if (!apiKey) {
    if (mode === 'claude') {
      throw new Error(
        'AMS_PLANNER=claude requiere ANTHROPIC_API_KEY. Usa AMS_PLANNER=heuristic para el planificador interno.',
      );
    }
    return null;
  }
  return new ClaudePlanner(createAnthropicClient(apiKey), model);
}

export async function buildProductionPlan(
  projectConfig: ProjectConfig,
  appConfig: AppConfig,
): Promise<PlanResult> {
  const warnings: string[] = [];
  const structure = planStructure(projectConfig.durationSec);

  const plannerInput: PlannerInput = {
    config: projectConfig,
    runtimeSec: projectConfig.durationSec,
    shots: structure.shots.map((shot) => ({
      index: shot.index,
      label: shot.label,
      beat: shot.beat,
      shotType: shot.shotType,
      cameraMove: shot.cameraMove,
      durationSec: shot.durationSec,
    })),
  };

  let brief: CreativeBrief = buildHeuristicBrief(plannerInput);
  let plannedBy: ProductionPlan['plannedBy'] = 'heuristic';

  let planner: Planner | null = null;
  try {
    planner = selectPlanner(appConfig);
  } catch (error) {
    warnings.push(errorMessage(error));
  }

  if (planner) {
    try {
      brief = await planner.plan(plannerInput);
      plannedBy = planner.name;
    } catch (error) {
      warnings.push(
        `El planificador de Claude no pudo completar el brief (${errorMessage(error)}). Se ha usado el planificador interno.`,
      );
    }
  }

  const visualBible = buildVisualBible(projectConfig, brief);

  const shots: Shot[] = structure.shots.map((planned) => {
    const creative = brief.shots.find((s) => s.index === planned.index);
    return {
      id: planned.id,
      index: planned.index,
      label: planned.label,
      beat: planned.beat,
      shotType: planned.shotType,
      cameraMove: planned.cameraMove,
      purpose: creative?.purpose ?? 'Sostener la continuidad narrativa del corto',
      description:
        creative?.description ??
        `Plano del intérprete tocando ${visualBible.instrument.names.join(' y ')} en ${visualBible.environment.location}.`,
      durationSec: planned.durationSec,
      reusable: planned.reusable,
      clips: planned.clips.map((clip) => ({
        id: clip.id,
        shotId: clip.shotId,
        index: clip.index,
        suffix: clip.suffix,
        label: clip.label,
        durationSec: clip.durationSec,
        motionNote: '',
      })),
    };
  });

  // Fill in per-clip motion notes now that shots are fully described.
  for (const shot of shots) {
    const total = shot.clips.length;
    shot.clips.forEach((clip, index) => {
      clip.motionNote =
        total === 1
          ? 'Toma completa en un solo clip.'
          : index === 0
            ? 'Arranque del movimiento de cámara y de la frase musical.'
            : index === total - 1
              ? 'Cierre del movimiento; la cámara se estabiliza al final.'
              : 'Continuación del movimiento sin cambios de dirección.';
    });
  }

  const timeline: TimelineEntry[] = structure.timeline.map((entry) => ({
    index: entry.index,
    shotId: entry.shotId,
    clipId: entry.clipId,
    clipAssetId: entry.clipId,
    startSec: entry.startSec,
    durationSec: entry.durationSec,
    reused: entry.reused,
    transitionIn: entry.transitionIn,
  }));

  const music = buildMusicBrief(projectConfig, brief, visualBible);
  const ambient = buildAmbientBrief(projectConfig, brief);

  const plan: ProductionPlan = {
    concept: {
      title: brief.title,
      logline: brief.logline,
      emotionalIntent: brief.emotionalIntent,
      emotionalArc: brief.emotionalArc,
      mood: brief.mood,
      palette: brief.palette,
      timeOfDay: brief.timeOfDay,
    },
    visualBible,
    shots,
    timeline,
    music,
    ambient,
    delivery: {
      title: brief.title,
      description: brief.delivery.description,
      hashtags: brief.delivery.hashtags,
    },
    notes: brief.notes,
    plannedBy,
    plannedAt: new Date().toISOString(),
    economics: structure.economics,
  };

  // The prompts depend on the finished bible, so they are composed last.
  for (const shot of shots) {
    shot.description = shot.description.trim();
  }

  return { plan, warnings };
}

export function composeShotImagePrompt(bible: VisualBible, shot: Shot): string {
  return buildShotImagePrompt(bible, shot);
}

export function composeClipPrompt(bible: VisualBible, shot: Shot, clipIndex: number): string {
  const clip = shot.clips[clipIndex];
  if (!clip) throw new Error(`Clip ${clipIndex} no existe en ${shot.id}`);
  return buildClipPrompt(bible, shot, clip, shot.clips.length);
}

export { shotImageAssetId };

function buildMusicBrief(
  config: ProjectConfig,
  brief: CreativeBrief,
  bible: VisualBible,
): MusicBrief {
  const instruments = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const formation = FORMATIONS_BY_ID.get(config.formationId);
  const scenario = SCENARIOS_BY_ID.get(config.scenarioId);
  const instrumentation = instruments.map((i) => i.name);

  const prompt = [
    `Pieza musical exclusivamente instrumental de ${config.durationSec} segundos.`,
    `Instrumentación: ${instrumentation.join(', ') || 'instrumento solista'}. Formación: ${formation?.label ?? 'Solista'}.`,
    `Estilo: ${brief.music.style}.`,
    `Carácter: ${brief.music.mood}. Intención emocional: ${brief.emotionalIntent}`,
    `Tonalidad: ${brief.music.key}, ${brief.music.scale}. Tempo aproximado: ${brief.music.tempoBpm} BPM.`,
    `Estructura: ${brief.music.structure}`,
    `Espacio sonoro coherente con ${scenario?.label ?? 'el escenario'} (acústica ${scenario?.acoustics ?? 'natural'}).`,
    `Paleta emocional del corto: ${bible.aesthetic.finish}.`,
    'Sin voz, sin coros, sin letra, sin palabras. Solo instrumentos.',
  ].join('\n');

  return {
    title: brief.title,
    instrumentation,
    style: brief.music.style,
    mood: brief.music.mood,
    tempoBpm: brief.music.tempoBpm,
    key: brief.music.key,
    scale: brief.music.scale,
    structure: brief.music.structure,
    durationSec: config.durationSec,
    prompt,
    negativePrompt: 'voz, canto, coros, letra, palabras habladas, aplausos, ruido de público',
  };
}

function buildAmbientBrief(config: ProjectConfig, brief: CreativeBrief): AmbientBrief {
  const scenario = SCENARIOS_BY_ID.get(config.scenarioId);
  const layers = brief.ambient.layers.length
    ? brief.ambient.layers
    : (scenario?.ambience ?? ['ambiente neutro']);
  const prompt = [
    `Lecho de sonido ambiental de ${config.durationSec} segundos para ${scenario?.label ?? 'el escenario'}.`,
    `Capas: ${layers.join(', ')}.`,
    brief.ambient.description,
    `Acústica del espacio: ${scenario?.acoustics ?? 'natural'}.`,
    'Debe quedar siempre por debajo de la música. Sin voces, sin palabras, sin música.',
  ].join('\n');

  return {
    layers,
    description: brief.ambient.description,
    acoustics: scenario?.acoustics ?? 'natural',
    durationSec: config.durationSec,
    prompt,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
