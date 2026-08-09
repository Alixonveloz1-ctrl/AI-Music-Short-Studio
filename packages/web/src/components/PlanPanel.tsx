import { formatTimecode, type Project } from '@ams/shared';

/** Everything the AI production team decided, laid open for inspection. */
export function PlanPanel({ project }: { project: Project }) {
  const { plan } = project;
  const bible = plan.visualBible;

  return (
    <section className="plan">
      <div className="plan-block">
        <h3>Concepto</h3>
        <p className="lead">{plan.concept.logline}</p>
        <dl>
          <Row label="Intención" value={plan.concept.emotionalIntent} />
          <Row label="Arco emocional" value={plan.concept.emotionalArc} />
          <Row label="Atmósfera" value={plan.concept.mood.join(' · ')} />
          <Row label="Paleta" value={plan.concept.palette.join(' · ')} />
          <Row label="Luz" value={plan.concept.timeOfDay} />
          <Row
            label="Planificado por"
            value={plan.plannedBy === 'claude' ? 'Claude' : 'Equipo interno (determinista)'}
          />
        </dl>
      </div>

      <div className="plan-block">
        <h3>Biblia visual</h3>
        <dl>
          <Row label="Personaje" value={bible.character.summary} />
          <Row label="Rostro" value={bible.character.face} />
          <Row label="Cabello" value={bible.character.hair} />
          <Row label="Vestuario" value={bible.character.wardrobe} />
          <Row label="Complexión" value={bible.character.build} />
          <Row label="Instrumento" value={`${bible.instrument.names.join(' + ')} — ${bible.instrument.appearance}`} />
          <Row label="Posición" value={bible.instrument.positioning} />
          <Row label="Escenario" value={bible.environment.location} />
          <Row label="Elementos" value={bible.environment.primaryElements.join(', ')} />
          <Row label="Iluminación" value={`${bible.lighting.direction}; ${bible.lighting.intensity}`} />
          <Row label="Tratamiento" value={bible.aesthetic.treatment} />
        </dl>
        <h4>Reglas de continuidad</h4>
        <ul className="rules">
          {bible.continuityRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>

      <div className="plan-block">
        <h3>Plan de tomas</h3>
        <p className="muted">
          {plan.economics.uniqueShots} tomas únicas · {plan.economics.timelineSlots} bloques de
          montaje · {plan.economics.reusedSlots} reutilizaciones ·{' '}
          {plan.economics.generatedFootageSec}s de metraje generado para{' '}
          {plan.economics.runtimeSec}s de corto.
        </p>
        <table className="shots">
          <thead>
            <tr>
              <th>Toma</th>
              <th>Bloque</th>
              <th>Plano</th>
              <th>Cámara</th>
              <th>Dur.</th>
              <th>Clips</th>
              <th>Propósito</th>
            </tr>
          </thead>
          <tbody>
            {plan.shots.map((shot) => (
              <tr key={shot.id}>
                <td>{shot.label}</td>
                <td>{beatLabel(shot.beat)}</td>
                <td>{shot.shotType.replace(/_/g, ' ')}</td>
                <td>{shot.cameraMove.replace(/_/g, ' ')}</td>
                <td>{shot.durationSec}s</td>
                <td>{shot.clips.map((c) => c.suffix).join(', ')}</td>
                <td className="wide-cell">{shot.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="plan-block">
        <h3>Línea de tiempo</h3>
        <ol className="timeline">
          {plan.timeline.map((entry) => (
            <li key={`${entry.index}-${entry.clipId}`} className={entry.reused ? 'reused' : ''}>
              <span className="tc">{formatTimecode(entry.startSec)}</span>
              <span className="clip">{entry.clipId.replace(/_/g, ' ')}</span>
              <span className="dur">{entry.durationSec}s</span>
              <span className="transition">{transitionLabel(entry.transitionIn)}</span>
              {entry.reused && <span className="tag">reutilizado</span>}
            </li>
          ))}
        </ol>
      </div>

      <div className="plan-block">
        <h3>Música</h3>
        <dl>
          <Row label="Estilo" value={plan.music.style} />
          <Row label="Carácter" value={plan.music.mood} />
          <Row label="Tonalidad" value={`${plan.music.key} · ${plan.music.scale} · ${plan.music.tempoBpm} BPM`} />
          <Row label="Estructura" value={plan.music.structure} />
          <Row label="Instrumentación" value={plan.music.instrumentation.join(', ')} />
        </dl>
        <h3>Sonido ambiental</h3>
        <dl>
          <Row label="Capas" value={plan.ambient.layers.join(', ')} />
          <Row label="Descripción" value={plan.ambient.description} />
          <Row label="Acústica" value={plan.ambient.acoustics} />
        </dl>
      </div>

      <div className="plan-block">
        <h3>Notas del equipo</h3>
        <dl>
          <Row label="Director" value={plan.notes.director} />
          <Row label="Productor" value={plan.notes.producer} />
          <Row label="Dirección de arte" value={plan.notes.artDirector} />
          <Row label="Fotografía" value={plan.notes.cinematographer} />
          <Row label="Guion" value={plan.notes.screenwriter} />
          <Row label="Montaje" value={plan.notes.editor} />
        </dl>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="dl-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function beatLabel(beat: string): string {
  const map: Record<string, string> = {
    opening: 'apertura',
    development: 'desarrollo',
    climax: 'clímax',
    closing: 'cierre',
  };
  return map[beat] ?? beat;
}

function transitionLabel(transition: string): string {
  const map: Record<string, string> = {
    cut: 'corte',
    dip_to_black: 'fundido a negro',
    fade_in: 'fundido de entrada',
    fade_out: 'fundido de salida',
  };
  return map[transition] ?? transition;
}
