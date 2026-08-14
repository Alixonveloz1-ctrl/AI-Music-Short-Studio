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

/**
 * El encargo de música que un paso reescribe a mano y otros dos, mucho más
 * abajo, comprueban: que llegó tal cual al modelo, y que «actualizar las
 * instrucciones» no se lo pisó. Vive aquí porque lo usan los tres.
 */
const MUSICA_A_MANO =
  'Instruments: erhu. Mood: calm. Tempo: around 70 BPM. Written by hand by the user.';

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

  await paso('un prompt bloqueado se puede reescribir a mano, y lo reescrito es lo que viaja', async () => {
    // EL PROBLEMA QUE RESUELVE. Google contesta «los filtros de contenido
    // bloquearon esta imagen, cambia la descripción de la toma» — y hasta ahora
    // no había ninguna forma de cambiarla: el prompt se escribía al crear el
    // corto y era de sólo lectura. El único remedio que ofrecía la herramienta
    // para un prompt bloqueado era empezar el corto de cero.
    const promptEp = require('../api/prompt.js');

    const antes = (await pedir(proyectoEp, { metodo: 'GET', query: { id } }))
      .cuerpo.proyecto.assets.find((x) => x.id === 'master_character');
    const original = antes.spec.prompt;

    const MIO = 'RETRATO ESCRITO A MANO POR EL USUARIO, sin la palabra que bloqueaba.';
    const r = await pedir(promptEp, { metodo: 'POST', cuerpo: { id, activo: 'master_character', prompt: MIO } });
    if (r.codigo !== 200) throw new Error('prompt: ' + JSON.stringify(r.cuerpo).slice(0, 200));
    const editado = r.cuerpo.proyecto.assets.find((x) => x.id === 'master_character');
    cierto(editado.spec.prompt === MIO, 'no se guardó lo que escribió: ' + editado.spec.prompt);
    cierto(editado.spec.promptOriginal === original, 'se perdió el original del Director');
    cierto(editado.spec.promptEditado === true, 'no queda marcado como escrito a mano');

    // LO QUE DE VERDAD IMPORTA: que su texto llegue al modelo. Guardarlo y
    // seguir mandando el viejo sería peor que no dejarlo editar, porque
    // regeneraría igual y sin ningún error que se lo explicase.
    const desde = google.pedidos.length;
    const g = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: 'master_character' } });
    cierto(g.codigo === 200 || g.codigo === 202, 'generar dio ' + g.codigo);
    const enviados = JSON.stringify(google.pedidos.slice(desde));
    cierto(enviados.indexOf(MIO) !== -1, 'el prompt escrito a mano no llegó a Google');
    cierto(enviados.indexOf(original.slice(0, 60)) === -1, 'se siguió mandando el prompt viejo');

    // Un vacío no se acepta: borraría el encargo en vez de cambiarlo.
    const vacio = await pedir(promptEp, { metodo: 'POST', cuerpo: { id, activo: 'master_character', prompt: '   ' } });
    cierto(vacio.codigo === 400, 'un prompt vacío se aceptó (código ' + vacio.codigo + ')');

    // Y siempre se puede volver a lo que escribió el Director.
    const v = await pedir(promptEp, { metodo: 'POST', cuerpo: { id, activo: 'master_character', restaurar: true } });
    if (v.codigo !== 200) throw new Error('restaurar: ' + JSON.stringify(v.cuerpo).slice(0, 200));
    const vuelto = v.cuerpo.proyecto.assets.find((x) => x.id === 'master_character');
    cierto(vuelto.spec.prompt === original, 'no volvió el original');
    cierto(!vuelto.spec.promptEditado, 'sigue marcado como escrito a mano');

    // La música se encarga EN INGLÉS, y es ese campo el que se edita: corregir
    // el español, que es sólo lo que se le enseña al usuario, no cambiaría nada.
    const m = await pedir(promptEp, {
      metodo: 'POST',
      cuerpo: { id, activo: 'music', prompt: MUSICA_A_MANO },
    });
    if (m.codigo !== 200) throw new Error('prompt de música: ' + JSON.stringify(m.cuerpo).slice(0, 200));
    cierto(m.cuerpo.campo === 'promptEn',
      'la música no se editó sobre el campo en inglés, sino sobre ' + m.cuerpo.campo);
    const musica = m.cuerpo.proyecto.assets.find((x) => x.id === 'music');
    cierto(musica.spec.promptEn === MUSICA_A_MANO, 'no se guardó el encargo en inglés');
    cierto(/[áéíóúñ]/i.test(musica.spec.prompt), 'se pisó el encargo en español, que es el que ve el usuario');
    // NO se restaura a propósito: más abajo se comprueba que esto es lo que
    // llegó a Lyria y que «actualizar las instrucciones» no se lo pisó.

  });

  await paso('el modelo se puede cambiar con el corto ya empezado', async () => {
    // «Después que ya tengo seleccionado un modelo de imagen o de video, ya no
    // puedo cambiarlo otra vez, debería poder estar libre, para yo intercambiar
    // generaciones entre modelos.»
    //
    // Antes se fijaba al crear el corto. La razón era buena —dos modelos no
    // dibujan igual y mezclarlos se nota— pero la decisión es suya. Y hay una
    // razón práctica encima: cuando un modelo rechaza un clip una y otra vez,
    // quedarse encerrado en él significa tirar el corto entero.
    const modeloEp = proyectoEp;
    const antes = (await pedir(proyectoEp, { metodo: 'GET', query: { id } })).cuerpo.proyecto;
    const aprobadosAntes = antes.assets.filter((a) => a.approvedGenerationId).length;
    const videoAntes = antes.config.videoModelId;

    const r = await pedir(modeloEp, {
      metodo: 'PATCH',
      cuerpo: { id, videoModelId: 'veo-3.1-fast-generate-001', imageModelId: 'gemini-3.1-flash-image' },
    });
    if (r.codigo !== 200) throw new Error('cambiar modelo: ' + JSON.stringify(r.cuerpo).slice(0, 200));
    cierto(r.cuerpo.cambios.length, 'no dice qué cambió');

    // Se guarda de verdad, no sólo en la respuesta.
    const despues = (await pedir(proyectoEp, { metodo: 'GET', query: { id } })).cuerpo.proyecto;
    cierto(despues.config.videoModelId === 'veo-3.1-fast-generate-001',
      'el modelo de vídeo no se guardó: ' + despues.config.videoModelId);
    cierto(videoAntes !== despues.config.videoModelId, 'la prueba no distingue nada: era el mismo modelo');

    // NADA SE DESAPRUEBA NI SE PIERDE: lo hecho sigue siendo lo oficial.
    cierto(despues.assets.filter((a) => a.approvedGenerationId).length === aprobadosAntes,
      'cambiar de modelo se llevó por delante aprobaciones');
    cierto(despues.events.some((e) => e.type === 'model_changed'),
      'el cambio no queda en la actividad, y es lo primero que hay que poder mirar ' +
      'cuando dos tomas no se parecen');

    // Un modelo inventado se rechaza con un motivo, no con un 500.
    const malo = await pedir(modeloEp, { metodo: 'PATCH', cuerpo: { id, videoModelId: 'no-existe' } });
    cierto(malo.codigo === 400, 'acepta un modelo que no existe (código ' + malo.codigo + ')');

    // Y se deja como estaba, que el resto de la prueba cuenta con ello.
    await pedir(modeloEp, { metodo: 'PATCH', cuerpo: { id, videoModelId: videoAntes } });
  });

  await paso('el montaje se niega mientras falte material, y dice cuál', async () => {
    const r = await pedir(montar, { metodo: 'POST', cuerpo: { id } });
    cierto(r.codigo === 409, 'código ' + r.codigo);
    cierto(typeof r.cuerpo.detalle !== 'object', 'el detalle viaja como objeto: se pintaría [object Object]');
    cierto(/Shot|maestr/i.test(r.cuerpo.error + ' ' + (r.cuerpo.detalle || '')), 'no nombra lo que falta');
  });

  // ── Producir el corto entero ──
  await paso('se produce y aprueba el corto entero, etapa por etapa', async () => {
    for (const etapa of ['images', 'videos', 'music']) {
      for (let vuelta = 0; vuelta < 40; vuelta++) {
        const p = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
        const pendientes = p.cuerpo.proyecto.assets.filter(
          (a) => a.stage === etapa && !(a.approvedGenerationId && !a.stale),
        );
        if (!pendientes.length) break;
        for (const a of pendientes) {
          if (a.locked) await pedir(desbloquear, { metodo: 'POST', cuerpo: { id, activo: a.id } });
          const g = await pedir(generar, {
            metodo: 'POST',
            cuerpo: { id, activo: a.id },
          });
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

  await paso('si Google rechaza el clip por sus palabras, se reintenta solo y más corto', async () => {
    // EL FALLO QUE COSTÓ DOS TARDES. Google contesta «this prompt contains
    // sensitive words» y no dice cuál. Se puso un reintento con menos texto…
    // en el ENVÍO. Pero Veo ACEPTA el envío, devuelve su operación como si todo
    // fuera bien, y sólo AL TERMINAR dice que el prompt tenía palabras
    // sensibles: el reintento nunca llegaba a ejecutarse.
    //
    // Aquí el Google de mentira rechaza igual que el de verdad — en la
    // operación, no en el envío — porque un simulacro más amable que el
    // servicio real deja pasar exactamente este tipo de error.
    const antes = (await pedir(proyectoEp, { metodo: 'GET', query: { id } })).cuerpo.proyecto;
    // A estas alturas el corto está entero y aprobado, así que se desbloquea
    // uno para regenerarlo: es exactamente lo que hace el usuario cuando un
    // clip le sale mal.
    const clip = antes.assets.find((a) => a.kind === 'clip');
    cierto(clip, 'el corto no tiene clips');
    if (clip.locked) await pedir(desbloquear, { metodo: 'POST', cuerpo: { id, activo: clip.id } });

    google.videosPedidos.length = 0;
    google.rechazarProximosVideos(1);   // el primer intento se rechaza; el segundo pasa

    const g = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: clip.id } });
    cierto(g.codigo === 200 || g.codigo === 202, 'lanzar el clip dio ' + g.codigo);
    let gen = g.cuerpo.gen;
    for (let n = 0; n < 30 && gen && gen.status === 'generating'; n += 1) {
      const s = await pedir(generar, { metodo: 'GET', query: { id, activo: clip.id, gen: gen.id } });
      gen = s.cuerpo.gen;
    }

    // 1. NO se rindió: el clip existe.
    cierto(gen && gen.status === 'review',
      'el clip se dio por perdido en vez de reintentarlo: ' + (gen && gen.status) + ' — ' + (gen && gen.error));

    // 2. Se lanzó DOS veces, y la segunda con menos texto y sin negativo.
    cierto(google.videosPedidos.length >= 2,
      'no se relanzó el clip: sólo hubo ' + google.videosPedidos.length + ' envío(s)');
    const primero = google.videosPedidos[0];
    const segundo = google.videosPedidos[google.videosPedidos.length - 1];
    cierto(primero.negativo, 'el primer intento ya iba sin prompt negativo');
    cierto(!segundo.negativo, 'el reintento sigue llevando el prompt negativo');
    cierto(segundo.bloques < primero.bloques,
      'el reintento no va más corto: ' + primero.bloques + ' → ' + segundo.bloques + ' bloques');
    cierto(segundo.bloques >= 3, 'el reintento recortó hasta dejar el clip sin descripción de la toma');

    // 3. Y SE LE DICE AL USUARIO, porque un clip con menos contexto puede no
    // encajar con los demás y eso hay que mirarlo antes de aprobarlo.
    cierto(/rechazó el encargo/.test(gen.aviso || ''),
      'no se avisa de que el clip salió con un encargo recortado: ' + gen.aviso);
  });

  await paso('parar una generación la para de verdad: ni el latido la resucita', async () => {
    // EL FALLO, con las palabras del usuario: «la generación de imágenes o de
    // videos se reintenta automáticamente, pero si se mantiene fallando, yo no
    // puedo pararla, así yo reinicie la página, se sigue reintentando».
    //
    // Lo que reintenta no vive en el navegador: vive en el proyecto, en el
    // bucket. Mientras la generación esté en «generando», CUALQUIER pestaña que
    // abra el corto la empuja otra vez — recargar no paraba nada, abría otro
    // empujador. Y cada empujón contra Veo se paga.
    const antes = (await pedir(proyectoEp, { metodo: 'GET', query: { id } })).cuerpo.proyecto;
    const clip = antes.assets.find((a) => a.kind === 'clip');
    if (clip.locked) await pedir(desbloquear, { metodo: 'POST', cuerpo: { id, activo: clip.id } });

    const g = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: clip.id } });
    cierto(g.codigo === 200 || g.codigo === 202, 'lanzar el clip dio ' + g.codigo);
    const genId = g.cuerpo.gen.id;
    cierto(g.cuerpo.gen.status === 'generating', 'el clip no se quedó generando: no hay nada que parar');

    // Se para, que es lo que hasta ahora no se podía hacer.
    const parado = await pedir(generar, {
      metodo: 'DELETE', query: { id, activo: clip.id, gen: genId },
    });
    cierto(parado.codigo === 200, 'parar dio ' + parado.codigo + ' ' + JSON.stringify(parado.cuerpo).slice(0, 200));
    cierto(parado.cuerpo.paradas && parado.cuerpo.paradas.length === 1,
      'no se paró exactamente una generación: ' + JSON.stringify(parado.cuerpo.paradas));

    const tras = (await pedir(proyectoEp, { metodo: 'GET', query: { id } })).cuerpo.proyecto;
    const clipTras = tras.assets.find((a) => a.id === clip.id);
    const genTras = clipTras.generations.find((x) => x.id === genId);
    cierto(clipTras.status !== 'generating', 'el activo sigue en marcha: ' + clipTras.status);
    cierto(genTras.stoppedByUser, 'la generación no consta como parada por el usuario');

    // LO QUE DE VERDAD SE COMPRUEBA AQUÍ: el latido vuelve —como al recargar la
    // página— y NO se le pide nada más a Google por esta generación.
    const llamadasAntes = google.pedidos.length;
    for (let n = 0; n < 3; n += 1) {
      const s = await pedir(generar, { metodo: 'GET', query: { id, activo: clip.id, gen: genId } });
      cierto(s.codigo === 200, 'el latido sobre una parada dio ' + s.codigo);
      cierto(s.cuerpo.gen.status !== 'generating', 'el latido resucitó la generación parada');
    }
    cierto(google.pedidos.length === llamadasAntes,
      'el latido siguió pidiéndole cosas a Google después de parar: ' +
      (google.pedidos.length - llamadasAntes) + ' llamada(s)');

    // Y después, cuando al usuario le dé la gana, se vuelve a generar a mano.
    // Parar deja el activo igual que un fallo: si ya tenía una versión aprobada
    // vuelve a quedarse con ella, bloqueada, y regenerar pasa por desbloquear —
    // que es la regla de siempre y no cambia por haber parado.
    const clipParado = tras.assets.find((a) => a.id === clip.id);
    cierto(clipParado.approvedGenerationId, 'parar se llevó por delante la versión aprobada');
    if (clipParado.locked) await pedir(desbloquear, { metodo: 'POST', cuerpo: { id, activo: clip.id } });
    const otra = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: clip.id } });
    cierto(otra.codigo === 200 || otra.codigo === 202,
      'después de parar no se puede regenerar a mano: ' + JSON.stringify(otra.cuerpo).slice(0, 200));

    // Se deja el clip como estaba: aprobado, para que siga el resto del corto.
    let gen2 = otra.cuerpo.gen;
    for (let n = 0; n < 30 && gen2 && gen2.status === 'generating'; n += 1) {
      const s = await pedir(generar, { metodo: 'GET', query: { id, activo: clip.id, gen: gen2.id } });
      gen2 = s.cuerpo.gen;
    }
    cierto(gen2 && gen2.status === 'review', 'la regeneración terminó en ' + (gen2 && gen2.status));
    const ap = await pedir(aprobar, { metodo: 'POST', cuerpo: { id, activo: clip.id, gen: gen2.id } });
    cierto(ap.codigo === 200, 'aprobar el clip regenerado: ' + JSON.stringify(ap.cuerpo).slice(0, 200));
  });

  await paso('parar todo el corto no necesita ir activo por activo', async () => {
    // El botón de emergencia: cuando hay varias en marcha y todas están
    // chocando contra lo mismo —un límite de peticiones, por ejemplo— pararlas
    // de una en una desde un teléfono no es una opción.
    const antes = (await pedir(proyectoEp, { metodo: 'GET', query: { id } })).cuerpo.proyecto;
    const clips = antes.assets.filter((a) => a.kind === 'clip').slice(0, 2);
    cierto(clips.length === 2, 'el corto no tiene dos clips que parar');

    for (const c of clips) {
      if (c.locked) await pedir(desbloquear, { metodo: 'POST', cuerpo: { id, activo: c.id } });
      const r = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: c.id } });
      cierto(r.codigo === 200 || r.codigo === 202, 'lanzar ' + c.id + ' dio ' + r.codigo);
    }

    // Sin `activo`: se para todo lo que esté en marcha en este corto.
    const parado = await pedir(generar, { metodo: 'DELETE', query: { id } });
    cierto(parado.codigo === 200, 'parar todo dio ' + parado.codigo);
    cierto(parado.cuerpo.paradas.length === 2,
      'no se pararon las dos generaciones en marcha: ' + parado.cuerpo.paradas.length);

    const tras = (await pedir(proyectoEp, { metodo: 'GET', query: { id } })).cuerpo.proyecto;
    cierto(tras.assets.filter((a) => a.status === 'generating').length === 0,
      'quedó algo generándose después de parar todo');

    // Parar cuando ya no hay nada es inofensivo: el botón no rompe nada si se
    // pulsa dos veces, que en un móvil pasa constantemente.
    const otra = await pedir(generar, { metodo: 'DELETE', query: { id } });
    cierto(otra.codigo === 200, 'parar dos veces dio ' + otra.codigo);
    cierto(otra.cuerpo.paradas.length === 0, 'la segunda vez paró algo que no estaba en marcha');

    // Y el corto se deja como estaba: los dos clips vuelven a generarse y se
    // aprueban, que si no el montaje de más abajo no tendría material.
    for (const c of clips) {
      const estaAhora = tras.assets.find((a) => a.id === c.id);
      if (estaAhora.locked) await pedir(desbloquear, { metodo: 'POST', cuerpo: { id, activo: c.id } });
      const r = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: c.id } });
      cierto(r.codigo === 200 || r.codigo === 202,
        'regenerar ' + c.id + ' dio ' + r.codigo + ' ' + JSON.stringify(r.cuerpo).slice(0, 160));
      let gen = r.cuerpo.gen;
      for (let n = 0; n < 30 && gen && gen.status === 'generating'; n += 1) {
        const s = await pedir(generar, { metodo: 'GET', query: { id, activo: c.id, gen: gen.id } });
        gen = s.cuerpo.gen;
      }
      cierto(gen && gen.status === 'review', c.id + ' terminó en ' + (gen && gen.status));
      const ap = await pedir(aprobar, { metodo: 'POST', cuerpo: { id, activo: c.id, gen: gen.id } });
      cierto(ap.codigo === 200, 'aprobar ' + c.id + ': ' + JSON.stringify(ap.cuerpo).slice(0, 200));
    }
  });

  await paso('si la música no cabe en el minuto de Vercel, se compone en Google', async () => {
    // EL FALLO, con las palabras del usuario: «No se pudo componer el fragmento
    // 1: Google tardó más de 45 s en responder y la función de Vercel se corta a
    // los 60». Componer es lo único aquí que puede tardar más de un minuto, y en
    // el plan gratuito de Vercel ese minuto no se puede subir. Reintentar desde
    // la misma función es volver a jugársela al mismo dado.
    //
    // Aquí Lyria no contesta a tiempo la primera vez —abortando de verdad, como
    // pasa en producción— y la pieza tiene que salir igual, compuesta en una
    // máquina de Cloud Build que no tiene ese límite.
    const antes = (await pedir(proyectoEp, { metodo: 'GET', query: { id } })).cuerpo.proyecto;
    const musica = antes.assets.find((a) => a.kind === 'music');
    cierto(musica, 'el corto no tiene música');
    if (musica.locked) await pedir(desbloquear, { metodo: 'POST', cuerpo: { id, activo: musica.id } });

    const mp3Antes = new Set([...objetos.keys()].filter((k) => /\.mp3$/.test(k)));
    google.agotarProximasMusicas(1);

    const g = await pedir(generar, { metodo: 'POST', cuerpo: { id, activo: musica.id } });
    cierto(g.codigo === 200 || g.codigo === 202, 'lanzar la música dio ' + g.codigo);
    let gen = g.cuerpo.gen;
    for (let n = 0; n < 30 && gen && gen.status === 'generating'; n += 1) {
      const s = await pedir(generar, { metodo: 'GET', query: { id, activo: musica.id, gen: gen.id } });
      gen = s.cuerpo.gen;
    }

    // 1. NO se rindió: la pieza está lista para que el usuario la revise.
    cierto(gen && gen.status === 'review',
      'la música se dio por perdida en vez de componerla en Google: ' +
      (gen && gen.status) + ' — ' + (gen && gen.error));

    // 2. Y se compuso allí de verdad: quedó el papeleo del encargo en el bucket.
    const encargos = [...objetos.keys()].filter((k) => /\/composiciones\/.*encargo\.json$/.test(k));
    cierto(encargos.length, 'no se le encargó nada a Cloud Build: se reintentó aquí y ya');

    // 3. Lo que se le mandó a Google es un encargo de música de verdad, con su
    //    línea de tiempo: es la única forma de pedir la duración.
    const encargo = JSON.parse(objetos.get(encargos[encargos.length - 1]).toString('utf8'));
    const texto = encargo.contents[0].parts[0].text;
    cierto(/\[00:00\]/.test(texto), 'el encargo que fue a Cloud Build perdió su línea de tiempo');
    cierto(!/[áéíóúñ¿¡]/i.test(texto), 'se le coló español a Lyria por el camino de Cloud Build');

    // 4. Y la pista guardada es el audio que dejó la máquina, SIN TOCAR: un MP3
    //    envuelto en una cabecera WAV es ruido blanco, y eso ya pasó una vez.
    const nuevas = [...objetos.keys()].filter((k) => /\.mp3$/.test(k) && !mp3Antes.has(k));
    cierto(nuevas.length, 'la pieza compuesta en Google no llegó al bucket como MP3: ' +
      [...objetos.keys()].filter((k) => /musica|composiciones/.test(k)).join(' · '));
    cierto(nuevas.some((k) => objetos.get(k).equals(google.audioEnviado)),
      'el audio que compuso Google llegó modificado al bucket: ' + nuevas.join(' · '));
    // Y el fragmento quedó en la carpeta del activo, no en la del papeleo.
    cierto(nuevas.some((k) => /\/musica\//.test(k)),
      'la pista no quedó donde van las pistas: ' + nuevas.join(' · '));

    const ap = await pedir(aprobar, { metodo: 'POST', cuerpo: { id, activo: musica.id, gen: gen.id } });
    cierto(ap.codigo === 200, 'aprobar la música: ' + JSON.stringify(ap.cuerpo).slice(0, 200));
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
    const musica = [...objetos.keys()].filter((k) => /\/musica\//.test(k));
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

  await paso('el corto se monta con una sola pista de audio: la música', async () => {
    // EL SONIDO AMBIENTAL SE QUITÓ DEL PRODUCTO. En palabras del usuario: los
    // de IA «la generación falla mucho y, cuando por fin los hace, vienen con
    // música»; los sintéticos, «solamente escucho un ruido horrible, que lo que
    // hace es dañar la calidad de la música».
    //
    // Quitarlo a medias sería peor que dejarlo: un activo que ya no se puede
    // generar bloquearía su etapa y el montaje no se abriría nunca. Este paso
    // comprueba que el corto llegó hasta el MP4 sin él.
    const p = await pedir(proyectoEp, { metodo: 'GET', query: { id } });
    const assets = p.cuerpo.proyecto.assets;
    cierto(!assets.some((a) => a.kind === 'ambient'), 'el corto todavía tiene un activo de ambiente');
    cierto(!p.cuerpo.proyecto.plan.ambient, 'el plan todavía lleva encargo de ambiente');

    // Y aun así se montó y se exportó: la etapa de ambiente no dejó nada colgado.
    cierto(p.cuerpo.proyecto.finalCut && p.cuerpo.proyecto.finalCut['export'],
      'el corto no llegó a exportarse');

    // Lo que se le mandó a ffmpeg lleva una sola entrada de audio.
    const encargos = [...objetos.keys()].filter((k) => /montajes\/.*\/(script\.sh|montaje\.sh|.*\.sh)$/.test(k));
    cierto(encargos.length, 'no se guardó el script del montaje en el bucket');
    const script = objetos.get(encargos[encargos.length - 1]).toString('utf8');
    cierto(script.indexOf('amix') === -1, 'el montaje sigue mezclando dos pistas');
    cierto(script.indexOf('ambiente') === -1, 'el montaje sigue bajando una pista de ambiente');
    cierto(/musica\./.test(script), 'el montaje no usa la pista de música');

    // Y de paso: el encargo de música que el usuario reescribió a mano mucho
    // antes es EXACTAMENTE lo que se le mandó a Lyria. Guardarlo y seguir
    // mandando el del Director sería peor que no dejarlo editar, porque
    // regeneraría igual y sin ningún error que se lo explicase.
    const textoDe = (q) => ((q.cuerpo.contents || [])
      .flatMap((c) => c.parts || []).map((x) => x.text || '').join('\n'));
    const aLyria = google.pedidos.filter((q) => /lyria/i.test(q.url));
    cierto(aLyria.length, 'no se encuentra ninguna petición a Lyria');
    cierto(aLyria.some((q) => textoDe(q).indexOf(MUSICA_A_MANO) !== -1),
      'a Lyria no le llegó el encargo escrito a mano');
  });

  await paso('un corto viejo puede actualizar sus instrucciones sin perder nada', async () => {
    // EL PROBLEMA QUE RESUELVE. Los encargos se escriben al crear el corto y se
    // guardan dentro. El usuario tuvo un corto de un zombie con batería cuya
    // música salía sin batería; se arregló el Director y siguió saliendo igual,
    // porque SU corto llevaba dentro las instrucciones viejas. Cada mejora
    // servía sólo para cortos nuevos.
    const actualizar = require('../api/actualizar.js');

    // Se ensucia el proyecto como si viniera de una versión anterior: encargos
    // viejos en un activo aprobado y en otro sin aprobar.
    const antes = (await pedir(proyectoEp, { metodo: 'GET', query: { id } })).cuerpo.proyecto;
    const aprobadosAntes = antes.assets.filter((a) => a.approvedGenerationId).length;
    const tomasAntes = antes.plan.shots.length;
    const lineaAntes = JSON.stringify(antes.plan.timeline.map((t) => [t.clipId, t.durationSec]));

    const { modificarProyecto } = require('../api/_lib/almacen.js');
    await modificarProyecto(id, (p) => {
      for (const a of p.assets) a.spec = Object.assign({}, a.spec, { prompt: 'ENCARGO VIEJO' });
      p.plan.music = Object.assign({}, p.plan.music, { promptEn: 'Instruments: bateria.' });
    });

    const r = await pedir(actualizar, { metodo: 'POST', cuerpo: { id } });
    if (r.codigo !== 200) throw new Error('actualizar: ' + JSON.stringify(r.cuerpo).slice(0, 200));
    const despues = r.cuerpo.proyecto;

    // 1. Los encargos se reescribieron.
    cierto(r.cuerpo.cambiados.length > 0, 'no se actualizó ningún encargo');
    cierto(!despues.assets.some((a) => !a.spec.promptEditado && a.spec.prompt === 'ENCARGO VIEJO'),
      'quedan encargos viejos sin actualizar');
    cierto(!/bateria/.test(despues.plan.music.promptEn || ''),
      'el encargo de música sigue siendo el viejo: ' + despues.plan.music.promptEn);

    // 1 bis. LO QUE EL USUARIO ESCRIBIÓ A MANO NO SE PISA. El encargo de música
    // se reescribió a mano unos pasos más arriba —normalmente se hace para
    // rodear un filtro que bloqueaba la generación—, así que ponerle encima el
    // texto del Director le devolvería justo el que ya sabe que no pasa. Se
    // respeta y se le avisa de cuáles se han quedado fuera.
    const musicaDespues = despues.assets.find((a) => a.kind === 'music');
    cierto(musicaDespues.spec.promptEn === MUSICA_A_MANO,
      'se pisó el encargo que el usuario escribió a mano: ' + musicaDespues.spec.promptEn);
    cierto((r.cuerpo.respetados || []).length > 0, 'no se dice qué encargos a mano se han respetado');
    cierto((r.cuerpo.avisos || []).some((t) => /a mano/i.test(t)),
      'el usuario no recibe ningún aviso de que hay encargos suyos sin actualizar');

    // 2. LA ESTRUCTURA NO SE TOCA. Ni una toma más, ni una menos, ni un segundo.
    cierto(despues.plan.shots.length === tomasAntes,
      'cambió el número de tomas: ' + tomasAntes + ' → ' + despues.plan.shots.length);
    cierto(JSON.stringify(despues.plan.timeline.map((t) => [t.clipId, t.durationSec])) === lineaAntes,
      'cambió la línea de tiempo, que el usuario ya había aprobado');

    // 3. NADA SE DESAPRUEBA. Lo aprobado sigue aprobado.
    const aprobadosDespues = despues.assets.filter((a) => a.approvedGenerationId).length;
    cierto(aprobadosDespues === aprobadosAntes,
      'se perdieron aprobaciones: ' + aprobadosAntes + ' → ' + aprobadosDespues);
    // 4. Pero sí se avisa de lo que cambió.
    cierto(despues.assets.some((a) => a.stale),
      'no se marcó como desactualizado nada de lo que cambió de instrucciones');
    // 5. Y el MP4 exportado sigue en su sitio.
    cierto(despues.finalCut && despues.finalCut['export'] && despues.finalCut['export'].path,
      'se perdió el MP4 exportado');
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
