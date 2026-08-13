// ════════════════════════════════════════════════════════════════
// SALUD — ¿qué cuenta de Google Cloud está usando este despliegue, y
// qué le falta para funcionar?
//
// Existe para que cambiar de cuenta se pueda verificar DESDE LA PROPIA
// APP, en el móvil, sin ir a buscar nada por la consola. Dice qué está
// bien, qué falta y CÓMO se arregla cada cosa.
//
// No requiere APP_KEY a propósito: es la pantalla que explica por qué
// no arranca nada, y pedir una contraseña para verla es justo lo
// contrario de lo que hace falta en ese momento. No gasta créditos y
// no devuelve ningún secreto: ni la clave privada, ni el JSON.
// ════════════════════════════════════════════════════════════════
const { cfg, loadServiceAccount, getAccessToken } = require('./_lib/gcp');
const { empezar } = require('./_lib/http');

// bot@mi-proyecto.iam.gserviceaccount.com -> bot…ot@mi-proyecto.iam.gserviceaccount.com
function taparCorreo(correo) {
  const arroba = String(correo || '').indexOf('@');
  if (arroba < 0) return '';
  const local = correo.slice(0, arroba);
  const dominio = correo.slice(arroba);
  if (local.length <= 6) return local[0] + '…' + dominio;
  return local.slice(0, 5) + '…' + local.slice(-2) + dominio;
}

// Las APIs que hacen falta, con para qué sirve cada una. Se pregunta a Service
// Usage en vez de deducirlo de una llamada fallida: así la respuesta es «está
// apagada» y no «algo salió mal».
const SERVICIOS = [
  ['aiplatform.googleapis.com', 'Vertex AI', 'generar imágenes, vídeo y música', true],
  ['storage.googleapis.com', 'Cloud Storage', 'guardar el proyecto y el material', true],
  ['cloudbuild.googleapis.com', 'Cloud Build', 'montar el MP4 final', true],
];

// Los roles que necesita la cuenta de servicio, con su nombre en pantalla.
const ROLES = [
  ['roles/aiplatform.user', 'Usuario de Vertex AI', 'llamar a Imagen, Veo y Lyria'],
  ['roles/storage.admin', 'Administrador de Storage', 'leer y escribir en el bucket, y ajustar su CORS'],
  ['roles/cloudbuild.builds.editor', 'Editor de Cloud Build', 'lanzar el montaje'],
  ['roles/iam.serviceAccountUser', 'Usuario de cuenta de servicio', 'el que más se olvida; sin él el montaje falla'],
  ['roles/logging.logWriter', 'Escritor de registros', 'que el montaje pueda escribir su registro'],
];

/**
 * De qué commit salió lo que se está sirviendo.
 *
 * `VERCEL_GIT_COMMIT_SHA` y sus hermanas las pone Vercel sola en cada
 * despliegue; no hay que configurar nada. El mensaje del commit es lo que de
 * verdad sirve para reconocerlo de un vistazo — un sha de siete letras no le
 * dice nada a nadie.
 */
function versionDesplegada() {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
  if (!sha) {
    return { conocida: false, nota: 'Esto no se está ejecutando en Vercel, así que no hay despliegue que identificar.' };
  }
  return {
    conocida: true,
    commit: sha.slice(0, 7),
    mensaje: (process.env.VERCEL_GIT_COMMIT_MESSAGE || '').split('\n')[0].slice(0, 160),
    rama: process.env.VERCEL_GIT_COMMIT_REF || '',
    entorno: process.env.VERCEL_ENV || '',
  };
}

