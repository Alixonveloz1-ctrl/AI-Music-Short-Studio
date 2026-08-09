import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { ClaudePlanner, buildUserPrompt } from '../team/claudePlanner.js';
import { planStructure } from '../team/producer.js';
import type { PlannerInput } from '../team/planner.js';
import { BASE_CONFIG } from './helpers.js';

/**
 * The Claude planner is exercised against a stub of the Messages API, so the
 * request shape (structured outputs, adaptive thinking) and the response
 * handling are covered without needing a key or network access.
 */

const structure = planStructure(60);
const input: PlannerInput = {
  config: BASE_CONFIG,
  runtimeSec: 60,
  shots: structure.shots.map((s) => ({
    index: s.index,
    label: s.label,
    beat: s.beat,
    shotType: s.shotType,
    cameraMove: s.cameraMove,
    durationSec: s.durationSec,
  })),
};

let server: Server;
let baseURL: string;
let lastRequest: Record<string, unknown> = {};
let nextResponse: () => { status: number; body: unknown };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      lastRequest = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const { status, body } = nextResponse();
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no address');
  baseURL = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function makePlanner(): ClaudePlanner {
  const client = new Anthropic({ apiKey: 'test-key', baseURL, maxRetries: 0 });
  return new ClaudePlanner(client, 'claude-opus-5');
}

function message(text: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
    ...extra,
  };
}

const FULL_BRIEF = {
  title: 'Bruma sobre el bosque',
  logline: 'Una intérprete toca al amanecer mientras la niebla se levanta.',
  emotionalIntent: 'Calma atenta.',
  emotionalArc: 'De la quietud al clímax y de vuelta al silencio.',
  mood: ['sereno', 'melancólico'],
  palette: ['ámbar', 'verde profundo'],
  timeOfDay: 'amanecer con niebla baja',
  character: {
    summary: 'Intérprete de mirada baja.',
    face: 'rostro ovalado, cejas rectas, ojos oscuros',
    hair: 'coleta baja negra',
    wardrobe: 'túnica de lino crudo',
    build: 'complexión delgada',
    apparentAge: 'unos 30 años',
    accessories: ['pulsera de cuerda'],
  },
  environment: {
    location: 'claro de bosque con troncos altos',
    primaryElements: ['troncos altos', 'musgo'],
    secondaryElements: ['polvo en la luz'],
    atmosphere: 'aire frío y quieto',
  },
  lighting: {
    direction: 'luz lateral desde la izquierda',
    intensity: 'contraste medio',
    atmosphere: 'haces visibles entre los árboles',
  },
  instrumentAppearance: 'erhu de madera oscura con barniz mate',
  continuityRules: ['mismo rostro', 'mismo vestuario', 'misma luz'],
  shots: structure.shots.map((s) => ({
    index: s.index,
    purpose: `propósito ${s.index}`,
    description: `descripción ${s.index}`,
  })),
  music: {
    style: 'erhu solista',
    mood: 'melancólico',
    tempoBpm: 64,
    key: 'Re menor',
    scale: 'menor natural',
    structure: 'intro, desarrollo, clímax, resolución',
  },
  ambient: { layers: ['viento', 'pájaros'], description: 'bosque al alba' },
  delivery: { description: 'Corto musical instrumental.', hashtags: ['Erhu', '#Bosque', '#AIMusic'] },
  notes: {
    director: 'nota director',
    producer: 'nota productor',
    artDirector: 'nota arte',
    cinematographer: 'nota foto',
    screenwriter: 'nota guion',
    editor: 'nota montaje',
  },
};

describe('Claude planner', () => {
  it('sends the configuration, the shot list and a structured-output schema', async () => {
    nextResponse = () => ({ status: 200, body: message(JSON.stringify(FULL_BRIEF)) });
    await makePlanner().plan(input);

    expect(lastRequest['model']).toBe('claude-opus-5');
    expect(lastRequest['thinking']).toEqual({ type: 'adaptive' });

    const outputConfig = lastRequest['output_config'] as Record<string, unknown>;
    expect(outputConfig['effort']).toBe('high');
    const format = outputConfig['format'] as Record<string, unknown>;
    expect(format['type']).toBe('json_schema');
    expect(Object.keys((format['schema'] as { properties: object }).properties)).toContain('shots');

    const system = String(lastRequest['system']);
    expect(system).toMatch(/sin voz/i);
    expect(system).toMatch(/continuidad/i);

    const messages = lastRequest['messages'] as Array<{ content: string }>;
    expect(messages[0]?.content).toContain('Erhu');
    expect(messages[0]?.content).toContain('Shot 01');
  });

  it('returns the model brief when it is complete', async () => {
    nextResponse = () => ({ status: 200, body: message(JSON.stringify(FULL_BRIEF)) });
    const brief = await makePlanner().plan(input);
    expect(brief.title).toBe('Bruma sobre el bosque');
    expect(brief.character.face).toBe('rostro ovalado, cejas rectas, ojos oscuros');
    expect(brief.shots).toHaveLength(structure.shots.length);
    // Hashtags are normalised on the way in.
    expect(brief.delivery.hashtags[0]).toBe('#Erhu');
  });

  it('fills gaps from the deterministic brief instead of failing', async () => {
    const partial = { ...FULL_BRIEF, character: { ...FULL_BRIEF.character, hair: '' }, shots: [] };
    nextResponse = () => ({ status: 200, body: message(JSON.stringify(partial)) });
    const brief = await makePlanner().plan(input);
    expect(brief.character.hair.length).toBeGreaterThan(3);
    expect(brief.shots).toHaveLength(structure.shots.length);
  });

  it('surfaces a refusal rather than silently planning something else', async () => {
    nextResponse = () => ({
      status: 200,
      body: message('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'other' } }),
    });
    await expect(makePlanner().plan(input)).rejects.toThrow(/rechaz/i);
  });

  it('propagates API errors so the caller can fall back', async () => {
    nextResponse = () => ({
      status: 500,
      body: { type: 'error', error: { type: 'api_error', message: 'boom' } },
    });
    await expect(makePlanner().plan(input)).rejects.toThrow();
  });
});

describe('Planner prompt', () => {
  it('gives the model the settings it must not contradict (PRD §14)', () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('Duración total: 60 segundos');
    expect(prompt).toContain('Solista');
    expect(prompt).toContain('Mujer adulta');
    expect(prompt).toContain('Bosque');
    expect(prompt).toContain('Anime cinematográfico');
    expect(prompt).toContain(BASE_CONFIG.creativeDirection);
    for (const shot of input.shots) expect(prompt).toContain(shot.label);
  });
});
