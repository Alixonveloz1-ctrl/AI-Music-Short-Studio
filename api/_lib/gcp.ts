// ════════════════════════════════════════════════════════════════
// GOOGLE CLOUD — credenciales, tokens, URLs firmadas y montaje.
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
// las regiones tienen valores por defecto y solo existe una variable
// para cada uno por si un proyecto concreto no tiene acceso a alguno
// — no hay que definirlas.
//
// Sin dependencias: el JWT y la firma V4 se hacen con node:crypto.
// Una dependencia menos es una cosa menos que puede romperse en un
// deploy que no se puede depurar desde el móvil.
// ════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';

// ─── Configuración: todo overridable desde Vercel ───

const env = (name: string, fallback = ''): string => {
  const value = (process.env[name] ?? '').trim();
  return value || fallback;
};

/**
 * Getters, no constantes: el valor se lee de `process.env` en cada acceso, así
 * que siempre refleja el entorno actual y las pruebas pueden variarlo sin
 * trucos con la caché de módulos.
 */
export const cfg = {
  /** Región por defecto de Vertex AI. */
  get location() {
    return env('GCP_LOCATION', 'us-central1');
  },

  /** Imagen: Imagen 4 en Vertex AI. */
  get imageModel() {
    return env('IMAGE_MODEL', 'imagen-4.0-generate-001');
  },
  get imageLocation() {
    return env('IMAGE_LOCATION', this.location);
  },

  /** Vídeo: Veo. Lite por defecto — un corto son decenas de clips. */
  get veoModel() {
    return env('VEO_MODEL', 'veo-3.1-lite-generate-001');
  },
  get veoLocation() {
    return env('VEO_LOCATION', this.location);
  },

  /** Música instrumental: el PRD la llama «Lyra»; en Vertex AI es Lyria. */
  get musicModel() {
    return env('MUSIC_MODEL', 'lyria-002');
  },
  get musicLocation() {
    return env('MUSIC_LOCATION', this.location);
  },

  /** Capa creativa. Vacío = planificador determinista interno. */
  get anthropicKey() {
    return env('ANTHROPIC_API_KEY');
  },
  get anthropicModel() {
    return env('ANTHROPIC_MODEL', 'claude-opus-4-5-20251101');
  },

  get bucket() {
    return env('GCS_OUTPUT_BUCKET')
      .replace(/^gs:\/\//, '')
      .replace(/\/+$/, '');
  },

  /**
   * Carpeta propia dentro del bucket. No hay que configurarla: existe para que
   * el bucket se pueda compartir con otra cosa sin mezclar archivos.
   */
  get prefix() {
    return env('GCS_PREFIX', 'music-studio').replace(/^\/+|\/+$/g, '') || 'music-studio';
  },
};

// ─── Credenciales ───

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri: string;
}

/**
 * Nombres aceptados para la credencial, el primero es el canónico. Los alias
 * existen para que un despliegue que ya traiga la variable con otro nombre
 * siga funcionando sin tener que renombrarla en Vercel.
 */
const KEY_VARS = ['GCP_SERVICE_ACCOUNT', 'GOOGLE_SERVICE_ACCOUNT_KEY', 'GOOGLE_CREDENTIALS'];

export function loadServiceAccount(): ServiceAccount {
  let raw = '';
  for (const name of KEY_VARS) {
    const value = (process.env[name] ?? '').trim();
    if (value) {
      raw = value;
      break;
    }
  }
  if (!raw) throw new ConfigError('GCP_SERVICE_ACCOUNT no configurado en Vercel');

  // Pegar JSON multilínea en un campo de un panel desde el móvil sale mal a
  // menudo, así que también se acepta el mismo JSON en base64.
  let text = raw;
  if (!raw.startsWith('{')) {
    try {
      text = Buffer.from(raw, 'base64').toString('utf8').trim();
    } catch {
      throw new ConfigError('GCP_SERVICE_ACCOUNT no es JSON ni base64 válido');
    }
  }

  let sa: Partial<ServiceAccount>;
  try {
    sa = JSON.parse(text) as Partial<ServiceAccount>;
  } catch {
    throw new ConfigError(
      'GCP_SERVICE_ACCOUNT no es JSON válido — pega el archivo completo de la service account',
    );
  }

  if (!sa.project_id) {
    throw new ConfigError('GCP_SERVICE_ACCOUNT sin project_id — ¿pegaste el JSON completo?');
  }
  if (!sa.client_email) throw new ConfigError('GCP_SERVICE_ACCOUNT sin client_email');
  if (!sa.private_key) throw new ConfigError('GCP_SERVICE_ACCOUNT sin private_key');

  // Los paneles convierten a menudo los saltos de línea reales en los dos
  // caracteres \ y n, y entonces la clave no se puede parsear.
  if (sa.private_key.includes('\\n')) sa.private_key = sa.private_key.replace(/\\n/g, '\n');

  return {
    project_id: sa.project_id,
    client_email: sa.client_email,
    private_key: sa.private_key,
    token_uri: sa.token_uri || 'https://oauth2.googleapis.com/token',
  };
}

const b64url = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Firma con node:crypto directamente: el PEM va tal cual a createSign, que se
 * encarga de cabeceras y saltos de línea. Decodificarlo a mano falla en cuanto
 * la clave arrastra un espacio de más.
 */
