import type { ProductionStatus, Project } from '@ams/shared';
import { ASSET_STATUS_LABELS, STAGE_LABELS } from '@ams/shared';

const STATE_MARK: Record<'pending' | 'active' | 'complete', string> = {
  pending: '○',
  active: '●',
  complete: '✓',
};

const ROW_MARK: Record<string, string> = {
  pending: '○',
  generating: '◐',
  review: '●',
  approved: '✓',
};

export function StatusBoard({
  project,
  status,
  selectedAssetId,
  onSelect,
}: {
  project: Project;
  status: ProductionStatus;
  selectedAssetId: string | null;
  onSelect: (assetId: string) => void;
}) {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));

  return (
    <aside className="board">
      <section>
        <h3>Producción</h3>
        <ul className="stage-list">
          {status.stages.map((stage) => (
            <li key={stage.stage} className={`stage ${stage.state}`}>
              <span className="mark">{STATE_MARK[stage.state]}</span>
              <span className="stage-name">{STAGE_LABELS[stage.stage]}</span>
              {stage.total > 0 && (
                <span className="counter">
                  {stage.approved}/{stage.total}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3>Estado de los activos</h3>
        <ul className="asset-list">
          {status.rows.map((row) => {
            const asset = assetsById.get(row.assetId);
            const generations = asset?.generations.length ?? 0;
            return (
              <li key={row.assetId}>
                <button
                  type="button"
                  className={[
                    'asset-row',
                    row.status,
                    row.stale ? 'stale' : '',
                    selectedAssetId === row.assetId ? 'selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onSelect(row.assetId)}
                >
                  <span className="mark">{ROW_MARK[row.status] ?? '○'}</span>
                  <span className="asset-name">{row.label}</span>
                  <span className="asset-status">
                    {row.stale ? 'DESACTUALIZADO' : ASSET_STATUS_LABELS[row.status]}
                    {generations > 1 ? ` · ${generations} gen.` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
