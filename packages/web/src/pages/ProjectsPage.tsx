import { useEffect, useState } from 'react';
import { STAGE_LABELS, formatTimecode, type ProjectSummary } from '@ams/shared';
import { api } from '../lib/api';

const CUT_LABELS: Record<string, string> = {
  pending: 'sin montar',
  building: 'montando',
  review: 'previsualización en revisión',
  approved: 'montaje aprobado',
  exported: 'MP4 exportado',
  failed: 'montaje con error',
};

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function remove(id: string) {
    if (!window.confirm('¿Eliminar este proyecto y todas sus generaciones? No se puede deshacer.')) {
      return;
    }
    await api.deleteProject(id);
    setProjects((prev) => prev?.filter((p) => p.id !== id) ?? null);
  }

  return (
    <main className="setup">
      <header className="setup-header">
        <h1>Proyectos</h1>
        <p>
          Cada proyecto conserva su plan, todas sus generaciones y el montaje final.{' '}
          <a className="link" href="#/">
            Crear un corto nuevo
          </a>
        </p>
      </header>

      {error && <div className="panel error-panel">{error}</div>}
      {!projects && !error && <div className="panel">Cargando…</div>}
      {projects?.length === 0 && (
        <div className="panel">
          Todavía no hay ningún proyecto.{' '}
          <a className="link" href="#/">
            Crea el primero
          </a>
          .
        </div>
      )}

      <ul className="project-list">
        {projects?.map((project) => (
          <li key={project.id} className="panel project-card">
            <div>
              <a className="project-title" href={`#/proyecto/${project.id}`}>
                {project.title}
              </a>
              <p className="muted">
                {formatTimecode(project.durationSec)} · etapa actual:{' '}
                {STAGE_LABELS[project.currentStage]} · {project.approvedAssets}/
                {project.totalAssets} activos aprobados ·{' '}
                {CUT_LABELS[project.finalCutStatus] ?? project.finalCutStatus}
              </p>
              <p className="muted small">
                Actualizado {new Date(project.updatedAt).toLocaleString('es-ES')}
              </p>
            </div>
            <button type="button" className="ghost" onClick={() => remove(project.id)}>
              Eliminar
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
