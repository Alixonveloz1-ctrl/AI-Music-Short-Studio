import { EventEmitter } from 'node:events';
import type { Project, ProjectEvent } from '@ams/shared';

/**
 * In-process pub/sub used to push production updates to open SSE connections,
 * so the Production Room reflects a finished generation the moment it lands.
 */
export class ProjectEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publishProject(project: Project): void {
    this.emitter.emit(`project:${project.id}`, { type: 'project', project });
  }

  publishEvent(projectId: string, event: ProjectEvent): void {
    this.emitter.emit(`project:${projectId}`, { type: 'event', event });
  }

  subscribe(projectId: string, listener: (payload: unknown) => void): () => void {
    const key = `project:${projectId}`;
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }
}
