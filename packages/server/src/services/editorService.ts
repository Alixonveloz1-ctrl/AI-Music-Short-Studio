/**
 * The Editor (PRD §32–§34, §42).
 *
 * Receives *only* approved assets, lays them out on the planned timeline —
 * replaying approved footage where the Producer planned a reuse (§33) — mixes
 * the approved music under the approved ambience, and renders a preview the
 * user has to sign off before anything is exported.
 */
import { writeFile } from 'node:fs/promises';
import {
  OUTPUT_FPS,
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  computeCurrentStage,
  formatTimecode,
  hasApprovedVersion,
  type FileRef,
  type Project,
} from '@ams/shared';
import { ProjectRepository } from '../storage/repository.js';
import { DomainError, approvedGenerationOf, getAsset, makeEventAndPush } from '../domain/index.js';
import { EXPORT_FILE, FINAL_DIR, METADATA_FILE, PREVIEW_FILE, assetUrl } from '../storage/paths.js';
import { fileSize, probeDurationSec, runFfmpeg } from '../media/ffmpeg.js';
import { AMBIENT_ASSET_ID, MUSIC_ASSET_ID } from '../domain/project.js';
import type { ProjectEventBus } from './events.js';

const DIP_SEC = 0.35;
const OPENING_FADE_SEC = 1.0;
const CLOSING_FADE_SEC = 1.4;
const MUSIC_GAIN = 0.92;
const AMBIENT_GAIN = 0.24;

export class EditorService {
  constructor(
    private readonly repo: ProjectRepository,
    private readonly bus: ProjectEventBus,
  ) {}

