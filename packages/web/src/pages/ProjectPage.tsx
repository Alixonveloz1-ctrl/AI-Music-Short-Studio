import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FORMATIONS_BY_ID,
  INSTRUMENTS_BY_ID,
  PERFORMER_TYPES_BY_ID,
  SCENARIOS_BY_ID,
  VISUAL_STYLES_BY_ID,
  computeProductionStatus,
  formatTimecode,
  type ProductionStatus,
  type Project,
} from '@ams/shared';
import { api, ApiError, subscribeToProject } from '../lib/api';
import { StatusBoard } from '../components/StatusBoard';
import { AssetReview } from '../components/AssetReview';
import { PlanPanel } from '../components/PlanPanel';
import { FinalCutPanel } from '../components/FinalCutPanel';

type Tab = 'review' | 'plan' | 'edit';

export function ProjectPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [missingForEdit, setMissingForEdit] = useState<string[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('review');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const autoSelect = useRef(true);

  const refresh = useCallback(async () => {
    const payload = await api.getProject(projectId);
    setProject(payload.project);
    setMissingForEdit(payload.status.missingForEdit ?? []);
    return payload.project;
  }, [projectId]);

  useEffect(() => {
    refresh().catch((e: unknown) =>
      setLoadError(e instanceof Error ? e.message : `No se pudo abrir el proyecto: ${String(e)}`),
    );
  }, [refresh]);

  // Live updates: a generation that finishes in the background lands here.
  useEffect(() => {
    return subscribeToProject(projectId, (event) => {
      if (event.type === 'project') {
        setProject(event.project);
      }
    });
  }, [projectId]);

  const status: ProductionStatus | null = useMemo(
    () => (project ? computeProductionStatus(project) : null),
    [project],
  );

  // Follow the production automatically until the user picks something.
  useEffect(() => {
    if (!status || !autoSelect.current) return;
    if (status.nextActionableAssetId) setSelectedAssetId(status.nextActionableAssetId);
  }, [status]);

  const selectedAsset = useMemo(
    () => project?.assets.find((a) => a.id === selectedAssetId) ?? null,
    [project, selectedAssetId],
  );

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        await refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  if (loadError) {
    return (
      <main className="room">
        <div className="panel error-panel">
          <h2>No se pudo abrir el proyecto</h2>
          <p>{loadError}</p>
          <a className="link" href="#/">
            Volver al inicio
          </a>
        </div>
      </main>
    );
  }

  if (!project || !status) {
    return (
      <main className="room">
        <div className="panel">Cargando la sala de producción…</div>
      </main>
    );
  }

  const config = project.config;
  const instruments = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id)?.name)
    .filter(Boolean)
    .join(' + ');

  return (
    <main className="room">
      <header className="room-header">
        <div>
          <p className="eyebrow">Production Room</p>
          <h1>{project.delivery.title}</h1>
          <p className="facts">
            <span>Duración: {formatTimecode(config.durationSec)}</span>
            <span>Estilo: {VISUAL_STYLES_BY_ID.get(config.visualStyleId)?.label}</span>
            <span>Instrumento: {instruments}</span>
            <span>Intérprete: {PERFORMER_TYPES_BY_ID.get(config.performerTypeId)?.label}</span>
            <span>Formación: {FORMATIONS_BY_ID.get(config.formationId)?.label}</span>
            <span>Escenario: {SCENARIOS_BY_ID.get(config.scenarioId)?.label}</span>
          </p>
        </div>
        <nav className="tabs">
          <button className={tab === 'review' ? 'tab active' : 'tab'} onClick={() => setTab('review')}>
            Revisión
          </button>
          <button className={tab === 'plan' ? 'tab active' : 'tab'} onClick={() => setTab('plan')}>
            Plan
          </button>
          <button className={tab === 'edit' ? 'tab active' : 'tab'} onClick={() => setTab('edit')}>
            Montaje
          </button>
          <a className="tab" href="#/proyectos">
            Proyectos
          </a>
        </nav>
      </header>

      {error && <div className="panel error-panel room-error">{error}</div>}

      <div className="room-body">
        <StatusBoard
          project={project}
          status={status}
          selectedAssetId={selectedAssetId}
          onSelect={(id) => {
            autoSelect.current = false;
            setSelectedAssetId(id);
            setTab('review');
          }}
        />

        <div className="room-main">
          {tab === 'review' &&
            (selectedAsset ? (
              <AssetReview
                project={project}
                asset={selectedAsset}
                busy={busy}
                onGenerate={(assetId, unlock) =>
                  run(() => api.generate(project.id, assetId, { unlock }))
                }
                onApprove={(assetId, generationId) =>
                  run(() => api.approve(project.id, assetId, generationId))
                }
                onReject={(assetId, generationId) =>
                  run(() => api.reject(project.id, assetId, generationId))
                }
              />
            ) : (
              <section className="review">
                <h2>Producción completa</h2>
                <p className="muted">
                  Todos los activos están aprobados. Pasa a la pestaña «Montaje» para ver el corto
                  completo y exportarlo.
                </p>
              </section>
            ))}

          {tab === 'plan' && <PlanPanel project={project} />}

          {tab === 'edit' && (
            <FinalCutPanel
              project={project}
              missingForEdit={missingForEdit}
              busy={busy}
              onAssemble={() => run(() => api.assemble(project.id))}
              onApprove={() => run(() => api.approveFinal(project.id))}
              onReopen={(reason) => run(() => api.reopen(project.id, reason))}
              onExport={() => run(() => api.exportFinal(project.id))}
              onSaveDelivery={(delivery) => run(() => api.updateDelivery(project.id, delivery))}
            />
          )}
        </div>
      </div>

      <footer className="room-footer">
        <h3>Actividad</h3>
        <ul className="events">
          {project.events
            .slice(-14)
            .reverse()
            .map((event) => (
              <li key={event.id}>
                <span className="muted">
                  {new Date(event.at).toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                {event.message}
              </li>
            ))}
        </ul>
      </footer>
    </main>
  );
}
