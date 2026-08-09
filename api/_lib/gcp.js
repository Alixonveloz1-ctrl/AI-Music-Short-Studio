// ════════════════════════════════════════════════════════════════
// GOOGLE CLOUD — credenciales, tokens, URLs firmadas y almacenamiento.
//
// Lo que está bajo api/_lib/ NO se despliega como función (Vercel
// ignora lo que empieza por "_"): es un módulo compartido.
//
// SOLO HAY DOS VARIABLES OBLIGATORIAS:
//
//   GCP_SERVICE_ACCOUNT   el JSON completo de la cuenta de servicio
//   GCS_OUTPUT_BUCKET     el nombre del bucket
//
// Todo lo demás se deduce. El proyecto sale del `project_id` de la
// propia credencial, así que cambiar de cuenta de Google Cloud es
// cambiar esas dos variables y redeployar: nada más. Los modelos y
// las regiones tienen valor por defecto y su variable existe solo por
// si un proyecto concreto no tiene acceso a alguno.
//
// Sin dependencias: el JWT y la firma V4 se hacen con node:crypto.
// Una dependencia menos es una cosa menos que puede romperse en un
// deploy que no se puede depurar desde el móvil.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

// ─── Configuración ───

function env(nombre, porDefecto) {
  const v = (process.env[nombre] || '').trim();
  return v || porDefecto || '';
}

// Getters, no constantes: el valor se lee de process.env en cada acceso, así
// que siempre refleja el entorno actual y las pruebas pueden variarlo sin
// trucos con la caché de módulos.
const cfg = {
  get location() {
    return env('GCP_LOCATION', 'us-central1');
  },

  // Imagen.
  get imageModel() {
    return env('IMAGE_MODEL', 'imagen-4.0-generate-001');
  },
  get imageLocation() {
    return env('IMAGE_LOCATION', this.location);
  },

  // Vídeo. Lite por defecto: un corto son decenas de clips y Veo cobra por
  // segundo generado.
  get veoModel() {
    return env('VEO_MODEL', 'veo-3.1-lite-generate-001');
  },
  get veoLocation() {
    return env('VEO_LOCATION', this.location);
  },

  // Música instrumental. El PRD la llama «Lyra»; en Vertex AI es Lyria.
  get musicModel() {
    return env('MUSIC_MODEL', 'lyria-002');
  },
  get musicLocation() {
    return env('MUSIC_LOCATION', this.location);
  },

  // Capa creativa. Sin clave se usa el planificador determinista interno, que
  // es un modo válido y no un fallo.
  get anthropicKey() {
    return env('ANTHROPIC_API_KEY');
  },
  get anthropicModel() {
    return env('ANTHROPIC_MODEL', 'claude-opus-4-5-20251101');
  },

  get bucket() {
    return env('GCS_OUTPUT_BUCKET').replace(/^gs:\/\//, '').replace(/\/+$/, '');
  },

  // Carpeta propia dentro del bucket. No hay que configurarla: existe para que
  // el bucket se pueda compartir con otros proyectos sin mezclar archivos.
  get prefix() {
    return env('GCS_PREFIX', 'music-studio').replace(/^\/+|\/+$/g, '') || 'music-studio';
  },

  // Región donde corre el montaje del MP4.
  get montajeRegion() {
    return env('MONTAJE_REGION', this.location);
  },
};

// ─── Credenciales ───

class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.configError = true;
  }
}