  async assemble(projectId: string): Promise<Project> {
    return this.repo.withLock(projectId, async () => {
      const project = await this.repo.load(projectId);
      const missing = missingApprovals(project);
      if (missing.length > 0) {
        throw new DomainError(
          `El montaje solo puede usar activos aprobados. Faltan: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}`,
          409,
        );
      }

      project.finalCut = { ...project.finalCut, status: 'building', error: undefined };
      makeEventAndPush(project, 'cut_building', 'Montando la previsualización con los activos aprobados…');
      await this.repo.save(project);
      this.publish(project);

      try {
        const { file, edl, builtFrom } = await this.render(project, PREVIEW_FILE);
        project.finalCut = {
          status: 'review',
          preview: file,
          export: project.finalCut.export,
          builtFrom,
          builtAt: new Date().toISOString(),
          edl,
        };
        makeEventAndPush(
          project,
          'cut_ready',
          `Previsualización lista: ${edl.length} cortes, ${formatTimecode(project.config.durationSec)}.`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        project.finalCut = { ...project.finalCut, status: 'failed', error: message };
        makeEventAndPush(project, 'cut_failed', `El montaje falló: ${message}`);
        await this.repo.save(project);
        this.publish(project);
        throw error instanceof DomainError ? error : new DomainError(message, 500);
      }

      project.currentStage = computeCurrentStage(project);
      await this.repo.save(project);
      this.publish(project);
      return project;
    });
  }

  /** Final approval gate (PRD §34): nothing is exported without it. */
  async approveFinal(projectId: string): Promise<Project> {
    return this.repo.withLock(projectId, async () => {
      const project = await this.repo.load(projectId);
      if (project.finalCut.status !== 'review') {
        throw new DomainError(
          'Solo se puede aprobar una previsualización que esté en revisión. Vuelve a montar el corto.',
          409,
        );
      }
      project.finalCut.status = 'approved';
      project.finalCut.approvedAt = new Date().toISOString();
      makeEventAndPush(project, 'cut_approved', 'El usuario aprobó el montaje final.');
      project.currentStage = computeCurrentStage(project);
      await this.repo.save(project);
      this.publish(project);
      return project;
    });
  }

  /** Send the approved cut back to editing (PRD §34). */
  async reopen(projectId: string, reason: string): Promise<Project> {
    return this.repo.withLock(projectId, async () => {
      const project = await this.repo.load(projectId);
      project.finalCut = { ...project.finalCut, status: 'pending', approvedAt: undefined };
      makeEventAndPush(project, 'cut_failed', `Vuelta a edición: ${reason || 'revisión solicitada por el usuario'}`);
      project.currentStage = computeCurrentStage(project);
      await this.repo.save(project);
      this.publish(project);
      return project;
    });
  }

  async exportFinal(projectId: string): Promise<Project> {
    return this.repo.withLock(projectId, async () => {
      const project = await this.repo.load(projectId);
      if (project.finalCut.status !== 'approved' && project.finalCut.status !== 'exported') {
        throw new DomainError('Aprueba el montaje final antes de exportar el MP4.', 409);
      }
      const preview = project.finalCut.preview;
      if (!preview) throw new DomainError('No hay previsualización que exportar.', 409);

      await this.repo.ensureDir(projectId, FINAL_DIR);
      const previewPath = this.repo.absolutePath(projectId, preview.path);
      const exportRelative = `${FINAL_DIR}/${EXPORT_FILE}`;
      const exportPath = this.repo.absolutePath(projectId, exportRelative);

      // Stream copy: the approved preview *is* the film; this only rewrites the
      // container so the MP4 is streamable.
      await runFfmpeg(['-i', previewPath, '-c', 'copy', '-movflags', '+faststart', exportPath]);

      const metadataRelative = `${FINAL_DIR}/${METADATA_FILE}`;
      const metadata = {
        title: project.delivery.title,
        description: project.delivery.description,
        hashtags: project.delivery.hashtags,
        durationSec: project.config.durationSec,
        resolution: `${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}`,
        fps: OUTPUT_FPS,
        approvedAt: project.finalCut.approvedAt,
        exportedAt: new Date().toISOString(),
        edl: project.finalCut.edl,
        economics: project.plan.economics,
      };
      await writeFile(
        this.repo.absolutePath(projectId, metadataRelative),
        JSON.stringify(metadata, null, 2),
        'utf8',
      );

      project.finalCut.status = 'exported';
      project.finalCut.export = {
        path: exportRelative,
        url: assetUrl(projectId, exportRelative),
        mimeType: 'video/mp4',
        bytes: await fileSize(exportPath),
        durationSec: (await probeDurationSec(exportPath)) ?? project.config.durationSec,
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
      };
      makeEventAndPush(project, 'exported', `MP4 final exportado: ${project.delivery.title}`);
      project.currentStage = computeCurrentStage(project);
      await this.repo.save(project);
      this.publish(project);
      return project;
    });
  }

  private async render(
    project: Project,
    outputName: string,
  ): Promise<{ file: FileRef; edl: NonNullable<Project['finalCut']['edl']>; builtFrom: Record<string, string> }> {
    const entries = project.plan.timeline;
    if (entries.length === 0) throw new DomainError('El plan no tiene línea de tiempo.', 500);

    await this.repo.ensureDir(project.id, FINAL_DIR);
    const outRelative = `${FINAL_DIR}/${outputName}`;
    const outPath = this.repo.absolutePath(project.id, outRelative);

    const builtFrom: Record<string, string> = {};
    const inputs: string[] = [];
    const filters: string[] = [];
    const labels: string[] = [];
    const totalSec = entries.reduce((sum, e) => sum + e.durationSec, 0);

    entries.forEach((entry, index) => {
      const asset = getAsset(project, entry.clipAssetId);
      const generation = approvedGenerationOf(asset);
      if (!generation?.file) {
        throw new DomainError(`El clip "${asset.label}" no tiene versión aprobada.`, 409);
      }
      builtFrom[asset.id] = generation.id;
      inputs.push('-i', this.repo.absolutePath(project.id, generation.file.path));

      const isFirst = index === 0;
      const isLast = index === entries.length - 1;
      const next = entries[index + 1];
      const chain = [
        `trim=start=0:duration=${entry.durationSec.toFixed(3)}`,
        'setpts=PTS-STARTPTS',
        `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease`,
        `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
        'setsar=1',
        `fps=${OUTPUT_FPS}`,
      ];
      if (isFirst) {
        chain.push(`fade=t=in:st=0:d=${OPENING_FADE_SEC}`);
      } else if (entry.transitionIn === 'dip_to_black') {
        chain.push(`fade=t=in:st=0:d=${DIP_SEC}`);
      }
      if (isLast) {
        chain.push(
          `fade=t=out:st=${Math.max(0, entry.durationSec - CLOSING_FADE_SEC).toFixed(3)}:d=${CLOSING_FADE_SEC}`,
        );
      } else if (next?.transitionIn === 'dip_to_black') {
        chain.push(
          `fade=t=out:st=${Math.max(0, entry.durationSec - DIP_SEC).toFixed(3)}:d=${DIP_SEC}`,
        );
      }
      filters.push(`[${index}:v]${chain.join(',')}[v${index}]`);
      labels.push(`[v${index}]`);
    });

    filters.push(`${labels.join('')}concat=n=${entries.length}:v=1:a=0[vout]`);

    const musicAsset = getAsset(project, MUSIC_ASSET_ID);
    const ambientAsset = getAsset(project, AMBIENT_ASSET_ID);
    const musicGen = approvedGenerationOf(musicAsset);
    const ambientGen = approvedGenerationOf(ambientAsset);
    if (!musicGen?.file) throw new DomainError('No hay música aprobada.', 409);
    if (!ambientGen?.file) throw new DomainError('No hay sonido ambiental aprobado.', 409);
    builtFrom[musicAsset.id] = musicGen.id;
    builtFrom[ambientAsset.id] = ambientGen.id;

    const musicIndex = entries.length;
    const ambientIndex = entries.length + 1;
    inputs.push('-i', this.repo.absolutePath(project.id, musicGen.file.path));
    inputs.push('-i', this.repo.absolutePath(project.id, ambientGen.file.path));

    filters.push(
      `[${musicIndex}:a]apad,atrim=0:${totalSec},asetpts=PTS-STARTPTS,volume=${MUSIC_GAIN}[amus]`,
    );
    filters.push(
      `[${ambientIndex}:a]apad,atrim=0:${totalSec},asetpts=PTS-STARTPTS,volume=${AMBIENT_GAIN}[aamb]`,
    );
    filters.push(
      `[amus][aamb]amix=inputs=2:duration=first:normalize=0,` +
        `afade=t=in:st=0:d=${OPENING_FADE_SEC},` +
        `afade=t=out:st=${Math.max(0, totalSec - CLOSING_FADE_SEC).toFixed(3)}:d=${CLOSING_FADE_SEC},` +
        `alimiter=limit=0.95[aout]`,
    );

    await runFfmpeg([
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(OUTPUT_FPS),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-t',
      String(totalSec),
      '-movflags',
      '+faststart',
      outPath,
    ]);

    const edl = entries.map((entry) => {
      const asset = getAsset(project, entry.clipAssetId);
      return {
        index: entry.index + 1,
        timecode: formatTimecode(entry.startSec),
        label: asset.label,
        durationSec: entry.durationSec,
        reused: entry.reused,
      };
    });

    return {
      file: {
        path: outRelative,
        url: assetUrl(project.id, outRelative),
        mimeType: 'video/mp4',
        bytes: await fileSize(outPath),
        durationSec: (await probeDurationSec(outPath)) ?? totalSec,
        width: OUTPUT_WIDTH,
        height: OUTPUT_HEIGHT,
      },
      edl,
      builtFrom,
    };
  }

  private publish(project: Project): void {
    this.bus.publishProject(project);
    const last = project.events[project.events.length - 1];
    if (last) this.bus.publishEvent(project.id, last);
  }
}

/** Assets the Editor still needs before it can build a cut. */
export function missingApprovals(project: Project): string[] {
  const missing: string[] = [];
  const byId = new Map(project.assets.map((a) => [a.id, a] as const));
  for (const entry of project.plan.timeline) {
    const asset = byId.get(entry.clipAssetId);
    if (!asset) {
      missing.push(`Clip ${entry.clipId}`);
      continue;
    }
    if (!hasApprovedVersion(asset) || asset.stale) missing.push(asset.label);
  }
  for (const id of [MUSIC_ASSET_ID, AMBIENT_ASSET_ID]) {
    const asset = byId.get(id);
    if (!asset) continue;
    if (!hasApprovedVersion(asset) || asset.stale) missing.push(asset.label);
  }
  return Array.from(new Set(missing));
}
