import {
  computeCurrentStage,
  computeProductionStatus,
  projectConfigSchema,
  type ProductionStatus,
  type Project,
  type ProjectSummary,
} from '@ams/shared';
import type { AppConfig } from '../config.js';
import { ProjectRepository } from '../storage/repository.js';
import { buildProductionPlan } from '../team/index.js';
import { createProject } from '../domain/project.js';
import {
  DomainError,
  approveGeneration,
  rejectGeneration,
  unlockAsset,
} from '../domain/stateMachine.js';
import type { ProjectEventBus } from './events.js';
import { missingApprovals } from './editorService.js';

export interface CreateProjectResult {
  project: Project;
  warnings: string[];
}

export class ProjectService {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly config: AppConfig,
    private readonly bus: ProjectEventBus,
  ) {}

  async create(rawConfig: unknown): Promise<CreateProjectResult> {
    const parsed = projectConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'config'}: ${issue.message}`)
        .join('; ');
      throw new DomainError(`Configuración no válida — ${detail}`, 400);
    }

    const { plan, warnings } = await buildProductionPlan(parsed.data, this.config);
    const project = createProject(parsed.data, plan);
    project.currentStage = computeCurrentStage(project);
    await this.repo.save(project);
    this.bus.publishProject(project);
    return { project, warnings };
  }

  async list(): Promise<ProjectSummary[]> {
    return this.repo.list();
  }

  async get(id: string): Promise<Project> {
    return this.repo.load(id);
  }

  async status(id: string): Promise<ProductionStatus & { missingForEdit: string[] }> {
    const project = await this.repo.load(id);
    return {
      ...computeProductionStatus(project),
      missingForEdit: missingApprovals(project),
    };
  }

  async approve(projectId: string, assetId: string, generationId: string): Promise<Project> {
    return this.mutate(projectId, (project) => {
      approveGeneration(project, assetId, generationId);
    });
  }

  async reject(projectId: string, assetId: string, generationId: string): Promise<Project> {
    return this.mutate(projectId, (project) => {
      rejectGeneration(project, assetId, generationId);
    });
  }

  async unlock(projectId: string, assetId: string): Promise<Project> {
    return this.mutate(projectId, (project) => {
      unlockAsset(project, assetId);
    });
  }

  /** Editable delivery metadata (PRD §42). */
  async updateDelivery(
    projectId: string,
    delivery: { title?: string; description?: string; hashtags?: string[] },
  ): Promise<Project> {
    return this.mutate(projectId, (project) => {
      if (typeof delivery.title === 'string' && delivery.title.trim()) {
        project.delivery.title = delivery.title.trim().slice(0, 120);
      }
      if (typeof delivery.description === 'string') {
        project.delivery.description = delivery.description.trim().slice(0, 600);
      }
      if (Array.isArray(delivery.hashtags)) {
        project.delivery.hashtags = delivery.hashtags
          .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
          .slice(0, 15)
          .map((tag) => (tag.startsWith('#') ? tag.trim() : `#${tag.trim()}`));
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.repo.withLock(id, async () => {
      if (!(await this.repo.exists(id))) throw new DomainError(`Proyecto no encontrado: ${id}`, 404);
      await this.repo.delete(id);
    });
  }

  private async mutate(projectId: string, fn: (project: Project) => void): Promise<Project> {
    return this.repo.withLock(projectId, async () => {
      const project = await this.repo.load(projectId);
      fn(project);
      project.currentStage = computeCurrentStage(project);
      await this.repo.save(project);
      this.bus.publishProject(project);
      const last = project.events[project.events.length - 1];
      if (last) this.bus.publishEvent(project.id, last);
      return project;
    });
  }
}
