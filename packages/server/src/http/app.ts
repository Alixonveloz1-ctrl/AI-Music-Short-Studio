import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import {
  buildCatalog,
  computeProductionStatus,
  generateOptionsSchema,
  searchInstruments,
} from '@ams/shared';
import { REPO_ROOT, type AppConfig } from '../config.js';
import { ProjectRepository } from '../storage/repository.js';
import { buildProviders } from '../providers/registry.js';
import { ProjectEventBus } from '../services/events.js';
import { GenerationService } from '../services/generationService.js';
import { EditorService, missingApprovals } from '../services/editorService.js';
import { ProjectService } from '../services/projectService.js';
import { DomainError } from '../domain/stateMachine.js';
import { hasFfmpeg } from '../media/ffmpeg.js';

export interface Studio {
  app: express.Express;
  repo: ProjectRepository;
  projects: ProjectService;
  generation: GenerationService;
  editor: EditorService;
  bus: ProjectEventBus;
}

export function createStudio(config: AppConfig): Studio {
  const repo = new ProjectRepository(config.dataDir);
  const providers = buildProviders(config);
  const bus = new ProjectEventBus();
  const projects = new ProjectService(repo, config, bus);
  const generation = new GenerationService(repo, providers, config, bus);
  const editor = new EditorService(repo, bus);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();

  api.get('/health', async (_req, res) => {
    res.json({
      ok: true,
      providers: config.providers,
      planner: config.planner.apiKey ? config.planner.mode : 'heuristic',
      ffmpeg: await hasFfmpeg(),
    });
  });

  api.get('/catalog', (_req, res) => {
    res.json(buildCatalog());
  });

  api.get('/catalog/instruments', (req, res) => {
    const query = typeof req.query['q'] === 'string' ? req.query['q'] : '';
    const limit = Number.parseInt(String(req.query['limit'] ?? '30'), 10);
    res.json(searchInstruments(query, Number.isFinite(limit) ? Math.min(100, limit) : 30));
  });

  api.get(
    '/projects',
    wrap(async (_req, res) => {
      res.json(await projects.list());
    }),
  );

  api.post(
    '/projects',
    wrap(async (req, res) => {
      const result = await projects.create(req.body?.config ?? req.body);
      res.status(201).json({
        project: result.project,
        warnings: result.warnings,
        status: computeProductionStatus(result.project),
      });
    }),
  );

  api.get(
    '/projects/:id',
    wrap(async (req, res) => {
      const project = await projects.get(param(req, 'id'));
      res.json({
        project,
        status: { ...computeProductionStatus(project), missingForEdit: missingApprovals(project) },
      });
    }),
  );

  api.delete(
    '/projects/:id',
    wrap(async (req, res) => {
      await projects.delete(param(req, 'id'));
      res.status(204).end();
    }),
  );

  api.patch(
    '/projects/:id/delivery',
    wrap(async (req, res) => {
      const project = await projects.updateDelivery(param(req, 'id'), req.body ?? {});
      res.json({ project });
    }),
  );

  api.post(
    '/projects/:id/assets/:assetId/generate',
    wrap(async (req, res) => {
      const parsed = generateOptionsSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new DomainError('Opciones de generación no válidas', 400);
      const result = await generation.start(param(req, 'id'), param(req, 'assetId'), parsed.data);
      res.status(202).json({ generation: result.generation, project: result.project });
    }),
  );

  api.post(
    '/projects/:id/assets/:assetId/unlock',
    wrap(async (req, res) => {
      const project = await projects.unlock(param(req, 'id'), param(req, 'assetId'));
      res.json({ project });
    }),
  );

  api.post(
    '/projects/:id/assets/:assetId/generations/:generationId/approve',
    wrap(async (req, res) => {
      const project = await projects.approve(
        param(req, 'id'),
        param(req, 'assetId'),
        param(req, 'generationId'),
      );
      res.json({ project, status: computeProductionStatus(project) });
    }),
  );

  api.post(
    '/projects/:id/assets/:assetId/generations/:generationId/reject',
    wrap(async (req, res) => {
      const project = await projects.reject(
        param(req, 'id'),
        param(req, 'assetId'),
        param(req, 'generationId'),
      );
      res.json({ project, status: computeProductionStatus(project) });
    }),
  );

  api.post(
    '/projects/:id/edit/assemble',
    wrap(async (req, res) => {
      const project = await editor.assemble(param(req, 'id'));
      res.json({ project });
    }),
  );

  api.post(
    '/projects/:id/edit/approve',
    wrap(async (req, res) => {
      const project = await editor.approveFinal(param(req, 'id'));
      res.json({ project });
    }),
  );

  api.post(
    '/projects/:id/edit/reopen',
    wrap(async (req, res) => {
      const project = await editor.reopen(param(req, 'id'), String(req.body?.reason ?? ''));
      res.json({ project });
    }),
  );

  api.post(
    '/projects/:id/export',
    wrap(async (req, res) => {
      const project = await editor.exportFinal(param(req, 'id'));
      res.json({ project });
    }),
  );

  api.get('/projects/:id/stream', (req, res) => {
    const projectId = param(req, 'id');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': conectado\n\n');

    const send = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    const unsubscribe = bus.subscribe(projectId, send);
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);

    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
      res.end();
    });
  });

  app.use('/api', api);

  // Generated media is served straight out of the project directory.
  app.use(
    '/media',
    express.static(repo.projectsDir, {
      fallthrough: false,
      maxAge: '1h',
      setHeaders(res, filePath) {
        if (filePath.endsWith('.mp4')) res.setHeader('Accept-Ranges', 'bytes');
      },
    }),
  );

  // The built web app, when it exists (production single-process mode).
  const webDist = path.resolve(REPO_ROOT, 'packages', 'web', 'dist');
  app.use(express.static(webDist, { index: 'index.html', fallthrough: true }));
  app.get(/^(?!\/api|\/media).*/, (_req, res, next) => {
    res.sendFile(path.join(webDist, 'index.html'), (error) => {
      if (error) next();
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof DomainError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : 'Error interno';
    // eslint-disable-next-line no-console
    console.error('[ams] error no controlado:', error);
    res.status(500).json({ error: message });
  });

  return { app, repo, projects, generation, editor, bus };
}

type Handler = (req: Request, res: Response) => Promise<void>;

/**
 * Express types route params as possibly-undefined under
 * `noUncheckedIndexedAccess`; a missing one means the route itself is wrong,
 * so fail loudly rather than threading `undefined` into the domain.
 */
function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new DomainError(`Falta el parámetro de ruta "${name}"`, 400);
  }
  return value;
}

function wrap(handler: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}
