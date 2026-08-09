/**
 * The Claude-backed production team.
 *
 * When an Anthropic API key is available, the Director, Screenwriter and Art
 * Director roles (PRD §13–§18) are played by Claude: it writes the concept,
 * the visual bible and one description per planned shot. It never decides the
 * *structure* — shot count, durations, clip splits and the reuse plan are the
 * Producer's job and stay in code.
 *
 * Any failure here is non-fatal: the caller falls back to the deterministic
 * planner so a project can always be created.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  FORMATIONS_BY_ID,
  INSTRUMENTS_BY_ID,
  PERFORMER_TYPES_BY_ID,
  SCENARIOS_BY_ID,
  VISUAL_STYLES_BY_ID,
  creativeBriefSchema,
  normalizeCreativeBrief,
  type CreativeBrief,
} from '@ams/shared';
import type { Planner, PlannerInput } from './planner.js';
import { buildHeuristicBrief } from './heuristicPlanner.js';
import { shotTypeLabel, cameraMoveLabel } from './artDirector.js';

const SYSTEM_PROMPT = `Eres el equipo de dirección de AI Music Short Studio: Director, Guionista y Director de Arte trabajando juntos.

Preparas la capa creativa de un cortometraje musical instrumental, sin voz, sin diálogo y sin narración.

Reglas que no puedes romper:
- Respeta estrictamente la configuración elegida por el usuario. No cambies el instrumento, la formación, el tipo de intérprete, el escenario, el estilo visual ni la duración.
- No introduzcas cantantes, voces, letras, texto en pantalla ni carteles.
- La continuidad es lo más importante: describe al personaje, el instrumento y el escenario con detalles concretos y repetibles, de modo que todas las tomas parezcan la misma película. Evita adjetivos vagos ("bonito", "épico") y prefiere hechos visuales ("cejas rectas", "barniz mate con una marca junto al puente").
- Escribe una entrada por cada toma de la lista que se te da, en el mismo orden y con el mismo índice, adaptando la descripción al tipo de plano y al momento del corto indicados.
- Escribe todo en español.`;

export class ClaudePlanner implements Planner {
  readonly name = 'claude' as const;

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
  ) {}

  async plan(input: PlannerInput): Promise<CreativeBrief> {
    const fallback = buildHeuristicBrief(input);
    // `messages.create` rather than `messages.parse`: the schema still
    // constrains the output, but we own the failure paths. `parse` throws a
    // generic "failed to parse" for a refusal or a truncated response, which
    // would hide *why* the plan could not be written.
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'high',
        format: zodOutputFormat(creativeBriefSchema),
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    });

    if (response.stop_reason === 'refusal') {
      throw new Error(
        `El planificador rechazó la petición (${response.stop_details?.category ?? 'sin categoría'}).`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error('El plan creativo se cortó por longitud antes de completarse.');
    }

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) {
      throw new Error('El planificador devolvió una respuesta vacía.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('El planificador devolvió un JSON no válido.');
    }

    return normalizeCreativeBrief(parsed, fallback, input.shots.length);
  }
}

export function buildUserPrompt(input: PlannerInput): string {
  const { config, shots, runtimeSec } = input;
  const instruments = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const scenario = SCENARIOS_BY_ID.get(config.scenarioId);
  const style = VISUAL_STYLES_BY_ID.get(config.visualStyleId);
  const formation = FORMATIONS_BY_ID.get(config.formationId);
  const performerType = PERFORMER_TYPES_BY_ID.get(config.performerTypeId);

  const shotLines = shots
    .map(
      (shot) =>
        `${shot.index}. ${shot.label} — ${shotTypeLabel(shot.shotType)}, ${cameraMoveLabel(shot.cameraMove)}, ${shot.durationSec} s, bloque "${shot.beat}"`,
    )
    .join('\n');

  const instrumentLines = instruments
    .map((i) => `- ${i.name} (${i.origin}): se toca con ${i.technique}; se sostiene ${i.posture}`)
    .join('\n');

  return `CONFIGURACIÓN DEL CORTO

Instrumentos:
${instrumentLines || '- (sin instrumentos)'}

Formación: ${formation?.label ?? 'Solista'} (${formation?.description ?? ''})
Intérprete: ${performerType?.label ?? ''} — ${performerType?.descriptor ?? ''}
Escenario: ${scenario?.label ?? ''}${config.scenarioCustom ? ` — indicación del usuario: ${config.scenarioCustom}` : ''}
Elementos habituales del escenario: ${scenario?.elements.join(', ') || 'sin definir'}
Estilo visual: ${style?.label ?? ''} — ${style?.treatment ?? ''}${config.visualStyleCustom ? `; indicación del usuario: ${config.visualStyleCustom}` : ''}
Duración total: ${runtimeSec} segundos

DIRECCIÓN CREATIVA DEL USUARIO (texto libre, tiene prioridad sobre tus preferencias):
${config.creativeDirection.trim() || '(el usuario no ha escrito indicaciones adicionales)'}

PLAN DE TOMAS YA DECIDIDO POR EL PRODUCTOR (no lo cambies, solo descríbelo):
${shotLines}

TAREA
Escribe la capa creativa completa: concepto, biblia visual (personaje, instrumento, escenario, luz), una descripción por toma, el brief musical instrumental, las capas de sonido ambiental, los metadatos de publicación y una nota breve por cada rol del equipo.`;
}

export function createAnthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey });
}
