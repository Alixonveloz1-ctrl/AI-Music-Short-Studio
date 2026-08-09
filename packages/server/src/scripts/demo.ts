/**
 * End-to-end offline production run.
 *
 * Drives one project through the exact same services the web app calls:
 * plan -> generate -> review -> approve -> assemble -> approve -> export.
 * The "user" here approves everything on the first take; the point is to prove
 * the whole pipeline produces a real MP4 with no cloud credentials.
 *
 *   npm run demo -- --duration 60
 */
import { hasApprovedVersion, formatTimecode, type Project } from '@ams/shared';
import { loadConfig } from '../config.js';
import { createStudio } from '../http/app.js';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const durationSec = Number.parseInt(arg('duration', '60'), 10) as 60 | 120 | 180;

const config = loadConfig();
const studio = createStudio(config);
await studio.repo.init();

const started = Date.now();

const { project: created, warnings } = await studio.projects.create({
  instrumentIds: [arg('instrument', 'erhu')],
  formationId: 'solo',
  performerGenderId: 'female',
  performerTypeId: 'adult_woman',
  scenarioId: arg('scenario', 'forest'),
  visualStyleId: arg('style', 'anime_cinematic'),
  creativeDirection:
    'Una intérprete solitaria al amanecer. Quiero sensación de calma, niebla baja entre los árboles y luz dorada muy suave. Nada épico: intimidad.',
  durationSec,
});

for (const warning of warnings) console.log(`aviso: ${warning}`);

console.log(`\nProyecto ${created.id} — "${created.plan.concept.title}"`);
console.log(
  `Plan: ${created.plan.shots.length} tomas únicas · ${created.plan.timeline.length} cortes · ` +
    `${created.plan.economics.reusedSlots} reutilizaciones · ` +
    `${created.plan.economics.generatedFootageSec}s de metraje para ${created.plan.economics.runtimeSec}s de montaje`,
);
console.log(`Planificador: ${created.plan.plannedBy}\n`);

let project: Project = created;
let generated = 0;

// The studio only ever opens the next stage once the previous one is fully
// approved, so walking the asset list in order mirrors what a user would do.
for (const asset of [...project.assets].sort((a, b) => a.order - b.order)) {
  process.stdout.write(`  ${asset.label.padEnd(38)} `);
  project = await studio.generation.startAndWait(project.id, asset.id);
  const current = project.assets.find((a) => a.id === asset.id);
  const generation = current?.generations[current.generations.length - 1];
  if (!generation) throw new Error(`No se generó nada para ${asset.id}`);
  if (generation.status === 'failed') {
    console.log(`FALLÓ — ${generation.error}`);
    process.exit(1);
  }
  generated += 1;
  // This is the human decision point; the demo always says yes.
  project = await studio.projects.approve(project.id, asset.id, generation.id);
  const seconds = ((generation.elapsedMs ?? 0) / 1000).toFixed(1);
  console.log(`aprobado (gen #${generation.index}, ${seconds}s, ${formatFileSize(generation.file?.bytes ?? 0)})`);
}

const notApproved = project.assets.filter((a) => !hasApprovedVersion(a));
if (notApproved.length > 0) {
  console.error(`Quedan activos sin aprobar: ${notApproved.map((a) => a.label).join(', ')}`);
  process.exit(1);
}

console.log('\nMontando…');
project = await studio.editor.assemble(project.id);
console.log(`Previsualización: ${project.finalCut.preview?.path} (${formatFileSize(project.finalCut.preview?.bytes ?? 0)})`);

console.log('\nLista de cortes:');
for (const cut of project.finalCut.edl ?? []) {
  console.log(
    `  ${cut.timecode}  ${cut.label.padEnd(34)} ${String(cut.durationSec).padStart(2)}s${cut.reused ? '  [reutilizado]' : ''}`,
  );
}

project = await studio.editor.approveFinal(project.id);
project = await studio.editor.exportFinal(project.id);

console.log(`\nMP4 final: ${studio.repo.absolutePath(project.id, project.finalCut.export!.path)}`);
console.log(`Duración:  ${formatTimecode(project.finalCut.export?.durationSec ?? 0)}`);
console.log(`Tamaño:    ${formatFileSize(project.finalCut.export?.bytes ?? 0)}`);
console.log(`\nTítulo:      ${project.delivery.title}`);
console.log(`Descripción: ${project.delivery.description}`);
console.log(`Hashtags:    ${project.delivery.hashtags.join(' ')}`);
console.log(
  `\n${generated} activos generados y aprobados en ${((Date.now() - started) / 1000).toFixed(1)}s`,
);

function formatFileSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
