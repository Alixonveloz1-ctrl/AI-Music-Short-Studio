// ════════════════════════════════════════════════════════════════
// HTTP — el preámbulo que comparten todas las funciones de api/.
//
// CORS, comprobación del método, lectura del cuerpo, la puerta de
// seguridad y una forma única de contestar los errores.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const { ConfigError } = require('./gcp');

// ─── Puerta de seguridad ───
//
// IDEA: proteger los créditos. Cada endpoint exige una cabecera "x-app-key"
// igual a la variable APP_KEY configurada en Vercel. Sin ella responde 401 y no
// gasta ni un crédito. Generar un corto son decenas de llamadas a Veo, así que
// una API abierta es dinero regalado a quien encuentre la URL.
//
// A PRUEBA DE BLOQUEO, PERO NO EN PRODUCCIÓN. Si APP_KEY no está configurada:
//   - en desarrollo o en una vista previa: TODO queda ABIERTO, para no quedarte
//     fuera mientras pruebas.
//   - en PRODUCCIÓN: se cierra. Un fallo de configuración —la variable borrada,
//     renombrada o no propagada a un entorno— no puede costar dinero.

function modoAbierto() {
  if (process.env.APP_KEY) return false;
  return (process.env.VERCEL_ENV || 'development') !== 'production';
}

function claveCorrecta(req) {
  const clave = process.env.APP_KEY || '';
  if (!clave) return modoAbierto();
  const recibida = String((req.headers && (req.headers['x-app-key'] || req.headers['X-App-Key'])) || '');
  const a = Buffer.from(recibida);
  const b = Buffer.from(clave);
  // Comparación en tiempo constante; primero descarta por longitud, porque
  // timingSafeEqual lanza si los tamaños no coinciden.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function comprobarClave(req, res) {
  if (claveCorrecta(req)) return true;

  // Sin APP_KEY en producción el mensaje tiene que decir la verdad: no es que la
  // contraseña esté mal, es que falta configurar la variable. Si no, verías
  // «contraseña incorrecta» y estarías horas probando contraseñas.
  if (!process.env.APP_KEY) {
    res.status(401).json({
      error: 'Falta configurar APP_KEY en Vercel. La API está cerrada por seguridad hasta que la configures.',
      code: 'APP_AUTH',
      sinClave: true,
    });
    return false;
  }

  // El marcador code:'APP_AUTH' distingue ESTE 401 (la contraseña de la app) de
  // un 401 que venga de Google o de Anthropic. Sin él, el navegador confunde
  // «Google rechazó la credencial» con «tu sesión expiró» y te echa al login
  // tapando el error de verdad.
  res.status(401).json({ error: 'No autorizado. Vuelve a entrar con tu contraseña.', code: 'APP_AUTH' });
  return false;
}

// ─── Preámbulo ───

const CABECERAS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-app-key',
};

/**
 * CORS, preflight, método y clave. Devuelve true cuando el endpoint DEBE
 * PARAR porque la respuesta ya está cerrada.
 *
 *   if (empezar(req, res, ['POST'])) return;
 */
function empezar(req, res, metodos, opciones) {
  const o = opciones || {};
  for (const [k, v] of Object.entries(CABECERAS)) res.setHeader(k, v);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }

  const permitidos = metodos || ['POST'];
  if (permitidos.indexOf(req.method) === -1) {
    res.status(405).json({ error: 'Método no permitido' });
    return true;
  }

  // /api/salud se puede consultar sin clave: es la pantalla que dice qué está
  // mal configurado, y exigir una clave para verla es justo lo contrario de lo
  // que hace falta cuando algo no arranca. No gasta créditos ni revela secretos.
  if (!o.sinClave && !comprobarClave(req, res)) return true;

  return false;
}

/**
 * El cuerpo de la petición como objeto.
 *
 * Vercel a veces lo entrega ya parseado, a veces como cadena y a veces no lo
 * entrega. Las tres se tratan aquí para que ningún endpoint tenga que repetirlo.
 */
async function cuerpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  try {
    const trozos = [];
    for await (const t of req) trozos.push(t);
    const texto = Buffer.concat(trozos).toString('utf8');
    return texto ? JSON.parse(texto) : {};
  } catch (e) {
    return {};
  }
}

/** Un parámetro obligatorio de la query o del cuerpo. */
function requerido(datos, nombre) {
  const v = datos && datos[nombre];
  if (v === undefined || v === null || v === '') {
    throw new ErrorPeticion(400, 'Falta el parámetro "' + nombre + '"');
  }
  return v;
}

class ErrorPeticion extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ErrorPeticion';
    this.status = status;
  }
}

/**
 * Una sola forma de contestar cualquier fallo.
 *
 * Los errores de configuración llevan `configError: true` para que la interfaz
 * pueda decir «esto lo arreglas en Vercel» en vez de «vuelve a intentarlo»,
 * que es el consejo equivocado cuando falta una variable.
 */
function fallo(res, e) {
  const status = e && (e.status || (e instanceof ConfigError ? 500 : 500));
  const cuerpoRespuesta = { error: (e && e.message) || 'Error desconocido' };
  if (e && (e.configError || e instanceof ConfigError)) cuerpoRespuesta.configError = true;
  if (e && e.detalle) cuerpoRespuesta.detalle = e.detalle;

  // Al registro de Vercel siempre, aunque la respuesta se recorte: es el único
  // sitio donde se puede leer el fallo completo desde un teléfono.
  console.error('[api]', (e && e.stack) || e);

  try {
    res.status(status).json(cuerpoRespuesta);
  } catch (e2) {
    // La respuesta ya estaba cerrada; no hay nada más que hacer.
  }
}

module.exports = {
  empezar,
  cuerpo,
  requerido,
  fallo,
  ErrorPeticion,
  comprobarClave,
  claveCorrecta,
  modoAbierto,
};
