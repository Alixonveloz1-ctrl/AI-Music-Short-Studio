import fs from 'node:fs/promises';
import path from 'node:path';
import {
  computeCurrentStage,
  summarizeProject,
  type Project,
  type ProjectSummary,
} from '@ams/shared';
import { DomainError } from '../domain/stateMachine.js';

/**
 * Filesystem-backed project store.
 *
 * A project is one directory: a JSON document plus every generation ever
 * produced for it. Rejected generations are kept on disk as history (PRD §21,
 * §37) — only the pointer to the approved one is authoritative.
 */
export class ProjectRepository {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly dataDir: string) {}

  get projectsDir(): string {
    return path.join(this.dataDir, 'projects');
  }

  projectDir(id: string): string {
    return path.join(this.projectsDir, id);
  }

  projectFile(id: string): string {
    return path.join(this.projectDir(id), 'project.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.projectsDir, { recursive: true });
  }

  async list(): Promise<ProjectSummary[]> {
    await this.init();
    const entries = await fs.readdir(this.projectsDir, { withFileTypes: true });
    const summaries: ProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const project = await this.load(entry.name);
        summaries.push(summarizeProject(project));
      } catch {
        // A half-written or hand-edited directory should not break the list.
      }
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  }

  async exists(id: string): Promise<boolean> {
    try {
      await fs.access(this.projectFile(id));
      return true;
    } catch {
      return false;
    }
  }

  async load(id: string): Promise<Project> {
    assertSafeId(id);
    let raw: string;
    try {
      raw = await fs.readFile(this.projectFile(id), 'utf8');
    } catch {
      throw new DomainError(`Proyecto no encontrado: ${id}`, 404);
    }
    const project = JSON.parse(raw) as Project;
    project.currentStage = computeCurrentStage(project);
    return project;
  }

  async save(project: Project): Promise<void> {
    assertSafeId(project.id);
    const dir = this.projectDir(project.id);
    await fs.mkdir(dir, { recursive: true });
    const target = this.projectFile(project.id);
    const tmp = `${target}.${process.pid}.tmp`;
    // Trim the audit log so a long session cannot grow the file without bound.
    if (project.events.length > 500) {
      project.events = project.events.slice(-500);
    }
    await fs.writeFile(tmp, JSON.stringify(project, null, 2), 'utf8');
    await fs.rename(tmp, target);
  }

  async ensureDir(projectId: string, relativeDir: string): Promise<string> {
    const dir = path.join(this.projectDir(projectId), ...relativeDir.split('/'));
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  absolutePath(projectId: string, relativePath: string): string {
    assertSafeId(projectId);
    const base = this.projectDir(projectId);
    const resolved = path.resolve(base, ...relativePath.split('/'));
    if (!resolved.startsWith(path.resolve(base) + path.sep)) {
      throw new DomainError('Ruta de archivo no permitida', 400);
    }
    return resolved;
  }

  async delete(id: string): Promise<void> {
    assertSafeId(id);
    await fs.rm(this.projectDir(id), { recursive: true, force: true });
  }

  /**
   * Serialise every mutation of a project so two concurrent requests cannot
   * write over each other's version of `project.json`.
   */
  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => gate);
    this.locks.set(id, chained);
    await previous.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
      // Only the last waiter in the chain clears the entry; anyone queued
      // behind us has already replaced it with their own link.
      if (this.locks.get(id) === chained) this.locks.delete(id);
    }
  }
}

const SAFE_ID = /^[a-z0-9_]+$/i;

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new DomainError(`Identificador de proyecto no válido: ${id}`, 400);
  }
}
