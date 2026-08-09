import { z } from 'zod';
// The Anthropic SDK's structured-output helper is built on Zod 4, which ships
// alongside Zod 3 under the `zod/v4` subpath. The creative brief — the only
// schema handed to a model — is therefore defined with v4; everything else
// stays on the classic API the rest of the codebase already uses.
import * as z4 from 'zod/v4';
import { DURATIONS_SEC } from './constants.js';
import {
  FORMATIONS_BY_ID,
  INSTRUMENTS_BY_ID,
  PERFORMER_TYPES_BY_ID,
  PERFORMER_GENDERS,
  SCENARIOS_BY_ID,
  VISUAL_STYLES_BY_ID,
} from './catalog.js';

const genderIds = PERFORMER_GENDERS.map((g) => g.id);

export const projectConfigSchema = z
  .object({
    instrumentIds: z
      .array(z.string())
      .min(1, 'Selecciona al menos un instrumento')
      .max(8, 'Máximo 8 instrumentos')
      .refine((ids) => ids.every((id) => INSTRUMENTS_BY_ID.has(id)), {
        message: 'Instrumento desconocido',
      })
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Instrumentos duplicados',
      }),
    formationId: z.string().refine((id) => FORMATIONS_BY_ID.has(id), 'Formación desconocida'),
    performerGenderId: z
      .string()
      .refine((id) => genderIds.includes(id), 'Tipo de intérprete desconocido'),
    performerTypeId: z
      .string()
      .refine((id) => PERFORMER_TYPES_BY_ID.has(id), 'Tipo visual desconocido'),
    scenarioId: z.string().refine((id) => SCENARIOS_BY_ID.has(id), 'Escenario desconocido'),
    scenarioCustom: z.string().max(2000).optional(),
    visualStyleId: z.string().refine((id) => VISUAL_STYLES_BY_ID.has(id), 'Estilo desconocido'),
    visualStyleCustom: z.string().max(2000).optional(),
    creativeDirection: z.string().max(6000).default(''),
    durationSec: z.union([z.literal(60), z.literal(120), z.literal(180)]),
    titleHint: z.string().max(120).optional(),
  })
  .superRefine((config, ctx) => {
    const performerType = PERFORMER_TYPES_BY_ID.get(config.performerTypeId);
    if (performerType && !performerType.genderIds.includes(config.performerGenderId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['performerTypeId'],
        message: 'El tipo visual no corresponde al intérprete seleccionado',
      });
    }
    if (config.scenarioId === 'other' && !config.scenarioCustom?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scenarioCustom'],
        message: 'Describe el escenario personalizado',
      });
    }
    if (config.visualStyleId === 'other' && !config.visualStyleCustom?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['visualStyleCustom'],
        message: 'Describe el estilo personalizado',
      });
    }
    if (!DURATIONS_SEC.includes(config.durationSec)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationSec'],
        message: 'Duración no soportada',
      });
    }
  });

export type ProjectConfigInput = z.input<typeof projectConfigSchema>;

export const generateOptionsSchema = z.object({
  unlock: z.boolean().optional(),
  promptOverride: z.string().max(8000).optional(),
});

/**
 * The creative layer a planner is responsible for.
 *
 * Structure and timing are computed by the Producer in code, so this schema
 * only covers *creative* decisions. It deliberately carries no length or range
 * constraints: structured outputs do not enforce those server-side, and a
 * rejected brief would be far worse than a slightly long sentence. Lengths are
 * clamped afterwards by `normalizeCreativeBrief`.
 */
