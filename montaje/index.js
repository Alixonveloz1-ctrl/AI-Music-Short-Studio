// ════════════════════════════════════════════════════════════════════════════
// AMS-MONTAJE — el montador de MP4 de AI Music Short Studio.
//
// POR QUÉ EXISTE ESTE SERVICIO
//
// El montaje final necesita ffmpeg, y en Vercel no hay ffmpeg ni hay tiempo:
// una función se corta a los pocos segundos y un corto de tres minutos tarda
// varios. Así que el montaje vive aquí, en un contenedor de Cloud Run que se
// despliega UNA sola vez en la cuenta de Google Cloud del usuario (montaje/
// instalar.sh lo hace solo) y al que la aplicación llama por HTTP.
//
// EN QUÉ SE DIFERENCIA DEL MONTADOR DE OTROS PROYECTOS
//
// Los montadores con narración estiran los clips para que cuadren con la voz.
// Aquí NO hay voz nunca: el corto es instrumental y la duración de cada toma ya
// la decidió el productor. Por eso este servicio no calcula nada de tiempos:
// recibe una LÍNEA DE TIEMPO explícita y la ejecuta al pie de la letra.
//
// CERO DEPENDENCIAS DE NPM
//
// Nada de @google-cloud/storage: el bucket se lee y se escribe con `fetch`
// contra la API JSON de Cloud Storage, y el permiso sale del servidor de
// metadatos de Cloud Run. Una dependencia menos es una cosa menos que puede
// romper un despliegue que el usuario no puede depurar desde el móvil, y
// además el contenedor se construye sin `npm install`.
//
// NUNCA FALLA EN SILENCIO
//
// Cualquier error acaba escrito, en español y en una frase entendible, en
// <prefijo>/montajes/<jobId>.json dentro del bucket. Es lo único que se puede
// leer desde un teléfono: los registros de Cloud Run no se abren cómodamente
// desde ahí y "exit code 1" no le dice nada a nadie. La aplicación consulta ese
// objeto y enseña el mensaje tal cual.
//
// CONTRATO
//
//   GET  /        -> { ok: true, service: 'ams-montaje', version: '<fecha>.<n>' }
//   POST /montar  -> { jobId }   (responde YA; el trabajo sigue en segundo plano)
//
// La respuesta inmediata con trabajo de fondo es exactamente por lo que el
// despliegue lleva --no-cpu-throttling: sin esa opción Google le retira el
// procesador a la instancia en cuanto contesta la petición, y el render se
// queda congelado a medias sin ningún error.
// ════════════════════════════════════════════════════════════════════════════
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// Versión del servicio. Se sube cada vez que se toca este archivo; la
// aplicación la lee de GET / para poder decir sola si el Cloud Run desplegado
// está al día o le falta la última actualización. Sin esto habría que
// preguntárselo al usuario, que es justo lo que no puede comprobar.
const VERSION = '2026-08-09.1';

const PUERTO = process.env.PORT || 8080;
const MONTAJE_KEY = process.env.MONTAJE_KEY || '';

// El bucket del despliegue. La petición también lo trae, pero si esta variable
// está puesta manda ella: así, aunque alguien averigüe la URL y la clave, no
// puede usar el servicio para copiar archivos entre buckets ajenos de la
// cuenta.
const BUCKET_FIJO = (process.env.BUCKET || '').replace(/^gs:\/\//, '').replace(/\/.*$/, '');

// ─── Receta de montaje ───
//
// Los mismos números que usaba el montaje local con ffmpeg. Están aquí y no en
// la petición a propósito: son decisiones de dirección, no configuración.

const FUNDIDO_ENTRADA = 1.2;   // abrir la película desde negro
const FUNDIDO_SALIDA = 1.6;    // cerrarla a negro
const FUNDIDO_BLOQUE = 0.4;    // corte a negro entre bloques narrativos: separa
                               // dos ideas, no abre la película, así que es corto
const GANANCIA_MUSICA = 0.85;
const GANANCIA_AMBIENTE = 0.28;

const ANCHO_POR_DEFECTO = 1920;
const ALTO_POR_DEFECTO = 1080;
const FPS_POR_DEFECTO = 24;

// AAC en MP4 a 48 kHz: es lo que esperan los reproductores de móvil y las
// redes. La música generada puede venir a 44,1 kHz; se remuestrea UNA vez, en
// el paso final, que es el único que codifica audio.
const AUDIO_HZ = 48000;

// Un corto de tres minutos con tomas de ocho segundos son unas veintitrés
// tomas. Ochenta deja margen de sobra y evita que una petición absurda ponga a
// la máquina a abrir mil archivos.
const MAX_ENTRADAS = 80;

// Dos montajes a la vez en una instancia de 4 CPU se estorban y los dos tardan
// el doble. Mejor decirlo claro que entregar dos renders lentos.
const MAX_TRABAJOS = 2;
let trabajosActivos = 0;

// ════════════════════════════════════════════════════════════════════════════
// Utilidades de proceso
// ════════════════════════════════════════════════════════════════════════════

function ejecutar(cmd, args, msTiempoLimite) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: msTiempoLimite || 600000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // Solo la cola del error: ffmpeg escupe cientos de líneas y la única
          // que dice algo es casi siempre la última.
          const detalle = String(stderr || err.message).trim().slice(-700);
          return reject(new Error(detalle || (cmd + ' terminó con error')));
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

async function duracionDe(archivo) {
  const { stdout } = await ejecutar('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    archivo,
  ], 60000);
  const d = parseFloat(stdout.trim());
  if (!isFinite(d) || d <= 0) {
    throw new Error('El archivo ' + path.basename(archivo) + ' no tiene una duración legible; llegó vacío o corrupto.');
  }
  return d;
}