// Nombres aceptados, el primero es el canónico. Los alias existen para que un
// despliegue que ya traiga la variable con otro nombre siga funcionando.
const KEY_VARS = ['GCP_SERVICE_ACCOUNT', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_CREDENTIALS'];

function loadServiceAccount() {
  let raw = '';
  for (const nombre of KEY_VARS) {
    const v = (process.env[nombre] || '').trim();
    if (v) { raw = v; break; }
  }
  if (!raw) throw new ConfigError('GCP_SERVICE_ACCOUNT no configurado en Vercel');

  // Pegar JSON multilínea en el panel desde el móvil sale mal a menudo, así que
  // también se acepta el mismo JSON en base64.
  let texto = raw;
  if (raw[0] !== '{') {
    try {
      texto = Buffer.from(raw, 'base64').toString('utf8').trim();
    } catch (e) {
      throw new ConfigError('GCP_SERVICE_ACCOUNT no es JSON ni base64 válido');
    }
  }

  let sa;
  try {
    sa = JSON.parse(texto);
  } catch (e) {
    throw new ConfigError(
      'GCP_SERVICE_ACCOUNT no es JSON válido — pega el archivo completo de la cuenta de servicio',
    );
  }

  if (!sa.project_id) throw new ConfigError('GCP_SERVICE_ACCOUNT sin project_id — ¿pegaste el JSON completo?');
  if (!sa.client_email) throw new ConfigError('GCP_SERVICE_ACCOUNT sin client_email');
  if (!sa.private_key) throw new ConfigError('GCP_SERVICE_ACCOUNT sin private_key');

  // Los paneles convierten a menudo los saltos de línea reales en los dos
  // caracteres \ y n, y entonces la clave no se puede parsear.
  if (sa.private_key.indexOf('\\n') !== -1) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  if (!sa.token_uri) sa.token_uri = 'https://oauth2.googleapis.com/token';

  return sa;
}

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// Firma con node:crypto directamente: el PEM va tal cual a createSign, que se
// encarga de las cabeceras y los saltos de línea. Decodificarlo a mano falla en
// cuanto la clave arrastra un espacio de más.
function signJwt(sa, payload) {
  const entrada = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url(payload);
  const firmador = crypto.createSign('RSA-SHA256');
  firmador.update(entrada);
  const firma = firmador
    .sign(sa.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return entrada + '.' + firma;
}

async function exchangeJwt(sa, assertion) {
  const r = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + assertion,
  });
  return r.json();
}

// Los tokens duran una hora y Vercel reutiliza instancias calientes entre
// peticiones, así que cachearlos ahorra una ida y vuelta en casi todas.
let tokenCache = { key: null, token: null, expiresAt: 0 };

async function getAccessToken(sa) {
  const ahora = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.key === sa.client_email && tokenCache.expiresAt > ahora + 60) {
    return tokenCache.token;
  }

  const d = await exchangeJwt(
    sa,
    signJwt(sa, {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: sa.token_uri,
      iat: ahora,
      exp: ahora + 3600,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    }),
  );

  if (!d.access_token) {
    throw new Error(
      'OAuth: ' + (d.error_description || d.error || JSON.stringify(d).slice(0, 200)),
    );
  }

  tokenCache = {
    key: sa.client_email,
    token: d.access_token,
    expiresAt: ahora + (Number(d.expires_in) || 3600),
  };
  return d.access_token;
}

/** Credenciales, proyecto y token en una sola llamada. */
async function auth() {
  const sa = loadServiceAccount();
  const token = await getAccessToken(sa);
  return { sa, projectId: sa.project_id, token };
}

// ─── URL firmada V4 ───
//
// Sirve para GET (descarga) y PUT (subida directa desde el navegador), así que
// el material pesado nunca pasa por una función de Vercel.