export const creativeBriefSchema = z4.object({
  title: z4.string().describe('Título corto y evocador del cortometraje, sin comillas. Máx. 78 caracteres.'),
  logline: z4.string().describe('Una sola frase que resume el corto.'),
  emotionalIntent: z4.string().describe('Qué debe sentir el espectador.'),
  emotionalArc: z4.string().describe('Cómo evoluciona la emoción de principio a fin.'),
  mood: z4.array(z4.string()).describe('De 2 a 5 adjetivos de atmósfera.'),
  palette: z4.array(z4.string()).describe('De 2 a 4 colores dominantes.'),
  timeOfDay: z4.string().describe('Momento del día y calidad de la luz.'),
  character: z4.object({
    summary: z4.string().describe('Quién es el intérprete, en una frase.'),
    face: z4
      .string()
      .describe('Rasgos faciales concretos y repetibles: forma del rostro, cejas, ojos, nariz, boca.'),
    hair: z4.string().describe('Color, longitud y peinado exactos.'),
    wardrobe: z4.string().describe('Prendas, tejidos y colores exactos.'),
    build: z4.string().describe('Complexión y postura.'),
    apparentAge: z4.string().describe('Franja de edad aparente.'),
    accessories: z4.array(z4.string()).describe('Accesorios visibles, puede ir vacío.'),
  }),
  environment: z4.object({
    location: z4.string().describe('Descripción del lugar concreto.'),
    primaryElements: z4.array(z4.string()).describe('De 2 a 6 elementos que deben aparecer siempre.'),
    secondaryElements: z4.array(z4.string()).describe('Elementos de apoyo, puede ir vacío.'),
    atmosphere: z4.string().describe('Aire, partículas, temperatura, sensación.'),
  }),
  lighting: z4.object({
    direction: z4.string().describe('De dónde viene la luz principal.'),
    intensity: z4.string().describe('Contraste y rango dinámico.'),
    atmosphere: z4.string().describe('Niebla, haces visibles, dominante de color.'),
  }),
  instrumentAppearance: z4
    .string()
    .describe('Material, acabado y detalles del instrumento, para que sea siempre el mismo ejemplar.'),
  continuityRules: z4
    .array(z4.string())
    .describe('De 3 a 10 reglas que toda toma debe respetar para mantener la continuidad.'),
  shots: z4
    .array(
      z4.object({
        index: z4.number().describe('Número de la toma, empezando en 1.'),
        purpose: z4.string().describe('Función narrativa de la toma.'),
        description: z4
          .string()
          .describe('Qué se ve: encuadre, acción concreta del intérprete, entorno visible.'),
      }),
    )
    .describe('Una entrada por cada toma de la lista proporcionada, en el mismo orden.'),
  music: z4.object({
    style: z4.string(),
    mood: z4.string(),
    tempoBpm: z4.number().describe('Entre 40 y 200.'),
    key: z4.string().describe('Tonalidad, por ejemplo "Re menor".'),
    scale: z4.string().describe('Escala o modo.'),
    structure: z4.string().describe('Estructura por secciones con marcas de tiempo.'),
  }),
  ambient: z4.object({
    layers: z4.array(z4.string()).describe('Capas de sonido ambiental, sin voces.'),
    description: z4.string().describe('Cómo debe sonar el lecho ambiental.'),
  }),
  delivery: z4.object({
    description: z4.string().describe('Descripción corta para publicar.'),
    hashtags: z4.array(z4.string()).describe('De 5 a 10 hashtags, cada uno empezando por #.'),
  }),
  notes: z4.object({
    director: z4.string(),
    producer: z4.string(),
    artDirector: z4.string(),
    cinematographer: z4.string(),
    screenwriter: z4.string(),
    editor: z4.string(),
  }),
});

export type CreativeBrief = z4.infer<typeof creativeBriefSchema>;

function clamp(value: unknown, max: number, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return fallback;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function clampList(
  value: unknown,
  maxItems: number,
  maxLength: number,
  fallback: string[],
): string[] {
  if (!Array.isArray(value)) return fallback;
  const out = value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => clamp(v, maxLength, ''))
    .filter(Boolean)
    .slice(0, maxItems);
  return out.length > 0 ? out : fallback;
}

/**
 * Bring an arbitrary (possibly model-authored) brief into the shape the rest of
 * the pipeline expects: lengths clamped, missing fields filled from a known
 * good fallback, and exactly one shot entry per planned shot.
 */
