// ════════════════════════════════════════════════════════════════
// ARCHIVO — servir un archivo del bucket desde NUESTRO dominio.
//
//   GET /api/archivo?u=<url firmada>   ->  los bytes, tal cual
//
// POR QUÉ EXISTE. El usuario guardó la herramienta en la pantalla de inicio del
// iPhone y dejó de poder descargar: «no me deja descargar nada, solo como que se
// recarga la página». Una app de la pantalla de inicio no es una pestaña — no
// tiene barra ni descargador— y iOS tampoco soporta el atributo `download`. Al
// mandarla fuera con target="_blank" tampoco se arregla: iOS no abre Safari,
// abre un navegador incrustado que TAMPOCO sabe descargar, y se queda en blanco.
//
// Lo único que en iOS guarda un archivo desde una web es la hoja de compartir
// (`navigator.share` con un File): deja mandarlo a Fotos o a Archivos. Y para
// construir ese File hay que poder LEER los bytes desde JavaScript.
//
// Ahí está el problema que resuelve este archivo: los bytes están en
// storage.googleapis.com, que es otro origen, y un `fetch` a otro origen
// necesita que ESE servidor dé permiso con cabeceras CORS. El bucket no las da,
// y configurarlas es una orden de gcloud que este usuario no puede lanzar —
// trabaja sólo desde el teléfono. Así que el archivo pasa por aquí, que es el
// mismo origen que la página, y el navegador lo lee sin pedir permiso a nadie.
//
// POR QUÉ ES UNA FUNCIÓN «EDGE» Y NO UNA NORMAL. Una función de Vercel del
// montón no puede devolver más de 4,5 MB, y un corto de tres minutos pesa
// bastante más. Las Edge devuelven la respuesta a chorro, sin ese tope: los
// bytes van pasando de Google al teléfono sin acumularse en ningún sitio.
//
// NO ES UN PROXY ABIERTO, y era el riesgo obvio de hacer esto:
//
//   1. Pide la contraseña de la app, igual que el resto de la API.
//   2. Sólo acepta URLs de storage.googleapis.com.
//   3. Sólo dentro del bucket y la carpeta de esta herramienta.
//   4. La URL tiene que venir FIRMADA por Google y sin caducar; sin eso, Google
//      la rechaza y aquí no hay ninguna credencial que añadir.
//
// Sin las cuatro, cualquiera podría usar la cuenta de Vercel del usuario para
// mover ficheros ajenos a su costa.
// ════════════════════════════════════════════════════════════════

export const config = { runtime: 'edge' };

/** El origen del que se acepta servir. Ningún otro. */
const HOST_PERMITIDO = 'storage.googleapis.com';

function fallo(estado, mensaje) {
  return new Response(JSON.stringify({ error: mensaje }), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * La misma puerta que el resto de la API (ver api/_lib/http.js).
 *
 * Sin APP_KEY configurada: abierto fuera de producción y CERRADO en producción.
 * Un despiste de configuración no puede convertir esto en un proxy público.
 */
function claveCorrecta(req) {
  const clave = (process.env.APP_KEY || '').trim();
  if (!clave) return (process.env.VERCEL_ENV || 'development') !== 'production';
  const recibida = req.headers.get('x-app-key') || '';
  // Comparación de longitud constante a mano: el runtime Edge no trae
  // timingSafeEqual, y comparar con === se rinde en el primer carácter distinto.
  if (recibida.length !== clave.length) return false;
  let diferencia = 0;
  for (let i = 0; i < clave.length; i += 1) diferencia |= recibida.charCodeAt(i) ^ clave.charCodeAt(i);
  return diferencia === 0;
}

/** El prefijo de ruta del que no se puede salir: /<bucket>/<carpeta>/ */
function raizPermitida() {
  const bucket = (process.env.GCS_OUTPUT_BUCKET || '')
    .trim().replace(/^gs:\/\//, '').replace(/\/+$/, '');
  const prefijo = ((process.env.GCS_PREFIX || 'music-studio').trim()
    .replace(/^\/+|\/+$/g, '')) || 'music-studio';
  return bucket ? '/' + bucket + '/' + prefijo + '/' : '';
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'GET') return fallo(405, 'Método no permitido');
  if (!claveCorrecta(req)) return fallo(401, 'No autorizado');

  const pedida = new URL(req.url).searchParams.get('u') || '';
  if (!pedida) return fallo(400, 'Falta el parámetro "u" con la URL del archivo');

  let destino;
  try {
    destino = new URL(pedida);
  } catch (e) {
    return fallo(400, 'La URL del archivo no es válida');
  }

  if (destino.protocol !== 'https:' || destino.hostname !== HOST_PERMITIDO) {
    return fallo(400, 'Esta ruta sólo sirve archivos del almacenamiento del estudio');
  }

  const raiz = raizPermitida();
  if (!raiz) return fallo(500, 'Falta configurar GCS_OUTPUT_BUCKET');
  // decodeURIComponent NO se usa a propósito: la ruta viaja codificada y
  // compararla decodificada dejaría pasar un %2e%2e%2f que suba de carpeta.
  if (destino.pathname.indexOf(raiz) !== 0 || destino.pathname.indexOf('..') !== -1) {
    return fallo(403, 'Ese archivo no pertenece a este estudio');
  }

  let respuesta;
  try {
    respuesta = await fetch(destino.toString(), { headers: { accept: '*/*' } });
  } catch (e) {
    return fallo(502, 'No se pudo leer el archivo del almacenamiento');
  }

  if (!respuesta.ok) {
    // Lo normal aquí es que la firma haya caducado. Se dice, porque la solución
    // —recargar la pantalla para que se firme de nuevo— no es adivinable.
    const motivo = respuesta.status === 403 || respuesta.status === 400
      ? 'El enlace del archivo ha caducado. Recarga la pantalla y vuelve a intentarlo.'
      : 'El almacenamiento respondió ' + respuesta.status;
    return fallo(respuesta.status === 404 ? 404 : 502, motivo);
  }

  // El cuerpo se devuelve A CHORRO, sin leerlo entero: es lo que permite pasar
  // un MP4 de decenas de megas por una función.
  const cabeceras = new Headers();
  cabeceras.set('content-type', respuesta.headers.get('content-type') || 'application/octet-stream');
  const largo = respuesta.headers.get('content-length');
  // El tamaño se conserva porque la pantalla lo usa para enseñar el progreso de
  // la descarga; sin él, el usuario mira una barra que no avanza.
  if (largo) cabeceras.set('content-length', largo);
  cabeceras.set('cache-control', 'no-store');
  // Que no se lo quede ningún intermediario ni se enseñe como página.
  cabeceras.set('x-content-type-options', 'nosniff');

  return new Response(respuesta.body, { status: 200, headers: cabeceras });
}