function signedUrl(sa, bucket, objectPath, opciones) {
  const o = opciones || {};
  const metodo = o.method || 'GET';
  const expira = o.expiresSeconds || 604800;

  const datetime = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const fecha = datetime.slice(0, 8);

  const alcance = fecha + '/auto/storage/goog4_request';
  const params = [
    ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential', sa.client_email + '/' + alcance],
    ['X-Goog-Date', datetime],
    ['X-Goog-Expires', String(expira)],
    ['X-Goog-SignedHeaders', 'host'],
  ];

  // Sin esto el navegador ABRE el MP4 en una pestaña y sólo deja verlo. La
  // cabecera la pone GCS a partir de este parámetro, y va FIRMADA: añadirla a
  // la URL después de firmar hace que se rechace la petición entera.
  if (o.descargarComo) {
    const nombre = String(o.descargarComo).replace(/[^\w.-]+/g, '_').slice(0, 120) || 'descarga';
    params.push(['response-content-disposition', 'attachment; filename="' + nombre + '"']);
  }

  // RFC 3986: encodeURIComponent deja pasar !'()* y la firma canónica no los
  // admite. Los parámetros van ordenados alfabéticamente.
  const enc = (s) =>
    encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const query = params.map(([k, v]) => enc(k) + '=' + enc(v)).sort().join('&');

  const ruta = objectPath.split('/').map(encodeURIComponent).join('/');
  const canonica = [
    metodo,
    '/' + bucket + '/' + ruta,
    query,
    'host:storage.googleapis.com',
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const aFirmar = [
    'GOOG4-RSA-SHA256',
    datetime,
    alcance,
    crypto.createHash('sha256').update(canonica).digest('hex'),
  ].join('\n');

  const firmador = crypto.createSign('RSA-SHA256');
  firmador.update(aFirmar);
  const firma = firmador.sign(sa.private_key, 'hex');

  return (
    'https://storage.googleapis.com/' + bucket + '/' + ruta + '?' + query + '&X-Goog-Signature=' + firma
  );
}

// ─── CORS del bucket ───
//
// El navegador hace dos cosas de origen cruzado con el bucket: LEE las imágenes
// y los clips (revisarlos, reproducirlos) y ESCRIBE con URLs firmadas PUT. Un
// PUT que lleva Content-Type se pregunta antes (preflight), así que el bucket
// tiene que permitir PUT y OPTIONS, no sólo GET.
//
// Una sola lista, en un solo sitio: el PATCH REEMPLAZA el array entero, así que
// dos sitios que la escriban con listas distintas se revocan permisos el uno al
// otro en silencio, y el fallo aparece como un «Load failed» que no señala nada.
const CORS_BUCKET = [
  {
    origin: ['*'],
    method: ['GET', 'HEAD', 'PUT', 'POST', 'OPTIONS'],
    responseHeader: [
      'Content-Type',
      'Content-Length',
      'Content-Range',
      'Content-Disposition',
      'ETag',
      'x-goog-resumable',
      'Authorization',
    ],
    maxAgeSeconds: 3600,
  },
];

async function asegurarCors(token, bucket) {
  try {
    const r = await fetch('https://storage.googleapis.com/storage/v1/b/' + bucket, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cors: CORS_BUCKET }),
    });
    if (!r.ok) return { ok: false, error: r.status + ' — ' + (await r.text()).slice(0, 160) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Cloud Storage ───

async function gcsUpload(token, bucket, objectPath, body, contentType, opciones) {
  const o = opciones || {};
  let url =
    'https://storage.googleapis.com/upload/storage/v1/b/' + bucket + '/o' +
    '?uploadType=media&name=' + encodeURIComponent(objectPath);
  // Precondición de escritura: ver almacen.js. `0` significa «solo si no
  // existe todavía».
  if (o.ifGenerationMatch !== undefined && o.ifGenerationMatch !== null) {
    url += '&ifGenerationMatch=' + encodeURIComponent(String(o.ifGenerationMatch));
  }
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body,
  });
  if (!r.ok) {
    const err = new Error(
      'GCS subida ' + objectPath + ': ' + r.status + ' ' + (await r.text()).slice(0, 200),
    );
    err.status = r.status;
    throw err;
  }
  return r.json().catch(() => ({}));
}

