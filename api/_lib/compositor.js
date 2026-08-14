// ════════════════════════════════════════════════════════════════
// COMPONER LA MÚSICA EN UNA MÁQUINA QUE NO SE CORTA AL MINUTO
//
// EL PROBLEMA, con las palabras del usuario: «No se pudo componer el
// fragmento 1: Google tardó más de 45 s en responder y la función de
// Vercel se corta a los 60».
//
// Componer es lo único de esta herramienta que puede tardar más de un
// minuto, y una función de Vercel en el plan gratuito dura sesenta
// segundos como máximo. No es un número que se pueda subir pagando
// menos: es el tope del plan. Se le puede quitar tiempo a lo demás —y
// se le quitó, de doce segundos de margen a seis—, pero eso mejora las
// probabilidades y no quita el techo. Una pieza de tres minutos no cabe
// ahí ninguna vez.
//
// La salida es la misma que ya usa el montaje del MP4: encargarle el
// trabajo a una máquina de Cloud Build, que no tiene ese límite. La
// función de Vercel lanza el trabajo y se va; el latido pregunta cada
// pocos segundos si terminó. Nada espera a nada.
//
// POR QUÉ ESTO NO PIDE NADA NUEVO EN GOOGLE CLOUD. El build corre CON LA
// MISMA cuenta de servicio que ya está en las variables de Vercel, así
// que hereda sus permisos —incluido el de llamar a Lyria— y no hay que
// darle ningún rol a nadie más. Cambiar de cuenta de Google sigue siendo
// cambiar una variable y nada más, que es la regla de este proyecto.
// ════════════════════════════════════════════════════════════════
const { gcsUpload, gcsReadText } = require('./gcp');

// La imagen del SDK de Google: trae gcloud, curl y python3, que es todo
// lo que hace falta. Es la misma que ya usa el montaje.
const IMAGEN_SDK = 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim';

// Media hora. Lyria tarda entre uno y tres minutos; esto es un tope para
// que un trabajo colgado no se quede dando vueltas para siempre.
const TIMEOUT_BUILD = '1800s';

// Y el mismo tope para la llamada de dentro: `curl` sin límite deja el
// build vivo hasta que lo mate Cloud Build, sin escribir nada legible.
const TIMEOUT_CURL = 1500;

