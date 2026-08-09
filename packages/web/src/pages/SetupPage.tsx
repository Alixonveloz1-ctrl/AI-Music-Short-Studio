import { useEffect, useMemo, useState } from 'react';
import type { Instrument, ProjectConfig } from '@ams/shared';
import { api, ApiError, type Catalog } from '../lib/api';
import { navigate } from '../lib/router';

const DEFAULTS = {
  formationId: 'solo',
  performerGenderId: 'female',
  performerTypeId: 'adult_woman',
  scenarioId: 'forest',
  visualStyleId: 'anime_cinematic',
  durationSec: 120 as 60 | 120 | 180,
};

export function SetupPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Instrument[]>([]);
  const [formationId, setFormationId] = useState(DEFAULTS.formationId);
  const [performerGenderId, setPerformerGenderId] = useState(DEFAULTS.performerGenderId);
  const [performerTypeId, setPerformerTypeId] = useState(DEFAULTS.performerTypeId);
  const [scenarioId, setScenarioId] = useState(DEFAULTS.scenarioId);
  const [scenarioCustom, setScenarioCustom] = useState('');
  const [visualStyleId, setVisualStyleId] = useState(DEFAULTS.visualStyleId);
  const [visualStyleCustom, setVisualStyleCustom] = useState('');
  const [durationSec, setDurationSec] = useState<60 | 120 | 180>(DEFAULTS.durationSec);
  const [creativeDirection, setCreativeDirection] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .catalog()
      .then((data) => {
        setCatalog(data);
        const erhu = data.instruments.find((i) => i.id === 'erhu');
        if (erhu) setSelected([erhu]);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  const results = useMemo(() => {
    if (!catalog) return [];
    const normalized = normalize(query);
    const pool = catalog.instruments;
    if (!normalized) return pool.slice(0, 18);
    return pool
      .filter((instrument) =>
        [instrument.name, instrument.id, ...instrument.aliases]
          .map(normalize)
          .some((value) => value.includes(normalized)),
      )
      .slice(0, 18);
  }, [catalog, query]);

  const performerTypes = useMemo(
    () => (catalog?.performerTypes ?? []).filter((t) => t.genderIds.includes(performerGenderId)),
    [catalog, performerGenderId],
  );

  useEffect(() => {
    if (performerTypes.length === 0) return;
    if (!performerTypes.some((t) => t.id === performerTypeId)) {
      setPerformerTypeId(performerTypes[0]!.id);
    }
  }, [performerTypes, performerTypeId]);

  const scenarioNeedsText = scenarioId === 'other';
  const styleNeedsText = visualStyleId === 'other';

  const canSubmit =
    selected.length > 0 &&
    (!scenarioNeedsText || scenarioCustom.trim().length > 0) &&
    (!styleNeedsText || visualStyleCustom.trim().length > 0) &&
    !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const config: ProjectConfig = {
      instrumentIds: selected.map((i) => i.id),
      formationId,
      performerGenderId,
      performerTypeId,
      scenarioId,
      scenarioCustom: scenarioCustom.trim() || undefined,
      visualStyleId,
      visualStyleCustom: visualStyleCustom.trim() || undefined,
      creativeDirection: creativeDirection.trim(),
      durationSec,
    };
    try {
      const result = await api.createProject(config);
      navigate({ name: 'project', id: result.project.id });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `No se pudo crear el corto: ${String(e)}`);
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="setup">
        <div className="panel error-panel">
          <h2>No se pudo cargar el catálogo</h2>
          <p>{loadError}</p>
          <p className="muted">¿Está el servidor en marcha? Prueba con <code>npm run dev</code>.</p>
        </div>
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="setup">
        <div className="panel">Cargando catálogo…</div>
      </main>
    );
  }

  return (
    <main className="setup">
      <header className="setup-header">
        <h1>AI Music Short Studio</h1>
        <p>
          Define tu corto musical. El equipo de producción IA preparará el concepto, la dirección,
          el universo visual y el plan de tomas — y tú aprobarás cada activo antes de que pase a la
          siguiente etapa.
        </p>
      </header>

      <section className="panel">
        <h2><span className="step">1</span> Instrumento</h2>
        <input
          className="search"
          type="search"
          placeholder="Buscar instrumento… (erhu, guzheng, violonchelo, taiko)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Buscar instrumento"
        />
        {selected.length > 0 && (
          <div className="chips" aria-label="Instrumentos seleccionados">
            {selected.map((instrument) => (
              <button
                key={instrument.id}
                type="button"
                className="chip"
                onClick={() => setSelected((prev) => prev.filter((i) => i.id !== instrument.id))}
                title="Quitar"
              >
                {instrument.name} <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}
        <ul className="instrument-list">
          {results.map((instrument) => {
            const isSelected = selected.some((i) => i.id === instrument.id);
            const category = catalog.instrumentCategories.find(
              (c) => c.id === instrument.categoryId,
            );
            return (
              <li key={instrument.id}>
                <button
                  type="button"
                  className={isSelected ? 'instrument selected' : 'instrument'}
                  onClick={() =>
                    setSelected((prev) =>
                      isSelected
                        ? prev.filter((i) => i.id !== instrument.id)
                        : prev.length >= 8
                          ? prev
                          : [...prev, instrument],
                    )
                  }
                >
                  <strong>{instrument.name}</strong>
                  <span className="muted">{category?.label}</span>
                </button>
              </li>
            );
          })}
          {results.length === 0 && <li className="muted">Ningún instrumento coincide con «{query}».</li>}
        </ul>
      </section>

      <section className="panel">
        <h2><span className="step">2</span> Formación</h2>
        <div className="grid-2">
          <label>
            Formación musical
            <select value={formationId} onChange={(e) => setFormationId(e.target.value)}>
              {catalog.formations.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>Intérprete</legend>
            <div className="radios">
              {catalog.performerGenders.map((gender) => (
                <label key={gender.id} className="radio">
                  <input
                    type="radio"
                    name="gender"
                    value={gender.id}
                    checked={performerGenderId === gender.id}
                    onChange={() => setPerformerGenderId(gender.id)}
                  />
                  {gender.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <fieldset>
          <legend>Tipo visual</legend>
          <div className="radios">
            {performerTypes.map((type) => (
              <label key={type.id} className="radio">
                <input
                  type="radio"
                  name="performerType"
                  value={type.id}
                  checked={performerTypeId === type.id}
                  onChange={() => setPerformerTypeId(type.id)}
                />
                {type.label}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="panel">
        <h2><span className="step">3</span> Escenario</h2>
        <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
          {catalog.scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <textarea
          rows={2}
          placeholder={
            scenarioNeedsText
              ? 'Describe el escenario personalizado (obligatorio)'
              : 'Opcional: matiza el escenario (por ejemplo, «bosque de bambú con niebla baja»)'
          }
          value={scenarioCustom}
          onChange={(e) => setScenarioCustom(e.target.value)}
        />
      </section>

      <section className="panel">
        <h2><span className="step">4</span> Estilo visual</h2>
        <select value={visualStyleId} onChange={(e) => setVisualStyleId(e.target.value)}>
          {catalog.visualStyles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <textarea
          rows={2}
          placeholder={
            styleNeedsText
              ? 'Describe el estilo personalizado (obligatorio)'
              : 'Opcional: instrucciones de estilo adicionales'
          }
          value={visualStyleCustom}
          onChange={(e) => setVisualStyleCustom(e.target.value)}
        />
      </section>

      <section className="panel">
        <h2><span className="step">5</span> Duración</h2>
        <div className="duration-group">
          {catalog.durations.map((option) => (
            <button
              key={option.seconds}
              type="button"
              className={durationSec === option.seconds ? 'duration selected' : 'duration'}
              onClick={() => setDurationSec(option.seconds as 60 | 120 | 180)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2><span className="step">6</span> Dirección creativa</h2>
        <p className="muted">
          Escribe libremente. No hace falta que sea un prompt técnico: apariencia, vestuario,
          ambiente, iluminación, época, colores, intención emocional… El equipo de producción lo
          traducirá a instrucciones.
        </p>
        <textarea
          rows={6}
          placeholder="Describe libremente lo que quieres…"
          value={creativeDirection}
          onChange={(e) => setCreativeDirection(e.target.value)}
        />
      </section>

      {error && <div className="panel error-panel">{error}</div>}

      <div className="submit-row">
        <button type="button" className="primary big" disabled={!canSubmit} onClick={submit}>
          {submitting ? 'Preparando la producción…' : 'Crear corto'}
        </button>
        <a className="link" href="#/proyectos">
          Ver proyectos existentes
        </a>
      </div>
    </main>
  );
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
