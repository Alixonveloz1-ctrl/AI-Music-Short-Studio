import { useState } from 'react';
import {
  ASSET_KIND_MEDIA,
  blockingDependencies,
  canGenerate,
  hasApprovedVersion,
  type Asset,
  type Generation,
  type Project,
} from '@ams/shared';

/**
 * The review surface for one asset (PRD §20, §26, §29).
 *
 * Everything here funnels into two buttons — REGENERAR and APROBAR — because
 * nothing moves forward without one of them being pressed.
 */
export function AssetReview({
  project,
  asset,
  busy,
  onGenerate,
  onApprove,
  onReject,
}: {
  project: Project;
  asset: Asset;
  busy: boolean;
  onGenerate: (assetId: string, unlock: boolean) => void;
  onApprove: (assetId: string, generationId: string) => void;
  onReject: (assetId: string, generationId: string) => void;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [viewedGenerationId, setViewedGenerationId] = useState<string | null>(null);

  const latest = asset.generations[asset.generations.length - 1];
  const approved = asset.generations.find((g) => g.id === asset.approvedGenerationId);
  const viewed =
    asset.generations.find((g) => g.id === viewedGenerationId) ?? latest ?? approved ?? null;

  const gate = canGenerate(project, asset);
  const blocking = blockingDependencies(project, asset);
  const media = ASSET_KIND_MEDIA[asset.kind];
  const isGenerating = asset.status === 'generating';
  const awaitingDecision = viewed?.status === 'review';

  return (
    <section className="review">
      <header className="review-header">
        <div>
          <p className="eyebrow">{mediaLabel(media)}</p>
          <h2>{asset.label}</h2>
          <p className="muted">{asset.spec.objective}</p>
        </div>
        <div className="review-badges">
          <span className={`badge ${asset.status}`}>{statusLabel(asset)}</span>
          {asset.locked && <span className="badge locked">BLOQUEADO</span>}
          {asset.stale && <span className="badge stale">DESACTUALIZADO</span>}
        </div>
      </header>

      {asset.stale && asset.staleReason && (
        <p className="notice warn">
          {asset.staleReason} Revisa este activo y vuelve a generarlo si ya no encaja.
        </p>
      )}

      {blocking.length > 0 && (
        <p className="notice">
          Este activo se apoya en material que todavía no está aprobado:{' '}
          <strong>{blocking.map((b) => b.label).join(', ')}</strong>.
        </p>
      )}

      <div className="preview">
        {isGenerating && (
          <div className="preview-empty generating">
            <span className="spinner" aria-hidden="true" />
            <p>Generando…</p>
            <p className="muted">
              La IA está trabajando. Cuando termine aparecerá aquí para que la revises.
            </p>
          </div>
        )}
        {!isGenerating && !viewed?.file && (
          <div className="preview-empty">
            <p>Todavía no hay ninguna generación.</p>
            <p className="muted">{asset.spec.objective}</p>
          </div>
        )}
        {!isGenerating && viewed?.file && <MediaPreview generation={viewed} media={media} />}
      </div>

      {viewed && (
        <div className="generation-line">
          <span>
            Generación #{viewed.index}
            {viewed.id === asset.approvedGenerationId ? ' · APROBADA' : ''}
            {viewed.status === 'rejected' ? ' · descartada' : ''}
            {viewed.status === 'failed' ? ' · falló' : ''}
          </span>
          <span className="muted">
            {viewed.provider.name} · {viewed.provider.model}
            {viewed.file?.durationSec ? ` · ${viewed.file.durationSec.toFixed(1)}s` : ''}
          </span>
        </div>
      )}

      {viewed?.error && <p className="notice error">{viewed.error}</p>}

      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy || isGenerating || (!gate.ok && !asset.locked)}
          onClick={() => onGenerate(asset.id, asset.locked)}
          title={!gate.ok ? gate.reason : undefined}
        >
          {asset.generations.length === 0 ? 'Generar' : 'Regenerar'}
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || !awaitingDecision}
          onClick={() => viewed && onApprove(asset.id, viewed.id)}
        >
          Aprobar
        </button>
        {awaitingDecision && (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => viewed && onReject(asset.id, viewed.id)}
          >
            Descartar
          </button>
        )}
      </div>

      {!gate.ok && !asset.locked && <p className="notice">{gate.reason}</p>}
      {asset.locked && (
        <p className="notice">
          Este activo está aprobado y bloqueado: es la versión oficial del proyecto. Al regenerarlo
          se desbloquea y el material que dependa de él quedará marcado como desactualizado.
        </p>
      )}

      <details className="prompt" open={showPrompt} onToggle={(e) => setShowPrompt(e.currentTarget.open)}>
        <summary>Ver el prompt utilizado</summary>
        <pre>{viewed?.prompt ?? asset.spec.prompt}</pre>
        {(viewed?.negativePrompt ?? asset.spec.negativePrompt) && (
          <>
            <h4>Prompt negativo</h4>
            <pre>{viewed?.negativePrompt ?? asset.spec.negativePrompt}</pre>
          </>
        )}
        {viewed && viewed.referenceAssetIds.length > 0 && (
          <>
            <h4>Referencias aprobadas utilizadas</h4>
            <ul className="ref-list">
              {viewed.referenceAssetIds.map((id) => (
                <li key={id}>{project.assets.find((a) => a.id === id)?.label ?? id}</li>
              ))}
            </ul>
          </>
        )}
        {asset.spec.continuityNotes.length > 0 && (
          <>
            <h4>Continuidad</h4>
            <ul className="ref-list">
              {asset.spec.continuityNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </>
        )}
      </details>

      {asset.generations.length > 0 && (
        <section className="history">
          <h3>Historial de generaciones</h3>
          <ul>
            {asset.generations
              .slice()
              .reverse()
              .map((generation) => (
                <li key={generation.id}>
                  <button
                    type="button"
                    className={[
                      'history-item',
                      generation.status,
                      viewed?.id === generation.id ? 'selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setViewedGenerationId(generation.id)}
                  >
                    <span>Generación #{generation.index}</span>
                    <span className="muted">{historyLabel(generation)}</span>
                  </button>
                </li>
              ))}
          </ul>
          {hasApprovedVersion(asset) && (
            <p className="muted">
              Solo la versión aprobada se usa en la producción; las demás se conservan como
              historial.
            </p>
          )}
        </section>
      )}
    </section>
  );
}

function MediaPreview({
  generation,
  media,
}: {
  generation: Generation;
  media: 'image' | 'video' | 'audio';
}) {
  const url = generation.file?.url;
  if (!url) return null;
  if (media === 'image') {
    return <img src={url} alt={`Generación ${generation.index}`} />;
  }
  if (media === 'video') {
    return <video src={url} controls playsInline preload="metadata" />;
  }
  return (
    <div className="audio-preview">
      <audio src={url} controls preload="metadata" />
      <p className="muted">Escucha la pieza completa antes de decidir.</p>
    </div>
  );
}

function mediaLabel(media: 'image' | 'video' | 'audio'): string {
  if (media === 'image') return 'Imagen generada';
  if (media === 'video') return 'Vídeo generado';
  return 'Audio generado';
}

function statusLabel(asset: Asset): string {
  if (asset.status === 'approved') return 'APROBADO';
  if (asset.status === 'review') return 'EN REVISIÓN';
  if (asset.status === 'generating') return 'GENERANDO';
  return 'PENDIENTE';
}

function historyLabel(generation: Generation): string {
  switch (generation.status) {
    case 'approved':
      return 'aprobada';
    case 'rejected':
      return 'descartada';
    case 'failed':
      return 'falló';
    case 'generating':
      return 'generando…';
    default:
      return 'en revisión';
  }
}
