import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

let ffmpegChecked: boolean | null = null;

export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked !== null) return ffmpegChecked;
  try {
    await execFileAsync('ffmpeg', ['-version'], { maxBuffer: 1024 * 1024 });
    ffmpegChecked = true;
  } catch {
    ffmpegChecked = false;
  }
  return ffmpegChecked;
}

export async function requireFfmpeg(): Promise<void> {
  if (!(await hasFfmpeg())) {
    throw new FfmpegError(
      'ffmpeg no está disponible en el sistema. Instálalo para generar vídeo y exportar el MP4 final.',
      '',
    );
  }
}

export async function runFfmpeg(args: string[], timeoutMs = 20 * 60 * 1000): Promise<string> {
  await requireFfmpeg();
  try {
    const { stderr } = await execFileAsync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return stderr;
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    const stderr = err.stderr ?? '';
    const tail = stderr.split('\n').slice(-25).join('\n');
    throw new FfmpegError(`ffmpeg falló: ${tail || err.message || 'error desconocido'}`, stderr);
  }
}

export async function probeDurationSec(file: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        file,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function fileSize(file: string): Promise<number> {
  const info = await stat(file);
  return info.size;
}