async function tamanoDe(archivo) {
  const { stdout } = await ejecutar('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0:s=x',
    archivo,
  ], 60000);
  const m = /(\d+)x(\d+)/.exec(stdout.trim());
  if (!m) throw new Error('No se pudo medir el tamaño de ' + path.basename(archivo) + '.');
  return { ancho: parseInt(m[1], 10), alto: parseInt(m[2], 10) };
}

// ════════════════════════════════════════════════════════════════════════════
// Cloud Storage sin SDK
// ════════════════════════════════════════════════════════════════════════════

// El token dura una hora. Se cachea porque un montaje hace decenas de llamadas
// al bucket y pedirlo cada vez es un viaje de ida y vuelta por cada archivo.
let tokenCache = { valor: '', expiraEn: 0 };

async function tokenAcceso() {
  const ahora = Date.now() / 1000;
  if (tokenCache.valor && tokenCache.expiraEn > ahora + 60) return tokenCache.valor;

  const r = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } },
  );
  if (!r.ok) {
    throw new Error(
      'El servicio no pudo pedir permiso para entrar al bucket (servidor de metadatos: HTTP ' +
      r.status + '). Vuelve a ejecutar montaje/instalar.sh.',
    );
  }
  const d = await r.json();
  if (!d.access_token) throw new Error('El servidor de metadatos no devolvió ningún permiso de acceso.');
  tokenCache = {
    valor: d.access_token,
    expiraEn: ahora + (Number(d.expires_in) || 3600),
  };
  return tokenCache.valor;
}

function urlObjeto(bucket, objeto) {
  return 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket) +
    '/o/' + encodeURIComponent(objeto);
}

/** Baja un objeto del bucket a disco, en streaming (no cabe un MP4 en memoria). */
async function bajar(bucket, objeto, destino) {
  let ultimo = '';
  // Tres intentos: un 5xx suelto de Cloud Storage es normal y tirar el montaje
  // entero por eso sería absurdo.
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const token = await tokenAcceso();
      const r = await fetch(urlObjeto(bucket, objeto) + '?alt=media', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (r.status === 404) {
        // Un 404 no se reintenta: el archivo no está y no va a aparecer.
        throw new Error('No existe en el bucket: ' + objeto);
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(destino));
      const bytes = fs.statSync(destino).size;
      if (bytes < 1024) throw new Error('llegó vacío (' + bytes + ' bytes)');
      return bytes;
    } catch (e) {
      ultimo = e.message;
      if (ultimo.indexOf('No existe en el bucket') === 0) throw e;
      if (intento === 3) break;
      await new Promise((ok) => setTimeout(ok, 800 * intento));
    }
  }
  throw new Error('No se pudo bajar "' + objeto + '" del bucket: ' + ultimo);
}

