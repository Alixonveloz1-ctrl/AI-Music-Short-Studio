import type { AppConfig } from '../config.js';
import {
  MockAmbientProvider,
  MockImageProvider,
  MockMusicProvider,
  MockVideoProvider,
} from './mock/index.js';
import { LyriaMusicProvider, VertexImageProvider, VertexVideoProvider } from './vertex/index.js';
import type { ProviderBundle } from './types.js';

export function buildProviders(config: AppConfig): ProviderBundle {
  const vertex = { project: config.vertex.project, location: config.vertex.location };
  return {
    image:
      config.providers.image === 'vertex'
        ? new VertexImageProvider(vertex, config.vertex.imageModel)
        : new MockImageProvider(),
    video:
      config.providers.video === 'vertex'
        ? new VertexVideoProvider(vertex, config.vertex.videoModel)
        : new MockVideoProvider(),
    music:
      config.providers.music === 'lyria'
        ? new LyriaMusicProvider(vertex, config.vertex.musicModel)
        : new MockMusicProvider(),
    ambient: new MockAmbientProvider(),
  };
}

export * from './types.js';