export function normalizeCreativeBrief(
  candidate: unknown,
  fallback: CreativeBrief,
  shotCount: number,
): CreativeBrief {
  const raw = (candidate ?? {}) as Partial<CreativeBrief>;
  const rawCharacter = (raw.character ?? {}) as Partial<CreativeBrief['character']>;
  const rawEnvironment = (raw.environment ?? {}) as Partial<CreativeBrief['environment']>;
  const rawLighting = (raw.lighting ?? {}) as Partial<CreativeBrief['lighting']>;
  const rawMusic = (raw.music ?? {}) as Partial<CreativeBrief['music']>;
  const rawAmbient = (raw.ambient ?? {}) as Partial<CreativeBrief['ambient']>;
  const rawDelivery = (raw.delivery ?? {}) as Partial<CreativeBrief['delivery']>;
  const rawNotes = (raw.notes ?? {}) as Partial<CreativeBrief['notes']>;

  const byIndex = new Map<number, { purpose: string; description: string }>();
  if (Array.isArray(raw.shots)) {
    for (const shot of raw.shots) {
      if (!shot || typeof shot !== 'object') continue;
      const index = Number((shot as { index?: unknown }).index);
      if (!Number.isFinite(index)) continue;
      byIndex.set(index, {
        purpose: clamp((shot as { purpose?: unknown }).purpose, 190, ''),
        description: clamp((shot as { description?: unknown }).description, 580, ''),
      });
    }
  }

  const shots = Array.from({ length: shotCount }, (_, i) => {
    const index = i + 1;
    const fromModel = byIndex.get(index);
    const fromFallback = fallback.shots[i] ?? {
      index,
      purpose: 'Sostener la continuidad narrativa del corto',
      description: 'Plano del intérprete tocando en el escenario definido.',
    };
    return {
      index,
      purpose: fromModel?.purpose || fromFallback.purpose,
      description: fromModel?.description || fromFallback.description,
    };
  });

  const tempo = Number(rawMusic.tempoBpm);

  return {
    title: clamp(raw.title, 78, fallback.title),
    logline: clamp(raw.logline, 390, fallback.logline),
    emotionalIntent: clamp(raw.emotionalIntent, 290, fallback.emotionalIntent),
    emotionalArc: clamp(raw.emotionalArc, 480, fallback.emotionalArc),
    mood: clampList(raw.mood, 5, 40, fallback.mood),
    palette: clampList(raw.palette, 4, 40, fallback.palette),
    timeOfDay: clamp(raw.timeOfDay, 60, fallback.timeOfDay),
    character: {
      summary: clamp(rawCharacter.summary, 380, fallback.character.summary),
      face: clamp(rawCharacter.face, 290, fallback.character.face),
      hair: clamp(rawCharacter.hair, 190, fallback.character.hair),
      wardrobe: clamp(rawCharacter.wardrobe, 290, fallback.character.wardrobe),
      build: clamp(rawCharacter.build, 190, fallback.character.build),
      apparentAge: clamp(rawCharacter.apparentAge, 60, fallback.character.apparentAge),
      accessories: Array.isArray(rawCharacter.accessories)
        ? clampList(rawCharacter.accessories, 6, 60, [])
        : fallback.character.accessories,
    },
    environment: {
      location: clamp(rawEnvironment.location, 290, fallback.environment.location),
      primaryElements: clampList(
        rawEnvironment.primaryElements,
        6,
        80,
        fallback.environment.primaryElements,
      ),
      secondaryElements: Array.isArray(rawEnvironment.secondaryElements)
        ? clampList(rawEnvironment.secondaryElements, 6, 80, [])
        : fallback.environment.secondaryElements,
      atmosphere: clamp(rawEnvironment.atmosphere, 290, fallback.environment.atmosphere),
    },
    lighting: {
      direction: clamp(rawLighting.direction, 190, fallback.lighting.direction),
      intensity: clamp(rawLighting.intensity, 190, fallback.lighting.intensity),
      atmosphere: clamp(rawLighting.atmosphere, 190, fallback.lighting.atmosphere),
    },
    instrumentAppearance: clamp(raw.instrumentAppearance, 390, fallback.instrumentAppearance),
    continuityRules: clampList(raw.continuityRules, 10, 200, fallback.continuityRules),
    shots,
    music: {
      style: clamp(rawMusic.style, 190, fallback.music.style),
      mood: clamp(rawMusic.mood, 190, fallback.music.mood),
      tempoBpm:
        Number.isFinite(tempo) && tempo >= 40 && tempo <= 200
          ? Math.round(tempo)
          : fallback.music.tempoBpm,
      key: clamp(rawMusic.key, 40, fallback.music.key),
      scale: clamp(rawMusic.scale, 60, fallback.music.scale),
      structure: clamp(rawMusic.structure, 390, fallback.music.structure),
    },
    ambient: {
      layers: clampList(rawAmbient.layers, 6, 60, fallback.ambient.layers),
      description: clamp(rawAmbient.description, 390, fallback.ambient.description),
    },
    delivery: {
      description: clamp(rawDelivery.description, 390, fallback.delivery.description),
      hashtags: clampList(rawDelivery.hashtags, 10, 40, fallback.delivery.hashtags).map((tag) =>
        tag.startsWith('#') ? tag : `#${tag.replace(/^#+/, '')}`,
      ),
    },
    notes: {
      director: clamp(rawNotes.director, 580, fallback.notes.director),
      producer: clamp(rawNotes.producer, 580, fallback.notes.producer),
      artDirector: clamp(rawNotes.artDirector, 580, fallback.notes.artDirector),
      cinematographer: clamp(rawNotes.cinematographer, 580, fallback.notes.cinematographer),
      screenwriter: clamp(rawNotes.screenwriter, 580, fallback.notes.screenwriter),
      editor: clamp(rawNotes.editor, 580, fallback.notes.editor),
    },
  };
}
