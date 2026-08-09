import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** <repo>/packages/server/src -> <repo> */
const repoRoot = path.resolve(here, '..', '..', '..');

function env(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

export type ImageProviderMode = 'mock' | 'vertex';
export type VideoProviderMode = 'mock' | 'vertex';
export type MusicProviderMode = 'mock' | 'lyria';
export type AmbientProviderMode = 'mock';
export type PlannerMode = 'auto' | 'claude' | 'heuristic';

export interface AppConfig {
  port: number;
  dataDir: string;
  publicBaseUrl: string;
  providers: {
    image: ImageProviderMode;
    video: VideoProviderMode;
    music: MusicProviderMode;
    ambient: AmbientProviderMode;
  };
  vertex: {
    project: string;
    location: string;
    imageModel: string;
    videoModel: string;
    musicModel: string;
  };
  planner: {
    mode: PlannerMode;
    model: string;
    apiKey: string;
  };
}

function pick<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = env(name, fallback).toLowerCase() as T;
  return allowed.includes(raw) ? raw : fallback;
}

export function loadConfig(): AppConfig {
  const dataDir = env('AMS_DATA_DIR') || path.join(repoRoot, 'data');
  const port = Number.parseInt(env('PORT', '8787'), 10);
  return {
    port: Number.isFinite(port) ? port : 8787,
    dataDir,
    publicBaseUrl: env('AMS_PUBLIC_BASE_URL', ''),
    providers: {
      image: pick('AMS_IMAGE_PROVIDER', ['mock', 'vertex'] as const, 'mock'),
      video: pick('AMS_VIDEO_PROVIDER', ['mock', 'vertex'] as const, 'mock'),
      music: pick('AMS_MUSIC_PROVIDER', ['mock', 'lyria'] as const, 'mock'),
      ambient: pick('AMS_AMBIENT_PROVIDER', ['mock'] as const, 'mock'),
    },
    vertex: {
      project: env('GOOGLE_CLOUD_PROJECT'),
      location: env('GOOGLE_CLOUD_LOCATION', 'us-central1'),
      imageModel: env('AMS_VERTEX_IMAGE_MODEL', 'imagen-4.0-generate-001'),
      videoModel: env('AMS_VERTEX_VIDEO_MODEL', 'veo-3.0-generate-001'),
      musicModel: env('AMS_VERTEX_MUSIC_MODEL', 'lyria-002'),
    },
    planner: {
      mode: pick('AMS_PLANNER', ['auto', 'claude', 'heuristic'] as const, 'auto'),
      model: env('AMS_PLANNER_MODEL', 'claude-opus-5'),
      apiKey: env('ANTHROPIC_API_KEY'),
    },
  };
}

export const REPO_ROOT = repoRoot;
