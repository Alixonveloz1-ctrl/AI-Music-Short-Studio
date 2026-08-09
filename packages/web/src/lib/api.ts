import type {
  Instrument,
  ProductionStatus,
  Project,
  ProjectConfig,
  ProjectSummary,
  StreamEvent,
} from '@ams/shared';

export interface Catalog {
  instrumentCategories: Array<{ id: string; label: string }>;
  instruments: Instrument[];
  formations: Array<{ id: string; label: string; performerCount: number; description: string }>;
  performerGenders: Array<{ id: string; label: string }>;
  performerTypes: Array<{ id: string; label: string; genderIds: string[]; descriptor: string }>;
  scenarios: Array<{ id: string; label: string; outdoor: boolean }>;
  visualStyles: Array<{ id: string; label: string; treatment: string }>;
  durations: ReadonlyArray<{ seconds: number; label: string }>;
}

export interface ProjectPayload {
  project: Project;
  status: ProductionStatus & { missingForEdit?: string[] };
  warnings?: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Error ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export const api = {
  health: () => request<{ ok: boolean; providers: Record<string, string>; ffmpeg: boolean }>('/health'),
  catalog: () => request<Catalog>('/catalog'),
  searchInstruments: (query: string) =>
    request<Instrument[]>(`/catalog/instruments?q=${encodeURIComponent(query)}&limit=40`),
  listProjects: () => request<ProjectSummary[]>('/projects'),
  createProject: (config: ProjectConfig) =>
    request<ProjectPayload>('/projects', { method: 'POST', body: JSON.stringify({ config }) }),
  getProject: (id: string) => request<ProjectPayload>(`/projects/${id}`),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  generate: (projectId: string, assetId: string, options: { unlock?: boolean } = {}) =>
    request<{ project: Project }>(`/projects/${projectId}/assets/${assetId}/generate`, {
      method: 'POST',
      body: JSON.stringify(options),
    }),
  approve: (projectId: string, assetId: string, generationId: string) =>
    request<ProjectPayload>(
      `/projects/${projectId}/assets/${assetId}/generations/${generationId}/approve`,
      { method: 'POST' },
    ),
  reject: (projectId: string, assetId: string, generationId: string) =>
    request<ProjectPayload>(
      `/projects/${projectId}/assets/${assetId}/generations/${generationId}/reject`,
      { method: 'POST' },
    ),
  unlock: (projectId: string, assetId: string) =>
    request<{ project: Project }>(`/projects/${projectId}/assets/${assetId}/unlock`, {
      method: 'POST',
    }),
  assemble: (projectId: string) =>
    request<{ project: Project }>(`/projects/${projectId}/edit/assemble`, { method: 'POST' }),
  approveFinal: (projectId: string) =>
    request<{ project: Project }>(`/projects/${projectId}/edit/approve`, { method: 'POST' }),
  reopen: (projectId: string, reason: string) =>
    request<{ project: Project }>(`/projects/${projectId}/edit/reopen`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  exportFinal: (projectId: string) =>
    request<{ project: Project }>(`/projects/${projectId}/export`, { method: 'POST' }),
  updateDelivery: (
    projectId: string,
    delivery: { title?: string; description?: string; hashtags?: string[] },
  ) =>
    request<{ project: Project }>(`/projects/${projectId}/delivery`, {
      method: 'PATCH',
      body: JSON.stringify(delivery),
    }),
};

/** Live production updates, so a finished generation shows up on its own. */
export function subscribeToProject(
  projectId: string,
  onEvent: (event: StreamEvent) => void,
): () => void {
  const source = new EventSource(`/api/projects/${projectId}/stream`);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as StreamEvent);
    } catch {
      // A malformed frame should never take the Production Room down.
    }
  };
  return () => source.close();
}