/** Sube un Buffer al bucket. */
async function subirBuffer(bucket, objeto, buffer, tipo) {
  let ultimo = '';
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const token = await tokenAcceso();
      const r = await fetch(
        'https://storage.googleapis.com/upload/storage/v1/b/' + encodeURIComponent(bucket) +
        '/o?uploadType=media&name=' + encodeURIComponent(objeto),
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': tipo || 'application/octet-stream',
          },
          body: buffer,
        },
      );
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return true;
    } catch (e) {
      ultimo = e.message;
      if (intento === 3) break;
      await new Promise((ok) => setTimeout(ok, 800 * intento));
    }
  }
  throw new Error('No se pudo guardar "' + objeto + '" en el bucket: ' + ultimo);
}

/**
 * Sube el MP4 terminado.
 *
 * Se lee el archivo entero a memoria a propósito: así la petición lleva un
 * Content-Length real. Subir en streaming obliga a codificación troceada, y una
 * subida troceada de 150 MB que se corta a la mitad deja en el bucket un MP4
 * incompleto que parece bueno. Un corto de tres minutos a 1080p ronda los
 * 150 MB y la instancia tiene 4 GB: cabe de sobra.
 */
async function subirArchivo(bucket, objeto, archivo, tipo) {
  const buffer = fs.readFileSync(archivo);
  await subirBuffer(bucket, objeto, buffer, tipo);
  return buffer.length;
}

// ════════════════════════════════════════════════════════════════════════════
// Estado del trabajo
// ════════════════════════════════════════════════════════════════════════════

function rutaEstado(prefijo, jobId) {
  return prefijo + '/montajes/' + jobId + '.json';
}