module.exports = async function handler(req, res) {
  // sinClave: esta pantalla tiene que poder verse aunque APP_KEY no esté puesta.
  if (empezar(req, res, ['GET', 'POST'], { sinClave: true })) return;

  const salida = {
    // QUÉ VERSIÓN ESTÁ DESPLEGADA. Existe porque la pregunta se hizo y no había
    // forma de contestarla: «¿tú estás desplegando en main? porque yo no veo
    // nada de los cambios». Sin esto, saber si el navegador está viendo la
    // última versión exige entrar en el panel de Vercel desde el móvil.
    //
    // Vercel pone estas variables en cada despliegue. Fuera de Vercel no
    // existen, y entonces se dice eso mismo en vez de inventar una versión.
    version: versionDesplegada(),
    app: {
      appKey: process.env.APP_KEY
        ? { ok: true }
        : {
            ok: false,
            aviso: 'APP_KEY no está configurada. En producción la API queda cerrada; ' +
              'ponla en Vercel para poder usar la herramienta.',
          },
      planificador: cfg.anthropicKey
        ? { modo: 'claude', modelo: cfg.anthropicModel }
        : { modo: 'interno', nota: 'Sin ANTHROPIC_API_KEY se usa el planificador determinista. Es un modo válido.' },
    },
    cuentaServicio: { configurada: false },
    bucket: { configurado: false },
    // Cada modelo con la variable que lo cambia, para que un proyecto sin
    // acceso a alguno se pueda apuntar a otro sin tocar el código.
    modelos: {
      imagen: { valor: cfg.imageModel, variable: 'IMAGE_MODEL', region: cfg.imageLocation },
      video: { valor: cfg.veoModel, variable: 'VEO_MODEL', region: cfg.veoLocation },
      musica: { valor: cfg.musicModel, variable: 'MUSIC_MODEL', region: cfg.musicLocation },
    },
    comprobaciones: {},
    servicios: [],
    rolesNecesarios: ROLES.map(([id, nombre, para]) => ({ id, nombre, para })),
    faltan: [],
  };

  const falta = (que) => salida.faltan.push(que);
  // Una sola forma de contestar: `listo` se calcula aquí, así que ningún
  // camino de salida puede olvidarse de ponerlo y dejar a la interfaz
  // adivinando si la configuración está completa o no.
  const responder = () => {
    salida.listo = salida.faltan.length === 0;
    return res.status(200).json(salida);
  };

  // ─── La credencial ───
  let sa;
  try {
    sa = loadServiceAccount();
  } catch (e) {
    salida.cuentaServicio.error = e.message;
    falta('Pega el JSON de la cuenta de servicio en la variable GCP_SERVICE_ACCOUNT de Vercel y vuelve a desplegar.');
    return responder();
  }

  salida.cuentaServicio = {
    configurada: true,
    proyecto: sa.project_id,
    correo: taparCorreo(sa.client_email),
    claveValida: String(sa.private_key).indexOf('PRIVATE KEY') !== -1,
  };
  if (!salida.cuentaServicio.claveValida) {
    salida.cuentaServicio.error = 'el JSON no contiene una private_key válida';
    falta('Vuelve a descargar la clave JSON de la cuenta de servicio: la que hay está incompleta.');
  }

  // ─── El bucket ───
  const bruto = (process.env.GCS_OUTPUT_BUCKET || '').trim();
  if (cfg.bucket) {
    salida.bucket = { configurado: true, nombre: cfg.bucket, carpeta: cfg.prefix };
    if (bruto.indexOf('gs://') === 0) {
      salida.bucket.aviso = 'quita el prefijo gs:// — se espera solo el nombre del bucket';
    }
  } else {
    salida.bucket = { configurado: false, error: 'GCS_OUTPUT_BUCKET no está configurado' };
    falta('Pon el nombre del bucket (sin gs://) en la variable GCS_OUTPUT_BUCKET de Vercel.');
  }

  // ─── ¿La credencial vale? ───
  let token;
  try {
    token = await getAccessToken(sa);
    salida.comprobaciones.credenciales = { ok: true };
  } catch (e) {
    salida.comprobaciones.credenciales = { ok: false, error: e.message };
    falta('Google rechazó la credencial. Comprueba que la clave no esté revocada y que la cuenta siga activa.');
    return responder();
  }

  const proyecto = sa.project_id;

  // ─── ¿Qué APIs están encendidas? ───
  await Promise.all(
    SERVICIOS.map(async ([id, nombre, para, obligatoria]) => {
      let fila = { id, nombre, para, estado: 'desconocido' };
      try {
        const r = await fetch(
          'https://serviceusage.googleapis.com/v1/projects/' + proyecto + '/services/' + id,
          { headers: { Authorization: 'Bearer ' + token, 'X-Goog-User-Project': proyecto } },
        );
        const d = await r.json().catch(() => ({}));
        if (r.ok) {
          fila.estado = d.state === 'ENABLED' ? 'encendida' : 'apagada';
        } else if (r.status === 403) {
          // Un 403 aquí significa que la cuenta no puede LEER la lista de APIs,
          // lo cual no dice nada sobre si la API funciona. No es un fallo.
          fila.nota = 'sin permiso para consultarlo (roles/serviceusage.serviceUsageConsumer)';
        } else {
          fila.nota = 'consulta ' + r.status;
        }
      } catch (e) {
        fila.nota = String(e.message).slice(0, 120);
      }
      salida.servicios.push(fila);
      if (obligatoria && fila.estado === 'apagada') {
        falta('Enciende la API ' + nombre + ' (' + id + ') en la consola de Google Cloud.');
      }
    }),
  );
  // Promise.all no garantiza el orden de inserción; se reordena para que la
  // lista se vea siempre igual y no baile entre recargas.
  salida.servicios.sort((a, b) => SERVICIOS.findIndex((s) => s[0] === a.id) - SERVICIOS.findIndex((s) => s[0] === b.id));

  // ─── ¿Se puede usar el bucket de verdad? ───
  if (salida.bucket.configurado) {
    try {
      const r = await fetch('https://storage.googleapis.com/storage/v1/b/' + cfg.bucket, {
        headers: { Authorization: 'Bearer ' + token, 'X-Goog-User-Project': proyecto },
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        salida.comprobaciones.bucket = { ok: true, region: d.location || null };
      } else {
        // El estado y un trozo del cuerpo SIEMPRE: «error» a secas no señala a
        // nada, y menos desde un teléfono.
        salida.comprobaciones.bucket = {
          ok: false,
          estado: r.status,
          error: r.status + ' — ' + String((d.error && d.error.message) || 'sin detalle').slice(0, 200),
        };
        falta(
          r.status === 404
            ? 'El bucket "' + cfg.bucket + '" no existe en el proyecto ' + proyecto + '. Revisa el nombre.'
            : 'La cuenta de servicio no puede acceder al bucket. Dale el rol Administrador de Storage.',
        );
      }
    } catch (e) {
      salida.comprobaciones.bucket = { ok: false, error: e.message };
    }
  }

  // ─── ¿Se puede lanzar el montaje? ───
  //
  // Listar builds es la comprobación más barata que toca de verdad la API: no
  // crea nada, no cuesta nada, y un 403 aquí es exactamente el mismo 403 que
  // saldría al montar.
  try {
    const r = await fetch(
      'https://cloudbuild.googleapis.com/v1/projects/' + proyecto + '/builds?pageSize=1',
      { headers: { Authorization: 'Bearer ' + token } },
    );
    if (r.ok) {
      salida.comprobaciones.montaje = { ok: true };
    } else {
      const t = await r.text();
      salida.comprobaciones.montaje = { ok: false, estado: r.status, error: t.slice(0, 200) };
      falta(
        r.status === 403
          ? 'La cuenta de servicio no puede usar Cloud Build. Dale el rol Editor de Cloud Build ' +
            'y también Usuario de cuenta de servicio, que es el que más se olvida.'
          : 'Cloud Build no responde (' + r.status + '). Comprueba que la API esté encendida.',
      );
    }
  } catch (e) {
    salida.comprobaciones.montaje = { ok: false, error: e.message };
  }

  return responder();
};