/** Devuelve el texto del objeto y su número de generación, o null si no existe. */
async function gcsReadText(token, bucket, objectPath) {
  const base =
    'https://storage.googleapis.com/storage/v1/b/' + bucket + '/o/' + encodeURIComponent(objectPath);
  const r = await fetch(base + '?alt=media', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const texto = await r.text();
  // La generación viene en la cabecera, así se lee el contenido y la versión
  // con UNA sola petición en vez de dos.
  const generacion = r.headers.get('x-goog-generation') || null;
  return { texto, generacion };
}

/**
 * Copia un objeto dentro de Google, sin que los bytes pasen por Vercel.
 *
 * Es `rewriteTo` y no `copyTo` porque los objetos grandes se copian por tramos:
 * Google devuelve un testigo y hay que volver a llamar hasta que dice `done`.
 * Un MP4 de tres minutos suele ir en una sola pasada, pero con el testigo
 * funciona igual cuando no.
 *
 * Devuelve el tamaño en bytes del objeto resultante.
 */
async function gcsCopy(token, bucketOrigen, objetoOrigen, bucketDestino, objetoDestino) {
  const base =
    'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucketOrigen) +
    '/o/' + encodeURIComponent(objetoOrigen) +
    '/rewriteTo/b/' + encodeURIComponent(bucketDestino) +
    '/o/' + encodeURIComponent(objetoDestino);

  let testigo = '';
  for (let vuelta = 0; vuelta < 40; vuelta += 1) {
    const r = await fetch(base + (testigo ? '?rewriteToken=' + encodeURIComponent(testigo) : ''), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) {
      const detalle = (await r.text().catch(() => '')).slice(0, 200);
      const err = new Error('No se pudo copiar ' + objetoOrigen + ': ' + r.status + ' ' + detalle);
      err.status = 502;
      throw err;
    }
    const d = await r.json().catch(() => ({}));
    if (d.done) return Number((d.resource && d.resource.size) || d.objectSize || 0);
    testigo = d.rewriteToken || '';
    if (!testigo) break;
  }
  const err = new Error('La copia de ' + objetoOrigen + ' no terminó tras muchos intentos.');
  err.status = 502;
  throw err;
}

async function gcsDelete(token, bucket, objectPath) {
  const r = await fetch(
    'https://storage.googleapis.com/storage/v1/b/' + bucket + '/o/' + encodeURIComponent(objectPath),
    { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } },
  );
  return r.ok || r.status === 404;
}

async function gcsList(token, bucket, prefijo, opciones) {
  const o = opciones || {};
  const salida = [];
  let pageToken = '';
  do {
    let url =
      'https://storage.googleapis.com/storage/v1/b/' + bucket + '/o' +
      '?prefix=' + encodeURIComponent(prefijo) + '&maxResults=1000';
    if (o.delimiter) url += '&delimiter=' + encodeURIComponent(o.delimiter);
    if (o.fields) url += '&fields=' + encodeURIComponent(o.fields);
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('GCS lista ' + prefijo + ': ' + r.status);
    const d = await r.json();
    if (o.delimiter) {
      for (const p of d.prefixes || []) salida.push(p);
    } else {
      for (const item of d.items || []) salida.push(item);
    }
    pageToken = d.nextPageToken || '';
  } while (pageToken);
  return salida;
}

// ─── Vertex AI ───

/**
 * Endpoint de un publisher model. `location: 'global'` usa el host no regional;
 * cualquier otra, el regional.
 */
function vertexUrl(projectId, location, model, method) {
  const host =
    location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : 'https://' + location + '-aiplatform.googleapis.com';
  return (
    host + '/v1/projects/' + projectId + '/locations/' + location +
    '/publishers/google/models/' + model + ':' + method
  );
}

module.exports = {
  cfg,
  ConfigError,
  loadServiceAccount,
  getAccessToken,
  auth,
  signedUrl,
  asegurarCors,
  CORS_BUCKET,
  gcsUpload,
  gcsReadText,
  gcsCopy,
  gcsDelete,
  gcsList,
  vertexUrl,
};
