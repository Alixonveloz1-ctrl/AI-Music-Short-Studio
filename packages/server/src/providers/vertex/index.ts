/**
 * Google Cloud / Vertex AI providers (PRD §19, §24, §41).
 *
 *   images -> Imagen        (`:predict`)
 *   video  -> Veo           (`:predictLongRunning` + polling)
 *   music  -> Lyria         (`:predict`, stitched to the requested length)
 *
 * The PRD calls the music model "Lyra"; on Vertex AI the instrumental music
 * model is published as Lyria, which is what this adapter targets.
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { OUTPUT_ASPECT_RATIO, type ProviderInfo } from '@ams/shared';
import { fileSize, probeDurationSec, runFfmpeg } from '../../media/ffmpeg.js';
import {
  ProviderError,
  type ImageProvider,
  type ImageRequest,
  type MusicProvider,
  type MusicRequest,
  type ProviderResult,
  type VideoProvider,
  type VideoRequest,
} from '../types.js';
import { delay, modelEndpoint, vertexPost, type VertexSettings } from './client.js';

interface PredictResponse {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
    audioContent?: string;
    raiFilteredReason?: string;
  }>;
}

interface OperationResponse {
  name?: string;
  done?: boolean;
  error?: { message?: string; code?: number };
  response?: {
    videos?: Array<{ bytesBase64Encoded?: string; gcsUri?: string; mimeType?: string }>;
    raiMediaFilteredReasons?: string[];
  };
}

function decodeFirstPrediction(response: PredictResponse, what: string): Buffer {
  const prediction = response.predictions?.[0];
  if (!prediction) {
    throw new ProviderError(`Vertex AI no devolvió ${what}.`);
  }
  if (prediction.raiFilteredReason) {
    throw new ProviderError(`Vertex AI filtró la generación: ${prediction.raiFilteredReason}`);
  }
  const base64 = prediction.bytesBase64Encoded ?? prediction.audioContent;
  if (!base64) {
    throw new ProviderError(`Vertex AI devolvió una respuesta sin datos de ${what}.`);
  }
  return Buffer.from(base64, 'base64');
}

export class VertexImageProvider implements ImageProvider {
  readonly info: ProviderInfo;
  readonly extension = '.png';

  constructor(
    private readonly settings: VertexSettings,
    model: string,
  ) {
    this.info = { name: 'vertex-ai', model, mode: 'vertex' };
  }

  async generate(request: ImageRequest): Promise<ProviderResult> {
    const instance: Record<string, unknown> = { prompt: request.prompt };

    // Subject/style reference images are only accepted by the Imagen
    // "capability" models; other models take the prompt alone.
    if (request.references.length > 0 && this.info.model.includes('capability')) {
      instance['referenceImages'] = await Promise.all(
        request.references.map(async (reference, index) => ({
          referenceType: 'REFERENCE_TYPE_SUBJECT',
          referenceId: index + 1,
          referenceImage: { bytesBase64Encoded: (await readFile(reference.path)).toString('base64') },
          subjectImageConfig: {
            subjectDescription: reference.role,
            subjectType: reference.role.includes('personaje')
              ? 'SUBJECT_TYPE_PERSON'
              : 'SUBJECT_TYPE_DEFAULT',
          },
        })),
      );
    }

    const body = {
      instances: [instance],
      parameters: {
        sampleCount: 1,
        aspectRatio: OUTPUT_ASPECT_RATIO,
        seed: request.seed,
        addWatermark: false,
        personGeneration: 'allow_adult',
        includeRaiReason: true,
        ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
      },
    };

    const response = await vertexPost<PredictResponse>(
      this.settings,
      modelEndpoint(this.settings, this.info.model, 'predict'),
      body,
    );
    const buffer = decodeFirstPrediction(response, 'imagen');
    await writeFile(request.outputPath, buffer);
    return {
      path: request.outputPath,
      mimeType: response.predictions?.[0]?.mimeType ?? 'image/png',
      bytes: buffer.length,
      width: request.width,
      height: request.height,
    };
  }
}

export class VertexVideoProvider implements VideoProvider {
  readonly info: ProviderInfo;
  readonly extension = '.mp4';

  constructor(
    private readonly settings: VertexSettings,
    model: string,
  ) {
    this.info = { name: 'vertex-ai', model, mode: 'vertex' };
  }

  async generate(request: VideoRequest): Promise<ProviderResult> {
    const instance: Record<string, unknown> = { prompt: request.prompt };
    if (request.sourceImagePath) {
      instance['image'] = {
        bytesBase64Encoded: (await readFile(request.sourceImagePath)).toString('base64'),
        mimeType: 'image/png',
      };
    }

    const started = await vertexPost<OperationResponse>(
      this.settings,
      modelEndpoint(this.settings, this.info.model, 'predictLongRunning'),
      {
        instances: [instance],
        parameters: {
          sampleCount: 1,
          durationSeconds: Math.round(request.durationSec),
          aspectRatio: OUTPUT_ASPECT_RATIO,
          // The short is scored separately; clip audio would fight the mix.
          generateAudio: false,
          personGeneration: 'allow_adult',
          ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
        },
      },
    );

    const operationName = started.name;
    if (!operationName) {
      throw new ProviderError('Vertex AI no devolvió una operación de vídeo.');
    }

    const buffer = await this.pollOperation(operationName);
    await writeFile(request.outputPath, buffer);
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

  private async pollOperation(operationName: string): Promise<Buffer> {
    const url = modelEndpoint(this.settings, this.info.model, 'fetchPredictOperation');
    const deadline = Date.now() + 15 * 60 * 1000;
    let wait = 5_000;
    while (Date.now() < deadline) {
      await delay(wait);
      wait = Math.min(15_000, Math.round(wait * 1.3));
      const operation = await vertexPost<OperationResponse>(this.settings, url, { operationName });
      if (!operation.done) continue;
      if (operation.error) {
        throw new ProviderError(`Vertex AI falló generando el vídeo: ${operation.error.message}`);
      }
      const filtered = operation.response?.raiMediaFilteredReasons?.[0];
      if (filtered) {
        throw new ProviderError(`Vertex AI filtró el vídeo: ${filtered}`);
      }
      const video = operation.response?.videos?.[0];
      if (video?.bytesBase64Encoded) {
        return Buffer.from(video.bytesBase64Encoded, 'base64');
      }
      if (video?.gcsUri) {
        throw new ProviderError(
          `Vertex AI escribió el vídeo en ${video.gcsUri}. Configura el modelo para devolver bytes en línea.`,
        );
      }
      throw new ProviderError('Vertex AI terminó la operación sin devolver vídeo.');
    }
    throw new ProviderError('La generación de vídeo superó el tiempo máximo de espera.', true);
  }
}

/** Lyria returns fixed-length takes, so long pieces are stitched together. */
const LYRIA_SEGMENT_SEC = 30;