/** Un valor a prueba de comillas dentro de un script de shell. */
function comilla(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

/**
 * El trozo de Python que saca el audio de la respuesta de Vertex.
 *
 * NO decide formatos ni envuelve nada: eso lo hace `vertex.reconocerAudio`
 * del lado de Vercel, con la tabla de firmas que ya existe. Aquí sólo se
 * descodifica el base64 y se dejan escritos los bytes, la etiqueta que
 * declaró Google y los dieciséis primeros bytes en hexadecimal —que es lo
 * que permite reconocer la pieza sin bajársela entera—.
 */
const SACAR_AUDIO = `import json, base64, sys

try:
    d = json.load(open('respuesta.json'))
except Exception as e:
    open('error.txt', 'w').write('Google no devolvio JSON: %s' % e)
    sys.exit(1)

if 'error' in d:
    err = d['error']
    open('error.txt', 'w').write('Vertex AI respondio: %s' % (err.get('message') or err))
    sys.exit(1)

parte = None
for c in d.get('candidates', []) or []:
    for p in ((c.get('content') or {}).get('parts') or []):
        parte = p.get('inlineData') or p.get('inline_data')
        if parte and parte.get('data'):
            break
        parte = None
    if parte:
        break

if not parte:
    razon = 'sin finishReason'
    texto = ''
    for c in d.get('candidates', []) or []:
        razon = c.get('finishReason') or razon
        for p in ((c.get('content') or {}).get('parts') or []):
            if isinstance(p.get('text'), str):
                texto += p['text']
        break
    open('error.txt', 'w').write('Lyria no devolvio audio (%s)%s.' % (razon, (': ' + texto[:160]) if texto else ''))
    sys.exit(1)

crudo = base64.b64decode(parte['data'])
open('audio.bin', 'wb').write(crudo)
open('formato.txt', 'w').write(parte.get('mimeType') or parte.get('mime_type') or '')
open('cabecera.txt', 'w').write(crudo[:16].hex())
print('audio: %d bytes' % len(crudo))
`;

/**
 * Lanza la composición y vuelve enseguida con el identificador del trabajo.
 *
 * `carpeta` es donde queda todo lo del encargo: lo que se pidió, lo que
 * devolvió Google y, si algo falla, el motivo escrito en `error.txt` —que es
 * lo único que se puede leer desde un teléfono—.
 */
async function lanzarComposicion(opciones) {
  const { token, projectId, cuentaEmail, bucket, carpeta, url, cuerpo } = opciones;

  if (!cuentaEmail) {
    throw new Error(
      'No se sabe con qué cuenta de servicio componer: a las credenciales de Google ' +
      'les falta client_email.',
    );
  }

  await gcsUpload(
    token, bucket, carpeta + '/encargo.json',
    Buffer.from(JSON.stringify(cuerpo)), 'application/json',
  );
  // Se vacía la queja anterior, para que un fallo sin nota no herede la del
  // intento pasado y mande a buscar un problema que ya no existe.
  await gcsUpload(token, bucket, carpeta + '/error.txt', Buffer.from(''), 'text/plain');

  const gs = (o) => 'gs://' + bucket + '/' + o;

  const componer = [
    'set -e',
    'cd /workspace',
    'gcloud storage cp ' + comilla(gs(carpeta + '/encargo.json')) + ' encargo.json',
    // El token es el de la cuenta con la que corre el build, que es la misma
    // que usa Vercel: por eso puede llamar a Lyria sin ningún permiso nuevo.
    'TOKEN="$(gcloud auth print-access-token)"',
    "cat > sacar.py <<'PY'",
    SACAR_AUDIO,
    'PY',
    'codigo=$(curl -sS --max-time ' + TIMEOUT_CURL + ' -o respuesta.json -w "%{http_code}" \\',
    '  -X POST -H "Authorization: Bearer $TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    '  -H ' + comilla('X-Goog-User-Project: ' + projectId) + ' \\',
    '  --data-binary @encargo.json ' + comilla(url) + ') || codigo=000',
    'echo "Vertex respondió $codigo"',
    'if [ "$codigo" = "000" ]; then',
    '  echo "No se pudo hablar con Vertex AI: la llamada no llegó a completarse." > error.txt',
    '  exit 1',
    'fi',
    'if [ "$codigo" != "200" ]; then',
    '  echo "Vertex AI respondió $codigo: $(head -c 500 respuesta.json)" > error.txt',
    '  exit 1',
    'fi',
    'python3 sacar.py',
  ].join('\n');

  const subir = [
    'cd /workspace',
    // El error se sube SIEMPRE, haya audio o no: es lo único que la aplicación
    // puede enseñar cuando la composición falla.
    'if [ -s error.txt ]; then gcloud storage cp error.txt ' + comilla(gs(carpeta + '/error.txt')) + '; fi',
    'if [ ! -s audio.bin ]; then',
    '  echo "La composición terminó sin producir audio." >&2',
    '  exit 1',
    'fi',
    'gcloud storage cp audio.bin ' + comilla(gs(carpeta + '/audio.bin')),
    'gcloud storage cp formato.txt ' + comilla(gs(carpeta + '/formato.txt')),
    'gcloud storage cp cabecera.txt ' + comilla(gs(carpeta + '/cabecera.txt')),
    'echo "audio en ' + gs(carpeta + '/audio.bin') + '"',
  ].join('\n');

  const build = {
    steps: [
      {
        name: IMAGEN_SDK, id: 'componer', entrypoint: 'bash', args: ['-c', componer],
        // Si la composición falla, el build sigue para que el paso de subida
        // deje el error.txt en el bucket. Sin esto el build muere aquí y el
        // motivo real se queda dentro de una máquina que ya no existe.
        allowFailure: true,
      },
      { name: IMAGEN_SDK, id: 'subir', entrypoint: 'bash', args: ['-c', subir] },
    ],
    timeout: TIMEOUT_BUILD,
    // ESTA LÍNEA ES LA QUE HACE QUE NO HAGA FALTA NINGÚN PERMISO NUEVO. Sin
    // ella el build correría con la cuenta por defecto de Cloud Build, que no
    // tiene acceso a Vertex AI, y habría que ir a la consola a dárselo — con lo
    // que cambiar de cuenta de Google dejaría de ser cambiar una variable.
    serviceAccount: 'projects/' + projectId + '/serviceAccounts/' + cuentaEmail,
    options: {
      // Componer no es trabajo de CPU: la máquina sólo espera a Google.
      machineType: 'E2_HIGHCPU_8',
      // Obligatorio cuando el build corre con una cuenta propia: sin esto se
      // rechaza antes de empezar porque no tiene dónde escribir el registro.
      logging: 'CLOUD_LOGGING_ONLY',
    },
    tags: ['ams-musica'],
  };

  const r = await fetch('https://cloudbuild.googleapis.com/v1/projects/' + projectId + '/builds', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(build),
  });
  const texto = await r.text();

  if (!r.ok) throw new Error('No se pudo lanzar la composición: ' + explicar(r.status, texto));

  let d = {};
  try { d = JSON.parse(texto); } catch (e) { /* respuesta no-JSON */ }
  const buildId = (d.metadata && d.metadata.build && d.metadata.build.id) || '';
  if (!buildId) throw new Error('Cloud Build aceptó la composición pero no devolvió su identificador.');
  return { buildId, carpeta };
}