function signJwt(sa: ServiceAccount, payload: Record<string, unknown>): string {
  const input = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  const sig = signer
    .sign(sa.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${input}.${sig}`;
}

async function exchangeJwt(sa: ServiceAccount, assertion: string): Promise<Record<string, string>> {
  const response = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer' +
      `&assertion=${assertion}`,
  });
  return (await response.json()) as Record<string, string>;
}

// Los tokens duran una hora y Vercel reutiliza instancias calientes entre
// peticiones, así que cachearlos ahorra una ida y vuelta en casi todas.
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.key === sa.client_email && tokenCache.expiresAt > now + 60) {
    return tokenCache.token;
  }

  const data = await exchangeJwt(
    sa,
    signJwt(sa, {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    }),
  );

  const token = data['access_token'];
  if (!token) {
    throw new Error(
      `OAuth: ${data['error_description'] || data['error'] || JSON.stringify(data).slice(0, 200)}`,
    );
  }

  tokenCache = {
    key: sa.client_email,
    token,
    expiresAt: now + (Number(data['expires_in']) || 3600),
  };
  return token;
}

/**
 * Token de identidad firmado por Google. Un Cloud Run privado
 * (`--no-allow-unauthenticated`) necesita esto, con la URL del servicio como
 * audiencia, no un token de acceso.
 */
export async function getIdToken(sa: ServiceAccount, audience: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const data = await exchangeJwt(
    sa,
    signJwt(sa, {
      iss: sa.client_email,
      sub: sa.client_email,
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
      target_audience: audience,
    }),
  );
  const idToken = data['id_token'];
  if (!idToken) {
    throw new Error(`ID token: ${data['error_description'] || data['error'] || 'sin id_token'}`);
  }
  return idToken;
}

/** Credenciales, proyecto y token en una sola llamada. */
export async function auth(): Promise<{ sa: ServiceAccount; projectId: string; token: string }> {
  const sa = loadServiceAccount();
  const token = await getAccessToken(sa);
  return { sa, projectId: sa.project_id, token };
}

// ─── URL firmada V4 ───

export interface SignedUrlOptions {
  method?: 'GET' | 'PUT';
  expiresSeconds?: number;
  /** Fuerza la descarga con este nombre en vez de reproducir en el navegador. */
  descargarComo?: string;
}

/**
 * Sirve para GET (descarga) y PUT (subida directa desde el navegador), así que
 * el material pesado nunca pasa por una función de Vercel.
 */
export function signedUrl(
  sa: ServiceAccount,
  bucket: string,
  objectPath: string,
  { method = 'GET', expiresSeconds = 604_800, descargarComo = '' }: SignedUrlOptions = {},
): string {
  const datetime = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const date = datetime.slice(0, 8);

  const credentialScope = `${date}/auto/storage/goog4_request`;
  const params: Array<[string, string]> = [
    ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
    ['X-Goog-Credential', `${sa.client_email}/${credentialScope}`],
    ['X-Goog-Date', datetime],
    ['X-Goog-Expires', String(expiresSeconds)],
    ['X-Goog-SignedHeaders', 'host'],
  ];

  // Sin esto el navegador ABRE el MP4 en una pestaña y sólo deja verlo. La
  // cabecera la pone GCS a partir de este parámetro, y va FIRMADA: añadirla a
  // la URL después de firmar hace que se rechace la petición entera.
  if (descargarComo) {
    const nombre = descargarComo.replace(/[^\w.-]+/g, '_').slice(0, 120) || 'descarga';
    params.push(['response-content-disposition', `attachment; filename="${nombre}"`]);
  }

  // RFC 3986: encodeURIComponent deja pasar !'()* y la firma canónica no los
  // admite. Los parámetros van ordenados alfabéticamente.
  const enc = (s: string): string =>
    encodeURIComponent(s).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const queryParams = params
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .sort()
    .join('&');

  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  const canonicalRequest = [
    method,
    `/${bucket}/${encodedPath}`,
    queryParams,
    'host:storage.googleapis.com',
    '',
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'GOOG4-RSA-SHA256',
    datetime,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(stringToSign);
  const signature = signer.sign(sa.private_key, 'hex');

  return `https://storage.googleapis.com/${bucket}/${encodedPath}?${queryParams}&X-Goog-Signature=${signature}`;
}

// ─── CORS del bucket ───
//
// El navegador hace dos cosas de origen cruzado con el bucket: LEE los clips y
// las imágenes (reproducirlos, revisarlos) y ESCRIBE el material del montaje
// con URLs firmadas PUT. Un PUT que lleva Content-Type se pregunta antes
// (preflight), así que el bucket tiene que permitir PUT y OPTIONS, no sólo GET.
//
// Una sola lista, en un solo sitio: el PATCH REEMPLAZA el array entero, así que
// dos sitios que la escriban con listas distintas se revocan permisos el uno al
// otro en silencio.
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

export async function asegurarCors(
  token: string,
  bucket: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${bucket}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cors: CORS_BUCKET }),
    });
    if (!response.ok) {
      return { ok: false, error: `${response.status} — ${(await response.text()).slice(0, 160)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

// ─── Cloud Storage ───

export async function gcsUpload(
  token: string,
  bucket: string,
  objectPath: string,
  body: Buffer | string,
  contentType = 'application/octet-stream',
): Promise<void> {
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o` +
    `?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body,
  });
  if (!response.ok) {
    throw new Error(
      `GCS subida ${objectPath}: ${response.status} ${(await response.text()).slice(0, 200)}`,
    );
  }
}

export async function gcsReadText(
  token: string,
  bucket: string,
  objectPath: string,
): Promise<string | null> {
  const url =
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/` +
    `${encodeURIComponent(objectPath)}?alt=media`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) return null;
  return response.text();
}

// ─── Vertex AI ───

/**
 * Endpoint de un publisher model. `location: 'global'` usa el host no regional;
 * cualquier otra, el regional.
 */
export function vertexUrl(
  projectId: string,
  location: string,
  model: string,
  method: string,
): string {
  const host =
    location === 'global'
      ? 'https://aiplatform.googleapis.com'
      : `https://${location}-aiplatform.googleapis.com`;
  return `${host}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:${method}`;
}
