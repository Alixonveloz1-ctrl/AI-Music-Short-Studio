// ════════════════════════════════════════════════════════════════
// PRUEBA DE EXTREMO A EXTREMO, CON UN GOOGLE CLOUD DE MENTIRA
//
//   node pruebas/extremo-a-extremo.js
//
// Recorre los endpoints de verdad —los mismos archivos que Vercel va
// a ejecutar— contra un Cloud Storage, un Vertex AI y un Cloud Build
// simulados en memoria. Sirve para comprobar que las piezas encajan
// ANTES de desplegar, que es cuando arreglarlo sale barato.
//
// No sustituye a probar contra Google de verdad: aquí las respuestas
// son las que yo digo que son. Lo que sí demuestra es que el flujo
// completo funciona y que el estado queda donde tiene que quedar.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

// ─── Entorno ───
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
        if (/application\/json/i.test(cabeceras) && nombre === null) {
          try { nombre = JSON.parse(contenido).name; } catch (e) { /* no era la parte de metadatos */ }
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
    if (u.indexOf(':predictLongRunning') !== -1) {
      return ok({ name: 'operaciones/veo-1' });
    }
    if (u.indexOf(':fetchPredictOperation') !== -1) {
      const clip = 'music-studio/veo/clip-de-prueba.mp4';
      objetos.set(clip, Buffer.from('mp4 de prueba'));
      return ok({ done: true, response: { videos: [{ gcsUri: 'gs://bucket-de-prueba/' + clip }] } });
    }
    if (u.indexOf('lyria') !== -1) {
      return ok({ predictions: [{ bytesBase64Encoded: WAV_VACIO, mimeType: 'audio/wav' }] });
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

// ─── req / res de mentira ───
function pedir(handler, { metodo = 'GET', query = {}, cuerpo = null } = {}) {
  const busca = new URLSearchParams(query).toString();
  const req = {
    method: metodo,
    url: '/api/x' + (busca ? '?' + busca : ''),
    headers: { host: 'pruebas.local', 'content-type': 'application/json' },
    query,
    body: cuerpo,
  };
  return new Promise((resolve, reject) => {
    const res = {
      _codigo: 200, _cuerpo: null, _cabeceras: {},
      setHeader(k, v) { this._cabeceras[k] = v; },
      status(c) { this._codigo = c; return this; },
      json(b) { this._cuerpo = b; resolve({ codigo: this._codigo, cuerpo: b }); return this; },
      end() { resolve({ codigo: this._codigo, cuerpo: this._cuerpo }); return this; },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

// ─── La prueba ───
let pasadas = 0;
const fallos = [];
function paso(nombre, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { pasadas++; console.log('  ✓ ' + nombre); })
    .catch((e) => { fallos.push(nombre); console.log('  ✗ ' + nombre + '\n      ' + e.message); });
}
function cierto(c, q) { if (!c) throw new Error(q || 'no se cumple'); }

async function principal() {
  console.log('\nDE PRINCIPIO A FIN, CON GOOGLE CLOUD SIMULADO\n');

  const catalogo = require('../api/catalogo.js');
  const proyectos = require('../api/proyectos.js');
  const proyectoEp = require('../api/proyecto.js');
  const generar = require('../api/generar.js');
  const aprobar = require('../api/aprobar.js');
  const rechazar = require('../api/rechazar.js');
  const desbloquear = require('../api/desbloquear.js');
  const montar = require('../api/montar.js');
  const entrega = require('../api/entrega.js');
  const salud = require('../api/salud.js');

  let id = null;

  await paso('la pantalla de diagnóstico responde sin caerse', async () => {
    const r = await pedir(salud, { metodo: 'GET' });
    cierto(r.codigo === 200, 'código ' + r.codigo);
    cierto(typeof r.cuerpo.listo === 'boolean', 'falta el campo "listo"');
  });

  await paso('el catálogo llega entero y sin credenciales', async () => {
    const r = await pedir(catalogo, { metodo: 'GET' });
    cierto(r.cuerpo.instruments.length === 89, 'instrumentos: ' + r.cuerpo.instruments.length);
    cierto(r.cuerpo.scenarios.length === 21, 'escenarios');
  });

  await paso('una configuración inválida se rechaza con un motivo, no con un 500', async () => {
    const r = await pedir(proyectos, { metodo: 'POST', cuerpo: { instrumentIds: [], durationSec: 45 } });
    cierto(r.codigo === 400, 'código ' + r.codigo);
    cierto(/instrumento|duraci/i.test(r.cuerpo.error), 'motivo poco claro: ' + r.cuerpo.error);
  });

  await paso('se crea el proyecto y el plan cuadra al segundo', async () => {
    const r = await pedir(proyectos, {
      metodo: 'POST',
      cuerpo: {
        instrumentIds: ['erhu'], formationId: 'solo',
        performerGenderId: 'female', performerTypeId: 'adult_woman',
        scenarioId: 'forest', visualStyleId: 'anime_cinematic', durationSec: 60,
        creativeDirection: 'niebla baja al amanecer',
      },
    });
    cierto(r.codigo === 201, 'código ' + r.codigo + ' ' + JSON.stringify(r.cuerpo).slice(0, 200));
    id = r.cuerpo.proyecto.id;
    const suma = r.cuerpo.proyecto.plan.timeline.reduce((s, e) => s + e.durationSec, 0);
    cierto(suma === 60, 'la línea de tiempo suma ' + suma);
    cierto(r.cuerpo.estado.readyForEdit === false, 'no debería poder montarse aún');
  });

  await paso('el proyecto se relee del bucket con URLs que se pueden abrir', async () => {
    const r = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
    cierto(r.codigo === 200, 'código ' + r.codigo);
    cierto(r.cuerpo.proyecto.assets.length > 0, 'sin activos');
    cierto(JSON.stringify(r.cuerpo).indexOf('gs://') === -1, 'se coló una ruta gs://');
  });

  await paso('generar el personaje maestro lo deja EN REVISIÓN, no aprobado', async () => {
    const r = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: 'master_character' } });
    cierto(r.codigo === 200 || r.codigo === 202, 'código ' + r.codigo + ' ' + JSON.stringify(r.cuerpo).slice(0, 200));
    const p = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
    const a = p.cuerpo.proyecto.assets.find((x) => x.id === 'master_character');
    cierto(a.status === 'review', 'estado ' + a.status);
    cierto(a.approvedGenerationId === null, 'se aprobó solo');
    cierto(a.generations[0].file && a.generations[0].file.url, 'la imagen no trae URL');
  });

  await paso('no se puede saltar de etapa: un clip todavía no se genera', async () => {
    const p = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
    const clip = p.cuerpo.proyecto.assets.find((x) => x.stage === 'videos');
    const r = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: clip.id } });
    cierto(r.codigo === 409, 'código ' + r.codigo);
    cierto(/etapa|aprob/i.test(r.cuerpo.error), 'motivo: ' + r.cuerpo.error);
  });

  await paso('rechazar conserva el intento en el historial', async () => {
    const p = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
    const a = p.cuerpo.proyecto.assets.find((x) => x.id === 'master_character');
    const r = await pedir(rechazar, { metodo: 'POST', cuerpo: { id, activo: 'master_character', gen: a.generations[0].id } });
    cierto(r.codigo === 200, 'código ' + r.codigo);
    const b = r.cuerpo.proyecto.assets.find((x) => x.id === 'master_character');
    cierto(b.generations.length === 1, 'se borró el intento');
    cierto(b.generations[0].status === 'rejected', 'estado ' + b.generations[0].status);
  });

  await paso('aprobar es lo único que aprueba, y bloquea el activo', async () => {
    await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: 'master_character' } });
    const p = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
    const a = p.cuerpo.proyecto.assets.find((x) => x.id === 'master_character');
    const g = a.generations.find((x) => x.status === 'review');
    const r = await pedir(aprobar, { metodo: 'POST', cuerpo: { id, activo: 'master_character', gen: g.id } });
    cierto(r.codigo === 200, 'código ' + r.codigo);
    const b = r.cuerpo.proyecto.assets.find((x) => x.id === 'master_character');
    cierto(b.status === 'approved' && b.locked === true, 'estado ' + b.status + ' bloqueado ' + b.locked);
  });

  await paso('un activo aprobado no se regenera sin desbloquear antes', async () => {
    const r = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: 'master_character' } });
    cierto(r.codigo === 409, 'código ' + r.codigo);
    const d = await pedir(desbloquear, { metodo: 'POST', cuerpo: { id, activo: 'master_character' } });
    cierto(d.codigo === 200, 'desbloquear dio ' + d.codigo);
    const a = d.cuerpo.proyecto.assets.find((x) => x.id === 'master_character');
    cierto(a.locked === false, 'sigue bloqueado');
  });

  await paso('el montaje se niega mientras falte material, y dice cuál', async () => {
    const r = await pedir(montar, { metodo: 'POST', cuerpo: { id } });
    cierto(r.codigo === 409, 'código ' + r.codigo);
    cierto(typeof r.cuerpo.detalle !== 'object', 'el detalle viaja como objeto: se pintaría [object Object]');
    cierto(/Shot|maestr/i.test(r.cuerpo.error + ' ' + (r.cuerpo.detalle || '')), 'no nombra lo que falta');
  });

  // ── Producir el corto entero ──
  await paso('se produce y aprueba el corto entero, etapa por etapa', async () => {
    for (const etapa of ['images', 'videos', 'music', 'ambient']) {
      for (let vuelta = 0; vuelta < 40; vuelta++) {
        const p = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
        const pendientes = p.cuerpo.proyecto.assets.filter(
          (a) => a.stage === etapa && !(a.approvedGenerationId && !a.stale),
        );
        if (!pendientes.length) break;
        for (const a of pendientes) {
          if (a.locked) await pedir(desbloquear, { metodo: 'POST', cuerpo: { id, activo: a.id } });
          const g = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: a.id } });
          if (g.codigo >= 400) throw new Error(a.id + ': ' + JSON.stringify(g.cuerpo).slice(0, 200));
          let gen = g.cuerpo.gen;
          // Empujar el modelo por pasos hasta que la generación cierre.
          for (let n = 0; n < 30 && gen && gen.status === 'generating'; n++) {
            const s = await pedir(generar, { metodo: 'GET', query: { id, activo: a.id, gen: gen.id } });
            if (s.codigo >= 400) throw new Error(a.id + ' al consultar: ' + JSON.stringify(s.cuerpo).slice(0, 200));
            gen = s.cuerpo.gen;
          }
          if (!gen || gen.status !== 'review') {
            throw new Error(a.id + ' terminó en "' + (gen && gen.status) + '": ' + ((gen && gen.error) || ''));
          }
          const ap = await pedir(aprobar, { metodo: 'POST', cuerpo: { id, activo: a.id, gen: gen.id } });
          if (ap.codigo !== 200) throw new Error('aprobar ' + a.id + ': ' + JSON.stringify(ap.cuerpo).slice(0, 200));
        }
      }
    }
    const p = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
    cierto(p.cuerpo.estado.readyForEdit === true,
      'sigue sin poder montarse; faltan: ' + (p.cuerpo.estado.missingForEdit || []).slice(0, 5).join(', '));
  });

  await paso('el montaje se lanza y termina', async () => {
    const r = await pedir(montar, { metodo: 'POST', cuerpo: { id } });
    cierto(r.codigo === 200 || r.codigo === 202, 'código ' + r.codigo + ' ' + JSON.stringify(r.cuerpo).slice(0, 250));
    const job = r.cuerpo.job;
    cierto(job, 'no devolvió identificador de montaje');
    let estado = null;
    for (let i = 0; i < 8; i++) {
      const s = await pedir(montar, { metodo: 'GET', query: { id, job } });
      estado = s.cuerpo.estado;
      if (estado !== 'montando') break;
    }
    cierto(estado === 'listo', 'el montaje acabó en "' + estado + '"');
  });

  await paso('la previsualización se puede reproducir', async () => {
    const p = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
    const corte = p.cuerpo.proyecto.finalCut;
    cierto(corte.preview && corte.preview.url, 'sin URL de previsualización');
    cierto(corte.status === 'review', 'estado del corte: ' + corte.status);
  });

  await paso('aprobar y exportar deja el MP4 final descargable', async () => {
    const r = await pedir(entrega, {
      metodo: 'POST',
      cuerpo: { id, titulo: 'Bruma sobre el bosque', descripcion: 'Corto instrumental.', hashtags: ['erhu', '#bosque'] },
    });
    cierto(r.codigo === 200, 'código ' + r.codigo + ' ' + JSON.stringify(r.cuerpo).slice(0, 200));
    const corte = r.cuerpo.proyecto.finalCut;
    cierto(corte.status === 'exported', 'estado del corte: ' + corte.status);
    cierto(corte['export'] && corte['export'].url, 'sin URL de descarga');
    cierto(corte.exportedAt, 'sin fecha de exportación');
    cierto(r.cuerpo.proyecto.delivery.hashtags[0][0] === '#', 'hashtags sin normalizar');
    const nombre = decodeURIComponent(new URL(corte['export'].url).searchParams.get('response-content-disposition') || '');
    cierto(nombre.indexOf('Bruma') !== -1, 'el MP4 no se descarga con el título: ' + nombre);
  });

  await paso('el MP4 quedó de verdad en el bucket, con su hoja al lado', async () => {
    const finales = [...objetos.keys()].filter((k) => k.indexOf('/final/') !== -1);
    cierto(finales.some((k) => k.endsWith('corto_final.mp4')), 'no está el MP4: ' + finales.join(', '));
    cierto(finales.some((k) => k.endsWith('corto_final.json')), 'no está la hoja de metadatos');
  });

  await paso('el proyecto aparece terminado en el listado', async () => {
    const r = await pedir(proyectos, { metodo: 'GET' });
    const ficha = r.cuerpo.proyectos.find((x) => x.id === id);
    cierto(ficha, 'el proyecto no sale en la lista');
    cierto(ficha.finalCutStatus === 'exported', 'estado en la lista: ' + ficha.finalCutStatus);
  });

  console.log('');
  console.log('  objetos escritos en el bucket: ' + objetos.size);
  console.log('  llamadas a Google: ' + llamadas.length);
  console.log('');
  if (fallos.length) {
    console.log(fallos.length + ' FALLOS de ' + (pasadas + fallos.length) + '\n');
    process.exit(1);
  }
  console.log(pasadas + ' pasos, todos correctos.\n');
}

principal().catch((e) => {
  console.error('\nLa prueba no llegó a terminar: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
