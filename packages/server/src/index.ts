import { loadConfig } from './config.js';
import { createStudio } from './http/app.js';
import { hasFfmpeg } from './media/ffmpeg.js';

const config = loadConfig();
const studio = createStudio(config);

await studio.repo.init();

const ffmpegAvailable = await hasFfmpeg();

studio.app.listen(config.port, () => {
  const lines = [
    `AI Music Short Studio escuchando en http://localhost:${config.port}`,
    `  datos          ${config.dataDir}`,
    `  imágenes       ${config.providers.image}`,
    `  vídeo          ${config.providers.video}`,
    `  música         ${config.providers.music}`,
    `  ambiente       ${config.providers.ambient}`,
    `  planificador   ${config.planner.apiKey && config.planner.mode !== 'heuristic' ? `${config.planner.mode} (${config.planner.model})` : 'interno (determinista)'}`,
    `  ffmpeg         ${ffmpegAvailable ? 'disponible' : 'NO DISPONIBLE — el vídeo y la exportación fallarán'}`,
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
});
