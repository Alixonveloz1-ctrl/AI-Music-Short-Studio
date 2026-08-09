import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ProjectConfig } from '@ams/shared';
import { loadConfig, type AppConfig } from '../config.js';
import { createStudio, type Studio } from '../http/app.js';

export const BASE_CONFIG: ProjectConfig = {
  instrumentIds: ['erhu'],
  formationId: 'solo',
  performerGenderId: 'female',
  performerTypeId: 'adult_woman',
  scenarioId: 'forest',
  visualStyleId: 'anime_cinematic',
  creativeDirection: 'Amanecer con niebla baja, luz dorada, sensación de quietud.',
  durationSec: 60,
};

export interface TestStudio extends Studio {
  config: AppConfig;
  cleanup: () => Promise<void>;
}

/** A studio wired to a throwaway data directory and the offline providers. */
export async function makeStudio(): Promise<TestStudio> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'ams-test-'));
  const config: AppConfig = {
    ...loadConfig(),
    dataDir,
    providers: { image: 'mock', video: 'mock', music: 'mock', ambient: 'mock' },
    planner: { mode: 'heuristic', model: 'claude-opus-5', apiKey: '' },
  };
  const studio = createStudio(config);
  await studio.repo.init();
  return {
    ...studio,
    config,
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  };
}
