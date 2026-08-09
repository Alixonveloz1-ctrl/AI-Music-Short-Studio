import path from 'node:path';
import type { Asset, AssetKind } from '@ams/shared';

/**
 * On-disk layout, mirroring the structure the PRD asks for (§37):
 *
 *   project/
 *     images/character/gen_001.png
 *     images/environment/gen_001.png
 *     images/shot_03/gen_002.png
 *     videos/shot_03_clip_a/gen_001.mp4
 *     music/gen_003.wav
 *     ambient/gen_001.wav
 *     final/project_final.mp4
 */

const KIND_ROOT: Record<AssetKind, string> = {
  master_character: 'images/character',
  master_environment: 'images/environment',
  master_scene: 'images/scene',
  shot_image: 'images',
  clip: 'videos',
  music: 'music',
  ambient: 'ambient',
};

export function assetRelativeDir(asset: Asset): string {
  const root = KIND_ROOT[asset.kind];
  if (asset.kind === 'shot_image') {
    return path.posix.join(root, asset.shotId ?? asset.id);
  }
  if (asset.kind === 'clip') {
    return path.posix.join(root, asset.id);
  }
  return root;
}

export function generationFileName(index: number, extension: string): string {
  return `gen_${String(index).padStart(3, '0')}${extension}`;
}

export function generationRelativePath(asset: Asset, index: number, extension: string): string {
  return path.posix.join(assetRelativeDir(asset), generationFileName(index, extension));
}

export const FINAL_DIR = 'final';
export const PREVIEW_FILE = 'preview.mp4';
export const EXPORT_FILE = 'project_final.mp4';
export const METADATA_FILE = 'project_final.json';

/** Public URL for a file stored inside a project directory. */
export function assetUrl(projectId: string, relativePath: string): string {
  return `/media/${projectId}/${relativePath.split(path.sep).join('/')}`;
}
