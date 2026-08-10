// ════════════════════════════════════════════════════════════════
// UN GOOGLE CLOUD DE MENTIRA
//
// Sustituye `fetch` por uno que contesta como Cloud Storage, Vertex AI
// y Cloud Build, guardando los objetos en memoria.
//
// Lo usan dos cosas: la prueba de extremo a extremo y el servidor
// local (pruebas/servidor-local.js), que permite abrir la herramienta
// entera en un navegador SIN cuenta de Google y sin gastar un céntimo.
//
// Aquí las respuestas son las que decimos nosotros, así que esto no
// demuestra que Google se comporte así — demuestra que nuestras piezas
// encajan entre ellas.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

/**
 * Pone en marcha el simulacro y devuelve el mapa de objetos, por si la
 * prueba quiere mirar qué se escribió.
 */
function instalarGoogleSimulado() {
  // ─── El Google Cloud de mentira ───
  //
  // Un solo `fetch` interceptado. Guarda los objetos en un Map, contesta a los
  // dos endpoints de Vertex que usamos y simula un Cloud Build que termina bien
  // a la segunda consulta.
  const objetos = new Map();
  const llamadas = [];
  let buildsLanzados = 0;
  const consultasBuild = new Map();

  const WAV_VACIO = (() => {
    const { encodeWav } = require('../api/_lib/audio.js');
    const n = 44100 * 31;
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 44100);
    return encodeWav(m, 44100).toString('base64');
  })();
  const PNG_FALSO = Buffer.from('imagen de prueba').toString('base64');

  global.fetch = async function (url, opciones) {
    const u = String(url);
    const o = opciones || {};
    llamadas.push(o.method || 'GET');

    const ok = (cuerpo, cabeceras) => ({
      ok: true, status: 200,
      headers: { get: (k) => (cabeceras || {})[String(k).toLowerCase()] || null },
      json: async () => cuerpo,
      text: async () => (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)),
    });
    const noHay = () => ({
      ok: false, status: 404,
      headers: { get: () => null },
      json: async () => ({ error: { message: 'no existe' } }),
      text: async () => 'no existe',
    });

    // Token OAuth
    if (u.indexOf('oauth2.googleapis.com/token') !== -1) {
      return ok({ access_token: 'token-de-prueba', expires_in: 3600 });
    }

    // Subir objeto. Dos formas: uploadType=media, con el nombre en la URL, y
    // uploadType=multipart, con el nombre dentro de la primera parte del cuerpo
    // (el almacén la usa para poder mandar metadatos en la misma petición).
    if (u.indexOf('/upload/storage/v1/b/') !== -1) {
      const cuerpo = o.body;
      const bruto = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(String(cuerpo || ''));
      let nombre = null;
      let datos = bruto;

      const enLaUrl = /[?&]name=([^&]+)/.exec(u);
      if (enLaUrl) {
        nombre = decodeURIComponent(enLaUrl[1]);
      } else {
        const tipo = (o.headers && (o.headers['Content-Type'] || o.headers['content-type'])) || '';
        const frontera = (/boundary=([^;]+)/.exec(tipo) || [, ''])[1].trim();
        if (!frontera) throw new Error('subida multipart sin boundary');
        const partes = bruto.toString('binary').split('--' + frontera);
        for (const parte of partes) {
          const corte = parte.indexOf('\r\n\r\n');
          if (corte === -1) continue;
          const cabeceras = parte.slice(0, corte);
          const contenido = parte.slice(corte + 4).replace(/\r\n$/, '');
          // El Content-Type que declara ESTA parte del cuerpo.
          const tipoDeclarado = (/content-type:\s*([^\r\n]+)/i.exec(cabeceras) || [, ''])[1].trim();
          if (/application\/json/i.test(cabeceras) && nombre === null) {
            try {
              const meta = JSON.parse(contenido);
              nombre = meta.name;
              // Google compara LETRA A LETRA el tipo de la parte con el que
              // declaran los metadatos, y rechaza la subida entera si difieren.
              // El simulacro no lo comprobaba, así que un desajuste de
              // mayúsculas ("UTF-8" contra "utf-8") pasaba aquí y estallaba en
              // producción impidiendo crear ni un proyecto.
              if (meta.contentType && meta.contentType !== tipoDeclarado) {
                return {
                  ok: false, status: 400, headers: { get: () => null },
                  json: async () => ({ error: { code: 400, message:
                    'Content-Type specified in the upload (' + tipoDeclarado +
                    ') does not match Content-Type specified in metadata (' +
                    meta.contentType + ')' } }),
                  text: async () => 'content-type mismatch',
                };
              }
            } catch (e) { /* no era la parte de metadatos */ }
          } else if (nombre !== null) {
            datos = Buffer.from(contenido, 'binary');
          }
        }
      }
      if (!nombre) throw new Error('no se pudo determinar el nombre del objeto subido');

      // Precondición de escritura: así la prueba también ejercita el control de
      // versiones del almacén y no solo el camino feliz.
      const pre = /[?&]ifGenerationMatch=(\d+)/.exec(u);
      if (pre) {
        const pedida = Number(pre[1]);
        const actual = objetos.has(nombre) ? 1 : 0;
        if (pedida !== actual) {
          return {
            ok: false, status: 412, headers: { get: () => null },
            json: async () => ({ error: { message: 'precondición fallida' } }),
            text: async () => 'precondición fallida',
          };
        }
      }

      objetos.set(nombre, datos);
      return ok({ name: nombre, size: String(datos.length), generation: '1' });
    }

    // Copiar objeto (rewrite)
    if (u.indexOf('/rewriteTo/b/') !== -1) {
      const m = /\/o\/([^/]+)\/rewriteTo\/b\/[^/]+\/o\/([^?]+)/.exec(u);
      const origen = decodeURIComponent(m[1]);
      const destino = decodeURIComponent(m[2]);
      if (!objetos.has(origen)) return noHay();
      objetos.set(destino, objetos.get(origen));
      return ok({ done: true, resource: { size: String(objetos.get(destino).length) } });
    }

    // Leer / consultar objeto
    if (u.indexOf('storage.googleapis.com/storage/v1/b/') !== -1) {
      if (o.method === 'DELETE') {
        const nombre = decodeURIComponent(/\/o\/([^?]+)/.exec(u)[1]);
        objetos.delete(nombre);
        return ok({});
      }
      if (o.method === 'PATCH') return ok({});                       // CORS
      if (u.indexOf('/o?') !== -1 || u.indexOf('/o&') !== -1) {      // listar
        const prefijo = decodeURIComponent((/[?&]prefix=([^&]*)/.exec(u) || [, ''])[1]);
        const items = [...objetos.keys()].filter((k) => k.indexOf(prefijo) === 0)
          .map((k) => ({ name: k, size: String(objetos.get(k).length), generation: '1', updated: '2026-01-01T00:00:00Z' }));
        return ok({ items });
      }
      const mo = /\/o\/([^?]+)/.exec(u);
      if (mo) {
        const nombre = decodeURIComponent(mo[1]);
        if (!objetos.has(nombre)) return noHay();
        if (u.indexOf('alt=media') !== -1) {
          return {
            ok: true, status: 200,
            headers: { get: (k) => (String(k).toLowerCase() === 'x-goog-generation' ? '1' : null) },
            text: async () => objetos.get(nombre).toString('utf8'),
            arrayBuffer: async () => objetos.get(nombre).buffer.slice(
              objetos.get(nombre).byteOffset,
              objetos.get(nombre).byteOffset + objetos.get(nombre).length,
            ),
            json: async () => JSON.parse(objetos.get(nombre).toString('utf8')),
          };
        }
        return ok({ name: nombre, size: String(objetos.get(nombre).length), generation: '1' });
      }
      return ok({ location: 'US' });                                  // metadatos del bucket
    }

    // Vertex AI
    if (u.indexOf('aiplatform.googleapis.com') !== -1) {
      // El host y la ruta tienen que ser reales. Con `region: ''` en el
      // catálogo y una llamada que no pasaba el valor por defecto, la URL salía
      // como https://undefined-aiplatform.googleapis.com/.../locations/undefined/
      // y Google devolvía su 404 en HTML. Aquí eso tiene que ser un error, no
      // un simulacro complaciente.
      if (/undefined|null/.test(u)) {
        return {
          ok: false, status: 404,
          text: async () => '<!DOCTYPE html><title>Error 404 (Not Found)!!1</title>',
          json: async () => ({}),
        };
      }
      let cuerpo = {};
      try { cuerpo = JSON.parse(String(o.body || '{}')); } catch (e) { /* no-JSON */ }
      if (u.indexOf(':predictLongRunning') !== -1) {
        return ok({ name: 'operaciones/veo-1' });
      }
      if (u.indexOf(':fetchPredictOperation') !== -1) {
        const clip = 'music-studio/veo/clip-de-prueba.mp4';
        objetos.set(clip, Buffer.from('mp4 de prueba'));
        return ok({ done: true, response: { videos: [{ gcsUri: 'gs://bucket-de-prueba/' + clip }] } });
      }
      // ─── Lyria ───
      //
      // El simulacro EXIGE lo mismo que Google, o la prueba pasa en verde con
      // la herramienta rota. Eso ya ocurrió: el prompt iba en español y Lyria
      // contestaba «Unsupported language detected. Please use one of the
      // supported languages: en», pero aquí devolvíamos audio tan contentos.
      if (u.indexOf('lyria') !== -1) {
        const texto = (((cuerpo.contents || [])[0] || {}).parts || [])
          .map((x) => (x && x.text) || '').join(' ');

        // 1. Sólo inglés. Se busca lo que delata al castellano: tildes, eñes y
        //    signos de apertura. Es tosco, pero es exactamente lo que pasaba.
        if (/[áéíóúñ¿¡]/i.test(texto)) {
          return {
            ok: false, status: 400,
            text: async () => JSON.stringify({ error: { message:
              'Audio generation failed with the following error: Unsupported language ' +
              'detected. Please use one of the supported languages: en.' } }),
            json: async () => ({ error: { message: 'Unsupported language detected.' } }),
          };
        }

        // 2. La duración se pide con marcas [MM:SS] dentro del prompt: no hay
        //    parámetro. Sin ellas Google devuelve unos treinta segundos y el
        //    corto se queda mudo a partir de ahí.
        if (!/\[\d{2}:\d{2}\]/.test(texto)) {
          return ok({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [
            { text: 'sin línea de tiempo: pieza corta de unos 30 s' },
            { inlineData: { mimeType: 'audio/wav', data: WAV_VACIO } },
          ] } }] });
        }

        // 3. Y `maxOutputTokens` lo rechaza con «invalid argument».
        if (cuerpo.generationConfig && cuerpo.generationConfig.maxOutputTokens) {
          return {
            ok: false, status: 400,
            text: async () => JSON.stringify({ error: { message: 'Request contains an invalid argument.' } }),
            json: async () => ({ error: { message: 'Request contains an invalid argument.' } }),
          };
        }

        return ok({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [
          { inlineData: { mimeType: 'audio/wav', data: WAV_VACIO } },
        ] } }] });
      }
      // Los modelos de imagen de Gemini («Nano Banana») no hablan `:predict`
      // sino `:generateContent`, y contestan con otra forma entera. Si el
      // simulacro les respondiera con `predictions`, elegir uno de esos
      // modelos parecería roto aquí y funcionaría en Google — que es la peor
      // clase de prueba que se puede tener.
      if (u.indexOf(':generateContent') !== -1) {
        return ok({
          candidates: [{
            finishReason: 'STOP',
            content: {
              role: 'model',
              parts: [{ inlineData: { mimeType: 'image/png', data: PNG_FALSO } }],
            },
          }],
        });
      }
      return ok({ predictions: [{ bytesBase64Encoded: PNG_FALSO, mimeType: 'image/png' }] });
    }

    // Cloud Build
    if (u.indexOf('cloudbuild.googleapis.com') !== -1) {
      if (o.method === 'POST') {
        buildsLanzados += 1;
        const id = 'build-' + buildsLanzados;
        consultasBuild.set(id, 0);
        return ok({ metadata: { build: { id } } });
      }
      const id = (/\/builds\/([^?]+)/.exec(u) || [, ''])[1];
      const veces = (consultasBuild.get(id) || 0) + 1;
      consultasBuild.set(id, veces);
      if (veces < 2) return ok({ id, status: 'WORKING' });
      // Terminó: el montaje deja su MP4 donde dijo la hoja del encargo.
      for (const k of objetos.keys()) {
        if (k.indexOf('/montajes/') !== -1 && k.endsWith('hoja.json')) {
          const hoja = JSON.parse(objetos.get(k).toString('utf8'));
          objetos.set(hoja.salida, Buffer.from('MP4 FINAL DE PRUEBA'));
        }
      }
      return ok({ id, status: 'SUCCESS' });
    }

    if (u.indexOf('serviceusage.googleapis.com') !== -1) return ok({ state: 'ENABLED' });

    throw new Error('El simulacro no conoce esta llamada: ' + u.slice(0, 120));
  };
  return { objetos, llamadas };
}

/** Credenciales de mentira, con una clave RSA de verdad para poder firmar. */
function entornoDePrueba() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  process.env.GCP_SERVICE_ACCOUNT = JSON.stringify({
    project_id: 'proyecto-de-prueba',
    client_email: 'estudio@proyecto-de-prueba.iam.gserviceaccount.com',
    private_key: privateKey,
  });
  process.env.GCS_OUTPUT_BUCKET = 'bucket-de-prueba';
  process.env.VERCEL_ENV = 'development';
  delete process.env.APP_KEY;
  delete process.env.ANTHROPIC_API_KEY;
}

module.exports = { instalarGoogleSimulado, entornoDePrueba };
