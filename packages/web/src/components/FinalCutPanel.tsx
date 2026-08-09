import { useEffect, useState } from 'react';
import type { Project } from '@ams/shared';

/**
 * Edit, final preview, final approval and export (PRD §32–§34, §42).
 *
 * The export button does not exist until the user has approved the preview —
 * the gate is enforced on the server too, but the UI should not even suggest
 * skipping it.
 */
export function FinalCutPanel({
  project,
  missingForEdit,
  busy,
  onAssemble,
  onApprove,
  onReopen,
  onExport,
  onSaveDelivery,
}: {
  project: Project;
  missingForEdit: string[];
  busy: boolean;
  onAssemble: () => void;
  onApprove: () => void;
  onReopen: (reason: string) => void;
  onExport: () => void;
  onSaveDelivery: (delivery: { title: string; description: string; hashtags: string[] }) => void;
}) {
  const cut = project.finalCut;
  const ready = missingForEdit.length === 0;

  const [title, setTitle] = useState(project.delivery.title);
  const [description, setDescription] = useState(project.delivery.description);
  const [hashtags, setHashtags] = useState(project.delivery.hashtags.join(' '));

  useEffect(() => {
    setTitle(project.delivery.title);
    setDescription(project.delivery.description);
    setHashtags(project.delivery.hashtags.join(' '));
  }, [project.delivery.title, project.delivery.description, project.delivery.hashtags]);

  return (
    <section className="final">
      <div className="plan-block">
        <h3>Montaje</h3>
        {!ready && (
          <p className="notice">
            El editor solo recibe activos aprobados. Faltan por aprobar:{' '}
            <strong>{missingForEdit.slice(0, 8).join(', ')}</strong>
            {missingForEdit.length > 8 ? ` y ${missingForEdit.length - 8} más` : ''}.
          </p>
        )}
        {ready && cut.status === 'pending' && (
          <p className="muted">
            Todo está aprobado. Monta la previsualización para verla completa antes de exportar.
          </p>
        )}
        {cut.status === 'building' && <p className="muted">Montando el corto…</p>}
        {cut.status === 'failed' && <p className="notice error">{cut.error}</p>}

        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy || !ready || cut.status === 'building'}
            onClick={onAssemble}
          >
            {cut.preview ? 'Volver a montar' : 'Montar previsualización'}
          </button>
          {cut.status === 'review' && (
            <>
              <button type="button" className="primary" disabled={busy} onClick={onApprove}>
                Aprobar vídeo final
              </button>
              <button
                type="button"
                className="ghost"
                disabled={busy}
                onClick={() => onReopen('El usuario detectó un problema en la previsualización')}
              >
                Volver a edición
              </button>
            </>
          )}
          {(cut.status === 'approved' || cut.status === 'exported') && (
            <button type="button" className="primary" disabled={busy} onClick={onExport}>
              {cut.status === 'exported' ? 'Volver a exportar MP4' : 'Exportar MP4'}
            </button>
          )}
        </div>
      </div>

      {cut.preview && (
        <div className="plan-block">
          <h3>Previsualización final</h3>
          <video src={cut.preview.url} controls playsInline preload="metadata" className="final-video" />
          <p className="muted">
            {formatBytes(cut.preview.bytes)} · {Math.round(cut.preview.durationSec ?? 0)}s ·{' '}
            {cut.preview.width}×{cut.preview.height}
            {cut.builtAt ? ` · montado ${new Date(cut.builtAt).toLocaleString('es-ES')}` : ''}
          </p>
        </div>
      )}

      {cut.edl && cut.edl.length > 0 && (
        <div className="plan-block">
          <h3>Lista de cortes</h3>
          <ol className="timeline">
            {cut.edl.map((entry) => (
              <li key={entry.index} className={entry.reused ? 'reused' : ''}>
                <span className="tc">{entry.timecode}</span>
                <span className="clip">{entry.label}</span>
                <span className="dur">{entry.durationSec}s</span>
                {entry.reused && <span className="tag">reutilizado</span>}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="plan-block">
        <h3>Entrega</h3>
        <label>
          Título
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </label>
        <label>
          Descripción corta
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Hashtags
          <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
        </label>
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              onSaveDelivery({
                title,
                description,
                hashtags: hashtags.split(/[\s,]+/).filter(Boolean),
              })
            }
          >
            Guardar metadatos
          </button>
        </div>
      </div>

      {cut.export && (
        <div className="plan-block success">
          <h3>MP4 final</h3>
          <p>
            <a className="link" href={cut.export.url} download>
              Descargar {project.delivery.title}.mp4
            </a>{' '}
            <span className="muted">
              ({formatBytes(cut.export.bytes)} · {Math.round(cut.export.durationSec ?? 0)}s)
            </span>
          </p>
          <p className="muted">
            El proyecto guarda también <code>final/project_final.json</code> con el título, la
            descripción, los hashtags y la lista de cortes.
          </p>
        </div>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
