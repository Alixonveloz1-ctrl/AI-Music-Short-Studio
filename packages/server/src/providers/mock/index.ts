/**
 * Offline generation providers.
 *
 * These are not a stub that returns a fixed file: they synthesise a distinct
 * still per shot, animate it into a real MP4 with the shot's planned camera
 * move, and compose an actual instrumental piece and ambience bed. That makes
 * the review loop — look at it, listen to it, approve it or regenerate it —
 * meaningful with no cloud account attached.
 */
import { writeFile } from 'node:fs/promises';
import type { CameraMove, ProviderInfo } from '@ams/shared';
import { renderStill } from '../../media/procedural.js';
import { renderAmbient, renderMusic } from '../../media/synth.js';
import { fileSize, probeDurationSec, runFfmpeg } from '../../media/ffmpeg.js';
import {
  ProviderError,
  type AmbientProvider,
  type AmbientRequest,
  type ImageProvider,
  type ImageRequest,
  type MusicProvider,
  type MusicRequest,
  type ProviderResult,
  type VideoProvider,
  type VideoRequest,
} from '../types.js';

const IMAGE_INFO: ProviderInfo = { name: 'studio-offline', model: 'procedural-still-v1', mode: 'mock' };
const VIDEO_INFO: ProviderInfo = { name: 'studio-offline', model: 'ken-burns-v1', mode: 'mock' };
const MUSIC_INFO: ProviderInfo = { name: 'studio-offline', model: 'instrumental-synth-v1', mode: 'mock' };
const AMBIENT_INFO: ProviderInfo = { name: 'studio-offline', model: 'ambience-synth-v1', mode: 'mock' };

export class MockImageProvider implements ImageProvider {
  readonly info = IMAGE_INFO;
  readonly extension = '.png';

  async generate(request: ImageRequest): Promise<ProviderResult> {
    const png = renderStill({
      width: request.width,
      height: request.height,
      seed: request.seed,
      timeOfDay: request.timeOfDay,
      outdoor: request.outdoor,
      shotType: request.shotType,
      performerCount: request.performerCount,
      captions: request.captions,
      badge: request.badge,
    });
    await writeFile(request.outputPath, png);
    return {
      path: request.outputPath,
      mimeType: 'image/png',
      bytes: png.length,
      width: request.width,
      height: request.height,
    };
  }
}

/** Ken Burns expressions matching the shot's planned camera move (PRD §18). */
function zoompanExpressions(move: CameraMove, frames: number): { z: string; x: string; y: string } {
  const n = Math.max(1, frames - 1);
  const centeredX = 'iw/2-(iw/zoom/2)';
  const centeredY = 'ih/2-(ih/zoom/2)';
  switch (move) {
    case 'slow_push_in':
      return { z: `1+0.13*on/${n}`, x: centeredX, y: centeredY };
    case 'slow_pull_out':
      return { z: `1.13-0.13*on/${n}`, x: centeredX, y: centeredY };
    case 'pan_left':
    case 'lateral_track_left':
      return { z: '1.12', x: `(iw-iw/zoom)*(1-on/${n})`, y: centeredY };
    case 'pan_right':
    case 'lateral_track_right':
      return { z: '1.12', x: `(iw-iw/zoom)*(on/${n})`, y: centeredY };
    case 'tilt_up':
      return { z: '1.12', x: centeredX, y: `(ih-ih/zoom)*(1-on/${n})` };
    case 'tilt_down':
      return { z: '1.12', x: centeredX, y: `(ih-ih/zoom)*(on/${n})` };
    case 'crane_up':
      return { z: `1.16-0.1*on/${n}`, x: centeredX, y: `(ih-ih/zoom)*(1-on/${n})` };
    case 'handheld_drift':
      return {
        z: '1.08',
        x: `${centeredX}+10*sin(on/13)`,
        y: `${centeredY}+7*cos(on/9)`,
      };
    case 'static':
    default:
      return { z: `1.02+0.01*on/${n}`, x: centeredX, y: centeredY };
  }
}

export class MockVideoProvider implements VideoProvider {
  readonly info = VIDEO_INFO;
  readonly extension = '.mp4';

  async generate(request: VideoRequest): Promise<ProviderResult> {
    const source = request.sourceImagePath;
    if (!source) {
      throw new ProviderError(
        'No hay imagen aprobada de referencia para animar este clip. Aprueba primero la imagen de la toma.',
      );
    }
    const fps = request.fps;
    const frames = Math.max(2, Math.round(request.durationSec * fps));
    const { z, x, y } = zoompanExpressions(request.cameraMove, frames);
    // Upscaling before zoompan keeps the pan/zoom free of stair-stepping.
    const filter = [
      `scale=${request.width * 2}:${request.height * 2}:flags=lanczos`,
      `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${request.width}x${request.height}:fps=${fps}`,
      'format=yuv420p',
    ].join(',');

    await runFfmpeg([
      '-loop',
      '1',
      '-framerate',
      String(fps),
      '-i',
      source,
      '-t',
      request.durationSec.toFixed(3),
      '-vf',
      filter,
      '-frames:v',
      String(frames),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-an',
      request.outputPath,
    ]);

    const bytes = await fileSize(request.outputPath);
    const durationSec = (await probeDurationSec(request.outputPath)) ?? request.durationSec;
    return {
      path: request.outputPath,
      mimeType: 'video/mp4',
      bytes,
      durationSec,
      width: request.width,
      height: request.height,
    };
  }
}

export class MockMusicProvider implements MusicProvider {
  readonly info = MUSIC_INFO;
  readonly extension = '.wav';

  async generate(request: MusicRequest): Promise<ProviderResult> {
    const wav = renderMusic({
      brief: request.brief,
      instrumentIds: request.instrumentIds,
      acoustics: request.acoustics,
      seed: request.seed,
    });
    await writeFile(request.outputPath, wav);
    return {
      path: request.outputPath,
      mimeType: 'audio/wav',
      bytes: wav.length,
      durationSec: request.brief.durationSec,
    };
  }
}

export class MockAmbientProvider implements AmbientProvider {
  readonly info = AMBIENT_INFO;
  readonly extension = '.wav';

  async generate(request: AmbientRequest): Promise<ProviderResult> {
    const wav = renderAmbient({ brief: request.brief, seed: request.seed });
    await writeFile(request.outputPath, wav);
    return {
      path: request.outputPath,
      mimeType: 'audio/wav',
      bytes: wav.length,
      durationSec: request.brief.durationSec,
    };
  }
}