async function escribirEstado(bucket, prefijo, jobId, datos) {
  const cuerpo = Object.assign({ jobId: jobId, version: VERSION, momento: new Date().toISOString() }, datos);
  await subirBuffer(
    bucket,
    rutaEstado(prefijo, jobId),
    Buffer.from(JSON.stringify(cuerpo, null, 2)),
    'application/json',
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Validación de la petición
// ════════════════════════════════════════════════════════════════════════════

function limpiarRuta(v) {
  return String(v == null ? '' : v).replace(/^\/+/, '').trim();
}

/**
 * Comprueba que un objeto del bucket vive dentro del prefijo del proyecto.
 *
 * No es paranoia: este servicio corre con permiso de escritura sobre TODO el
 * bucket. Sin esta comprobación, una petición con la clave correcta podría
 * pedirle que lea o pise cualquier archivo de la cuenta.
 */
function dentroDelPrefijo(objeto, prefijo) {
  if (!objeto) return false;
  if (objeto.indexOf('..') !== -1) return false;
  return objeto.indexOf(prefijo + '/') === 0;
}

function numero(v, porDefecto) {
  const n = Number(v);
  return isFinite(n) ? n : porDefecto;
}

/**
 * Traduce el cuerpo de /montar a un encargo comprobado, o devuelve un error ya
 * redactado en español. Todo lo que se pueda rechazar aquí es un montaje que no
 * se lanza para nada y un mensaje que llega al instante en vez de dentro de
 * cinco minutos.
 */
function revisarEncargo(d) {
  const bucketPedido = String(d.bucket || '').replace(/^gs:\/\//, '').replace(/\/.*$/, '').trim();
  const bucket = BUCKET_FIJO || bucketPedido;
  if (!bucket) return { error: 'Falta el nombre del bucket.' };
  if (BUCKET_FIJO && bucketPedido && bucketPedido !== BUCKET_FIJO) {
    return { error: 'Este montador solo trabaja con el bucket "' + BUCKET_FIJO + '".' };
  }

  const prefijo = limpiarRuta(d.prefijo).replace(/\/+$/, '');
  if (!prefijo) return { error: 'Falta el prefijo (la carpeta del estudio dentro del bucket).' };

  if (!Array.isArray(d.entradas) || d.entradas.length === 0) {
    return { error: 'No hay ninguna toma aprobada que montar.' };
  }
  if (d.entradas.length > MAX_ENTRADAS) {
    return { error: 'La línea de tiempo trae ' + d.entradas.length + ' tomas y el máximo son ' + MAX_ENTRADAS + '.' };
  }

  const entradas = [];
  for (let i = 0; i < d.entradas.length; i++) {
    const e = d.entradas[i] || {};
    const objeto = limpiarRuta(e.objeto);
    if (!dentroDelPrefijo(objeto, prefijo)) {
      return { error: 'La toma ' + (i + 1) + ' apunta a "' + (objeto || '(vacío)') + '", que está fuera de la carpeta del estudio.' };
    }
    const duracionSec = numero(e.duracionSec, 0);
    if (!(duracionSec > 0.05)) {
      return { error: 'La toma ' + (i + 1) + ' no tiene una duración válida.' };
    }
    const inicioSec = Math.max(0, numero(e.inicioSec, 0));
    entradas.push({
      objeto: objeto,
      inicioSec: inicioSec,
      duracionSec: duracionSec,
      // Cualquier transición que no sea el fundido a negro se monta como corte
      // seco, que es lo que el montador sabe hacer de verdad. Inventar un
      // encadenado que no existe sería peor que un corte.
      transicion: e.transicion === 'dip_to_black' ? 'dip_to_black' : 'cut',
    });
  }

  // La música es obligatoria: esto monta cortos musicales.
  const musicaObj = limpiarRuta(d.musica && (d.musica.objeto || d.musica.object) ? (d.musica.objeto || d.musica.object) : d.musica);
  if (!dentroDelPrefijo(musicaObj, prefijo)) {
    return { error: 'Falta la pista de música aprobada, o está fuera de la carpeta del estudio.' };
  }

  // El ambiente es opcional: hay cortos que se quedan solo con la música.
  let ambiente = null;
  const ambienteBruto = d.ambiente && (d.ambiente.objeto || d.ambiente.object) ? (d.ambiente.objeto || d.ambiente.object) : d.ambiente;
  const ambienteObj = limpiarRuta(ambienteBruto);
  if (ambienteObj) {
    if (!dentroDelPrefijo(ambienteObj, prefijo)) {
      return { error: 'La pista de ambiente está fuera de la carpeta del estudio.' };
    }
    ambiente = { objeto: ambienteObj, volumen: volumenValido(d.ambiente && d.ambiente.volumen, GANANCIA_AMBIENTE) };
  }

  const salida = limpiarRuta(d.salida);
  if (!dentroDelPrefijo(salida, prefijo)) {
    return { error: 'La ruta de salida está vacía o fuera de la carpeta del estudio.' };
  }
  if (!/\.mp4$/i.test(salida)) return { error: 'La ruta de salida tiene que terminar en .mp4' };

  return {
    encargo: {
      bucket: bucket,
      prefijo: prefijo,
      entradas: entradas,
      musica: { objeto: musicaObj, volumen: volumenValido(d.musica && d.musica.volumen, GANANCIA_MUSICA) },
      ambiente: ambiente,
      salida: salida,
      ancho: enteroPar(d.ancho, ANCHO_POR_DEFECTO),
      alto: enteroPar(d.alto, ALTO_POR_DEFECTO),
      fps: Math.min(60, Math.max(12, Math.round(numero(d.fps, FPS_POR_DEFECTO)))),
    },
  };
}

function volumenValido(v, porDefecto) {
  const n = Number(v);
  if (!isFinite(n) || n < 0 || n > 4) return porDefecto;
  return n;
}

// libx264 con yuv420p exige lados pares; un tamaño impar hace fallar el
// codificador con un mensaje que no dice nada de esto.
function enteroPar(v, porDefecto) {
  let n = Math.round(numero(v, porDefecto));
  if (!(n >= 160 && n <= 4096)) n = porDefecto;
  return n % 2 === 0 ? n : n + 1;
}

// ════════════════════════════════════════════════════════════════════════════
// El montaje
// ════════════════════════════════════════════════════════════════════════════

const n3 = (x) => Number(x).toFixed(3);

/**
 * Cadena de filtros de UNA toma.
 *
 * Todo el trabajo va sobre el segmento ya recortado, porque `setpts=PTS-STARTPTS`
 * lo recoloca en el segundo cero: los tiempos de los fundidos de más abajo son
 * relativos a la toma, no a la película.
 */
function cadenaDeToma(entrada, indice, entradas, ancho, alto, fps, disponible) {
  const dur = entrada.duracionSec;
  const primera = indice === 0;
  const ultima = indice === entradas.length - 1;
  const siguiente = entradas[indice + 1];

  const cadena = [
    // El clip se recorta a su hueco en la película. Los modelos de vídeo no
    // devuelven exactamente los segundos que se les piden, así que sin este
    // recorte la suma no cuadraría con la duración planificada.
    'trim=start=' + n3(entrada.inicioSec) + ':duration=' + n3(dur),
    'setpts=PTS-STARTPTS',
  ];

  // Si al clip le faltan décimas para cubrir su hueco, se congela el último
  // fotograma en vez de dejar que el segmento salga corto. Un segmento corto no
  // da ningún error: simplemente desplaza toda la película y la música termina
  // desincronizada, que es el fallo más difícil de ver y de explicar.
  const falta = dur - disponible;
  if (falta > 0.02) {
    cadena.push('tpad=stop_mode=clone:stop_duration=' + n3(falta));
  }

  cadena.push(
    // Encajar sin deformar: se reduce hasta caber y se rellena con negro. Un
    // scale a secas estiraría la imagen si el clip viniera con otra relación.
    'scale=' + ancho + ':' + alto + ':force_original_aspect_ratio=decrease',
    'pad=' + ancho + ':' + alto + ':(ow-iw)/2:(oh-ih)/2:color=black',
    'setsar=1',
    'fps=' + fps,
  );

  if (primera) {
    // El fundido nunca puede durar más que la toma: si dura más, la película
    // arranca a oscuras y el corte cambia antes de que la imagen haya llegado.
    cadena.push('fade=t=in:st=0:d=' + n3(Math.min(FUNDIDO_ENTRADA, dur)));
  } else if (entrada.transicion === 'dip_to_black') {
    cadena.push('fade=t=in:st=0:d=' + n3(Math.min(FUNDIDO_BLOQUE, dur)));
  }

  if (ultima) {
    const d = Math.min(FUNDIDO_SALIDA, dur);
    cadena.push('fade=t=out:st=' + n3(dur - d) + ':d=' + n3(d));
  } else if (siguiente && siguiente.transicion === 'dip_to_black') {
    const d = Math.min(FUNDIDO_BLOQUE, dur);
    cadena.push('fade=t=out:st=' + n3(dur - d) + ':d=' + n3(d));
  }

  return cadena.join(',');
}

/** Escapado para la lista del demuxer `concat`: dentro de '' solo se escapa '. */
function comilla(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

async function montar(jobId, encargo) {
  const { bucket, prefijo, entradas, musica, ambiente, salida, ancho, alto, fps } = encargo;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ams-montaje-'));
  const total = entradas.reduce((suma, e) => suma + e.duracionSec, 0);
  const avisos = [];
  let fase = 'preparando';

  // El estado se escribe muchas veces durante el montaje para que la pantalla
  // del móvil pueda enseñar por dónde va. Si una de esas escrituras falla no se
  // tira el trabajo: la información de avance es un lujo, el MP4 no.
  const avance = async (texto, progreso) => {
    fase = texto;
    try {
      await escribirEstado(bucket, prefijo, jobId, {
        estado: 'montando',
        fase: texto,
        progreso: Math.max(0, Math.min(1, progreso)),
        cortes: entradas.length,
        total: Number(total.toFixed(2)),
        salida: salida,
      });
    } catch (e) {
      console.warn('[' + jobId + '] no se pudo anotar el avance: ' + e.message);
    }
  };

  try {
    await avance('bajando el material del bucket', 0.02);

    // La misma toma puede aparecer varias veces en la película — el productor
    // planifica la reutilización — así que se baja UNA vez por objeto y el
    // archivo se abre tantas veces como haga falta. Bajar veinte veces el mismo
    // clip costaría más que el propio montaje.
    const localPorObjeto = new Map();
    for (const e of entradas) {
      if (!localPorObjeto.has(e.objeto)) {
        const nombre = 'clip_' + String(localPorObjeto.size).padStart(3, '0') +
          (/(\.[a-z0-9]{2,4})$/i.exec(e.objeto) || [, '.mp4'])[1].toLowerCase();
        localPorObjeto.set(e.objeto, path.join(dir, nombre));
      }
    }
    const musicaLocal = path.join(dir, 'musica' + ((/(\.[a-z0-9]{2,4})$/i.exec(musica.objeto) || [, '.wav'])[1]).toLowerCase());
    const ambienteLocal = ambiente
      ? path.join(dir, 'ambiente' + ((/(\.[a-z0-9]{2,4})$/i.exec(ambiente.objeto) || [, '.wav'])[1]).toLowerCase())
      : null;

    const pendientes = [];
    for (const [objeto, local] of localPorObjeto) pendientes.push({ objeto: objeto, local: local });
    pendientes.push({ objeto: musica.objeto, local: musicaLocal });
    if (ambiente) pendientes.push({ objeto: ambiente.objeto, local: ambienteLocal });

    // De cuatro en cuatro. De uno en uno se va el tiempo en la ida y vuelta, no
    // en la transferencia; todos a la vez satura la red de la instancia.
    let bajados = 0;
    for (let i = 0; i < pendientes.length; i += 4) {
      const tanda = pendientes.slice(i, i + 4);
      await Promise.all(tanda.map((p) => bajar(bucket, p.objeto, p.local)));
      bajados += tanda.length;
      await avance('bajando el material (' + bajados + ' de ' + pendientes.length + ')', 0.02 + 0.13 * (bajados / pendientes.length));
    }

    // Se mide cada clip ANTES de montar. Si a una toma le falta metraje para su
    // hueco, se sabe aquí y se dice cuál, en vez de dejar que la película salga
    // desincronizada y nadie entienda por qué.
    const duracionClip = new Map();
    for (const [objeto, local] of localPorObjeto) {
      duracionClip.set(objeto, await duracionDe(local));
    }

    // ── Una toma, un archivo intermedio ──
    //
    // La alternativa es un solo ffmpeg con un `-i` por toma y un filtro gigante,
    // que es lo que hacía el montaje local. Aquí no: veinte descodificadores de
    // 1080p abiertos a la vez se comen la memoria de la instancia, y cuando
    // revienta el mensaje no dice qué toma tenía el problema. Rindiendo toma a
    // toma, la memoria es constante y un fallo señala el plano culpable.
    //
    // No hay coste de calidad: los segmentos se unen luego con `-c copy` y el
    // sonido se pega también sin recodificar el vídeo, así que la imagen se
    // codifica UNA sola vez, igual que antes.
    const segmentos = [];
    for (let i = 0; i < entradas.length; i++) {
      const e = entradas[i];
      const origen = localPorObjeto.get(e.objeto);
      const disponible = Math.max(0, duracionClip.get(e.objeto) - e.inicioSec);
      if (disponible < 0.1) {
        throw new Error(
          'La toma ' + (i + 1) + ' empieza en el segundo ' + n3(e.inicioSec) +
          ' pero su clip solo dura ' + n3(duracionClip.get(e.objeto)) + 's. Vuelve a montar el plan.',
        );
      }
      if (disponible < e.duracionSec - 0.02) {
        avisos.push(
          'A la toma ' + (i + 1) + ' le faltaban ' + n3(e.duracionSec - disponible) +
          's de metraje; se congeló el último fotograma para cubrir el hueco.',
        );
      }

      const destino = path.join(dir, 'seg_' + String(i).padStart(3, '0') + '.mp4');
      const filtro = cadenaDeToma(e, i, entradas, ancho, alto, fps, disponible);
      try {
        await ejecutar('ffmpeg', [
          '-y', '-hide_banner', '-loglevel', 'error',
          '-i', origen,
          '-vf', filtro,
          '-an',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
          '-pix_fmt', 'yuv420p', '-r', String(fps),
          destino,
        ], 600000);
      } catch (err) {
        throw new Error('No se pudo preparar la toma ' + (i + 1) + ' ("' + e.objeto + '"): ' + err.message);
      }
      segmentos.push(destino);
      await avance('montando la toma ' + (i + 1) + ' de ' + entradas.length, 0.15 + 0.6 * ((i + 1) / entradas.length));
    }

    // ── Unir ──
    //
    // El demuxer `concat` con `-c copy` exige que todos los segmentos tengan los
    // mismos parámetros. Los tienen porque los acabamos de crear nosotros con el
    // mismo tamaño, la misma cadencia y el mismo formato de píxel: por eso el
    // scale+pad de arriba no es opcional aunque los clips ya vinieran bien.
    await avance('uniendo las tomas', 0.78);
    const lista = path.join(dir, 'lista.txt');
    fs.writeFileSync(lista, segmentos.map((f) => 'file ' + comilla(f)).join('\n') + '\n');
    const mudo = path.join(dir, 'mudo.mp4');
    await ejecutar('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', lista,
      '-c', 'copy', mudo,
    ], 600000);

    // ── Sonido ──
    await avance('mezclando la música y el ambiente', 0.85);
    const pelicula = path.join(dir, 'pelicula.mp4');
    const filtros = [];

    // `aformat` antes que nada: si una pista viene en mono y la otra en estéreo,
    // amix las junta colapsando a mono sin decir una palabra y el corto pierde
    // toda la imagen estéreo de la música.
    const normalizar = 'aformat=sample_fmts=fltp:sample_rates=' + AUDIO_HZ + ':channel_layouts=stereo';

    // `apad` ANTES de `atrim`: si la pista es más corta que la película se
    // alarga con silencio en vez de recortar el vídeo. Sin el apad, el
    // `duration=first` del amix termina la mezcla al acabarse la pista y el
    // final de la película se queda mudo.
    filtros.push('[1:a]' + normalizar + ',apad,atrim=0:' + n3(total) +
      ',asetpts=PTS-STARTPTS,volume=' + musica.volumen + '[amus]');

    let etiquetaMezcla = '[amus]';
    if (ambiente) {
      filtros.push('[2:a]' + normalizar + ',apad,atrim=0:' + n3(total) +
        ',asetpts=PTS-STARTPTS,volume=' + ambiente.volumen + '[aamb]');
      // normalize=0 es obligatorio: por defecto amix divide cada entrada entre
      // el número de entradas, así que mezclar dos pistas bajaría la música a la
      // mitad sin que nada lo indique.
      filtros.push('[amus][aamb]amix=inputs=2:duration=first:normalize=0[apre]');
      etiquetaMezcla = '[apre]';
    }

    const dSalida = Math.min(FUNDIDO_SALIDA, total);
    filtros.push(
      etiquetaMezcla +
      'afade=t=in:st=0:d=' + n3(Math.min(FUNDIDO_ENTRADA, total)) + ',' +
      'afade=t=out:st=' + n3(total - dSalida) + ':d=' + n3(dSalida) + ',' +
      // La suma de dos pistas puede pasarse de 0 dBFS y saturar. El limitador
      // corta el pico sin el escalón del recorte duro: sin distorsión ni chasquidos.
      'alimiter=limit=0.95[aout]',
    );

    const entradasFfmpeg = ['-i', mudo, '-i', musicaLocal];
    if (ambiente) entradasFfmpeg.push('-i', ambienteLocal);

    await ejecutar('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
    ].concat(entradasFfmpeg, [
      '-filter_complex', filtros.join(';'),
      '-map', '0:v:0', '-map', '[aout]',
      // El vídeo ya está codificado: aquí solo se pega el sonido.
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-ar', String(AUDIO_HZ), '-ac', '2',
      '-t', n3(total),
      // faststart mueve el índice al principio del archivo: sin esto el MP4 hay
      // que descargarlo entero antes de que empiece a verse.
      '-movflags', '+faststart',
      pelicula,
    ]), 900000);

    // ── Control de calidad ──
    //
    // Antes de dar nada por bueno se mide el archivo REAL. Un montaje que se
    // marca como terminado sin comprobar nada es exactamente como se publica un
    // corto roto sin enterarse.
    if (!fs.existsSync(pelicula)) throw new Error('El montaje terminó sin producir el MP4.');
    const bytes = fs.statSync(pelicula).size;
    if (bytes < 50000) throw new Error('El MP4 salió vacío (' + bytes + ' bytes).');
    const duracionReal = await duracionDe(pelicula);
    const tamanoReal = await tamanoDe(pelicula);
    if (Math.abs(duracionReal - total) > 0.5) {
      avisos.push('La película dura ' + n3(duracionReal) + 's y la línea de tiempo pedía ' + n3(total) + 's.');
    }
    if (tamanoReal.ancho !== ancho || tamanoReal.alto !== alto) {
      avisos.push('El MP4 salió a ' + tamanoReal.ancho + 'x' + tamanoReal.alto + ' en vez de ' + ancho + 'x' + alto + '.');
    }

    await avance('subiendo la película al bucket', 0.93);
    await subirArchivo(bucket, salida, pelicula, 'video/mp4');

    await escribirEstado(bucket, prefijo, jobId, {
      estado: 'listo',
      objeto: salida,
      duracion: Number(duracionReal.toFixed(2)),
      total: Number(total.toFixed(2)),
      ancho: tamanoReal.ancho,
      alto: tamanoReal.alto,
      fps: fps,
      bytes: bytes,
      cortes: entradas.length,
      avisos: avisos,
    });
    console.log('[' + jobId + '] listo: ' + salida + ' (' + n3(duracionReal) + 's, ' +
      Math.round(bytes / 1048576) + ' MB, ' + entradas.length + ' cortes)');
  } catch (e) {
    // El error NUNCA se pierde: queda escrito en el bucket, en español, y la
    // aplicación lo enseña tal cual. Es lo único legible desde un teléfono.
    const mensaje = (e && e.message) ? e.message : String(e);
    console.error('[' + jobId + '] falló durante "' + fase + '": ' + mensaje);
    try {
      await escribirEstado(bucket, prefijo, jobId, {
        estado: 'fallo',
        fase: fase,
        error: mensaje,
        avisos: avisos,
      });
    } catch (e2) {
      // Último recurso. Si ni el bucket responde, al menos queda en el registro.
      console.error('[' + jobId + '] tampoco se pudo escribir el fallo en el bucket: ' + e2.message);
    }
  } finally {
    trabajosActivos--;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* la instancia se apaga igual */ }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Servidor HTTP
// ════════════════════════════════════════════════════════════════════════════

/**
 * Comparación de la clave en tiempo constante.
 *
 * Con un `===` normal, el tiempo que tarda en fallar delata cuántos caracteres
 * iniciales eran correctos, y con eso una clave se adivina carácter a carácter.
 * Cuesta cuatro líneas evitarlo.
 */
function claveCorrecta(recibida) {
  if (!MONTAJE_KEY) return false;
  const a = Buffer.from(String(recibida || ''));
  const b = Buffer.from(MONTAJE_KEY);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function responder(res, codigo, objeto) {
  res.statusCode = codigo;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(objeto));
}

const servidor = http.createServer((req, res) => {
  const ruta = String(req.url || '').split('?')[0];

  if (req.method === 'GET' && (ruta === '/' || ruta === '')) {
    return responder(res, 200, { ok: true, service: 'ams-montaje', version: VERSION });
  }

  if (req.method !== 'POST' || ruta !== '/montar') {
    return responder(res, 404, { error: 'Aquí solo hay GET / y POST /montar.' });
  }

  if (!MONTAJE_KEY) {
    return responder(res, 500, {
      error: 'El servicio se desplegó sin MONTAJE_KEY. Vuelve a ejecutar montaje/instalar.sh.',
    });
  }
  if (!claveCorrecta(req.headers['x-montaje-key'])) {
    return responder(res, 401, { error: 'Clave incorrecta.' });
  }
  if (trabajosActivos >= MAX_TRABAJOS) {
    return responder(res, 429, {
      error: 'Ya hay ' + trabajosActivos + ' montajes en marcha. Espera a que terminen.',
    });
  }

  // El cuerpo es JSON pequeño: rutas del bucket y números. El material pesado
  // no pasa por aquí, lo baja el propio servicio. Un megabyte es de sobra y
  // evita que un cuerpo enorme tumbe la instancia.
  let cuerpo = '';
  let bytes = 0;
  let cortado = false;
  req.on('data', (trozo) => {
    bytes += trozo.length;
    if (bytes > 1024 * 1024) {
      cortado = true;
      req.destroy();
      return;
    }
    cuerpo += trozo;
  });

  req.on('end', () => {
    if (cortado) return;
    let datos;
    try {
      datos = JSON.parse(cuerpo);
    } catch (e) {
      return responder(res, 400, { error: 'El cuerpo de la petición no es JSON válido.' });
    }

    const revision = revisarEncargo(datos);
    if (revision.error) return responder(res, 400, { error: revision.error });

    const jobId = 'mont-' + crypto.randomBytes(9).toString('hex');
    trabajosActivos++;

    // Se responde YA con el identificador y el trabajo sigue de fondo. Todo lo
    // que pase a partir de aquí se cuenta por el bucket, nunca por esta
    // respuesta. Esto es lo que exige --no-cpu-throttling en el despliegue.
    responder(res, 200, {
      jobId: jobId,
      estado: rutaEstado(revision.encargo.prefijo, jobId),
    });

    // montar() atrapa sus propios errores y siempre libera el contador en su
    // `finally`; este catch existe solo para que un fallo imprevisto no acabe en
    // un rechazo sin manejar que tumbe el proceso entero.
    montar(jobId, revision.encargo).catch((e) => {
      console.error('[' + jobId + '] error no capturado: ' + (e && e.message));
    });
  });
});

servidor.listen(PUERTO, () => {
  console.log('ams-montaje ' + VERSION + ' escuchando en el puerto ' + PUERTO +
    (BUCKET_FIJO ? ' (bucket: ' + BUCKET_FIJO + ')' : ' (bucket: el que traiga cada petición)'));
});
