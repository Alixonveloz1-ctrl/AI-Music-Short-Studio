import { GoogleAuth } from 'google-auth-library';
import { ProviderError } from '../types.js';

export interface VertexSettings {
  project: string;
  location: string;
}

let authClient: GoogleAuth | null = null;

function auth(): GoogleAuth {
  if (!authClient) {
    authClient = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return authClient;
}

export function assertVertexConfigured(settings: VertexSettings): void {
  if (!settings.project) {
    throw new ProviderError(
      'Falta GOOGLE_CLOUD_PROJECT. Configura el proyecto de Google Cloud o usa los proveedores offline (AMS_*_PROVIDER=mock).',
    );
  }
}

export function modelEndpoint(settings: VertexSettings, model: string, verb: string): string {
  const host =
    settings.location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${settings.location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${settings.project}/locations/${settings.location}/publishers/google/models/${model}:${verb}`;
}

export async function vertexPost<T>(
  settings: VertexSettings,
  url: string,
  body: unknown,
  timeoutMs = 10 * 60 * 1000,
): Promise<T> {
  assertVertexConfigured(settings);
  const token = await auth().getAccessToken();
  if (!token) {
    throw new ProviderError(
      'No se pudieron obtener credenciales de Google Cloud. Ejecuta "gcloud auth application-default login" o define GOOGLE_APPLICATION_CREDENTIALS.',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const retriable = response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `Vertex AI respondió ${response.status}: ${truncate(text, 600)}`,
        retriable,
      );
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if ((error as Error).name === 'AbortError') {
      throw new ProviderError('La petición a Vertex AI superó el tiempo máximo de espera.', true);
    }
    throw new ProviderError(`Error llamando a Vertex AI: ${(error as Error).message}`, true);
  } finally {
    clearTimeout(timer);
  }
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