export class LyriaMusicProvider implements MusicProvider {
  readonly info: ProviderInfo;
  readonly extension = '.wav';

  constructor(
    private readonly settings: VertexSettings,
    model: string,
  ) {
    this.info = { name: 'vertex-lyria', model, mode: 'lyria' };
  }

  async generate(request: MusicRequest): Promise<ProviderResult> {
    const target = request.brief.durationSec;
    const segments = Math.max(1, Math.ceil(target / LYRIA_SEGMENT_SEC));
    const url = modelEndpoint(this.settings, this.info.model, 'predict');
    const workDir = await mkdtemp(path.join(os.tmpdir(), 'ams-lyria-'));

    try {
      const files: string[] = [];
      for (let i = 0; i < segments; i += 1) {
        const sectionPrompt =
          segments === 1
            ? request.prompt
            : `${request.prompt}\nSección ${i + 1} de ${segments} de la pieza; debe encadenar de forma continua con la anterior y la siguiente.`;
        const response = await vertexPost<PredictResponse>(this.settings, url, {
          instances: [
            {
              prompt: sectionPrompt,
              negative_prompt: request.negativePrompt ?? request.brief.negativePrompt,
              seed: request.seed + i,
            },
          ],
          parameters: {},
        });
        const buffer = decodeFirstPrediction(response, 'audio');
        const file = path.join(workDir, `segment_${i}.wav`);
        await writeFile(file, buffer);
        files.push(file);
      }

      if (files.length === 1) {
        await runFfmpeg([
          '-i',
          files[0] as string,
          '-t',
          String(target),
          '-c:a',
          'pcm_s16le',
          request.outputPath,
        ]);
      } else {
        const inputs = files.flatMap((file) => ['-i', file]);
        const concat = `${files.map((_, i) => `[${i}:a]`).join('')}concat=n=${files.length}:v=0:a=1[out]`;
        await runFfmpeg([
          ...inputs,
          '-filter_complex',
          concat,
          '-map',
          '[out]',
          '-t',
          String(target),
          '-c:a',
          'pcm_s16le',
          request.outputPath,
        ]);
      }

      const bytes = await fileSize(request.outputPath);
      const durationSec = (await probeDurationSec(request.outputPath)) ?? target;
      return { path: request.outputPath, mimeType: 'audio/wav', bytes, durationSec };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