/**
 * Traduce los rechazos de Cloud Build a algo accionable.
 *
 * Los mensajes de Google aquí nombran permisos internos que no significan nada
 * para quien sólo quiere música en su corto.
 */
function explicar(status, texto) {
  const t = String(texto);
  if (status === 403 && /serviceAccounts?\.actAs|act as|serviceAccountUser/i.test(t)) {
    return 'a la cuenta de servicio le falta el rol "Usuario de cuenta de servicio" ' +
      '(roles/iam.serviceAccountUser). Se añade en IAM, en la misma pantalla que los demás.';
  }
  if (status === 403 && /cloudbuild\.builds\.create|permission/i.test(t)) {
    return 'a la cuenta de servicio le falta el rol "Editor de Cloud Build" ' +
      '(roles/cloudbuild.builds.editor).';
  }
  if (status === 403 && /has not been used|disabled|SERVICE_DISABLED/i.test(t)) {
    return 'la API de Cloud Build no está habilitada en este proyecto ' +
      '(cloudbuild.googleapis.com).';
  }
  if (status === 404) return 'no se encuentra el proyecto de Google Cloud.';
  return status + ' — ' + t.slice(0, 300);
}

/**
 * ¿Terminó ya? Y si terminó bien, ¿qué audio dejó?
 *
 * Devuelve `{estado}` con 'componiendo' | 'listo' | 'fallo'. Cuando está listo
 * trae además el objeto donde quedó el audio, la etiqueta que declaró Google y
 * los primeros bytes: con eso el lado de Vercel sabe qué es sin bajárselo.
 */
async function estadoComposicion(token, projectId, buildId, bucket, carpeta) {
  const r = await fetch(
    'https://cloudbuild.googleapis.com/v1/projects/' + projectId + '/builds/' + encodeURIComponent(buildId),
    { headers: { Authorization: 'Bearer ' + token } },
  );
  if (!r.ok) {
    return { estado: 'desconocido', error: 'No se pudo consultar la composición: ' + r.status };
  }
  const d = await r.json();

  const enMarcha = d.status === 'QUEUED' || d.status === 'WORKING' || d.status === 'PENDING';
  if (enMarcha) {
    return { estado: 'componiendo', fase: d.status === 'QUEUED' ? 'en cola' : 'componiendo' };
  }

  if (d.status === 'SUCCESS') {
    const formato = await gcsReadText(token, bucket, carpeta + '/formato.txt');
    const cabecera = await gcsReadText(token, bucket, carpeta + '/cabecera.txt');
    return {
      estado: 'listo',
      objeto: carpeta + '/audio.bin',
      mimeType: ((formato && formato.texto) || '').trim(),
      cabeceraHex: ((cabecera && cabecera.texto) || '').trim(),
    };
  }

  // Cloud Build sólo sabe decir FAILURE. El motivo real lo escribió el propio
  // script en error.txt, que es lo único legible desde un teléfono.
  let motivo = '';
  const nota = await gcsReadText(token, bucket, carpeta + '/error.txt');
  if (nota && nota.texto && nota.texto.trim()) motivo = nota.texto.trim().slice(-700);

  const porEstado = {
    TIMEOUT: 'la composición tardó más de media hora y se canceló.',
    CANCELLED: 'la composición se canceló.',
    EXPIRED: 'la composición caducó en la cola.',
    INTERNAL_ERROR: 'Cloud Build tuvo un error interno.',
  };
  return {
    estado: 'fallo',
    error: motivo || porEstado[d.status] || 'la composición falló (' + d.status + ').',
  };
}

/**
 * Parar una composición en marcha.
 *
 * Cuando el usuario para la generación, la máquina de Cloud Build sigue
 * componiendo si nadie se lo dice: terminaría, dejaría el audio en el bucket y
 * nadie iría a recogerlo. Se le dice.
 *
 * Es de mejor esfuerzo a propósito: si la llamada falla —porque el trabajo ya
 * había terminado, o porque Google contesta mal— parar la generación sigue
 * siendo lo correcto. Devuelve si se pudo o no, para poder contarlo.
 */
async function cancelarComposicion(token, projectId, buildId) {
  if (!buildId) return false;
  try {
    const r = await fetch(
      'https://cloudbuild.googleapis.com/v1/projects/' + projectId +
      '/builds/' + encodeURIComponent(buildId) + ':cancel',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: '{}',
      },
    );
    return r.ok;
  } catch (e) {
    return false;
  }
}

module.exports = {
  lanzarComposicion,
  estadoComposicion,
  cancelarComposicion,
  SACAR_AUDIO,
  IMAGEN_SDK,
};
