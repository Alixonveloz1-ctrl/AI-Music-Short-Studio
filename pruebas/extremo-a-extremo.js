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

// ─── Entorno y Google Cloud simulado (pruebas/google-simulado.js) ───
const { instalarGoogleSimulado, entornoDePrueba } = require('./google-simulado.js');
entornoDePrueba();
const google = instalarGoogleSimulado();
const { objetos, llamadas } = google;

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

  await paso('el audio guardado es un archivo de audio de verdad, no bytes rotos', async () => {
    // ESTA COMPROBACIÓN FALTABA Y POR ESO LA ESTÁTICA PASÓ TRES VECES. Se
    // miraba que el archivo existiera, no que se pudiera abrir. Un MP3 envuelto
    // en una cabecera WAV existe perfectamente y suena a ruido blanco.
    const musica = [...objetos.keys()].filter((k) => /\/(musica|ambiente)\//.test(k));
    cierto(musica.length, 'no hay ninguna pista de música en el bucket');

    const firmaDe = (b) => {
      const h4 = b.toString('latin1', 0, 4);
      if (h4 === 'RIFF') return '.wav';
      if (h4 === 'OggS') return '.ogg';
      if (h4 === 'fLaC') return '.flac';
      if (b.toString('latin1', 4, 8) === 'ftyp') return '.m4a';
      if (h4.slice(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return '.mp3';
      return null;
    };

    for (const clave of musica) {
      const bytes = objetos.get(clave);
      cierto(bytes && bytes.length > 100, 'pista vacía o minúscula: ' + clave);
      const firma = firmaDe(bytes);
      cierto(firma, 'el archivo ' + clave + ' no tiene firma de audio reconocible; ' +
        'empieza por ' + bytes.toString('hex', 0, 8));
      // Y la extensión del nombre tiene que decir la verdad sobre su contenido.
      cierto(clave.endsWith(firma),
        'el archivo se llama ' + clave + ' pero por dentro es ' + firma +
        ' — un MP3 con nombre .wav no lo abre ni el navegador ni ffmpeg');

      // LA COMPROBACIÓN QUE DE VERDAD DELATA LA ESTÁTICA. Que un archivo
      // empiece por «RIFF» no significa que dentro haya audio: un MP3 con una
      // cabecera WAV pegada delante también empieza por RIFF, y es exactamente
      // el fallo que se coló tres veces seguidas. Lo que lo destapa es la
      // DURACIÓN: una cabecera que miente sobre el formato miente también sobre
      // cuánto dura, y un archivo que dice durar siete segundos cuando se
      // pidieron sesenta está roto por dentro.
      if (firma === '.wav') {
        const d = require('../api/_lib/audio.js').decodeWav(bytes);
        const segundos = d.samples.length / d.channels / d.sampleRate;
        cierto(Math.abs(segundos - 60) < 6,
          'el WAV ' + clave + ' dura ' + segundos.toFixed(1) + ' s y debería durar 60. ' +
          'Su cabecera dice ' + d.sampleRate + ' Hz y ' + d.channels + ' canal(es), ' +
          'así que ese formato no es el real y lo que se oiría es ruido');
      }
    }

    // Y LA REGLA DE ORO, la que se saltó tres veces seguidas: cuando Google
    // manda audio YA EMPAQUETADO —MP3, OGG, M4A—, lo que se guarda tiene que
    // ser EXACTAMENTE eso, byte por byte. Ni una cabecera de más. Comprobar la
    // firma no basta: un MP3 con una cabecera WAV pegada delante empieza por
    // «RIFF» y pasa cualquier comprobación de formato, y suena a estática.
    const enviado = google.audioEnviado;
    const empaquetado = enviado && (
      enviado[0] === 0xff || enviado.toString('latin1', 0, 3) === 'ID3' ||
      ['RIFF', 'OggS', 'fLaC'].indexOf(enviado.toString('latin1', 0, 4)) !== -1
    );
    if (empaquetado) {
      const pista = musica.map((k) => objetos.get(k)).find((b) => b.length >= enviado.length);
      cierto(pista, 'la pista guardada es más corta que la que mandó Google: se ha perdido audio');
      cierto(pista.equals(enviado),
        'Google mandó ' + enviado.length + ' bytes de ' + google.audioMime + ' y se guardaron ' +
        pista.length + '. El audio empaquetado NO se toca: reinterpretarlo es lo que suena a ruido');
    }
  });

  await paso('el paquete .zip existe, se abre y trae el vídeo y el texto', async () => {
    const zips = [...objetos.keys()].filter((k) => k.endsWith('.zip'));
    cierto(zips.length === 1, 'debería haber un paquete y hay ' + zips.length);
    const bytes = objetos.get(zips[0]);

    // Se abre con `unzip` de verdad, no mirando bytes: un ZIP que sólo pasa mis
    // propias comprobaciones no sirve de nada si el móvil del usuario no lo abre.
    const fs = require('fs');
    const os = require('os');
    const path2 = require('path');
    const { execFileSync } = require('child_process');
    const carpeta = fs.mkdtempSync(path2.join(os.tmpdir(), 'zip-'));
    const archivo = path2.join(carpeta, 'paquete.zip');
    fs.writeFileSync(archivo, bytes);
    try {
      execFileSync('unzip', ['-t', archivo], { stdio: 'pipe' });
    } catch (e) {
      throw new Error('unzip dice que el paquete está dañado: ' + String(e.stdout || e.message).slice(0, 200));
    }
    const listado = execFileSync('unzip', ['-Z1', archivo], { encoding: 'utf8' }).trim().split('\n');
    cierto(listado.some((n) => n.endsWith('.mp4')), 'el paquete no lleva el MP4: ' + listado.join(', '));
    cierto(listado.some((n) => n.endsWith('.txt')), 'el paquete no lleva la hoja de texto');

    // Y la hoja trae de verdad lo que hay que copiar y pegar.
    const nombreTxt = listado.find((n) => n.endsWith('.txt'));
    const hoja = execFileSync('unzip', ['-p', archivo, nombreTxt], { encoding: 'utf8' });
    for (const parte of ['TÍTULO', 'DESCRIPCIÓN', 'HASHTAGS', 'TODO JUNTO']) {
      cierto(hoja.indexOf(parte) !== -1, 'a la hoja le falta el bloque de ' + parte);
    }
    // El MP4 de dentro es el mismo que se exportó, byte por byte.
    const nombreMp4 = listado.find((n) => n.endsWith('.mp4'));
    const dentro = execFileSync('unzip', ['-p', archivo, nombreMp4], { maxBuffer: 1 << 28 });
    const exportado = objetos.get([...objetos.keys()].find((k) => k.endsWith('corto_final.mp4')));
    cierto(dentro.equals(exportado), 'el MP4 del paquete no es el que se exportó');
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  await paso('el proyecto aparece terminado en el listado', async () => {
    const r = await pedir(proyectos, { metodo: 'GET' });
    const ficha = r.cuerpo.proyectos.find((x) => x.id === id);
    cierto(ficha, 'el proyecto no sale en la lista');
    cierto(ficha.finalCutStatus === 'exported', 'estado en la lista: ' + ficha.finalCutStatus);
  });

  await paso('borrar un corto se lleva TODO su material del bucket', async () => {
    // Un corto de prueba que salió mal ocupa lo mismo que uno bueno. Si no se
    // puede quitar, la lista se convierte en un cementerio y el bucket paga.
    const antes = [...objetos.keys()].filter((k) => k.indexOf(id) !== -1).length;
    cierto(antes > 0, 'este corto no tiene material que borrar');

    const r = await pedir(proyectoEp, { metodo: 'DELETE', query: { id } });
    cierto(r.codigo === 200, 'código ' + r.codigo + ' ' + JSON.stringify(r.cuerpo).slice(0, 150));
    cierto(r.cuerpo.borrado === true, 'no dice que lo borró');

    const quedan = [...objetos.keys()].filter((k) => k.indexOf(id) !== -1);
    cierto(quedan.length === 0, 'quedaron ' + quedan.length + ' archivos: ' + quedan.slice(0, 3).join(', '));

    // Y ya no se puede abrir.
    const luego = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
    cierto(luego.codigo === 404, 'sigue abriéndose con código ' + luego.codigo);

    // Borrar algo que no existe avisa, no revienta.
    const otra = await pedir(proyectoEp, { metodo: 'DELETE', query: { id: 'prj_que_no_existe' } });
    cierto(otra.codigo === 404, 'borrar lo inexistente dio ' + otra.codigo);
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
