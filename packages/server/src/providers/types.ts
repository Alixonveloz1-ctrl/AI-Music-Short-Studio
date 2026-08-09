import type { AmbientBrief, CameraMove, MusicBrief, ProviderInfo, ShotType } from '@ams/shared';

export interface ReferenceFile {
  assetId: string;
  /** Absolute path to the approved file. */
  path: string;
  mimeType: string;
  /** What this reference is for, e.g. "personaje". */
  role: string;
}

export interface BaseRequest {
  prompt: string;
  negativePrompt?: string;
  seed: number;
  references: ReferenceFile[];
  /** Absolute path the provider must write to (extension already chosen). */
  outputPath: string;
}

export interface ImageRequest extends BaseRequest {
  width: number;
  height: number;
  shotType: ShotType;
  performerCount: number;
  timeOfDay: string;
  outdoor: boolean;
  /** Text the offline provider burns into the placeholder. */
  captions: string[];
  badge?: string;
}

export interface VideoRequest extends BaseRequest {
  durationSec: number;
  cameraMove: CameraMove;
  width: number;
  height: number;
  fps: number;
  /** Approved still this clip animates; always present in practice. */
  sourceImagePath?: string;
}

export interface MusicRequest extends BaseRequest {
  brief: MusicBrief;
  instrumentIds: string[];
  acoustics: string;
}

export interface AmbientRequest extends BaseRequest {
  brief: AmbientBrief;
}

export interface ProviderResult {
  path: string;
  mimeType: string;
  bytes: number;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface ImageProvider {
  readonly info: ProviderInfo;
  /** File extension the provider writes, including the dot. */
  readonly extension: string;
  generate(request: ImageRequest): Promise<ProviderResult>;
}

export interface VideoProvider {
  readonly info: ProviderInfo;
  readonly extension: string;
  generate(request: VideoRequest): Promise<ProviderResult>;
}

export interface MusicProvider {
  readonly info: ProviderInfo;
  readonly extension: string;
  generate(request: MusicRequest): Promise<ProviderResult>;
}

export interface AmbientProvider {
  readonly info: ProviderInfo;
  readonly extension: string;
  generate(request: AmbientRequest): Promise<ProviderResult>;
}

export interface ProviderBundle {
  image: ImageProvider;
  video: VideoProvider;
  music: MusicProvider;
  ambient: AmbientProvider;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retriable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
