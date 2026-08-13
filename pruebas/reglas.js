// ════════════════════════════════════════════════════════════════
// PRUEBAS DE LAS REGLAS DEL PRODUCTO
//
//   node pruebas/reglas.js
//
// Sin framework y sin dependencias, igual que el resto del proyecto:
// si hace falta instalar algo para comprobar que la herramienta
// funciona, la comprobación acaba sin ejecutarse nunca.
//
// Lo que se vigila aquí no es "que el código no reviente", es que no
// se rompa la promesa del producto: que nada se aprueba solo, que las
// etapas van en orden, y que la interfaz y el servidor entienden esas
// reglas EXACTAMENTE IGUAL.
//
// Ese último punto merece explicación. La interfaz es un index.html
// sin compilación, así que no puede importar api/_lib/progreso.js: le
// hizo falta su propia copia de las reglas. Dos copias de una regla
// son dos copias que pueden separarse, y si se separan el usuario ve
// un botón que el servidor luego rechaza — o peor, ve como terminada
// una etapa que no lo está. La prueba de abajo ejecuta las dos sobre
// el mismo proyecto y compara.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

let pasadas = 0;
const fallos = [];

function comprobar(nombre, fn) {
  try {
    fn();
    pasadas++;
    console.log('  ✓ ' + nombre);
  } catch (e) {
    fallos.push({ nombre, error: e.message });
    console.log('  ✗ ' + nombre);
    console.log('      ' + e.message);
  }
}

/** Igual que `comprobar`, para las que necesitan await. */
async function comprobarAsync(nombre, fn) {
  try {
    await fn();
    pasadas++;
    console.log('  ✓ ' + nombre);
  } catch (e) {
    fallos.push({ nombre, error: e.message });
    console.log('  ✗ ' + nombre);
    console.log('      ' + e.message);
  }
}

function igual(obtenido, esperado, que) {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error((que || 'valor') + ': se esperaba ' + b + ' y llegó ' + a);
}

function cierto(condicion, que) {
  if (!condicion) throw new Error(que || 'la condición no se cumple');
}

// ─── Módulos del servidor ───
const dominio = require(path.join(RAIZ, 'api/_lib/dominio.js'));
const progreso = require(path.join(RAIZ, 'api/_lib/progreso.js'));
const productor = require(path.join(RAIZ, 'api/_lib/productor.js'));
const montaje = require(path.join(RAIZ, 'api/_lib/montaje.js'));
const audio = require(path.join(RAIZ, 'api/_lib/audio.js'));
const planificador = require(path.join(RAIZ, 'api/_lib/planificador.js'));
const arte = require(path.join(RAIZ, 'api/_lib/arte.js'));
const vertex = require(path.join(RAIZ, 'api/_lib/vertex.js'));
const catalogo = require(path.join(RAIZ, 'api/_lib/catalogo.js'));
const rasgos = require(path.join(RAIZ, 'api/_lib/rasgos.js'));
const zip = require(path.join(RAIZ, 'api/_lib/zip.js'));
const { construirPlan } = require(path.join(RAIZ, 'api/_lib/plan.js'));

const CONFIG = {
  instrumentIds: ['erhu'],
  formationId: 'solo',
  performerTypeId: 'adult_woman',
  scenarioId: 'forest',
  visualStyleId: 'anime_cinematic',
  durationSec: 60,
  creativeDirection: 'niebla baja al amanecer',
  scenarioCustom: '',
  visualStyleCustom: '',
};

/**
 * Carga las funciones de reglas del index.html en un contexto aparte.
 *
 * Se ejecuta el <script> entero con un DOM de mentira: no interesa la interfaz,
 * interesan las funciones puras que hay dentro. Lo que no encuentre se queda en
 * silencio porque el arranque va dentro de un try, y las funciones sí quedan
 * definidas en el contexto.
 */
function reglasDeLaInterfaz(navegador) {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const guion = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!guion) throw new Error('index.html no tiene un bloque <script>');

  const nada = () => {};
  const elementoFalso = {
    style: {}, classList: { add: nada, remove: nada, toggle: nada, contains: () => false },
    addEventListener: nada, appendChild: nada, remove: nada, focus: nada,
    setAttribute: nada, removeAttribute: nada, querySelector: () => null,
    querySelectorAll: () => [], innerHTML: '', textContent: '', value: '', dataset: {},
  };
  const contexto = {
    console: { log: nada, warn: nada, error: nada },
    document: {
      getElementById: () => elementoFalso,
      querySelector: () => elementoFalso,
      querySelectorAll: () => [],
      createElement: () => elementoFalso,
      addEventListener: nada,
      body: elementoFalso,
      documentElement: elementoFalso,
    },
    // `navegador` permite fingir un dispositivo concreto: hay comportamiento que
    // depende de si esto es un iPhone y de si se abrió desde el icono de la
    // pantalla de inicio, y eso no se puede comprobar de otra manera.
    window: {
      addEventListener: nada,
      matchMedia: (q) => ({
        matches: Boolean(
          navegador && navegador.displayModeStandalone &&
          String(q).indexOf('display-mode: standalone') !== -1,
        ),
        addEventListener: nada,
      }),
    },
    localStorage: { getItem: () => null, setItem: nada, removeItem: nada },
    location: { hash: '', href: '' },
    fetch: () => Promise.reject(new Error('sin red en las pruebas')),
    setTimeout: nada, clearTimeout: nada, setInterval: nada, clearInterval: nada,
    requestAnimationFrame: nada,
    navigator: Object.assign(
      { userAgent: 'pruebas', maxTouchPoints: 0 },
      navegador && navegador.navigator,
    ),
  };
  contexto.window.navigator = contexto.navigator;
  // Globales extra que sólo necesitan algunas pruebas: un `fetch` de mentira,
  // File/Blob para la hoja de compartir… Se añaden aquí en vez de dejarlos
  // siempre puestos para que el resto siga corriendo sin navegador ninguno.
  Object.assign(contexto, (navegador && navegador.extras) || {});
  contexto.globalThis = contexto;
  vm.createContext(contexto);
  // El arranque de la interfaz falla sin navegador de verdad, y da igual: para
  // cuando falla, las funciones ya están declaradas en el contexto.
  try {
    vm.runInContext(guion[1], contexto, { timeout: 10000 });
  } catch (e) {
    /* se ignora a propósito: solo interesan las funciones */
  }
  return contexto;
}

async function principal() {
  console.log('\nREGLAS DEL PRODUCTO\n');

  const { plan } = await construirPlan(CONFIG);
  const nuevo = () => dominio.createProject(CONFIG, plan);

  // ── La regla central (PRD §4, §46) ──
  console.log('Nada se aprueba solo');

  comprobar('un proyecto nuevo no tiene nada aprobado', () => {
    const p = nuevo();
    igual(p.assets.filter((a) => a.status === 'approved').length, 0, 'activos aprobados');
    igual(p.assets.filter((a) => a.locked).length, 0, 'activos bloqueados');
  });

  comprobar('una generación correcta deja el activo en revisión, no aprobado', () => {
    const p = nuevo();
    const a = dominio.getAsset(p, 'master_character');
    const g = dominio.startGeneration(p, a, { prompt: 'p', negativePrompt: 'n', referenceAssetIds: [], provider: { name: 'prueba' }, seed: 1 });
    dominio.completeGeneration(p, a, g, { path: 'x.png', bytes: 10, mimeType: 'image/png' });
    igual(a.status, 'review', 'estado del activo');
    igual(a.approvedGenerationId, null, 'versión oficial');
    igual(a.locked, false, 'bloqueo');
  });

  comprobar('aprobar es lo único que aprueba, y bloquea', () => {
    const p = nuevo();
    const a = dominio.getAsset(p, 'master_character');
    const g = dominio.startGeneration(p, a, { prompt: 'p', negativePrompt: 'n', referenceAssetIds: [], provider: { name: 'prueba' }, seed: 1 });
    dominio.completeGeneration(p, a, g, { path: 'x.png', bytes: 10, mimeType: 'image/png' });
    dominio.approveGeneration(p, 'master_character', g.id);
    igual(a.status, 'approved', 'estado');
    igual(a.approvedGenerationId, g.id, 'versión oficial');
    igual(a.locked, true, 'bloqueo');
  });

  comprobar('no se pasa del tope de funciones del plan gratuito de Vercel', () => {
    // EL FALLO QUE MOTIVA ESTA COMPROBACIÓN, y es el peor tipo: silencioso.
    //
    // Vercel sólo deja DOCE funciones serverless por despliegue en el plan
    // gratuito. El proyecto estaba justo en doce. Añadir `api/modelo.js` fue la
    // trece, y desde ese commit NINGÚN despliegue volvió a pasar: producción se
    // quedó clavada horas en una versión vieja mientras yo daba por desplegados
    // unos cambios que nunca salieron, y el usuario probando una herramienta que
    // no tenía ninguno de ellos.
    //
    // Nada en el repositorio lo delataba: las pruebas pasaban, la sintaxis era
    // correcta y el commit se subía bien. El límite sólo aparece en el registro
    // de Vercel, que desde un móvil no se mira. Así que se comprueba aquí.
    const TOPE_HOBBY = 12;
    const enApi = fs.readdirSync(path.join(RAIZ, 'api'))
      .filter((n) => !fs.statSync(path.join(RAIZ, 'api', n)).isDirectory())
      .filter((n) => /\.(js|mjs|ts)$/.test(n));

    // Las Edge no cuentan para ese tope: son otro tipo de función. Se reconocen
    // porque declaran su runtime dentro del propio archivo.
    const edge = enApi.filter((n) =>
      /runtime:\s*'edge'/.test(fs.readFileSync(path.join(RAIZ, 'api', n), 'utf8')));
    const serverless = enApi.filter((n) => edge.indexOf(n) === -1);

    cierto(serverless.length <= TOPE_HOBBY,
      'hay ' + serverless.length + ' funciones serverless y el plan gratuito admite ' + TOPE_HOBBY +
      '. NINGÚN despliegue va a pasar hasta que se junten dos endpoints en uno. Son: ' +
      serverless.join(', '));
  });

  comprobar('ningún archivo de api/ aprueba por su cuenta', () => {
    // La búsqueda es tosca a propósito: si alguien añade mañana un atajo que
    // marque algo como aprobado fuera de approveGeneration, esta prueba se
    // entera aunque nadie se acuerde de venir a actualizarla.
    const sospechosos = [];
    const revisar = (dir) => {
      for (const nombre of fs.readdirSync(dir)) {
        const completo = path.join(dir, nombre);
        if (fs.statSync(completo).isDirectory()) { revisar(completo); continue; }
        if (!nombre.endsWith('.js') && !nombre.endsWith('.mjs')) continue;
        const texto = fs.readFileSync(completo, 'utf8');
        texto.split('\n').forEach((linea, i) => {
          // Solo ASIGNACIONES. El lookbehind descarta ===, !==, <= y >=: una
          // comparación con 'approved' es normal en cualquier sitio, lo que no
          // puede haber fuera de dominio.js es algo que lo PONGA.
          if (/(?<![=!<>])=\s*['"]approved['"]|approvedGenerationId\s*(?<![=!<>])=(?!=)/.test(linea)) {
            sospechosos.push(path.relative(RAIZ, completo) + ':' + (i + 1));
          }
        });
      }
    };
    revisar(path.join(RAIZ, 'api'));
    const permitidos = sospechosos.filter((s) => !s.startsWith('api/_lib/dominio.js'));
    igual(permitidos, [], 'sitios que aprueban fuera de dominio.js');
  });

  // ── Orden de las etapas (PRD §5) ──
  console.log('\nLas etapas van en orden');

  comprobar('los vídeos no se abren hasta aprobar todas las imágenes', () => {
    const p = nuevo();
    igual(progreso.stageIsOpen(p, 'images'), true, 'imágenes abiertas');
    igual(progreso.stageIsOpen(p, 'videos'), false, 'vídeos cerrados');
    igual(progreso.stageIsOpen(p, 'music'), false, 'música cerrada');
  });

  comprobar('un activo obsoleto no cuenta como etapa terminada', () => {
    const p = nuevo();
    for (const a of p.assets.filter((x) => x.stage === 'images')) {
      const g = dominio.startGeneration(p, a, { prompt: 'p', negativePrompt: 'n', referenceAssetIds: [], provider: { name: 'prueba' }, seed: 1 });
      dominio.completeGeneration(p, a, g, { path: a.id + '.png', bytes: 10, mimeType: 'image/png' });
      dominio.approveGeneration(p, a.id, g.id);
    }
    igual(progreso.isStageComplete(p, 'images'), true, 'imágenes completas');
    const alguna = p.assets.find((x) => x.stage === 'images' && x.id !== 'master_character');
    alguna.stale = true;
    igual(progreso.isStageComplete(p, 'images'), false, 'con una obsoleta ya no está completa');
  });

  // ── La interfaz y el servidor piensan igual ──
  console.log('\nLa interfaz y el servidor aplican las mismas reglas');

  const ui = reglasDeLaInterfaz();

  comprobar('index.html expone las funciones de reglas que se van a comparar', () => {
    for (const nombre of ['etapaAbierta', 'etapaCompleta', 'puedeGenerar', 'cuenta']) {
      cierto(typeof ui[nombre] === 'function', 'falta la función ' + nombre + ' en index.html');
    }
  });

  comprobar('la cola respeta las dependencias y no se salta la aprobación', () => {
    // La cola automatiza GENERAR. No automatiza APROBAR: eso es la regla del
    // producto (PRD §4, §46) y la prueba de abajo la vigila con la cola dentro.
    for (const nombre of ['colaSiguiente', 'colaPendientes', 'colaVacia']) {
      cierto(typeof ui[nombre] === 'function', 'falta ' + nombre + ' en index.html');
    }

    const p = nuevo();
    ui.estado.proyecto = p;
    ui.estado.proyectoId = p.id;
    ui.estado.cola = ui.colaVacia('images');

    // Generar y aprobar un activo, como haría el usuario tras revisarlo.
    const producir = (a) => {
      const g = dominio.startGeneration(p, a, { prompt: 'p', negativePrompt: 'n', referenceAssetIds: [], provider: { name: 'prueba' }, seed: 1 });
      dominio.completeGeneration(p, a, g, { path: a.id + '.png', bytes: 10, mimeType: 'image/png' });
      return g;
    };

    // Se deja correr la cola hasta que no proponga nada más, aprobando cada
    // cosa que propone. El tope es una red contra un bucle infinito.
    const orden = [];
    for (let vuelta = 0; vuelta < 200; vuelta += 1) {
      const siguiente = ui.colaSiguiente(p);
      if (!siguiente) break;
      // Lo que la cola propone tiene que poder generarse DE VERDAD según el
      // servidor. Si no, la cola se estaría saltando una dependencia.
      const puerta = progreso.canGenerate(p, siguiente);
      cierto(puerta.ok, 'la cola propuso algo que el servidor rechaza: ' + siguiente.id + ' — ' + puerta.reason);
      orden.push(siguiente.id);
      const g = producir(siguiente);
      // Recién generado, la cola NO debe volver a proponerlo: está en revisión
      // esperando al usuario, y eso no es trabajo suyo.
      cierto(!ui.colaPendientes(p).some((x) => x.id === siguiente.id),
        'la cola sigue contando como pendiente algo que ya espera decisión: ' + siguiente.id);
      dominio.approveGeneration(p, siguiente.id, g.id);
    }

    // Con todo aprobado, la cola de imágenes se queda sin nada que hacer.
    igual(ui.colaPendientes(p).length, 0, 'quedan imágenes pendientes al terminar');
    // Y ha pasado por TODAS las imágenes, ninguna se quedó fuera.
    igual(orden.length, p.assets.filter((a) => a.stage === 'images').length, 'imágenes recorridas');
    // El orden respeta la cadena: los personajes antes que la escena, y la
    // escena antes que cualquier imagen de toma.
    const pos = (id) => orden.indexOf(id);
    cierto(pos('master_scene') > pos('master_character'), 'la escena fue antes que el personaje');
    cierto(pos('master_scene') > pos('master_environment'), 'la escena fue antes que el escenario');
    for (const a of p.assets.filter((x) => x.kind === 'shot_image')) {
      cierto(pos(a.id) > pos('master_scene'), 'una toma fue antes que la escena: ' + a.id);
    }
  });

  comprobar('sin aprobar nada, la cola se queda esperando y no fuerza la puerta', () => {
    const p = nuevo();
    ui.estado.proyecto = p;
    ui.estado.proyectoId = p.id;
    ui.estado.cola = ui.colaVacia('images');

    // Se genera TODO lo que la cola puede generar, pero no se aprueba nada.
    const generados = new Set();
    for (let vuelta = 0; vuelta < 200; vuelta += 1) {
      const siguiente = ui.colaSiguiente(p);
      if (!siguiente) break;
      const g = dominio.startGeneration(p, siguiente, { prompt: 'p', negativePrompt: 'n', referenceAssetIds: [], provider: { name: 'prueba' }, seed: 1 });
      dominio.completeGeneration(p, siguiente, g, { path: 'x.png', bytes: 10, mimeType: 'image/png' });
      generados.add(siguiente.id);
    }
    // Sin una sola aprobación, la cola NO ha podido llegar a las tomas.
    cierto(!generados.has('master_scene'), 'la cola generó la escena sin aprobar sus dependencias');
    for (const a of p.assets.filter((x) => x.kind === 'shot_image')) {
      cierto(!generados.has(a.id), 'la cola generó una toma sin aprobar la escena: ' + a.id);
    }
    // Y nada quedó aprobado por el camino: la cola nunca aprueba.
    igual(p.assets.filter((a) => a.status === 'approved').length, 0, 'la cola aprobó algo por su cuenta');
    // Pero queda trabajo pendiente, así que la barra debe decir «en espera» en
    // vez de darse por terminada.
    cierto(ui.colaPendientes(p).length > 0, 'la cola se creería terminada con trabajo por hacer');
  });

  await comprobarAsync('el Director lee el contexto antes de encargar la música', async () => {
    // El fallo: un zombie solista tocando la BATERÍA en una ciudad en ruinas, y
    // la herramienta encargó «hopeful, luminous, serene» a 78 pulsaciones. El
    // carácter se sorteaba de cinco juegos, todos apacibles, sin mirar el
    // estilo, ni el escenario, ni el instrumento, ni lo que el usuario escribió.
    const armar = async (extra) => {
      const c = Object.assign({}, CONFIG, { formationId: 'solo' }, extra);
      return (await construirPlan(c)).plan.music.promptEn;
    };

    const zombi = await armar({
      instrumentIds: ['drum_kit'], scenarioId: 'city', visualStyleId: 'dark_fantasy',
      creativeDirection: 'un zombie en un mundo postapocalíptico, rock alternativo',
    });
    // 1. El instrumento, en inglés y con su nombre real. Era «bateria».
    cierto(/Instruments: drum kit/.test(zombi), 'la batería no llega en inglés: ' + zombi);
    // 2. El carácter sale del contexto, no de un sorteo apacible.
    cierto(/desolate|raw|menacing|dark/.test(zombi), 'el carácter no recoge el contexto: ' + zombi);
    cierto(!/serene|hopeful|luminous/.test(zombi), 'sigue encargando una pieza apacible para un corto de zombies');
    // 3. Y con empuje: 128, no 78.
    const bpm = Number(/around (\d+) BPM/.exec(zombi)[1]);
    cierto(bpm >= 110, 'el tempo es de ' + bpm + ' BPM para un corto de rock');
    // 4. A una batería no se le pide melodía ni tonalidad: de ahí el xilófono.
    cierto(/Do NOT add a melodic instrument/.test(zombi), 'no se prohíbe meter un instrumento melódico');
    cierto(!/carries the melody/.test(zombi), 'a la batería se le sigue pidiendo la melodía');
    cierto(/No key and no scale/.test(zombi), 'a una batería se le está pidiendo tonalidad');
    // 5. Y su escena llega como contexto, pero TRADUCIDA: pegar su español
    //    tumbaría la llamada entera con «Unsupported language detected».
    cierto(/post-apocalyptic wasteland/.test(zombi), 'su escena no llega traducida: ' + zombi);
    cierto(!/[áéíóúñ¿¡]/i.test(zombi), 'queda español en el encargo: ' + zombi);

    // Lo de siempre sigue funcionando: un violín es un violín y lleva melodía.
    const violin = await armar({ instrumentIds: ['violin'], scenarioId: 'forest' });
    cierto(/Instruments: violin/.test(violin), 'el violín llega mal: ' + violin);
    cierto(/carries the melody/.test(violin), 'a un violín se le quitó la melodía');
    cierto(/Key: /.test(violin), 'a un violín se le quitó la tonalidad');

    // Y el escenario manda aunque no se escriba nada: un arpa en una iglesia no
    // suena como una caja de ritmos en la calle.
    const iglesia = await armar({ instrumentIds: ['harp'], scenarioId: 'church', visualStyleId: 'oil' });
    const calle = await armar({ instrumentIds: ['drum_machine'], scenarioId: 'street', visualStyleId: 'retro' });
    cierto(/sacred|solemn|classical/.test(iglesia), 'la iglesia no tiñe la música: ' + iglesia);
    cierto(/urban|electric|nocturnal/.test(calle), 'la calle no tiñe la música: ' + calle);
    cierto(Number(/around (\d+) BPM/.exec(calle)[1]) > Number(/around (\d+) BPM/.exec(iglesia)[1]),
      'la caja de ritmos en la calle debería ir más rápida que el arpa en la iglesia');
  });

  comprobar('el sonido ambiental ya no existe en ninguna parte', () => {
    // SE QUITÓ DEL PRODUCTO, y en palabras del usuario: los efectos con IA «la
    // generación falla mucho y, cuando por fin los hace, vienen con música»; los
    // sintéticos, «tú dices que hay pájaros y cosas así, pero yo no escucho nada
    // de eso, solamente escucho un ruido horrible, que lo que hace es dañar la
    // calidad de la música».
    //
    // Esta comprobación existe porque quitar algo a medias es peor que no
    // quitarlo: un activo que ya no se puede generar bloquearía su etapa y el
    // usuario no podría ni montar el corto ni saber por qué.
    const p = nuevo();
    cierto(!p.assets.some((a) => a.kind === 'ambient'),
      'un corto nuevo sigue naciendo con un activo de ambiente');
    cierto(!p.plan.ambient, 'el plan sigue llevando un encargo de ambiente');

    const c = require(path.join(RAIZ, 'api/_lib/constantes.js'));
    cierto(c.ASSET_KINDS.indexOf('ambient') === -1, 'ambient sigue siendo un tipo de activo');
    cierto(c.STAGES.indexOf('ambient') === -1, 'ambient sigue siendo una etapa');
    cierto(!c.ASSET_KIND_STAGE.ambient, 'ambient sigue teniendo etapa asignada');

    // Y el sintetizador de ruido se fue con él.
    cierto(!audio.renderAmbient, 'audio.js sigue exportando el sintetizador de ambiente');
    cierto(!vertex.generarAmbiente, 'vertex.js sigue exportando la generación de ambiente con IA');

    // Ninguna etapa se quedó con un hueco: las que hay son las que se recorren.
    const etapas = new Set(p.assets.map((a) => a.stage));
    for (const e of etapas) {
      cierto(c.STAGES.indexOf(e) !== -1, 'hay activos en una etapa que ya no existe: ' + e);
    }
  });

  comprobar('un corto viejo con ambiente dentro se abre sin arrastrarlo', () => {
    // Hay proyectos guardados en el bucket con su activo «ambient», a veces
    // aprobado. Si al leerlos siguiera apareciendo, su etapa estaría siempre
    // incompleta —ya no se puede generar— y el montaje no se abriría nunca.
    const almacen = require(path.join(RAIZ, 'api/_lib/almacen.js'));
    cierto(typeof almacen.jubilarSonidoAmbiental === 'function',
      'almacen.js no expone la retirada del ambiente, así que no se puede comprobar');

    const viejo = nuevo();
    viejo.assets.push({
      id: 'ambient', kind: 'ambient', stage: 'ambient', label: 'Sonido ambiental',
      order: 99, status: 'approved', locked: true, approvedGenerationId: 'gen_x',
      generations: [], dependsOn: [], spec: {},
    });
    viejo.plan.ambient = { layers: ['viento'], prompt: 'x', durationSec: 60 };

    almacen.jubilarSonidoAmbiental(viejo);
    cierto(!viejo.assets.some((a) => a.kind === 'ambient'), 'el activo viejo sobrevive a la lectura');
    cierto(!viejo.plan.ambient, 'el encargo viejo sobrevive en el plan');
    // Y lo demás del corto queda intacto: no es una purga, es quitar una pieza.
    cierto(viejo.assets.some((a) => a.kind === 'music'), 'se llevó por delante la música');
    cierto(viejo.assets.some((a) => a.kind === 'clip'), 'se llevó por delante los clips');
  });

  comprobar('la musica arranca con el instrumento que se ve en pantalla', () => {
    // El usuario puso un solista de bateria y los veinte primeros segundos
    // fueron un chelo: el personaje aporreaba en silencio. La culpa era de la
    // linea de tiempo, que pedia «open sparse and quiet, the main instrument
    // almost alone» — y a una pieza de un solo instrumento, «escaso» solo se le
    // puede obedecer metiendo otro.
    const linea = vertex.lineaDeTiempo(60, ['drum kit']);
    cierto(/THE FIRST SECOND: drum kit is already playing at \[00:00\]/.test(linea),
      'no se exige el instrumento en el primer segundo: ' + linea.slice(0, 120));
    cierto(/ONLY THESE INSTRUMENTS: drum kit/.test(linea), 'no se prohiben los instrumentos de fuera');
    cierto(/Do not add any instrument that is not in that list/.test(linea),
      'no se prohibe explicitamente colar otro instrumento');
    // «Escaso» ya no puede leerse como «otro instrumento».
    cierto(!/main instrument almost alone/.test(linea), 'sigue la frase que causaba el chelo');
    cierto(/drum kit enters immediately, playing sparsely/.test(linea),
      'escaso deberia significar menos de ESE instrumento');
    // Y sigue habiendo arco: apertura, subida, pico y cierre.
    for (const marca of ['[00:00]', '[00:15]', '[00:33]', '[00:45]', '[00:54]', '[01:00]']) {
      cierto(linea.indexOf(marca) !== -1, 'falta la marca ' + marca + ' de la linea de tiempo');
    }
    // Con varios instrumentos se nombran todos.
    const duo = vertex.lineaDeTiempo(60, ['violin', 'cello']);
    cierto(/ONLY THESE INSTRUMENTS: violin and cello/.test(duo), 'no se listan los dos instrumentos');
  });

  comprobar('los 89 instrumentos tienen nombre inglés', () => {
    // El primer alias de la batería era «bateria», el nombre español sin tilde.
    // Los ids del catálogo SÍ están en inglés por construcción, así que son
    // ellos los que viajan. Esta comprobación vigila que siga siendo verdad.
    for (const i of catalogo.INSTRUMENTS) {
      cierto(/^[a-z0-9_]+$/.test(i.id), 'el id "' + i.id + '" no sirve como nombre inglés');
      cierto(i.id.length >= 3, 'el id "' + i.id + '" es demasiado corto para nombrar un instrumento');
    }
    // Y los casos donde el español y el inglés se separan, uno a uno.
    const esperado = {
      drum_kit: 'drum kit', bass_guitar: 'bass guitar', acoustic_guitar: 'acoustic guitar',
      flute: 'flute', french_horn: 'french horn', timpani: 'timpani',
      hurdy_gurdy: 'hurdy gurdy', full_orchestra: 'full orchestra', cello: 'cello',
      violin: 'violin', harp: 'harp', drum_machine: 'drum machine',
    };
    for (const id of Object.keys(esperado)) {
      cierto(catalogo.INSTRUMENTS_BY_ID.has(id), 'falta el instrumento ' + id);
      igual(id.replace(/_/g, ' '), esperado[id], 'el nombre inglés de ' + id + ' no es el esperado');
    }
  });

  await comprobarAsync('a Lyria no le llega ni una palabra en español', async () => {
    // El fallo: «Audio generation failed with the following error: Unsupported
    // language detected. Please use one of the supported languages: en.» El
    // prompt iba en español, como todo el resto del producto. Lyria es el único
    // servicio de la herramienta que no lo entiende, así que su encargo se
    // compone aparte, en inglés, desde los mismos datos.
    const enEspanol = (t) => /[áéíóúñ¿¡]/i.test(String(t || ''));

    // Las configuraciones llevan TILDES A PROPÓSITO. Esta comprobación existía
    // ya y se le escapó que el encargo pegaba el texto del usuario tal cual,
    // porque su configuración de prueba no tenía ni una tilde. Una prueba de
    // idioma con datos sin acentos no comprueba nada.
    for (const cfg of [
      { instrumentIds: ['erhu'], formationId: 'solo', scenarioId: 'forest' },
      { instrumentIds: ['violin', 'cello'], formationId: 'duo', scenarioId: 'rooftop' },
      { instrumentIds: ['guitar'], formationId: 'quartet', scenarioId: 'beach' },
      { instrumentIds: ['piano', 'flute'], formationId: 'orchestra', scenarioId: 'theatre' },
      {
        instrumentIds: ['drum_kit'], formationId: 'solo', scenarioId: 'street',
        creativeDirection: 'un zombie tocando la batería, rock alternativo',
        scenarioCustom: 'vía pública abandonada, mundo postapocalíptico',
        visualStyleCustom: 'ilustración muy oscura con niebla',
      },
      {
        instrumentIds: ['harp'], formationId: 'solo', scenarioId: 'church',
        creativeDirection: 'una despedida melancólica al amanecer',
        scenarioCustom: 'una capilla de piedra con vidrieras rotas',
      },
    ]) {
      const c = Object.assign({}, CONFIG, cfg);
      const armado = await construirPlan(c);
      const en = armado.plan.music.promptEn;
      cierto(en, 'sin encargo en inglés para ' + cfg.instrumentIds.join('+'));
      cierto(!enEspanol(en),
        'queda español con ' + cfg.instrumentIds.join('+') + ': ' +
        (en.match(/[^\s]*[áéíóúñ][^\s]*/gi) || []).join(', '));
      // Y lleva lo que un modelo de música necesita para componer.
      for (const campo of ['Instruments:', 'Mood:', 'Tempo:']) {
        cierto(en.indexOf(campo) !== -1, 'al encargo le falta ' + campo);
      }
      // La tonalidad sólo cuando el instrumento la tiene: una batería no.
      const percusion = /drum kit|cajon|congas|bongos|djembe|taiko|tabla|timpani|gong/.test(en);
      cierto(percusion ? /No key and no scale/.test(en) : /Key: /.test(en),
        'la tonalidad no encaja con el instrumento: ' + en);
      // El nombre del instrumento también en inglés: «Violonchelo» no le dice nada.
      cierto(!/Violonchelo|Guitarra|Flauta/.test(en), 'un instrumento se quedó en español: ' + en);
    }
  });

  await comprobarAsync('ningún género del catálogo le cuela español a Lyria', async () => {
    // El fallo que se cazó aquí: el género «Flamenco» se describía como
    // «rasgueado guitar, compás, palmas». Esa tilde de «compás» tumba la
    // petición entera con «Unsupported language detected» — y el usuario no ve
    // una música rara, ve que no se genera nada.
    const enEspanol = (t) => /[áéíóúñ¿¡]/i.test(String(t || ''));
    for (const g of catalogo.MUSIC_GENRES) {
      cierto(!enEspanol(g.en),
        'el género ' + g.id + ' lleva español en lo que se le manda al modelo: ' + g.en);
      // Y el que se le ENSEÑA al usuario sigue siendo español (PRD §19), así
      // que la etiqueta no se puede haber «arreglado» quitándole las tildes.
      cierto(g.label, 'el género ' + g.id + ' no tiene etiqueta para la pantalla');
    }

    // Y con el género puesto, el encargo entero sigue limpio.
    for (const id of catalogo.MUSIC_GENRES.map((g) => g.id)) {
      const armado = await construirPlan(Object.assign({}, CONFIG, {
        musicGenreId: id,
        musicGenreCustom: id === 'other' ? 'música norteña' : '',
      }));
      const en = armado.plan.music.promptEn;
      cierto(!enEspanol(en),
        'con el género ' + id + ' queda español: ' +
        (en.match(/[^\s]*[áéíóúñ][^\s]*/gi) || []).join(', '));
    }
  });

  comprobar('lo que el usuario escribe en «Otro» llega en inglés, o al menos sin tildes', () => {
    // El cuadro es texto libre y el usuario escribe en español. Los géneros que
    // se conocen se traducen enteros; los que no, van sin tildes, que es lo que
    // dispara el rechazo por idioma.
    const conocidos = {
      'cumbia': /cumbia/,
      'norteño': /norteno/,
      'Joropo': /joropo/i,
      'música de circo': /circus/,
      'rock alternativo': /alternative rock/,
    };
    for (const escrito of Object.keys(conocidos)) {
      const g = catalogo.generoDe({ musicGenreId: 'other', musicGenreCustom: escrito }, []);
      cierto(conocidos[escrito].test(g.en), '«' + escrito + '» no se reconoció: ' + g.en);
      cierto(!/[áéíóúñ]/i.test(g.en), '«' + escrito + '» conserva tildes: ' + g.en);
    }
    // Uno que no está en ninguna lista: se manda igual, pero sin tildes.
    const raro = catalogo.generoDe({ musicGenreId: 'other', musicGenreCustom: 'ñangaré tropical' }, []);
    cierto(!/[áéíóúñ]/i.test(raro.en), 'un género desconocido le cuela tildes al modelo: ' + raro.en);
    // Y la ETIQUETA guarda lo que él escribió, tildes incluidas: es lo que ve.
    igual(raro.label, 'ñangaré tropical', 'la pantalla ya no enseña lo que escribió el usuario');
  });

  await comprobarAsync('la persona está DENTRO del sitio, no pegada sobre un fondo', async () => {
    // EL FALLO MÁS GRAVE QUE HA TENIDO LA HERRAMIENTA, en palabras del usuario:
    // «no está poniendo al personaje en los escenarios, simplemente lo está
    // montando como sobre un fondo y ya». Mandó un guitarrista de pie ENCIMA DE
    // LAS BUTACAS de un auditorio, con el escenario iluminado ahí al lado. Y una
    // intérprete en un bosque «como si el bosque fuera una pancarta de fondo».
    //
    // La causa era de estructura: el prompt describía a la persona en una lista
    // y el lugar en otra, sin nada que las uniera. Dos listas separadas se
    // componen como dos capas separadas.
    for (const escenario of ['auditorium', 'forest', 'rooftop', 'beach']) {
      const config = Object.assign({}, CONFIG, { scenarioId: escenario, creativeDirection: '' });
      const armado = await construirPlan(config);
      const proyecto = dominio.createProject(config, armado.plan);
      const esc = catalogo.SCENARIOS_BY_ID.get(escenario);

      // 1. Cada imagen de toma CON GENTE dice dónde se apoya y exige contacto.
      // Los planos detalle del instrumento o del entorno no llevan a nadie
      // dentro, así que se excluyen por su tipo y no por si tienen el bloque —
      // si se filtrara por eso, quitar el bloque haría pasar la prueba en vez
      // de fallarla, que es exactamente lo contrario de lo que sirve.
      const conGente = proyecto.assets.filter(
        (a) => a.kind === 'shot_image' &&
          !/Tipo de plano: plano detalle (del instrumento|del entorno)/.test(a.spec.prompt),
      );
      cierto(conGente.length, escenario + ': el corto no tiene imágenes de toma con gente');
      for (const img of conGente) {
        const p = img.spec.prompt;
        cierto(/DENTRO DEL SITIO/.test(p),
          escenario + ': ' + img.id + ' no ata la persona al sitio');
        cierto(p.indexOf(esc.donde) !== -1,
          escenario + ': ' + img.id + ' no dice dónde se coloca dentro del sitio');
        cierto(/proyectan SU SOMBRA/.test(p), escenario + ': no exige sombra de contacto');
        cierto(/UNA SOLA PERSPECTIVA/.test(p), escenario + ': no exige perspectiva compartida');
        cierto(/La luz del lugar CAE SOBRE ELLA/.test(p), escenario + ': la luz del sitio no cae sobre la persona');
        cierto(/POR DELANTE y algo POR DETRÁS/.test(p), escenario + ': no pide primer término');
      }

      // 2. Y el PLANO MAESTRO DE ESCENA también, que es la referencia de todas.
      const escena = proyecto.assets.find((a) => a.kind === 'master_scene');
      cierto(/DENTRO DEL SITIO/.test(escena.spec.prompt),
        escenario + ': la escena maestra no ata la gente al sitio, y es la referencia de todo el corto');

      // 3. Los negativos nombran el defecto concreto, no sólo «collage».
      const neg = conGente[0].spec.negativePrompt || '';
      cierto(/recortado y pegado sobre el fondo/.test(neg), escenario + ': el negativo no prohíbe el recorte pegado');
      cierto(/telón pintado/.test(neg), escenario + ': el negativo no prohíbe el fondo de telón');
    }
  });

  comprobar('en un plano abierto el sitio se ve nítido, no desenfocado', () => {
    // El estilo pide «fondo muy desenfocado» y para un primer plano está bien.
    // En un plano general es justo lo que convierte el sitio en un telón: si el
    // lugar que se está presentando sale borroso, deja de ser un lugar.
    const config = Object.assign({}, CONFIG, { scenarioId: 'auditorium' });
    const proyecto = dominio.createProject(config, plan);
    const abiertos = proyecto.assets.filter(
      (a) => a.kind === 'shot_image' && /PLANO ABIERTO: el lugar se ve NÍTIDO/.test(a.spec.prompt),
    );
    cierto(abiertos.length, 'ningún plano abierto pide que el sitio se vea nítido');
    // Y en los cerrados no se dice, que ahí el desenfoque es correcto.
    const cerrados = proyecto.assets.filter(
      (a) => a.kind === 'shot_image' && /Tipo de plano: primer plano/.test(a.spec.prompt),
    );
    for (const c of cerrados) {
      cierto(!/PLANO ABIERTO/.test(c.spec.prompt),
        'a un primer plano se le está prohibiendo el desenfoque: ' + c.id);
    }
  });

  await comprobarAsync('el sitio se mueve en el vídeo, no sólo el personaje', async () => {
    // «Un bosque lleno de árboles, y los árboles quietos ni se movían, parecían
    // una imagen fija.» Veo anima lo que se le pide, y sólo se le pedía el
    // intérprete: el resultado es un recorte moviéndose sobre una fotografía.
    for (const escenario of ['forest', 'beach', 'auditorium']) {
      const config = Object.assign({}, CONFIG, { scenarioId: escenario, creativeDirection: '' });
      const armado = await construirPlan(config);
      const proyecto = dominio.createProject(config, armado.plan);
      const esc = catalogo.SCENARIOS_BY_ID.get(escenario);

      const clips = proyecto.assets.filter((a) => a.kind === 'clip');
      cierto(clips.length, escenario + ': sin clips');
      for (const c of clips) {
        cierto(/EL SITIO TAMBIÉN SE MUEVE/.test(c.spec.prompt),
          escenario + ': ' + c.id + ' no pide que se mueva el entorno');
        cierto(c.spec.prompt.indexOf(esc.movimiento) !== -1,
          escenario + ': ' + c.id + ' no dice QUÉ se mueve en ese sitio concreto');
      }
      cierto(/fondo congelado/.test(clips[0].spec.negativePrompt || ''),
        escenario + ': el negativo de vídeo no prohíbe el fondo congelado');
    }
  });

  comprobar('los 21 escenarios saben dónde va la gente y qué se mueve', () => {
    // Si mañana se añade un escenario sin estos dos datos, sus cortos volverían
    // al recorte sobre el fondo — y en silencio, porque todo lo demás funciona.
    for (const e of catalogo.SCENARIOS) {
      if (e.id === 'other') continue; // lo describe el usuario a mano
      cierto(e.donde && e.donde.length > 20, 'el escenario «' + e.label + '» no dice dónde se coloca al intérprete');
      cierto(e.movimiento && e.movimiento.length > 15, 'el escenario «' + e.label + '» no dice qué se mueve en él');
    }
  });

  await comprobarAsync('el vídeo se toca con la energía de la música que va a sonar', async () => {
    // EL FALLO: el usuario eligió un cuatro —instrumento de música llanera— y
    // el vídeo salió con el personaje rasgueando joropo a toda velocidad
    // mientras la música era una pieza melancólica de cuerdas pulsadas una a
    // una. «La música suena muy bien, pero no pega.» Imagen y música salían de
    // datos distintos; ahora el prompt de vídeo lleva dentro cómo suena.
    const casos = [
      { genero: 'metal', instrumento: 'drum_kit', espera: /RÁPIDO y FUERTE/ },
      { genero: 'joropo', instrumento: 'cuatro', espera: /RÁPIDO y FUERTE/ },
      { genero: 'bolero', instrumento: 'guitar', espera: /DESPACIO y SUAVE/ },
      { genero: 'ambient', instrumento: 'harp', espera: /DESPACIO y SUAVE/ },
      { genero: 'jazz', instrumento: 'saxophone', espera: /energía sostenida/ },
    ];
    for (const caso of casos) {
      const config = Object.assign({}, CONFIG, {
        musicGenreId: caso.genero,
        instrumentIds: [caso.instrumento],
        formationId: 'solo',
      });
      const armado = await construirPlan(config);
      const proyecto = dominio.createProject(config, armado.plan);

      // En los clips, que es donde se vio el fallo — menos en el que cierra la
      // película, que ahí lo que toca es DEJAR de tocar. Cuál es ese clip lo
      // dice el montaje, no el orden de la lista: el último hueco de la línea
      // de tiempo suele ser un plano reutilizado de más arriba.
      const clips = proyecto.assets.filter((a) => a.kind === 'clip');
      const cierra = clips.filter((c) => /EL PLANO DE CIERRE/.test(c.spec.prompt));
      igual(cierra.length, 1, 'debería haber exactamente un clip que cierre la película');
      const salvoElUltimo = clips.filter((c) => c.id !== cierra[0].id);
      cierto(salvoElUltimo.length, 'el corto de prueba no tiene clips');
      for (const c of salvoElUltimo) {
        cierto(caso.espera.test(c.spec.prompt),
          'con ' + caso.genero + ', el clip ' + c.id + ' no pide ' + caso.espera);
      }
      cierto(!/RÁPIDO y FUERTE|DESPACIO y SUAVE|energía sostenida y constante/.test(cierra[0].spec.prompt),
        'el clip final sigue pidiendo que toque, y ahí la pieza ya terminó');

      // Y en las imágenes de cada toma, que son el primer fotograma del clip:
      // si la postura de partida no pega, el vídeo arranca ya descolocado.
      const imagenes = proyecto.assets.filter((a) => a.kind === 'shot_image');
      cierto(imagenes.some((i) => /LA MÚSICA Y LA IMAGEN TIENEN QUE PEGAR/.test(i.spec.prompt)),
        'ninguna imagen de toma sabe cómo va a sonar la música');
    }
  });

  await comprobarAsync('el género que anuncia la pantalla es el que se compone', async () => {
    // La pantalla dice «con lo que llevas elegido saldrá algo en la línea de X»
    // usando `suggestedGenreId` del catálogo. Si eso no fuera exactamente lo
    // que el servidor acaba usando, sería una promesa falsa.
    const delCatalogo = catalogo.buildCatalog().instruments;
    for (const id of ['cuatro', 'drum_kit', 'bandoneon', 'saxophone', 'violin']) {
      const anunciado = delCatalogo.find((i) => i.id === id).suggestedGenreId;
      const compuesto = catalogo.generoDe(
        { musicGenreId: 'auto' },
        [catalogo.INSTRUMENTS_BY_ID.get(id)],
      );
      igual(compuesto.id, anunciado, 'con ' + id + ', lo anunciado y lo compuesto no coinciden');
    }
    // Y sin tocar nada, un corto sale con el género que le pega al instrumento.
    const armado = await construirPlan(Object.assign({}, CONFIG, { instrumentIds: ['cuatro'] }));
    igual(armado.plan.music.genre.id, 'joropo', 'un cuatro sin más indicaciones no sale joropo');
  });

  await comprobarAsync('la ruta que sirve archivos no es un proxy abierto', async () => {
    // POR QUÉ EXISTE ESA RUTA. En iOS, la única forma de que una web guarde un
    // archivo en el teléfono es la hoja de compartir, y para eso hay que poder
    // LEER los bytes desde JavaScript. Están en storage.googleapis.com, que es
    // otro origen, y el bucket no da permiso CORS. Así que pasan por el propio
    // dominio, donde no hace falta permiso de nadie.
    //
    // Y EL RIESGO DE HACER ESO es convertir la cuenta de Vercel del usuario en
    // un proxy público que cualquiera pueda usar a su costa. De ahí las cuatro
    // puertas que se comprueban aquí.
    const antes = { ...process.env };
    process.env.APP_KEY = 'la-clave';
    process.env.VERCEL_ENV = 'production';
    process.env.GCS_OUTPUT_BUCKET = 'mi-bucket';
    process.env.GCS_PREFIX = 'music-studio';

    const mod = await import('../api/archivo.mjs');
    const handler = mod.default;
    igual(mod.config.runtime, 'edge',
      'tiene que ser una función Edge: una normal no puede devolver un MP4 de 25 MB');

    const pedir = (u, clave, metodo) => handler(new Request(
      'https://app.local/api/archivo' + (u ? '?u=' + encodeURIComponent(u) : ''),
      { method: metodo || 'GET', headers: clave ? { 'x-app-key': clave } : {} },
    ));
    const bueno = 'https://storage.googleapis.com/mi-bucket/music-studio/proyectos/p1/final/corto.mp4?X-Goog-Signature=abc';

    // 1. Sin la contraseña de la app no se sirve nada.
    igual((await pedir(bueno, '')).status, 401, 'sirve archivos sin contraseña');
    igual((await pedir(bueno, 'otra-clave')).status, 401, 'acepta una contraseña equivocada');

    // 2. Sólo el almacenamiento de Google, y sólo por https.
    for (const malo of [
      'https://ejemplo.com/archivo.mp4',
      'https://storage.googleapis.com.ejemplo.com/x.mp4',
      'http://storage.googleapis.com/mi-bucket/music-studio/x.mp4',
    ]) {
      igual((await pedir(malo, 'la-clave')).status, 400, 'acepta un destino que no es el bucket: ' + malo);
    }

    // 3. Sólo dentro del bucket y de la carpeta de esta herramienta.
    for (const fuera of [
      'https://storage.googleapis.com/otro-bucket/music-studio/x.mp4',
      'https://storage.googleapis.com/mi-bucket/otra-carpeta/x.mp4',
      'https://storage.googleapis.com/mi-bucket/music-studio/../../otro/x.mp4',
    ]) {
      igual((await pedir(fuera, 'la-clave')).status, 403, 'deja salir de su carpeta: ' + fuera);
    }

    // 4. Y sin URL no hay nada que servir; POST tampoco.
    igual((await pedir('', 'la-clave')).status, 400, 'acepta una petición sin archivo');
    igual((await pedir(bueno, 'la-clave', 'POST')).status, 405, 'acepta métodos que no son GET');

    // Sin APP_KEY configurada, en producción se CIERRA: un despiste de
    // configuración no puede dejar la puerta abierta.
    process.env.APP_KEY = '';
    igual((await pedir(bueno, '')).status, 401, 'sin APP_KEY en producción queda abierto');

    Object.assign(process.env, antes);
  });

  comprobar('desde la app de la pantalla de inicio, las descargas se abren en Safari', () => {
    // EL FALLO. El usuario guardó la herramienta en la pantalla de inicio desde
    // Safari y dejó de poder descargar: «no me deja descargar nada, solo como
    // que se recarga la página y ya». En Chrome descargaba sin problema.
    //
    // POR QUÉ. Una app de la pantalla de inicio no es una pestaña: es una
    // ventana sin barra y con una sola página. Ahí el atributo `download` se
    // ignora —iOS no lo ha soportado nunca— y navegar a un archivo que llega
    // con «Content-Disposition: attachment» no tiene a dónde ir, así que la
    // ventana se queda donde estaba.
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari';
    const app = reglasDeLaInterfaz({ navigator: { userAgent: IPHONE, standalone: true } });
    const enlaceApp = app.enlaceDeDescarga('https://x/y.zip', 'Descargar', 'btn');
    cierto(/target="_blank"/.test(enlaceApp),
      'en la app instalada la descarga no sale de la ventana: ' + enlaceApp);
    cierto(/rel="noopener"/.test(enlaceApp), 'falta rel="noopener" en el enlace que abre fuera');
    cierto(/brújula/.test(app.notaDeDescarga('https://x/y.zip')),
      'el aviso no dice cómo salir de la pantalla en blanco: iOS abre un visor incrustado que tampoco descarga');
    cierto(/copiar-enlace/.test(app.notaDeDescarga('https://x/y.zip')),
      'no hay forma de sacar el enlace para pegarlo en Safari');

    // Y EN TODO LO DEMÁS NO CAMBIA NADA. `download` ya funciona en un navegador
    // normal, y abrir una pestaña que se cierra sola al empezar la descarga
    // sería cambiar a peor algo que va bien.
    const otros = [
      ['iPhone en una pestaña normal', { userAgent: IPHONE, standalone: false }, false],
      ['Android con la app instalada', { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome' }, true],
      ['Chrome de escritorio', { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome' }, false],
    ];
    for (const [nombre, navegador, standalone] of otros) {
      const iu = reglasDeLaInterfaz({ navigator: navegador, displayModeStandalone: standalone });
      const enlace = iu.enlaceDeDescarga('https://x/y.zip', 'Descargar', 'btn');
      cierto(/ download>/.test(enlace), nombre + ': perdió la descarga directa — ' + enlace);
      cierto(!/target="_blank"/.test(enlace), nombre + ': se le puso el rodeo de iOS sin necesitarlo');
      igual(iu.notaDeDescarga('https://x/y.zip'), '', nombre + ': le sale un aviso que no le toca');
    }
  });

  await comprobarAsync('en la app de iOS se guarda con la hoja de compartir, en dos toques', async () => {
    // Es la única forma que tiene una web de dejar un archivo en un iPhone. Y
    // tiene una trampa: `navigator.share` EXIGE que la haya disparado un toque,
    // y descargar treinta megas tarda más de lo que dura ese permiso. Si se
    // intenta compartir después de la descarga, iOS lanza NotAllowedError y el
    // usuario se queda sin nada y sin explicación.
    //
    // Por eso el primer toque descarga y el segundo comparte: con el archivo ya
    // en memoria, el segundo es instantáneo y el permiso sigue vivo.
    const PESO = 12 * 1024 * 1024;
    const compartidos = [];
    let permiso = false;

    const nav = {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari',
      standalone: true,
      maxTouchPoints: 5,
      canShare: (d) => Boolean(d && d.files),
      share: async (d) => {
        if (!permiso) { const e = new Error('gesto caducado'); e.name = 'NotAllowedError'; throw e; }
        compartidos.push(d.files[0]);
      },
    };

    let pedidoA = null;
    let claveEnviada = null;
    let descargas = 0;
    const iu = reglasDeLaInterfaz({
      navigator: nav,
      extras: {
        File, Blob, URL,
        fetch: async (u, o) => {
          descargas += 1;
          pedidoA = String(u);
          claveEnviada = (o && o.headers && o.headers['x-app-key']) || null;
          let enviados = 0;
          return {
            ok: true,
            headers: { get: (k) => (k === 'content-length' ? String(PESO) : 'video/mp4') },
            body: { getReader: () => ({ read: async () => {
              if (enviados >= PESO) return { done: true };
              const n = Math.min(4 * 1024 * 1024, PESO - enviados);
              enviados += n;
              return { done: false, value: new Uint8Array(n) };
            } }) },
          };
        },
      },
    });
    iu.estado.clave = 'la-clave';

    // En la app instalada, lo que se ofrece es GUARDAR, no el enlace.
    cierto(/data-accion="guardar-telefono"/.test(iu.notaDeDescarga('https://x/y.mp4', 'corto.mp4')),
      'no se ofrece guardar con la hoja de compartir');

    const url = 'https://storage.googleapis.com/b/music-studio/p/final/corto.mp4?sig=x';
    const boton = {
      textContent: 'Guardar en el teléfono', disabled: false,
      getAttribute: (k) => (k === 'data-url' ? url : 'corto.mp4'),
    };

    // Primer toque: descarga. iOS rechaza el compartir por gesto caducado.
    await iu.accionGuardarEnElTelefono(boton);
    igual(compartidos.length, 0, 'compartió con el permiso del toque ya caducado');
    cierto(/Guardar ahora/.test(boton.textContent),
      'el botón no avisa de que ya está listo: ' + boton.textContent);
    cierto(!boton.disabled, 'el botón se quedó bloqueado y no se puede dar el segundo toque');

    // LOS BYTES SE PIDEN A NUESTRO DOMINIO, no a Google: un fetch al bucket lo
    // bloquearía CORS, y configurarlo no está al alcance de este usuario.
    cierto(pedidoA && pedidoA.indexOf('/api/archivo?') === 0,
      'los bytes no se piden por nuestro dominio, sino a ' + pedidoA);
    cierto(pedidoA.indexOf(encodeURIComponent(url)) !== -1, 'no se le dice qué archivo hay que traer');
    igual(claveEnviada, 'la-clave', 'no se manda la contraseña de la app al traer el archivo');

    // Segundo toque: ya está en memoria, así que comparte al instante.
    permiso = true;
    await iu.accionGuardarEnElTelefono(boton);
    igual(compartidos.length, 1, 'el segundo toque no compartió nada');
    // Y NO vuelve a descargar. Si lo hiciera, el usuario pagaría los megas dos
    // veces y —peor— el permiso del toque volvería a caducar por el camino, así
    // que el segundo toque tampoco guardaría nada y no habría forma de salir.
    igual(descargas, 1, 'el segundo toque volvió a descargar el archivo entero');
    igual(compartidos[0].name, 'corto.mp4', 'el archivo llega sin nombre reconocible');
    igual(compartidos[0].size, PESO, 'el archivo llega incompleto');
    igual(compartidos[0].type, 'video/mp4', 'el archivo llega sin tipo, y iOS no sabría dónde guardarlo');
  });

  await comprobarAsync('se puede ver QUÉ VERSIÓN está desplegada, sin salir de la app', async () => {
    // «¿Tú estás desplegando en la rama de main? Porque yo no veo nada de los
    // cambios que hace por ningún lado.»
    //
    // La pregunta era razonable y no había forma de contestarla desde el
    // teléfono: para saber si el navegador estaba viendo la última versión
    // había que entrar en el panel de Vercel. Ahora lo dice la propia app.
    const antes = { ...process.env };
    process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890';
    process.env.VERCEL_GIT_COMMIT_MESSAGE = 'Un cambio cualquiera\ncon segunda línea';
    process.env.VERCEL_GIT_COMMIT_REF = 'main';
    process.env.VERCEL_ENV = 'production';

    const salud = require(path.join(RAIZ, 'api/salud.js'));
    const cuerpo = await new Promise((listo) => {
      const res = {
        setHeader() {}, status() { return this; },
        json(b) { listo(b); return this; }, end() { listo(null); return this; },
      };
      salud({ method: 'GET', headers: { host: 'l' }, url: '/' }, res);
    });

    cierto(cuerpo && cuerpo.version, 'el diagnóstico no dice qué versión está desplegada');
    cierto(cuerpo.version.conocida, 'no reconoce el despliegue estando en Vercel');
    igual(cuerpo.version.commit, 'abcdef1', 'el commit no sale abreviado y legible');
    igual(cuerpo.version.rama, 'main', 'no dice de qué rama salió');
    // El mensaje es lo que de verdad se reconoce de un vistazo; un sha de siete
    // letras no le dice nada a nadie.
    igual(cuerpo.version.mensaje, 'Un cambio cualquiera', 'el mensaje del commit no llega, o llega con más de una línea');

    // Fuera de Vercel se dice eso, en vez de inventar una versión.
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    const fuera = await new Promise((listo) => {
      const res = { setHeader() {}, status() { return this; }, json(b) { listo(b); return this; }, end() { listo(null); return this; } };
      salud({ method: 'GET', headers: { host: 'l' }, url: '/' }, res);
    });
    cierto(!fuera.version.conocida, 'se inventa una versión fuera de Vercel');
    cierto(fuera.version.nota, 'no explica por qué no hay versión que enseñar');

    Object.assign(process.env, antes);

    // Y la pantalla lo enseña sin que haya que pulsar nada.
    const iu = reglasDeLaInterfaz();
    iu.estado.salud = { version: { conocida: true, commit: 'abcdef1', mensaje: 'Un cambio cualquiera', rama: 'main', entorno: 'production' } };
    const pantalla = iu.vistaPerfil();
    cierto(/Versión desplegada/.test(pantalla), 'el Perfil no enseña la versión');
    cierto(/abcdef1/.test(pantalla) && /Un cambio cualquiera/.test(pantalla),
      'la versión no llega a la pantalla');
  });

  comprobar('el modelo se puede cambiar desde el elemento que está fallando', () => {
    // Los selectores estaban sólo en la ficha del corto, y la ficha vive en otra
    // pestaña: «no veo ningún botón para el selector de generador ni de imagen
    // ni de video». Los buscó mirando el clip que le fallaba, que es justo donde
    // uno decide cambiar de modelo.
    const iu = reglasDeLaInterfaz();
    cierto(typeof iu.htmlModeloDelActivo === 'function', 'la interfaz no ofrece el selector por elemento');
    iu.estado.catalogo = {
      modelosImagen: [{ id: 'img-a', etiqueta: 'Imagen A' }, { id: 'img-b', etiqueta: 'Imagen B' }],
      modelosVideo: [{ id: 'vid-a', etiqueta: 'Vídeo A' }, { id: 'vid-b', etiqueta: 'Vídeo B' }],
    };
    const proyecto = { id: 'prj_1', config: { imageModelId: 'img-b', videoModelId: 'vid-b' } };

    // A un clip se le ofrecen los modelos de VÍDEO, y sale marcado el suyo.
    const deClip = iu.htmlModeloDelActivo(proyecto, { kind: 'clip', id: 'c1' });
    cierto(/data-modelo="video"/.test(deClip), 'a un clip no se le ofrece cambiar el modelo de vídeo');
    cierto(/value="vid-b" selected/.test(deClip), 'no viene marcado el modelo que usa ahora');
    cierto(!/img-a/.test(deClip), 'a un clip se le ofrecen modelos de imagen, que ahí no hacen nada');

    // A una imagen, los de IMAGEN.
    const deImagen = iu.htmlModeloDelActivo(proyecto, { kind: 'shot_image', id: 'i1' });
    cierto(/data-modelo="imagen"/.test(deImagen), 'a una imagen no se le ofrece cambiar su modelo');
    cierto(!/vid-a/.test(deImagen), 'a una imagen se le ofrecen modelos de vídeo');

    // La música no lleva selector: sólo hay un compositor.
    igual(iu.htmlModeloDelActivo(proyecto, { kind: 'music', id: 'music' }), '',
      'a la música se le ofrece un modelo que no se puede elegir');
  });

  comprobar('no queda ninguna descarga fuera del enlace que sabe de iOS', () => {
    // Si mañana alguien añade otro botón de descarga con `<a ... download>` a
    // mano, en la app instalada volvería a no hacer nada — y sería un fallo
    // silencioso, porque en el navegador de quien lo escribió funcionaría.
    const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
    const sueltos = html.match(/<a [^>]*\bdownload\b/g) || [];
    igual(sueltos.length, 0,
      'hay ' + sueltos.length + ' enlace(s) de descarga escritos a mano; usa enlaceDeDescarga()');
  });

  comprobar('la interfaz y el servidor editan EL MISMO campo del prompt', () => {
    // La música y el ambiente se le piden a Google en inglés y guardan además
    // una versión en español para enseñársela al usuario. Si la pantalla
    // editara una y el servidor guardara la otra, el usuario cambiaría el
    // prompt, volvería a generar y saldría exactamente lo mismo — sin ningún
    // error que se lo explicase.
    const enServidor = fs.readFileSync(path.join(RAIZ, 'api/prompt.js'), 'utf8');
    const listaServidor = /const CAMPO_EN_INGLES = \[([^\]]*)\]/.exec(enServidor);
    cierto(listaServidor, 'api/prompt.js ya no declara CAMPO_EN_INGLES');

    const iu = reglasDeLaInterfaz();
    cierto(Array.isArray(iu.PROMPT_EN_INGLES), 'la interfaz no declara PROMPT_EN_INGLES');

    const delServidor = listaServidor[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    igual(iu.PROMPT_EN_INGLES.slice().sort(), delServidor.slice().sort(),
      'las dos listas de tipos que se encargan en inglés se han separado');

    // Y la regla se aplica igual sobre un activo de verdad.
    for (const kind of ['music', 'ambient', 'clip', 'shot_image', 'master_character']) {
      const esperado = delServidor.indexOf(kind) !== -1 ? 'promptEn' : 'prompt';
      igual(iu.campoDePrompt({ kind }), esperado, 'la interfaz elige mal el campo de ' + kind);
    }
  });

  comprobar('todo lo que se puede editar existe en el activo desde el principio', () => {
    // Si un activo se editara sobre un campo que no tiene, el cuadro saldría
    // vacío y guardar borraría el encargo del Director en vez de cambiarlo.
    const iu = reglasDeLaInterfaz();
    const proyecto = dominio.createProject(CONFIG, plan);
    for (const a of proyecto.assets) {
      const campo = iu.campoDePrompt(a);
      cierto(a.spec && typeof a.spec[campo] === 'string' && a.spec[campo].length,
        'el activo ' + a.id + ' (' + a.kind + ') no trae texto en ' + campo);
    }
  });

  comprobar('el encargo de música va en inglés y con su línea de tiempo', () => {
    const enEspanol = (t) => /[áéíóúñ¿¡]/i.test(String(t || ''));
    // El plan completo, que es de donde sale el prompt que viaja a Google.
    cierto(plan.music && plan.music.promptEn, 'el plan no lleva el encargo en inglés');
    cierto(!enEspanol(plan.music.promptEn),
      'queda español en el encargo: ' + (plan.music.promptEn.match(/[^\s]*[áéíóúñ][^\s]*/gi) || []).join(', '));
    // Y el que se le enseña al usuario sigue en español (PRD §19).
    cierto(enEspanol(plan.music.prompt), 'el prompt que ve el usuario ya no está en español');

    // Lo que de verdad se manda: el cuerpo que arma vertex.js.
    const linea = vertex.lineaDeTiempo(180);
    cierto(!enEspanol(linea), 'la línea de tiempo lleva español');
    cierto(/\[00:00\]/.test(linea) && /\[03:00\]/.test(linea),
      'la línea de tiempo no cubre los tres minutos: es la única forma de pedir la duración');
    // Y una sola llamada compone el corto entero, sin coserlo por trozos.
    for (const d of [60, 120, 180]) {
      igual(vertex.fragmentosNecesarios(d), 1, 'el corto de ' + d + ' s se está troceando');
    }
  });

  comprobar('un encargo que ya está en inglés le llega a Lyria sin tocar', () => {
    // vertex.js lleva una tabla español→inglés como respaldo para los cortos
    // creados antes de que el encargo se escribiera ya en inglés. Sus reglas van
    // con la marca `i`, así que pasaban por encima de un texto inglés y lo
    // cambiaban: «Tempo:» salía «tempo:», «Piano» salía «piano».
    //
    // Daba igual para el modelo, pero no da igual desde que el usuario puede
    // reescribir el prompt a mano: lo que escribe tiene que llegar tal cual, o
    // estaría corrigiendo un texto que el servidor va a reescribir después.
    const ingles = 'Instruments: erhu. Mood: calm. Tempo: around 70 BPM. Piano, instrumental.';
    igual(vertex.aIngles(ingles), ingles, 'se tocó un encargo que ya estaba en inglés');

    // Y el respaldo sigue funcionando para los cortos viejos, que es para lo
    // único que existe.
    const espanol = 'Pieza instrumental. Tonalidad: Re menor, escala menor natural.';
    const traducido = vertex.aIngles(espanol);
    cierto(/instrumental piece/.test(traducido), 'ya no traduce el español de los cortos viejos');
    cierto(/natural minor/.test(traducido), 'la escala se quedó en español: ' + traducido);
    cierto(!/[áéíóú]/i.test(traducido.replace(/Re /, '')), 'quedan tildes: ' + traducido);
  });

  comprobar('el audio de Lyria se lee con su formato real, no con uno supuesto', () => {
    // EL FALLO: la pista se generaba entera y sonaba a estática. Google declara
    // la frecuencia en el mimeType pero casi nunca los CANALES, y suponer uno
    // es razonable para una voz y está mal para música: Lyria compone en
    // estéreo. Leer estéreo como mono es tomar las muestras de los dos canales
    // como si fueran una detrás de otra, y eso es ruido blanco.
    //
    // Por eso el formato se DEDUCE de los bytes y la duración pedida, que es
    // una medición, en lugar de suponerse.
    const pcm = (rate, canales, segundos) => Buffer.alloc(rate * canales * 2 * segundos);

    const casos = [
      // [mimeType, rate real, canales reales]
      ['audio/L16;codec=pcm;rate=48000', 48000, 2],   // el caso que fallaba
      ['audio/L16;codec=pcm', 48000, 2],
      ['audio/L16;codec=pcm;rate=44100', 44100, 2],
      ['', 44100, 2],
      ['audio/L16;codec=pcm;rate=24000', 24000, 1],
      ['audio/L16;codec=pcm;rate=24000;channels=1', 24000, 1],
    ];
    for (const [mime, rate, canales] of casos) {
      const f = vertex.formatoDelPcm(pcm(rate, canales, 60), mime, 60);
      igual([f.rate, f.canales], [rate, canales],
        'formato mal deducido para «' + (mime || 'sin mimeType') + '»');
    }

    // Y la cabecera que se escribe dice la verdad, de punta a punta.
    const crudo = pcm(48000, 2, 60);
    const r = vertex.juntarAudio({ candidates: [{ content: { parts: [
      { inlineData: { mimeType: 'audio/L16;codec=pcm;rate=48000', data: crudo.toString('base64') } },
    ] } }] }, 60);
    const wav = Buffer.from(r.base64, 'base64');
    igual(wav.toString('latin1', 0, 4), 'RIFF', 'no lleva cabecera RIFF');
    igual(wav.readUInt16LE(22), 2, 'la cabecera declara los canales mal');
    igual(wav.readUInt32LE(24), 48000, 'la cabecera declara la frecuencia mal');
    // Y se puede abrir de verdad, con la duración correcta. Las muestras vienen
    // ENTRELAZADAS —izquierda, derecha, izquierda…— así que la duración se saca
    // dividiendo también por los canales. Contarlas como si fueran mono es
    // exactamente el error que producía la estática.
    const d = audio.decodeWav(wav);
    igual(d.sampleRate, 48000, 'frecuencia al decodificar');
    igual(d.channels, 2, 'canales al decodificar');
    igual(Math.round(d.samples.length / d.channels / d.sampleRate), 60, 'duración al decodificar');

    // Y la pieza terminada conserva el estéreo y la duración: si aquí se
    // perdiera un canal, volvería la estática.
    const pieza = audio.decodeWav(audio.unirFragmentos([wav], { duracionSec: 60 }));
    igual(pieza.channels, 2, 'la pieza final perdió el estéreo');
    igual(pieza.sampleRate, 48000, 'la pieza final cambió de frecuencia');
    igual(Math.round(pieza.samples.length / pieza.channels / pieza.sampleRate), 60,
      'la pieza final no dura lo que se pidió');
  });

  comprobar('el audio comprimido NO se toca: se guarda tal cual', () => {
    // EL FALLO QUE COSTÓ TRES RONDAS. Lyria no siempre devuelve PCM: devuelve
    // audio ya empaquetado. El usuario midió 22601 bytes por segundo, que son
    // ~180 kbps — un bitrate de MP3, no de PCM de ningún formato.
    //
    // Envolver bytes comprimidos en una cabecera WAV que declara «muestras de
    // 16 bits» es exactamente lo que produce ruido blanco. Y no hay deducción
    // de frecuencia que lo arregle: el error no era adivinar mal el formato,
    // era tocar unos bytes que no había que tocar.
    const conFirma = (firma, n) => {
      const b = Buffer.alloc(n);
      Buffer.from(firma).copy(b, 0);
      return b;
    };
    const trama = Buffer.alloc(4000);
    trama[0] = 0xff; trama[1] = 0xfb;

    const casos = [
      ['MP3 por trama', trama, 'audio/mpeg', '.mp3', 'audio/mpeg'],
      ['MP3 con ID3', conFirma('ID3', 4000), '', '.mp3', 'audio/mpeg'],
      ['OGG', conFirma('OggS', 4000), '', '.ogg', 'audio/ogg'],
      ['FLAC', conFirma('fLaC', 4000), '', '.flac', 'audio/flac'],
    ];
    for (const [que, bytes, mime, ext, tipo] of casos) {
      const r = vertex.prepararAudio(bytes, mime, 60);
      igual(r.extension, ext, 'extensión mal detectada en ' + que);
      igual(r.tipo, tipo, 'tipo mal detectado en ' + que);
      // Lo importante: NI UN BYTE TOCADO.
      igual(r.bytes.length, bytes.length, 'a ' + que + ' se le añadieron bytes');
      cierto(r.bytes.equals(bytes), 'a ' + que + ' se le cambiaron los bytes');
      cierto(!r.editable, que + ' se marcó como editable y no lo es');
    }

    // Un M4A se reconoce por 'ftyp' en el byte 4, no en el 0.
    const m4a = Buffer.alloc(4000);
    Buffer.from('ftyp').copy(m4a, 4);
    igual(vertex.prepararAudio(m4a, '', 60).extension, '.m4a', 'M4A mal detectado');

    // Y el PCM de verdad SÍ se envuelve, que es el único caso en que toca.
    const pcm = Buffer.alloc(48000 * 2 * 2 * 60);
    const r = vertex.prepararAudio(pcm, 'audio/L16;codec=pcm;rate=48000', 60);
    igual(r.extension, '.wav', 'el PCM crudo debería salir como WAV');
    igual(r.bytes.length, pcm.length + 44, 'al PCM crudo no se le puso la cabecera');
    cierto(r.editable, 'un WAV sí se puede editar');

    // Lo mismo por la puerta de arriba, que es por donde entra de verdad.
    const respuesta = (bytes, mime) => ({ candidates: [{ content: { parts: [
      { inlineData: { mimeType: mime, data: bytes.toString('base64') } },
    ] } }] });
    const salida = vertex.juntarAudio(respuesta(trama, 'audio/mpeg'), 60);
    igual(salida.mimeType, 'audio/mpeg', 'el MP3 sale etiquetado como otra cosa');
    igual(salida.extension, '.mp3', 'el MP3 sale con otra extensión');
    cierto(Buffer.from(salida.base64, 'base64').equals(trama), 'el MP3 salió modificado');
  });

  comprobar('la pieza suena como la compuso Lyria, no a estática', () => {
    // La comprobación de verdad: se mete un tono puro de 440 Hz y se mide qué
    // tono sale al otro lado. Con el formato mal supuesto salía a 110 Hz —dos
    // veces por la frecuencia y dos veces por leer los canales entrelazados
    // como si fueran muestras seguidas— y eso, con música real en vez de un
    // tono, es ruido blanco.
    const R = 48000;
    const N = R * 5;
    const pcm = Buffer.alloc(N * 4);
    for (let i = 0; i < N; i += 1) {
      const v = Math.round(9000 * Math.sin((2 * Math.PI * 440 * i) / R));
      pcm.writeInt16LE(v, i * 4);
      pcm.writeInt16LE(v, i * 4 + 2);
    }
    const respuesta = { candidates: [{ content: { parts: [
      { inlineData: { mimeType: 'audio/L16;codec=pcm;rate=48000', data: pcm.toString('base64') } },
    ] } }] };

    // Frecuencia del canal izquierdo, contando cruces por cero.
    const tonoDe = (wav) => {
      const d = audio.decodeWav(wav);
      let cruces = 0;
      let previo = d.samples[0];
      const frames = d.samples.length / d.channels;
      for (let f = 1; f < frames; f += 1) {
        const v = d.samples[f * d.channels];
        if ((previo < 0) !== (v < 0)) cruces += 1;
        previo = v;
      }
      return cruces / 2 / (frames / d.sampleRate);
    };

    const pieza = audio.unirFragmentos(
      [Buffer.from(vertex.juntarAudio(respuesta, 5).base64, 'base64')],
      { duracionSec: 5, fadeInSec: 0, fadeOutSec: 0 },
    );
    const hz = tonoDe(pieza);
    cierto(Math.abs(hz - 440) < 5, 'el tono salió a ' + hz.toFixed(0) + ' Hz en vez de 440');
  });

  await comprobarAsync('una llamada que no contesta se convierte en un error visible', async () => {
    // EL FALLO, tal como lo vivió el usuario: media hora mirando «Generando…».
    // La llamada a Vertex no tenía límite de espera, así que cuando el modelo
    // tardaba más que la función de Vercel, la función MORÍA. No lanzaba una
    // excepción: se apagaba. Nadie capturaba nada, no se apuntaba ningún error,
    // y el activo se quedaba en «generando» para siempre mientras el latido lo
    // reintentaba en bucle.
    const original = globalThis.fetch;
    // Un Google que acepta la conexión y no contesta jamás.
    globalThis.fetch = (url, opciones) => new Promise((resolve, reject) => {
      const señal = opciones && opciones.signal;
      if (!señal) return; // sin señal no hay salida: eso es justamente el fallo
      if (señal.aborted) return reject(Object.assign(new Error('abortada'), { name: 'AbortError' }));
      señal.addEventListener('abort', () => {
        reject(Object.assign(new Error('abortada'), { name: 'AbortError' }));
      });
      void resolve;
    });

    try {
      let error = null;
      const empezo = Date.now();
      try {
        await vertex.generarMusica({
          token: 't', projectId: 'p', prompt: 'instrumental piece',
          segundos: 60, presupuestoMs: 300,
        });
      } catch (e) {
        error = e;
      }
      const tardo = Date.now() - empezo;

      cierto(error, 'una llamada que no contesta debería dar error, no colgarse');
      cierto(/tardó más de/.test(error.message),
        'el error no explica que fue una espera agotada: ' + error.message);
      cierto(error.status === 504, 'el error no se marca como tiempo agotado: ' + error.status);
      // Y se rinde cuando toca, no cuando lo mate el servidor.
      cierto(tardo < 3000, 'tardó ' + tardo + ' ms en rendirse con un presupuesto de 300 ms');
    } finally {
      globalThis.fetch = original;
    }
  });

  comprobar('ninguna URL de Vertex sale con undefined dentro', () => {
    // El fallo: los modelos de Veo llevan region:'' para heredar la del
    // proyecto, pero vertex.js llamaba a regionVideo() sin pasar el valor por
    // defecto, así que salía undefined y la URL quedaba en
    // https://undefined-aiplatform.googleapis.com/.../locations/undefined/...
    // googleapis.com resuelve cualquier subdominio, así que no daba error de
    // red: daba la página 404 en HTML de Google. El vídeo no funcionaba nunca.
    const { vertexUrl } = require(path.join(RAIZ, 'api/_lib/gcp.js'));
    const modelos = require(path.join(RAIZ, 'api/_lib/modelos.js'));
    const casos = modelos.MODELOS_VIDEO.map((m) => ['video', m.id])
      .concat(modelos.MODELOS_IMAGEN.map((m) => ['imagen', m.id]));
    for (const [tipo, id] of casos) {
      const region = tipo === 'video' ? modelos.regionVideo(id) : modelos.regionImagen(id);
      cierto(region && typeof region === 'string', 'sin región para ' + id + ': ' + region);
      const url = vertexUrl('proyecto', region, id, 'predictLongRunning');
      cierto(!/undefined|null/.test(url), 'URL rota para ' + id + ': ' + url);
      cierto(/^https:\/\/[a-z0-9-]+\.googleapis\.com\//.test(url), 'host raro para ' + id + ': ' + url);
    }
  });

  comprobar('a Veo no se le mandan las palabras que hacen que rechace la petición', () => {
    // EL FALLO, con el mensaje literal de Google: «The prompt could not be
    // submitted. This prompt contains sensitive words that violate Google's
    // Responsible AI practices.» Nueve intentos contra eso.
    //
    // Las palabras estaban en el PROMPT NEGATIVO. El de las imágenes enumera
    // los defectos típicos de un generador con el vocabulario natural para ello
    // —«manos deformes», «anatomía imposible», «rostro distorsionado», «dedos
    // que se funden»— y ese vocabulario, leído por un filtro que mira palabras
    // y no intención, es indistinguible del de la mutilación.
    const PELIGROSAS = [
      /deforme/i, /anatomía imposible/i, /distorsionad/i,
      /se funden/i, /morphing/i, /mutil/i, /desfigur/i,
    ];
    const proyecto = dominio.createProject(CONFIG, plan);

    for (const clip of proyecto.assets.filter((a) => a.kind === 'clip')) {
      const todo = clip.spec.prompt + ' ' + (clip.spec.negativePrompt || '');
      for (const mala of PELIGROSAS) {
        cierto(!mala.test(todo),
          'al vídeo le llega una palabra que Veo rechaza (' + mala + ') en ' + clip.id);
      }
      // Y no se ha perdido la exigencia: se pide lo mismo con otras palabras.
      cierto(/manos mal dibujadas/.test(clip.spec.negativePrompt), 'se perdió la exigencia sobre las manos');
      cierto(/número de dedos incorrecto/.test(clip.spec.negativePrompt), 'se perdió la exigencia sobre los dedos');
      cierto(/rasgos de la cara mal dibujados/.test(clip.spec.negativePrompt), 'se perdió la exigencia sobre la cara');
    }

    // A LAS IMÁGENES SÍ SE LES SIGUE DICIENDO ASÍ: a esos modelos no les
    // molesta, funcionaban perfectamente, y «deforme» es la palabra que mejor
    // describe lo que hay que evitar. Cambiarlo también ahí sería empeorar algo
    // que no estaba roto.
    const imagen = proyecto.assets.find((a) => a.kind === 'shot_image');
    cierto(/deformes/.test(imagen.spec.negativePrompt),
      'se ha rebajado también el negativo de las imágenes, que no lo necesitaba');
  });

  await comprobarAsync('un rechazo por palabras no deja al usuario sin salida', async () => {
    // «This prompt contains sensitive words that violate Google's Responsible AI
    // practices.» Google no dice CUÁL es la palabra, sólo que hay una. Perseguirlas
    // de una en una es un juego que paga el usuario con su tiempo: se le fue una
    // tarde en nueve intentos contra el mismo muro.
    //
    // Un rechazo así ocurre ANTES de generar, así que no se factura. Se puede
    // insistir con menos texto sin que le cueste dinero.
    const RAI = "The prompt could not be submitted. This prompt contains sensitive words " +
      "that violate Google's Responsible AI practices. Support codes: 89371032";
    const PROMPT = ['CLIP 01A (8 s).', 'Plano medio en el auditorio.', 'Movimiento:\n- fija',
      'EL SITIO SE MUEVE:\n- polvo', 'CONTINUIDAD:\n- bla', 'Requisitos:\n- bla'].join('\n\n');

    cierto(vertex.rechazaPorPalabras(RAI), 'no se reconoce el rechazo por palabras de Google');
    cierto(!vertex.rechazaPorPalabras('Quota exceeded'), 'confunde una cuota agotada con un rechazo por palabras');

    const original = global.fetch;
    const resp = (cuerpo, ok = true, status = 200) => ({
      ok, status, headers: { get: () => null },
      json: async () => cuerpo, text: async () => JSON.stringify(cuerpo),
    });

    // `rechazaHasta` = cuántos envíos seguidos rechaza Google antes de aceptar.
    const conRechazos = async (rechazaHasta) => {
      let envios = 0;
      const vistos = [];
      global.fetch = async (u, o) => {
        if (String(u).indexOf('oauth2') !== -1) return resp({ access_token: 't', expires_in: 3600 });
        const cuerpo = JSON.parse(o.body);
        envios += 1;
        vistos.push({
          negativo: Boolean(cuerpo.parameters.negativePrompt),
          bloques: cuerpo.instances[0].prompt.split('\n\n').length,
        });
        if (envios <= rechazaHasta) return resp({ error: { message: RAI } }, false, 400);
        return resp({ name: 'operaciones/1' });
      };
      let r = null;
      let error = null;
      try {
        r = await vertex.iniciarVideo({
          token: 't', projectId: 'p', prompt: PROMPT, negativePrompt: 'manos deformes',
          modelo: 'veo-3.1-lite-generate-001', durationSec: 8, formatoId: 'vertical',
        });
      } catch (e) { error = e; }
      return { r, error, vistos };
    };

    try {
      // Sin rechazo, un solo envío y con el negativo puesto.
      const bien = await conRechazos(0);
      igual(bien.vistos.length, 1, 'reintenta cuando no hace falta');
      cierto(bien.vistos[0].negativo, 'no manda el prompt negativo cuando puede');
      cierto(!bien.r.aviso, 'avisa de un apaño que no ha hecho');

      // Un rechazo: se reintenta SIN EL NEGATIVO, que es donde estaban las
      // palabras marcadas y lo menos imprescindible del encargo.
      const uno = await conRechazos(1);
      igual(uno.vistos.length, 2, 'no reintenta tras el rechazo por palabras');
      cierto(!uno.vistos[1].negativo, 'el reintento sigue llevando el prompt negativo');
      igual(uno.vistos[1].bloques, uno.vistos[0].bloques, 'recorta el encargo antes de probar sin negativo');
      cierto(/sin el prompt negativo/.test(uno.r.aviso || ''),
        'no se avisa de que el clip salió con menos exigencias: ' + uno.r.aviso);

      // Si insiste, se recorta el encargo por el final, que es donde están las
      // listas largas de continuidad y de requisitos.
      const dos = await conRechazos(2);
      igual(dos.vistos.length, 3, 'no recorta el encargo cuando quitar el negativo no basta');
      cierto(dos.vistos[2].bloques < dos.vistos[1].bloques, 'el tercer envío no lleva menos texto');
      cierto(/recortada/.test(dos.r.aviso || ''), 'no se avisa de que el encargo iba recortado');

      // Y se recorta más, pero nunca por debajo de lo que describe la toma.
      const tres = await conRechazos(3);
      igual(tres.vistos.length, 4, 'no vuelve a recortar');
      cierto(tres.vistos[3].bloques >= 3, 'recortó tanto que el clip ya no describe la toma');

      // Cuando Google no cede, se rinde en vez de gastar intentos sin fin.
      const nunca = await conRechazos(99);
      cierto(nunca.error, 'no se rinde nunca y sigue reintentando');
      igual(nunca.vistos.length, 4, 'gasta más intentos de la cuenta contra un muro');
      cierto(/sensitive words/.test(nunca.error.message), 'se pierde el motivo de Google al rendirse');
    } finally {
      global.fetch = original;
    }
  });

  await comprobarAsync('cuando Veo falla, se dice POR QUÉ', async () => {
    // EL FALLO: el usuario encadenó nueve intentos del mismo clip y los nueve
    // dijeron «Veo terminó pero no devolvió ningún vídeo». Ese mensaje no
    // describía el fallo, describía que no sabíamos cuál era.
    //
    // Y la causa estaba a la vista: una operación larga de Google acaba con
    // `response` si salió bien o con `error` si no, y aquí sólo se leía
    // `response`. Cualquier fallo real —cuota, parámetro inválido, error
    // interno— caía en ese mensaje genérico.
    const original = global.fetch;
    const conOperacion = (op) => {
      global.fetch = async (u) => {
        const cuerpo = String(u).indexOf('oauth2') !== -1
          ? { access_token: 't', expires_in: 3600 }
          : op;
        return { ok: true, status: 200, headers: { get: () => null },
          json: async () => cuerpo, text: async () => JSON.stringify(cuerpo) };
      };
      return vertex.consultarVideo({
        token: 't', projectId: 'p', operationName: 'op/1', modelo: 'veo-3.1-lite-generate-001',
      });
    };

    try {
      // 1. La operación falló: se cuenta el motivo de Google, no un genérico.
      const falló = await conOperacion({
        done: true, error: { code: 3, message: 'Quota exceeded for veo generations' },
      });
      cierto(falló.listo, 'una operación fallida no se da por terminada');
      cierto(/Quota exceeded/.test(falló.error), 'se pierde el motivo real: ' + falló.error);
      cierto(!/no devolvió ningún vídeo/.test(falló.error), 'sigue saliendo el mensaje que no dice nada');

      // 2. Filtrada. Vale el contador Y las razones sueltas: Veo manda unas
      // veces uno y otras las otras, y mirando sólo el contador se escapaban.
      for (const resp of [
        { raiMediaFilteredCount: 1, raiMediaFilteredReasons: ['58061214'] },
        { raiMediaFilteredReasons: ['unsafe content'] },
      ]) {
        const r = await conOperacion({ done: true, response: resp });
        cierto(/filtros de contenido/.test(r.error), 'no se reconoce un clip filtrado: ' + r.error);
        cierto(/editar el prompt/.test(r.error), 'no se dice qué hacer con un clip filtrado');
      }

      // 3. Terminó sin vídeo y sin motivo: se dice QUÉ contestó. Es lo único
      // con lo que se puede diagnosticar desde un móvil, sin poder abrir los
      // registros de Google.
      const raro = await conOperacion({ done: true, response: { videos: [], loQueSea: 'x' } });
      cierto(/Contestó:/.test(raro.error), 'no se cuenta lo que devolvió Veo: ' + raro.error);
      cierto(/loQueSea/.test(raro.error), 'el resumen no nombra los campos que llegaron: ' + raro.error);

      // 4. Y lo que funciona sigue funcionando.
      const bien = await conOperacion({ done: true, response: { videos: [{ gcsUri: 'gs://b/c/clip.mp4' }] } });
      igual(bien.objeto, 'c/clip.mp4', 'un clip correcto ya no se recoge bien');
      const enCurso = await conOperacion({ done: false });
      igual(enCurso.listo, false, 'una operación en curso se da por terminada');
    } finally {
      global.fetch = original;
    }
  });

  comprobar('no se repite en bucle un fallo que se paga', () => {
    // Nueve intentos del mismo clip son nueve generaciones facturadas. La cola
    // ya no reintenta un activo roto, pero a mano no había ningún freno: el
    // botón «Regenerar» se podía pulsar indefinidamente sobre el mismo error.
    const iu = reglasDeLaInterfaz();
    cierto(typeof iu.fallosSeguidos === 'function', 'la interfaz no sabe contar fallos seguidos');

    const gens = (estados) => ({ generations: estados.map((s) => ({ status: s, error: 'x' })) });
    igual(iu.fallosSeguidos(gens([])), 0, 'sin generaciones no hay fallos');
    igual(iu.fallosSeguidos(gens(['failed', 'failed', 'failed'])), 3, 'no cuenta bien tres seguidos');
    // Los seguidos son los del FINAL: un acierto por el medio corta la racha.
    igual(iu.fallosSeguidos(gens(['failed', 'failed', 'approved', 'failed'])), 1,
      'cuenta fallos viejos que ya no vienen seguidos');
    igual(iu.fallosSeguidos(gens(['failed', 'review'])), 0, 'cuenta una racha que ya se cortó');
  });

  comprobar('un 429 de Google se distingue de un fallo de verdad', () => {
    cierto(typeof ui.esLimiteDeCuota === 'function', 'falta esLimiteDeCuota en index.html');
    const limite = [
      'Google está limitando las peticiones (cuota). Espera un momento y reintenta.',
      'HTTP 429: Too Many Requests',
      'RESOURCE_EXHAUSTED: quota exceeded',
    ];
    for (const m of limite) cierto(ui.esLimiteDeCuota(new Error(m)), 'no reconoce el límite: ' + m);
    const rotos = [
      'a la cuenta de servicio le falta el rol "Usuario de Vertex AI"',
      'ese modelo no existe o no está disponible en esta región',
      'El montaje sólo recibe material que hayas aprobado tú.',
    ];
    for (const m of rotos) cierto(!ui.esLimiteDeCuota(new Error(m)), 'confunde con un límite: ' + m);
  });

  comprobar('coinciden en qué etapas están abiertas, en cada paso de la producción', () => {
    const p = nuevo();
    const etapas = ['images', 'videos', 'music', 'ambient'];
    const comparar = (momento) => {
      for (const etapa of etapas) {
        const servidor = progreso.stageIsOpen(p, etapa);
        const interfaz = ui.etapaAbierta(p, etapa);
        if (servidor !== interfaz) {
          throw new Error(
            momento + ': la etapa "' + etapa + '" está ' + (servidor ? 'abierta' : 'cerrada') +
            ' para el servidor y ' + (interfaz ? 'abierta' : 'cerrada') + ' para la interfaz',
          );
        }
        const completaS = progreso.isStageComplete(p, etapa);
        const completaI = ui.etapaCompleta(p, etapa);
        if (completaS !== completaI) {
          throw new Error(momento + ': no coinciden en si "' + etapa + '" está terminada');
        }
      }
    };

    comparar('recién creado');
    for (const etapa of etapas) {
      for (const a of p.assets.filter((x) => x.stage === etapa)) {
        const g = dominio.startGeneration(p, a, { prompt: 'p', negativePrompt: 'n', referenceAssetIds: [], provider: { name: 'prueba' }, seed: 1 });
        dominio.completeGeneration(p, a, g, { path: a.id + '.bin', bytes: 10, mimeType: 'application/octet-stream' });
        comparar('con ' + a.id + ' en revisión');
        dominio.approveGeneration(p, a.id, g.id);
        comparar('con ' + a.id + ' aprobado');
      }
    }
  });

  comprobar('coinciden en si un activo se puede generar, y en el motivo cuando no', () => {
    const p = nuevo();
    for (const a of p.assets) {
      const servidor = progreso.canGenerate(p, a);
      const interfaz = ui.puedeGenerar(p, a);
      if (servidor.ok !== interfaz.ok) {
        throw new Error(
          a.id + ': el servidor dice ' + (servidor.ok ? 'sí' : 'no') +
          ' y la interfaz dice ' + (interfaz.ok ? 'sí' : 'no'),
        );
      }
    }
  });

  // ── El productor ──
  console.log('\nLa estructura del corto cuadra');

  comprobar('la línea de tiempo suma exactamente la duración pedida', () => {
    for (const segundos of [60, 120, 180]) {
      const e = productor.planStructure(segundos);
      const suma = e.timeline.reduce((s, x) => s + x.durationSec, 0);
      igual(suma, segundos, 'suma para ' + segundos + ' s');
    }
  });

  comprobar('ningún clip pasa de 8 segundos', () => {
    for (const segundos of [60, 120, 180]) {
      for (const toma of productor.planStructure(segundos).shots) {
        for (const clip of toma.clips) {
          cierto(clip.durationSec <= 8, 'clip de ' + clip.durationSec + ' s en ' + toma.id);
        }
      }
    }
  });

  // Apariciones en pantalla: dos clips seguidos de la misma toma son UNA.
  // Contar entradas de la linea de tiempo daria una cifra inflada, porque una
  // toma larga se parte en varios clips y no por eso se ve mas veces.
  function aparicionesEnPantalla(estructura) {
    const orden = [];
    let anterior = null;
    for (const t of estructura.timeline) {
      if (t.shotId === anterior) continue;
      anterior = t.shotId;
      orden.push(t.shotId);
    }
    return orden;
  }

  comprobar('la MITAD del corto se monta con material ya generado (PRD §15, §25, §33)', () => {
    // No es una optimizacion que se aplique al final: generar video es lo caro
    // de esta herramienta, y un plano que vuelve se genera UNA vez. La regla
    // vale igual para 1, 2 y 3 minutos.
    for (const segundos of [60, 120, 180]) {
      const orden = aparicionesEnPantalla(productor.planStructure(segundos));
      const distintos = new Set(orden).size;
      const repetido = Math.round((1 - distintos / orden.length) * 100);
      cierto(
        repetido >= 45 && repetido <= 55,
        segundos + ' s: se repite el ' + repetido + ' % y tiene que ser la mitad',
      );
    }
  });

  comprobar('todo corto termina con un plano en el que nadie toca', () => {
    // LA CAUSA RAÍZ, y estuvo escrita en el código todo el tiempo:
    //
    //     // El hueco de cierre rima a propósito con la imagen de apertura.
    //     if (isFinalSlot) { const opener = candidates.find(s => s.beat === 'opening'); ... }
    //
    // El corto terminaba REPITIENDO el plano de apertura, donde el intérprete
    // está tocando. Y la pieza de Lyria resuelve y deja dos o tres segundos de
    // silencio al final, así que el corto acababa con alguien aporreando el
    // instrumento en silencio.
    for (const segundos of [60, 120, 180]) {
      const e = productor.planStructure(segundos);
      const ultimo = e.timeline[e.timeline.length - 1];
      const cierre = e.shots.find((t) => t.id === ultimo.shotId);

      cierto(cierre.esCierre, segundos + ' s: el corto no termina en el plano de cierre');
      igual(cierre.shotType, productor.PLANO_DE_CIERRE, segundos + ' s: el plano final no es del tipo de cierre');
      // El último hueco puede ser una repetición DEL PROPIO cierre —eso está
      // permitido— pero nunca de otro plano, que es de donde venía el fallo.
      cierto(ultimo.shotId === cierre.id,
        segundos + ' s: el corto cierra con material de otro plano');
      igual(ultimo.transitionIn, 'dissolve', segundos + ' s: el plano final entra a corte seco');

      // Tiene su hueco entero: es un plano que se genera aposta, y darle el
      // sobrante de cuatro segundos sería pagar ocho y tirar la mitad.
      igual(ultimo.durationSec, 8, segundos + ' s: el plano de cierre no se lleva los ocho segundos');

      // SÍ puede volver durante el corto: el usuario lo pidió así —«eso le daría
      // un aire como de videoclip musical»—. Lo único que no se negocia es que el
      // último hueco sea suyo.
      cierto(cierre.reusable, segundos + ' s: el plano de cierre ya no se puede reutilizar');

      // Pero nunca pegado a sí mismo, ni siquiera en el hueco justo anterior al
      // final, que es el caso que `ultimaTomaId` no puede ver porque mira atrás.
      const posiciones = e.timeline
        .map((t, i) => (t.shotId === cierre.id ? i : -1))
        .filter((i) => i !== -1);
      for (let k = 1; k < posiciones.length; k += 1) {
        cierto(posiciones[k] - posiciones[k - 1] > 1,
          segundos + ' s: el plano de cierre sale dos veces seguidas');
      }
    }
  });

  comprobar('el plano de cierre puede volver durante el corto', () => {
    // «De hecho, sí se puede reutilizar, no hay ningún problema, porque eso le
    // daría un aire como de videoclip musical. Lo que hay que asegurarnos es de
    // que siempre sea el final, ese clip.»
    //
    // Para poder volver tiene que EXISTIR antes de repartir los huecos: si se
    // creara al llegar al último, los anteriores no podrían reutilizarlo porque
    // todavía no estaría. De ahí que se cree el primero y se coloque el último.
    let algunaVezVolvio = false;
    for (const segundos of [60, 120, 180]) {
      const e = productor.planStructure(segundos);
      const cierre = e.shots.find((t) => t.esCierre);
      const veces = e.timeline.filter((t) => t.shotId === cierre.id).length;
      if (veces > 1) algunaVezVolvio = true;

      // Vuelva o no, el último hueco es suyo. Eso no se negocia.
      igual(e.timeline[e.timeline.length - 1].shotId, cierre.id,
        segundos + ' s: el corto no termina en el plano de cierre');

      // Y aparece EL ÚLTIMO en la lista de tomas, aunque se cree el primero:
      // la pantalla y la lista de activos van en este orden.
      igual(e.shots[e.shots.length - 1].id, cierre.id,
        segundos + ' s: el plano de cierre no es el último de la lista de tomas');
      igual(cierre.index, e.shots.length, segundos + ' s: el plano de cierre está mal numerado');
      // Y no le roba el número a nadie: los planos de interpretación siguen
      // empezando en Shot 01.
      cierto(e.shots.some((t) => t.id === 'shot_01'), segundos + ' s: el corto ya no empieza en Shot 01');
    }
    cierto(algunaVezVolvio, 'el plano de cierre no vuelve nunca, y debería poder');
  });

  comprobar('el plano de cierre no le cuesta al usuario una generación de más', () => {
    // El plano final es una imagen y un clip nuevos. Podría haber salido caro:
    // ocupa un hueco que antes se rellenaba con material repetido, así que sin
    // más la reutilización habría bajado del 50 % al 38 % y cada corto de un
    // minuto pasaría a pagar un clip de Veo extra.
    //
    // No pasa porque el reparto de repeticiones cuenta sobre el corto entero y
    // elige posiciones sólo entre los huecos disponibles. El resultado son las
    // mismas tomas de siempre, con la última cambiada por el cierre.
    igual(productor.planStructure(60).shots.length, 4, 'el corto de 1 min ya no tiene 4 tomas');
    igual(productor.planStructure(120).shots.length, 8, 'el corto de 2 min ya no tiene 8 tomas');
    igual(productor.planStructure(180).shots.length, 12, 'el corto de 3 min ya no tiene 12 tomas');
  });

  comprobar('el sobrante de segundos va al penúltimo hueco, no al último', () => {
    // Sesenta y ciento ochenta no son múltiplos de ocho: sobran cuatro. Ese
    // hueco corto tiene que ocuparlo un plano REPETIDO, nunca el de cierre, que
    // se genera entero a propósito.
    for (const segundos of [60, 180]) {
      const e = productor.planStructure(segundos);
      const cortos = e.timeline.filter((t) => t.durationSec < 8);
      cierto(cortos.length, segundos + ' s: no hay ningún hueco corto y debería haberlo');
      for (const c of cortos) {
        cierto(c.reused, segundos + ' s: un hueco corto estrena plano y tira la mitad de lo pagado');
        cierto(c.index !== e.timeline.length - 1, segundos + ' s: el hueco corto cayó en el cierre');
      }
    }
    // Y en 120, que sí es múltiplo de ocho, no sobra nada.
    cierto(!productor.planStructure(120).timeline.some((t) => t.durationSec < 8),
      '120 s: aparecieron huecos cortos donde no sobra nada');
  });

  comprobar('ningun plano aparece dos veces seguidas', () => {
    // Que vuelva material no canta; que vuelva el MISMO plano pegado a si
    // mismo, si.
    for (const segundos of [60, 120, 180]) {
      const orden = aparicionesEnPantalla(productor.planStructure(segundos));
      let seguidos = 0;
      for (let i = 1; i < orden.length; i += 1) if (orden[i] === orden[i - 1]) seguidos += 1;
      igual(seguidos, 0, segundos + ' s: planos repetidos uno detras de otro');
    }
  });

  comprobar('solo se marca repetible un plano que aguante volver', () => {
    // Un plano que termina donde empezo se puede repetir sin que se note. Uno
    // que se acerca, no: al volver, el espectador ve un salto hacia atras. Y un
    // primer plano del rostro lleva un momento unico que delata la repeticion.
    const CON_DIRECCION = ['slow_push_in', 'slow_pull_out', 'crane_up', 'tilt_up', 'tilt_down'];
    const CON_MOMENTO = ['face', 'close_up', 'over_shoulder', 'low_angle'];
    for (const segundos of [60, 120, 180]) {
      for (const toma of productor.planStructure(segundos).shots) {
        if (!toma.reusable) continue;
        cierto(
          CON_DIRECCION.indexOf(toma.cameraMove) === -1,
          segundos + ' s: ' + toma.id + ' es repetible con camara ' + toma.cameraMove,
        );
        cierto(
          CON_MOMENTO.indexOf(toma.shotType) === -1,
          segundos + ' s: ' + toma.id + ' es repetible siendo ' + toma.shotType,
        );
      }
    }
  });

  comprobar('una toma repetida dura al menos lo que su hueco mas largo', () => {
    // Si no, al colocarla en el hueco grande faltaria metraje y el montaje
    // congelaria el ultimo fotograma sin que nadie lo hubiera decidido.
    for (const segundos of [60, 120, 180]) {
      const e = productor.planStructure(segundos);
      for (const toma of e.shots) {
        const suyos = e.timeline.filter((t) => t.shotId === toma.id);
        if (!suyos.length) continue;
        const hueco = Math.max.apply(null, suyos.map((t) => t.durationSec));
        const tiene = toma.clips.reduce((n, c) => n + c.durationSec, 0);
        cierto(tiene >= hueco, segundos + ' s: ' + toma.id + ' dura ' + tiene + ' s en un hueco de ' + hueco + ' s');
      }
    }
  });

  comprobar('el Director sabe que tomas van a volver', () => {
    // Sin la marca en la lista, el modelo escribe todas las tomas igual y las
    // repetibles salen con un gesto unico que delata la repeticion.
    const listaDe = (segundos) => {
      const e = productor.planStructure(segundos);
      const apariciones = new Map();
      for (const id of aparicionesEnPantalla(e)) {
        apariciones.set(id, (apariciones.get(id) || 0) + 1);
      }
      return planificador.buildUserPrompt({
        config: CONFIG,
        runtimeSec: segundos,
        shots: e.shots.map((t) => ({
          index: t.index, label: t.label, beat: t.beat, shotType: t.shotType,
          cameraMove: t.cameraMove, durationSec: t.durationSec,
          reusable: t.reusable, apariciones: apariciones.get(t.id) || 1,
        })),
      });
    };
    const prompt = listaDe(60);
    cierto(prompt.indexOf('REPETIBLE') !== -1, 'la lista no marca las tomas repetibles');
    // «ÚNICA» sólo aparece cuando el corto tiene alguna toma que no se repite.
    // En uno de un minuto las tres tomas con interpretación son repetibles, así
    // que se comprueba donde de verdad las hay.
    cierto(listaDe(120).indexOf('ÚNICA') !== -1, 'la lista no marca las tomas únicas');

    // Y EL PLANO FINAL lleva su propia marca, que no es ninguna de las dos: lo
    // que hay que saber de él no es cuántas veces sale, es que ahí nadie toca.
    // Sin decírselo, el modelo lo describe como los otros y escribe «tocando»,
    // que es la palabra con la que se queda el modelo de imagen.
    cierto(/PLANO FINAL — la pieza YA TERMINÓ/.test(prompt),
      'la lista de tomas no avisa de que el plano final no se toca');
    cierto(/NADIE TOCA/.test(prompt), 'la marca del plano final no es explícita');
    cierto(
      planificador.SYSTEM_PROMPT.indexOf('aguanten volver') !== -1,
      'el Director no recibe la instruccion de escribir tomas que aguanten volver',
    );
  });

  // ── Los prompts ──
  console.log('\nLos prompts dicen lo que el usuario pidió');

  function bibliaDe(cambios) {
    const config = Object.assign({}, CONFIG, cambios || {});
    const e = productor.planStructure(60);
    const brief = planificador.buildHeuristicBrief({ config, runtimeSec: 60, shots: e.shots });
    return { config, biblia: arte.buildVisualBible(config, brief), estructura: e };
  }

  comprobar('el estilo abre el prompt y prohíbe lo contrario', () => {
    // Se pidió anime y el personaje salía fotorrealista: el estilo iba como un
    // punto más a mitad del texto y el modelo lo tomó por sugerencia.
    const { config, biblia } = bibliaDe({ visualStyleId: 'anime_cinematic' });
    const p = arte.buildCharacterPrompt(biblia, config, 1, 1, 'Violín');
    cierto(p.indexOf('ESTILO VISUAL (INNEGOCIABLE') === 0, 'el estilo no abre el prompt');
    cierto(/PROHIBIDO/.test(p) && /fotorrealismo/.test(p), 'no prohíbe la fotografía en un estilo dibujado');

    const real = bibliaDe({ visualStyleId: 'realistic' });
    const pr = arte.buildCharacterPrompt(real.biblia, real.config, 1, 1, 'Violín');
    cierto(/PROHIBIDO/.test(pr) && /anime/.test(pr.split('PROHIBIDO')[1]), 'no prohíbe el anime en un estilo realista');
  });

  comprobar('lo que escribe el usuario manda sobre el catálogo', () => {
    // Pidió «azotea de noche con luces» y salió una azotea de día genérica: su
    // texto competía de igual a igual con los elementos del catálogo.
    const { config, biblia } = bibliaDe({
      scenarioId: 'rooftop',
      scenarioCustom: 'azotea de noche, decorada con luces decorativas',
    });
    const p = arte.buildEnvironmentPrompt(biblia, config);
    cierto(/INDICACIÓN DEL USUARIO SOBRE EL ESCENARIO/.test(p), 'su indicación no va señalada');
    cierto(/MANDA sobre todo/.test(p), 'no se dice que su indicación tenga prioridad');
    // Y va ANTES que los elementos del catálogo, que son los que contradecía.
    cierto(
      p.indexOf('INDICACIÓN DEL USUARIO') < p.indexOf('Elementos principales'),
      'su indicación va después de los elementos del catálogo',
    );
  });

  comprobar('el escenario maestro se pide vacío', () => {
    // Si sale alguien tocando, esa persona se cuela como referencia en las
    // tomas y acaban saliendo intérpretes duplicados.
    const { config, biblia } = bibliaDe({});
    const p = arte.buildEnvironmentPrompt(biblia, config);
    cierto(/ESCENARIO VACÍO/.test(p), 'no lo pide vacío');
    cierto(/SIN PERSONAS/.test(p), 'no lo repite en los requisitos');
  });

  comprobar('en un dúo, el segundo intérprete no desaparece del corto', () => {
    // El fallo tal como lo vio: pidió violín y violonchelo, y de trece tomas
    // sólo UNA tenía a las dos. En las doce restantes salía la del violín sola.
    // La causa: cada toma se describía «de una chica joven interpretando
    // Violín», en singular y siempre con el primer instrumento de la lista.
    const config = Object.assign({}, CONFIG, {
      formationId: 'duo', instrumentIds: ['violin', 'cello'],
    });
    const e = productor.planStructure(60);
    const brief = planificador.buildHeuristicBrief({ config, runtimeSec: 60, shots: e.shots });

    const suyas = (n) => brief.shots.filter((s) => s.subject === n).length;
    cierto(suyas(1) > 0, 'el intérprete 1 no sale en ninguna toma propia');
    cierto(suyas(2) > 0, 'el intérprete 2 no sale en ninguna toma propia');
    cierto(brief.shots.some((s) => s.subject === 'todos'), 'no hay ni una toma del grupo');
    // Y el reparto es equilibrado: nadie se lleva todo lo cerrado.
    cierto(Math.abs(suyas(1) - suyas(2)) <= 1, 'reparto desequilibrado: ' + suyas(1) + ' vs ' + suyas(2));

    // El violonchelo tiene que nombrarse en alguna descripción; antes no
    // aparecía en ninguna.
    cierto(brief.shots.some((s) => /Violonchelo/.test(s.description)),
      'el violonchelo no se menciona en ninguna toma');

    // Y con cuatro músicos tampoco se olvida ninguno.
    const cuatro = Object.assign({}, CONFIG, { formationId: 'quartet', instrumentIds: ['violin', 'cello'] });
    const b4 = planificador.buildHeuristicBrief({
      config: cuatro, runtimeSec: 180, shots: productor.planStructure(180).shots,
    });
    for (let n = 1; n <= 4; n += 1) {
      cierto(b4.shots.some((s) => s.subject === n), 'el intérprete ' + n + ' se queda sin tomas');
    }
  });

  comprobar('la toma dice quién sale y sólo recibe SU referencia', () => {
    const config = Object.assign({}, CONFIG, {
      formationId: 'duo', instrumentIds: ['violin', 'cello'],
    });
    const e = productor.planStructure(60);
    const brief = planificador.buildHeuristicBrief({ config, runtimeSec: 60, shots: e.shots });
    const biblia = arte.buildVisualBible(config, brief);

    const deUno = brief.shots.find((s) => typeof s.subject === 'number');
    const deTodos = brief.shots.find((s) => s.subject === 'todos');
    cierto(deUno && deTodos, 'no hay tomas de los dos tipos para comparar');

    const toma = Object.assign({}, e.shots[deUno.index - 1], deUno);
    const p1 = arte.buildShotImagePrompt(biblia, toma, config);
    cierto(/QUIÉN SALE EN ESTA TOMA/.test(p1), 'la toma no dice quién sale');
    cierto(/UNA SOLA PERSONA/.test(p1), 'una toma individual no lo deja claro');
    cierto(/NO aparecen en el encuadre/.test(p1), 'no se excluye al resto del grupo');
    // Y no se le listan las dos fichas del reparto: eso invita a meter a las dos.
    cierto(!/PERSONAS DISTINTAS/.test(p1), 'a una toma individual se le lista el reparto entero');

    const tomaG = Object.assign({}, e.shots[deTodos.index - 1], deTodos);
    const p2 = arte.buildShotImagePrompt(biblia, tomaG, config);
    cierto(/LOS 2 INTÉRPRETES/.test(p2), 'la toma de grupo no pide a los dos');
  });

  comprobar('cada intérprete tiene SU cara, no la del primero', () => {
    // El fallo tal como lo vio el usuario: eligió un dúo, violín y chelo, y los
    // dos retratos maestros le devolvieron a la misma chica. La causa era que
    // el brief traía UN solo personaje y los dos prompts lo copiaban.
    const { config, biblia } = bibliaDe({
      formationId: 'duo',
      instrumentIds: ['violin', 'cello'],
    });
    igual(biblia.cast.length, 2, 'el reparto no tiene dos intérpretes');
    cierto(biblia.cast[0].face !== biblia.cast[1].face, 'los dos intérpretes tienen el mismo rostro');
    cierto(biblia.cast[0].hair !== biblia.cast[1].hair, 'los dos intérpretes tienen el mismo pelo');
    cierto(biblia.cast[0].wardrobe !== biblia.cast[1].wardrobe, 'los dos visten igual');

    const p1 = arte.buildCharacterPrompt(biblia, config, 1, 2, 'Violín');
    const p2 = arte.buildCharacterPrompt(biblia, config, 2, 2, 'Chelo');
    cierto(p1.indexOf(biblia.cast[0].face) !== -1, 'el retrato 1 no describe al intérprete 1');
    cierto(p2.indexOf(biblia.cast[1].face) !== -1, 'el retrato 2 no describe al intérprete 2');
    cierto(p2.indexOf(biblia.cast[0].face) === -1, 'el retrato 2 sigue describiendo la cara del intérprete 1');
  });

  comprobar('con varios músicos la continuidad no pide «el mismo rostro»', () => {
    // Decirle «mismo rostro en todas las tomas» a un dúo es pedirle justo el
    // error: lo que se repite es cuál rostro le toca a cada uno.
    const solo = bibliaDe({ formationId: 'solo' }).biblia;
    cierto(
      solo.continuityRules.some((r) => /Mismo rostro en todas las tomas/.test(r)),
      'con un solista debería seguir habiendo un único rostro',
    );
    const duo = bibliaDe({ formationId: 'duo', instrumentIds: ['violin', 'cello'] }).biblia;
    cierto(
      !duo.continuityRules.some((r) => /Mismo rostro en todas las tomas/.test(r)),
      'con un dúo sigue pidiendo un rostro único',
    );
    cierto(
      duo.continuityRules.some((r) => /2 personas distintas/.test(r)),
      'no se dice que son dos personas distintas',
    );
  });

  comprobar('donde salen varios se lista quién es quién', () => {
    const duo = bibliaDe({ formationId: 'duo', instrumentIds: ['violin', 'cello'] });
    const escena = arte.buildScenePrompt(duo.biblia, duo.config);
    cierto(/REPARTO/.test(escena), 'la escena maestra no lleva el reparto');
    cierto(/PERSONAS DISTINTAS/.test(escena), 'no avisa de que son personas distintas');
    cierto(escena.indexOf(duo.biblia.cast[1].face) !== -1, 'la escena no describe al segundo intérprete');

    // Con un solista la lista sobra y no debe aparecer.
    const solo = bibliaDe({ formationId: 'solo' });
    cierto(!/REPARTO/.test(arte.buildScenePrompt(solo.biblia, solo.config)), 'un solista no necesita reparto');
  });

  comprobar('los intérpretes tienen que salir HERMOSOS, no correctos', () => {
    // Petición literal del usuario, y luego subida de listón: «guapas no es
    // suficiente, quiero hermosas». Nada en el prompt lo pedía: una cara
    // correcta y del montón puntuaba como éxito perfecto.
    const ella = bibliaDe({ performerTypeId: 'young_woman' });
    const p = arte.buildCharacterPrompt(ella.biblia, ella.config, 1, 1, 'Violín');
    cierto(/HERMOSA/.test(p), 'no se pide que sea hermosa');
    cierto(/proporciones perfectas/.test(p), 'no se pide una figura de proporciones perfectas');
    cierto(/CALIDAD \(mismo rango que el estilo\)/.test(p), 'no se fija el listón de calidad');
    cierto(/rostro anodino/.test(p), 'no se prohíbe la cara del montón');
    // El usuario pidió quitar las prohibiciones: le bloqueaban cosas normales
    // —una minifalda, un plano sensual— y una orden en negativo confunde al
    // generador. La edad se queda, pero como un dato de la ficha, no como aviso.
    cierto(!/sexualizad/i.test(p), 'sigue habiendo una prohibición que bloquea al generador');
    cierto(/Edad aparente: entre 18 y 24 años/.test(p), 'la edad ya no aparece en la ficha');
    // Y la belleza cubre todo, no sólo el rostro.
    for (const parte of ['cuerpo', 'cabello', 'manos', 'piel', 'ropa']) {
      cierto(new RegExp(parte).test(p), 'la belleza no llega a: ' + parte);
    }
    cierto(p.indexOf('CALIDAD') < p.indexOf('Persona:'), 'el listón va después de la descripción');
    cierto(/rostro anodino/.test(ella.biblia.negativePrompt), 'el negativo no excluye lo anodino');

    // A un hombre se le pide lo suyo, no el texto de ella.
    const el = bibliaDe({ performerTypeId: 'adult_man' });
    const pm = arte.buildCharacterPrompt(el.biblia, el.config, 1, 1, 'Violín');
    cierto(/MUY ATRACTIVO/.test(pm), 'al intérprete masculino no se le pide ser atractivo');
    cierto(!/ELLA TIENE QUE SER/.test(pm), 'a un hombre se le está pidiendo el texto de ella');
  });

  comprobar('el listón de belleza y calidad vale para TODOS los estilos', () => {
    // «Si yo escojo realismo o cualquier otro género, las imágenes tienen que
    // ser fieles a su género y ser siempre personajes hermosos.»
    for (const estilo of catalogo.VISUAL_STYLES) {
      const { config, biblia } = bibliaDe({ visualStyleId: estilo.id });
      const p = arte.buildCharacterPrompt(biblia, config, 1, 1, 'Violín');
      cierto(/CALIDAD \(mismo rango que el estilo\)/.test(p), 'sin listón de calidad en ' + estilo.id);
      cierto(/HERMOSA|MUY ATRACTIVO/.test(p), 'sin exigencia de belleza en ' + estilo.id);
      cierto(/rostro anodino o de foto de carné/.test(p), 'sin prohibición de lo mediocre en ' + estilo.id);
      // Y sigue siendo fiel a SU estilo: el tratamiento del catálogo va delante.
      cierto(p.indexOf(estilo.treatment.slice(0, 40)) !== -1, 'no se respeta el estilo ' + estilo.id);
    }
  });

  comprobar('el vestuario del grupo lo decide el Director, la cara no', () => {
    // Aclaración del usuario: que vayan iguales o distintos es decisión
    // creativa. Lo que NO se negocia es que sean personas diferentes.
    const vistos = new Set();
    for (const inst of [['violin', 'cello'], ['piano', 'violin'], ['guitar', 'flute'], ['cello', 'harp']]) {
      const { config, biblia } = bibliaDe({ formationId: 'duo', instrumentIds: inst });
      vistos.add(biblia.wardrobeGroup);
      // Innegociable, salga la decisión que salga:
      cierto(biblia.cast[0].face !== biblia.cast[1].face, 'dos intérpretes con la misma cara');
      cierto(biblia.cast[0].hair !== biblia.cast[1].hair, 'dos intérpretes con el mismo pelo');
      const p = arte.buildCharacterPrompt(biblia, config, 2, 2, 'el suyo');
      cierto(/OTRO ROSTRO y OTRO PEINADO/.test(p), 'no exige otra cara y otro peinado');
      cierto(!/otro color de ropa/i.test(p), 'sigue imponiendo otro color de ropa');
      cierto(!/los otros 1 intérpretes/.test(p), 'el plural está mal escrito');
      // Y el prompt dice la decisión que se tomó, no una regla fija.
      const base = (v) => v.split(', con ')[0];
      const mismos = base(biblia.cast[0].wardrobe) === base(biblia.cast[1].wardrobe);
      igual(mismos, biblia.wardrobeGroup === 'conjuntado', 'el vestuario no sigue la decisión');
      cierto(
        mismos ? /VESTUARIO es el mismo/.test(p) : /distinto del de los demás/.test(p),
        'el prompt no cuenta la decisión que tomó el Director',
      );
    }
    cierto(vistos.size === 2, 'el Director siempre decide lo mismo: ' + [...vistos].join(', '));
  });

  comprobar('el retrato de uno no describe el instrumento del otro', () => {
    const { config, biblia } = bibliaDe({ formationId: 'duo', instrumentIds: ['violin', 'cello'] });
    const p = arte.buildCharacterPrompt(biblia, config, 2, 2, 'Violonchelo');
    const bloque = p.split('\n\n').filter((b) => b.indexOf('Instrumento:\n') === 0).join('');
    cierto(bloque.length > 0, 'no hay bloque de instrumento');
    cierto(!/Violín/.test(bloque), 'al retrato del chelo se le cuela el violín');
  });

  comprobar('si el usuario escribe «de noche», es de noche', () => {
    // Escribió «azotea de noche» y el planificador sorteaba la hora del día de
    // su lista: el prompt acababa con dos horas contradictorias.
    const { biblia } = bibliaDe({
      scenarioId: 'rooftop',
      scenarioCustom: 'azotea de noche, decorada con luces decorativas',
    });
    cierto(/noche/.test(biblia.lighting.timeOfDay), 'la hora del día no es de noche');
    cierto(!/sol/.test(biblia.lighting.direction) || /sin luz de sol/.test(biblia.lighting.direction),
      'de noche sigue habiendo sol iluminando');
    cierto(!biblia.environment.secondaryElements.some((e) => /sombras largas/.test(e)),
      'de noche no puede haber sombras largas de sol');
    // Y lo que escribió encabeza los elementos, por delante del catálogo.
    igual(biblia.environment.primaryElements[0], 'azotea de noche, decorada con luces decorativas',
      'su texto no va el primero de los elementos');
  });

  comprobar('el estilo anime dice cómo se dibuja una CARA, no sólo el fondo', () => {
    // Por esto el escenario salía en anime y las personas realistas: el estilo
    // sólo hablaba de «fondos pintados con detalle».
    const { config, biblia } = bibliaDe({ visualStyleId: 'anime_cinematic' });
    const cabecera = arte.buildCharacterPrompt(biblia, config, 1, 1, 'Violín').split('\n\n')[0];
    cierto(/PERSONAS dibujadas en anime/.test(cabecera), 'el estilo no habla de cómo se dibuja a la gente');
    cierto(/ojos grandes/.test(cabecera), 'el estilo no describe el rostro de anime');
  });

  comprobar('la ficha del usuario SUSTITUYE el dato, no discute con él', () => {
    // El fallo tal como lo vio: pidió «dos chicas rubias en minifalda» en el
    // cuadro de texto y salió pelo negro y falda larga. El texto sí llegaba al
    // prompt, encima con un cartel de «esto manda», pero cinco líneas más abajo
    // seguía poniendo «Cabello: negro azabache». El modelo se queda con el dato.
    const { config, biblia } = bibliaDe({
      formationId: 'duo',
      instrumentIds: ['violin', 'cello'],
      performers: [
        { hairColor: 'Rubio', wardrobe: 'Minifalda', mood: 'Apasionada' },
        { hairColor: 'Rubio', wardrobe: 'Minifalda', mood: 'Apasionada' },
      ],
    });
    for (const n of [1, 2]) {
      const p = arte.buildCharacterPrompt(biblia, config, n, 2, 'el suyo');
      const persona = p.split('\n\n').filter((b) => b.indexOf('Persona:') === 0).join('');
      cierto(/rubio/i.test(persona), 'el intérprete ' + n + ' no es rubio');
      cierto(!/negro azabache|castaño|cobrizo/i.test(persona), 'le queda el color del banco al ' + n);
      cierto(/minifalda/i.test(persona), 'el intérprete ' + n + ' no lleva minifalda');
      cierto(!/falda negra de talle alto|vestido negro largo/i.test(persona), 'le queda la ropa del banco al ' + n);
      cierto(/apasionada/i.test(persona), 'no se recoge la actitud del ' + n);
    }
    // Y siguen siendo dos personas: mismo color, distinta cara y peinado.
    cierto(biblia.cast[0].face !== biblia.cast[1].face, 'dos rubias con la misma cara');
    cierto(biblia.cast[0].hair !== biblia.cast[1].hair, 'dos rubias con el mismo peinado');
  });

  comprobar('lo que se deja en blanco lo decide el Director', () => {
    // Media ficha rellena: lo elegido manda, lo vacío lo pone el banco.
    const { config, biblia } = bibliaDe({ performers: [{ eyes: 'Verdes' }] });
    const p = arte.buildCharacterPrompt(biblia, config, 1, 1, 'Violín');
    cierto(/ojos verdes/i.test(p), 'no se aplican los ojos elegidos');
    cierto(/Vestuario: .{15,}/.test(p), 'sin vestuario elegido, el Director no propuso ninguno');
    cierto(/Cabello: .{15,}/.test(p), 'sin pelo elegido, el Director no propuso ninguno');
    // Y sin ninguna ficha, todo sale del banco y nada se rompe.
    const solo = bibliaDe({});
    cierto(/Cabello: /.test(arte.buildCharacterPrompt(solo.biblia, solo.config, 1, 1, 'Violín')),
      'sin ficha ninguna el prompt se queda sin pelo');
  });

  comprobar('a un hombre no se le ofrecen minifaldas', () => {
    // El fallo: «elegí masculino y solo me salen opciones femeninas, cabello
    // largo ondulado, minifalda». Las fichas tenían una sola lista para todo
    // el mundo, así que la pantalla ofrecía una cosa y el Director repartía
    // otra.
    const soloDe = (banco) => {
      const salida = {};
      for (const r of rasgos.RASGOS) salida[r.id] = rasgos.opcionesDe(r, banco);
      return salida;
    };
    const ellas = soloDe('femenino');
    const ellos = soloDe('masculino');

    // Lo que no puede aparecer en el banco masculino, con todas las letras.
    for (const prenda of ['Minifalda', 'Falda corta', 'Falda larga', 'Vestido corto', 'Vestido largo']) {
      cierto(ellas.wardrobe.indexOf(prenda) !== -1, 'falta ' + prenda + ' en el vestuario femenino');
      cierto(ellos.wardrobe.indexOf(prenda) === -1, 'a un hombre se le ofrece ' + prenda);
    }
    cierto(ellos.wardrobe.indexOf('Traje completo') !== -1, 'al vestuario masculino le falta el traje');
    cierto(ellos.hairStyle.indexOf('Melena larga ondulada') === -1, 'a un hombre se le ofrece melena ondulada');
    cierto(ellos.build.indexOf('Curvilínea') === -1, 'a un hombre se le ofrece una complexión curvilínea');
    cierto(ellas.build.indexOf('Curvilínea') !== -1, 'al cuerpo femenino le falta una opción suya');

    // Y lo que SÍ es común: un color de ojos es un color de ojos.
    for (const comun of ['hairColor', 'eyes', 'skin', 'age', 'mood']) {
      igual(ellos[comun], ellas[comun], 'el rasgo ' + comun + ' no debería cambiar con el género');
      cierto(ellos[comun].length > 0, 'el rasgo ' + comun + ' se quedó sin opciones');
    }

    // Todos los rasgos tienen opciones en los dos bancos: uno vacío dejaría una
    // fila de la ficha sin ningún botón.
    for (const r of rasgos.RASGOS) {
      for (const banco of ['femenino', 'masculino']) {
        cierto(rasgos.opcionesDe(r, banco).length >= 4,
          'el rasgo ' + r.id + ' tiene muy pocas opciones en ' + banco);
      }
    }
  });

  comprobar('la pantalla y el Director reparten el género IGUAL', () => {
    // Aquí nació el fallo: dos copias de la misma regla. Si la pantalla enseña
    // minifaldas y el Director reparte trajes, el usuario elige una cosa y
    // recibe otra, y no hay forma de que se entere hasta ver la imagen.
    cierto(typeof ui.bancoDeInterprete === 'function', 'falta bancoDeInterprete en index.html');
    cierto(typeof ui.opcionesDelRasgo === 'function', 'falta opcionesDelRasgo en index.html');

    for (const tipo of catalogo.PERFORMER_TYPES) {
      const config = Object.assign({}, CONFIG, { performerTypeId: tipo.id, formationId: 'quartet' });
      const b = planificador.buildHeuristicBrief({
        config, runtimeSec: 60, shots: productor.planStructure(60).shots,
      });
      // La pantalla, con el mismo tipo de intérprete seleccionado.
      ui.estado.catalogo = { performerTypes: catalogo.PERFORMER_TYPES };
      ui.estado.form = { tipo: tipo.id, genero: tipo.genderIds[0], fichas: [] };

      for (let n = 1; n <= b.cast.length; n += 1) {
        igual(ui.bancoDeInterprete(n), b.cast[n - 1].banco,
          'con «' + tipo.label + '», al intérprete ' + n + ' la pantalla le da un banco y el Director otro');
      }
    }

    // Y las listas que dibuja la pantalla son las mismas que valida el servidor.
    const delCatalogo = catalogo.buildCatalog().characterTraits.rasgos;
    for (const r of delCatalogo) {
      for (const banco of ['femenino', 'masculino']) {
        const enPantalla = ui.opcionesDelRasgo(r, banco);
        const enServidor = rasgos.opcionesDe(rasgos.RASGOS_POR_ID.get(r.id), banco);
        igual(enPantalla, enServidor, 'las opciones de ' + r.id + ' (' + banco + ') no coinciden');
      }
    }
  });

  comprobar('la ficha se valida y se guarda sin basura', () => {
    igual(rasgos.normalizarFichas(null), null, 'sin fichas debería quedar en nulo');
    igual(rasgos.normalizarFichas([{}, {}]), null, 'fichas vacías deberían quedar en nulo');
    // Se conserva el hueco: la ficha 2 es del intérprete 2 aunque la 1 esté vacía.
    const f = rasgos.normalizarFichas([{}, { hairColor: 'Rubio' }]);
    igual(f.length, 2, 'se ha comprimido el hueco');
    igual(f[0], null, 'la primera debería ser un hueco');
    igual(f[1].hairColor, 'Rubio', 'no se guarda lo elegido');
    // Nada de campos inventados, y el tope de fichas se respeta.
    const g = rasgos.normalizarFichas([{ hairColor: 'Rubio', loQueSea: 'x' }]);
    cierto(!('loQueSea' in g[0]), 'se cuela un campo desconocido en el proyecto');
    igual(rasgos.normalizarFichas(new Array(9).fill({ eyes: 'Verdes' })).length, rasgos.MAX_FICHAS,
      'no se respeta el tope de fichas');
    // Y la pantalla puede dibujarlas: el catálogo las lleva.
    const cat = catalogo.buildCatalog().characterTraits;
    cierto(cat && cat.rasgos.length >= 6, 'el catálogo no lleva los rasgos para la pantalla');
    // Un rasgo trae O una lista para todos, O una por género. Nunca ninguna.
    cierto(
      cat.rasgos.every((r) => r.id && r.etiqueta &&
        ((r.opciones && r.opciones.length) || (r.porGenero && r.porGenero.femenino.length))),
      'hay un rasgo sin opciones que dibujar',
    );
  });

  comprobar('a cada referencia se le dice PARA QUÉ es', () => {
    // El fallo que hacía que los dos intérpretes fueran la misma chica: todas
    // las referencias llevaban «copia esta identidad», incluida la del OTRO
    // intérprete que se adjunta al generar el segundo retrato.
    const t = vertex.TEXTO_DE_REFERENCIA;
    cierto(t && t.otroInterprete, 'no existe un texto para «otro intérprete»');
    cierto(/DISTINTA/.test(t.otroInterprete), 'no pide que sea distinta');
    cierto(/NO repitas esta cara/.test(t.otroInterprete), 'no prohíbe repetir la cara');
    cierto(!/Copia de ella la identidad/.test(t.otroInterprete), 'sigue pidiendo copiar la identidad');
    cierto(/Copia de ella la identidad/.test(t.identidad), 'la referencia de identidad ya no pide copiarla');
    cierto(/MISMO SITIO/.test(t.lugar), 'la referencia de lugar no habla del sitio');
  });

  // ── El montaje ──
  console.log('\nEl montaje');

  comprobar('el corto lleva una sola pista de audio: la música', () => {
    // Había una segunda pista —el lecho de sonido ambiental— mezclada por
    // debajo con amix. Se quitó del producto: era un ruido plano que ensuciaba
    // lo único que el corto viene a enseñar.
    const s = montaje.construirScript(
      [{ local: 'a.mp4', durationSec: 5, transitionIn: 'fade_in' }],
      'm.wav', 'salida.mp4',
    );
    cierto(s.indexOf('amix') === -1, 'sigue mezclando dos pistas de audio');
    cierto(s.indexOf('ambiente') === -1, 'el script sigue nombrando el ambiente');
    // Y la música conserva su volumen: amix la habría dividido entre dos.
    cierto(/volume=0\.85/.test(s), 'la música no entra a su volumen');
    cierto(s.indexOf('alimiter') !== -1, 'falta el limitador');
    cierto(s.indexOf('exec 2>error.txt') !== -1, 'el motivo del fallo no se guardaría');
  });

  comprobar('un plano que vuelve entra encadenado, no a corte', () => {
    // El ojo reconoce un encuadre repetido. Medio segundo de superposición
    // desdibuja la costura; un corte seco la delata.
    const e = productor.planStructure(120);
    const vueltas = e.timeline.filter((t) => t.reused);
    cierto(vueltas.length > 0, 'este corto no reutiliza nada');
    const encadenados = vueltas.filter(
      (t) => t.transitionIn === 'dissolve' || t.transitionIn === 'dip_to_black',
    );
    cierto(
      encadenados.length >= vueltas.filter((t) => t.transitionIn !== 'cut').length,
      'hay planos que vuelven entrando a corte seco',
    );
  });

  comprobar('el encadenado no le roba segundos a la película', () => {
    // El trozo que entra encadenado tiene que durar medio segundo MÁS que su
    // hueco, porque esa media se comparte. Sin ese ajuste, cada encadenado
    // acortaría el corto y la música dejaría de cuadrar con la imagen.
    const s = montaje.construirScript(
      [
        { local: 'a.mp4', durationSec: 6, transitionIn: 'fade_in' },
        { local: 'b.mp4', durationSec: 4, transitionIn: 'dissolve' },
      ],
      'm.wav', 'salida.mp4',
    );
    cierto(s.indexOf('xfade=transition=fade:duration=0.5') !== -1, 'no usa encadenado real');
    // El segundo trozo se retima a 4,5 s: sus 4 s de hueco más el medio que
    // solapa. Ese 4.500 aparece como objetivo de la velocidad y como duración
    // final del trozo.
    cierto(s.indexOf('-v L=4.500') !== -1, 'el trozo encadenado no pide el solape al calcular su velocidad');
    cierto(s.indexOf('trim=duration=4.500') !== -1, 'el trozo encadenado no acaba durando lo que solapa');
    // Y el desplazamiento lo coloca medio segundo antes de que acabe el anterior.
    cierto(s.indexOf('offset=5.500') !== -1, 'el encadenado no arranca donde debe');
  });

  comprobar('el corto tiene un final: el último plano deja de tocar', () => {
    // Lo que vio el usuario en su primer montaje: «la música termina de una
    // forma suave, perfecta, pero los personajes siguen moviendo los
    // instrumentos como si estuvieran tocando, y ya está en silencio».
    //
    // Ningún clip sabía que era el último: todos pedían lo mismo, movimiento
    // sostenido de interpretación. La película se quedaba sin final.
    const p = nuevo();
    const clips = p.assets.filter((a) => a.kind === 'clip');
    const conFinal = clips.filter((a) => /EL PLANO DE CIERRE/.test(a.spec.prompt));
    igual(conFinal.length, 1, 'tiene que pedir el final exactamente un clip');

    // Y es el último que se VE. Antes NO lo era: el último hueco lo ocupaba un
    // plano REUTILIZADO de la apertura —«el hueco de cierre rima con la imagen
    // de apertura»— y en la apertura se está tocando. Por eso pedirle al último
    // clip que dejara de tocar no arreglaba nada: un mismo clip no puede estar
    // tocando en el minuto uno y no tocando al final.
    const ultimo = plan.timeline[plan.timeline.length - 1];
    igual(conFinal[0].id, ultimo.clipId, 'el final se le pide a un clip que no cierra la película');
    cierto(!ultimo.reused, 'el corto sigue cerrando con material reutilizado de otro momento');

    // El plano de cierre es SUYO y no sale en ningún otro sitio.
    const veces = plan.timeline.filter((t) => t.shotId === ultimo.shotId).length;
    igual(veces, 1, 'el plano de cierre se reutiliza en otro hueco, donde sí debería tocar');

    const prompt = conFinal[0].spec.prompt;
    cierto(/NO TOCA EN NINGÚN MOMENTO/.test(prompt), 'no prohíbe tocar en el clip final');
    cierto(/instrumento sigue bajado/.test(prompt), 'no exige el instrumento bajado');
    cierto(!/la película se está apagando/.test(prompt),
      'el clip del cierre habla del momento, y ahora también sale a mitad de corto');
    // Y su IMAGEN ya lo enseña quieto: ahí está la diferencia con el intento
    // anterior. El vídeo no tiene que inventarse la transición de tocar a no
    // tocar, porque su fotograma de partida ya es el de después.
    const imagen = p.assets.find((a) => a.id === ultimo.shotId + '_image');
    cierto(imagen, 'el plano de cierre no tiene imagen propia');
    cierto(/NO ESTÁ TOCANDO/.test(imagen.spec.prompt), 'la imagen del cierre no dice que no toca');
    cierto(/BAJADO y en reposo/.test(imagen.spec.prompt), 'la imagen del cierre no baja el instrumento');
    // Ni a la imagen ni al clip del cierre se les pide intensidad de toque: es
    // el bloque que ata el gesto a la música, y aquí no hay gesto que atar.
    cierto(!/TIENEN QUE PEGAR/.test(imagen.spec.prompt), 'a la imagen del cierre se le pide intensidad de toque');
    cierto(!/TIENEN QUE PEGAR/.test(prompt), 'al clip del cierre se le pide intensidad de toque');

    // Los demás siguen pidiendo movimiento sostenido: si todos cerraran, el
    // corto entero sería un desfile de finales.
    for (const c of clips) {
      if (c.id === ultimo.clipId) continue;
      cierto(/Movimiento contenido/.test(c.spec.prompt), 'a un clip normal le falta el movimiento: ' + c.id);
    }
  });

  comprobar('la imagen se apaga con la música, no después', () => {
    // El fundido final era de 1,6 s y Lyria resuelve la pieza a lo largo de los
    // últimos cinco o seis. La imagen seguía a pleno brillo con la música ya
    // casi apagada.
    const s = montaje.construirScript(
      [
        { local: 'a.mp4', durationSec: 8, transitionIn: 'fade_in' },
        { local: 'b.mp4', durationSec: 8, transitionIn: 'cut' },
      ],
      'm.wav', 'salida.mp4',
    );
    // LOS DOS FUNDIDOS SON DISTINTOS A PROPÓSITO. El de la IMAGEN es largo: la
    // pieza resuelve a lo largo de varios segundos y el negro tiene que entrar
    // con ella. El del AUDIO es corto porque la pieza YA se apaga sola —incluso
    // deja dos o tres segundos de silencio al final del archivo— y bajarle
    // encima otro fundido largo era apagar dos veces lo mismo.
    const audioOut = /afade=t=out:st=([0-9.]+):d=([0-9.]+)/.exec(s);
    cierto(audioOut, 'no hay fundido de salida en el audio');
    const videoOuts = s.match(/(?:^|[^a])fade=t=out:st=([0-9.]+):d=([0-9.]+)/g) || [];
    cierto(videoOuts.length, 'no hay fundido de salida en la imagen');

    const durVideo = Number(/d=([0-9.]+)/.exec(videoOuts[videoOuts.length - 1])[1]);
    const durAudio = Number(audioOut[2]);
    cierto(durVideo >= 3, 'la imagen se apaga en sólo ' + durVideo + ' s: la música tarda más en resolverse');
    cierto(durAudio <= 1.5,
      'el audio se apaga durante ' + durAudio + ' s encima de una pieza que ya termina sola');
    cierto(durVideo > durAudio, 'la imagen debería apagarse más despacio que la música');
  });

  comprobar('el paquete de descarga es un ZIP que se puede abrir', () => {
    // «Descargar un zip donde venga el MP4 y venga un archivo de texto con el
    // nombre, la descripción y los hashtags, solamente de copiar y pegar.»
    const mp4 = Buffer.alloc(5000, 7);
    const texto = zip.hojaDeTexto({
      title: 'Susurros de Violín',
      description: 'Dos intérpretes en una azotea al anochecer.',
      hashtags: ['#Violin', '#AIMusic'],
    });
    const paquete = zip.crearZip([{ nombre: 'corto.mp4', bytes: mp4 }, { nombre: 'corto.txt', bytes: texto }]);

    // Las firmas que hacen que un ZIP sea un ZIP.
    igual(paquete.readUInt32LE(0), 0x04034b50, 'no empieza por la firma de un ZIP');
    igual(paquete.readUInt32LE(paquete.length - 22), 0x06054b50, 'no termina con el índice');
    igual(paquete.readUInt16LE(paquete.length - 22 + 10), 2, 'el índice no dice que hay dos archivos');
    // El MP4 va dentro entero y sin comprimir: comprimir un vídeo no ahorra
    // nada y cuesta segundos de función.
    cierto(paquete.length > mp4.length + texto.length, 'el paquete es más pequeño que su contenido');
    igual(paquete.readUInt16LE(8), 0, 'el método debería ser «guardar sin comprimir»');
    // Y la suma de comprobación tiene que cuadrar, o el descompresor avisa de
    // que el archivo está dañado.
    igual(paquete.readUInt32LE(14), zip.crc32(mp4), 'la suma de comprobación del MP4 no cuadra');
    // Los nombres en UTF-8, o los acentos se rompen al abrirlo en Windows.
    igual(paquete.readUInt16LE(6) & 0x0800, 0x0800, 'no está marcada la bandera de UTF-8');

    // La hoja lleva las tres cosas y además todo junto, que es lo que se pega.
    const t = texto.toString('utf8');
    cierto(/Susurros de Violín/.test(t), 'falta el título');
    cierto(/azotea al anochecer/.test(t), 'falta la descripción');
    cierto(/#Violin #AIMusic/.test(t), 'faltan los hashtags');
    cierto(/TODO JUNTO/.test(t), 'falta el bloque de copiar y pegar');
    // El BOM son TRES bytes en UTF-8: EF BB BF.
    igual([texto[0], texto[1], texto[2]], [0xef, 0xbb, 0xbf],
      'sin BOM, el Bloc de notas de Windows rompe los acentos');

    // Y el nombre del archivo sale limpio de acentos y espacios.
    igual(zip.nombreSeguro('Susurros de Violín'), 'Susurros_de_Violin', 'nombre mal saneado');
    igual(zip.nombreSeguro('  ///  '), 'corto', 'un título imposible debería caer en el nombre por defecto');
  });

  comprobar('ninguna junta va a hueso: todos los cortes llevan cruce', () => {
    // Lo primero que notó el usuario al ver su corto montado: «donde se unen
    // las imágenes, algunos no les puso ningún efecto, se nota el salto, se
    // nota muy brusco». Dos planos generados por separado no comparten grano ni
    // luz exacta, así que un corte a hueso entre ellos parece un fallo.
    const s = montaje.construirScript(
      [
        { local: 'a.mp4', durationSec: 8, transitionIn: 'fade_in' },
        { local: 'b.mp4', durationSec: 8, transitionIn: 'cut' },
        { local: 'c.mp4', durationSec: 8, transitionIn: 'cut' },
      ],
      'm.wav', 'salida.mp4',
    );
    igual((s.match(/concat=n=2/g) || []).length, 0, 'queda una junta pegada a hueso');
    igual((s.match(/xfade=transition=fade/g) || []).length, 2, 'faltan cruces en los cortes');
    // Corto suave, no encadenado: dos décimas, no medio segundo. Un corte tiene
    // que seguir pareciendo un corte.
    cierto(/duration=0\.200/.test(s), 'el corte suave no dura dos décimas');

    // Y el cruce NO le roba segundos a la película: cada trozo se pide más
    // largo justo lo que se solapa, así que los dos que cruzan piden 8,2.
    const largos = (s.match(/trim=duration=([0-9.]+)/g) || [])
      .map((x) => Number(x.replace('trim=duration=', '')));
    igual(largos, [8, 8.2, 8.2], 'los trozos no piden el cruce de más');
  });

  comprobar('todos los trozos comparten base de tiempo', () => {
    // `concat` cambia la base de tiempo del resultado y `xfade` se niega a
    // mezclar dos entradas con bases distintas. La primera vez que un
    // encadenado venía detrás de un corte, ffmpeg moría con "timebase do not
    // match" — y solo pasaba en películas con las dos cosas.
    const s = montaje.construirScript(
      [
        { local: 'a.mp4', durationSec: 5, transitionIn: 'fade_in' },
        // El paso a negro es la única junta que va pegada con `concat`: ahí la
        // separación entre planos la hace el propio negro.
        { local: 'b.mp4', durationSec: 5, transitionIn: 'dip_to_black' },
        { local: 'a.mp4', durationSec: 5, transitionIn: 'dissolve' },
      ],
      'm.wav', 'salida.mp4',
    );
    const concats = (s.match(/concat=n=2/g) || []).length;
    const settb = (s.match(/settb=AVTB/g) || []).length;
    cierto(concats >= 1, 'no hay ningún corte que comprobar');
    // Uno por trozo más uno por cada unión.
    cierto(settb >= 3 + concats, 'faltan normalizaciones de base de tiempo');
  });

  comprobar('un clip que no encaja se retima, no se recorta ni se congela', () => {
    // Veo no siempre devuelve los segundos que se le piden, y un plano
    // reutilizado ocupa a veces un hueco más largo que aquel para el que se
    // generó. Recortar tira el final del plano; congelar el último fotograma
    // canta. Se cambia la velocidad, que conserva el plano entero y solo
    // altera el ritmo.
    const s = montaje.construirScript(
      [{ local: 'a.mp4', durationSec: 7, transitionIn: 'fade_in' }],
      'm.wav', 'salida.mp4',
    );
    // La duración real se mide en el momento del montaje, no al escribir el
    // script: aquí todavía no se sabe cuánto dura el clip.
    cierto(s.indexOf('duracion() {') !== -1, 'no mide la duración real del clip');
    cierto(s.indexOf('ffprobe') !== -1, 'no usa ffprobe para medir');
    cierto(s.indexOf('-v L=7.000') !== -1, 'no calcula la velocidad contra el hueco');
    cierto(s.indexOf('setpts=PTS*${R0}') !== -1, 'no aplica la velocidad calculada');
    // Y no hay ningún recorte del principio: el plano entra entero.
    cierto(s.indexOf('trim=start=0:duration=') === -1, 'sigue recortando el clip por el principio');
    // El congelado sigue existiendo como red de seguridad para el caso extremo
    // en que ni al doble de lento se llegue, pero ya no es el plan.
    cierto(s.indexOf('tpad=stop_mode=clone') !== -1, 'falta la red de seguridad');
    cierto(s.indexOf('trim=duration=7.000') !== -1, 'no fuerza la duración exacta');
  });

  comprobar('lo que sobra se recorta; sólo se retima lo que falta', () => {
    // Desde que todos los clips se piden de ocho segundos, lo normal es que
    // SOBREN. Y acelerar un plano al doble para meterlo en un hueco de cuatro
    // segundos se ve a la legua, mientras que recortar no se nota.
    const s = montaje.construirScript(
      [{ local: 'a.mp4', durationSec: 8, transitionIn: 'fade_in' }],
      'm.wav', 'salida.mp4',
    );
    cierto(s.indexOf('if(r<1)r=1') !== -1, 'un clip que sobra se está acelerando en vez de recortar');
    cierto(s.indexOf('if(r>2)r=2') !== -1, 'no limita la ralentización de un clip que falta');
    cierto(s.indexOf('trim=duration=') !== -1, 'no hay recorte a la duración del hueco');
    // Y si la medición fallara y devolviera cero, no se divide por cero.
    cierto(s.indexOf('if(C<=0)C=L') !== -1, 'una medición vacía rompería el cálculo');
  });

  comprobar('ni un segundo pagado se queda fuera de la pantalla', () => {
    // La regla, en palabras del usuario: «hay que aprovechar los ocho segundos
    // que se generan, y mucho menos recortarlo, porque entonces estaríamos
    // desperdiciando dinero generando segundos que se van a perder».
    //
    // Ocho segundos de Veo cuestan lo mismo que cuatro —se paga por vídeo, no
    // por segundo— así que un hueco de cuatro es pagar ocho y tirar cuatro.
    const { MAX_CLIP_SECONDS } = require(path.join(RAIZ, 'api/_lib/constantes.js'));
    for (const dur of [60, 120, 180]) {
      const e = productor.planStructure(dur);
      const clips = e.shots.flatMap((x) => x.clips);

      // Lo más largo que cada clip llega a estar en pantalla.
      const enPantalla = new Map();
      for (const t of e.timeline) {
        enPantalla.set(t.clipId, Math.max(enPantalla.get(t.clipId) || 0, t.durationSec));
      }
      for (const c of clips) {
        igual(enPantalla.get(c.id), c.durationSec,
          'del clip ' + c.label + ' de ' + dur + ' s se pagan ' + c.durationSec +
          ' s y sólo se ven ' + (enPantalla.get(c.id) || 0));
      }

      // Y el único hueco que puede ser más corto es el último, y tiene que
      // estar ocupado por un plano que ya se vio entero.
      const cortos = e.timeline.filter((t) => t.durationSec < MAX_CLIP_SECONDS);
      for (const t of cortos) {
        cierto(t.reused, 'hueco corto de ' + t.durationSec + ' s con material nuevo en ' + dur + ' s');
      }
      cierto(cortos.length <= 1, 'más de un hueco corto en ' + dur + ' s');
    }
  });

  comprobar('todos los clips se piden al máximo que da Veo', () => {
    // Antes cada clip se pedía del largo exacto de su hueco: un clímax de
    // cuatro segundos generaba cuatro segundos. Con la mitad del corto montada
    // con material repetido, eso deja sin metraje a la segunda aparición.
    const { MAX_CLIP_SECONDS } = require(path.join(RAIZ, 'api/_lib/constantes.js'));
    for (const dur of [60, 120, 180]) {
      const e = productor.planStructure(dur);
      const clips = e.shots.flatMap((x) => x.clips);
      cierto(clips.length > 0, 'sin clips en ' + dur + ' s');
      for (const c of clips) {
        igual(c.durationSec, MAX_CLIP_SECONDS, 'clip corto en ' + dur + ' s: ' + c.label);
      }
      // Y sigue habiendo material de sobra para el hueco más largo de su toma.
      for (const shot of e.shots) {
        const generado = shot.clips.reduce((a, c) => a + c.durationSec, 0);
        cierto(generado >= shot.durationSec,
          'la toma ' + shot.id + ' necesita ' + shot.durationSec + ' s y sólo se generan ' + generado);
      }
    }
  });

  comprobar('un clip repetido se descarga una sola vez', () => {
    const s = montaje.construirScript(
      [
        { local: 'a.mp4', durationSec: 4, transitionIn: 'fade_in' },
        { local: 'b.mp4', durationSec: 4, transitionIn: 'cut' },
        { local: 'a.mp4', durationSec: 4, transitionIn: 'cut' },
      ],
      'm.wav', 'salida.mp4',
    );
    // El mismo archivo se abre tres veces como entrada de ffmpeg —eso es
    // gratis— pero la descarga desde el bucket ocurre una sola vez, porque
    // `lanzarMontaje` lo mapea a un único nombre local. Aquí se comprueba lo
    // que corresponde al script: los tres cortes están en la película.
    const aperturas = (s.match(/-i 'a\.mp4'/g) || []).length;
    igual(aperturas, 2, 'el clip repetido no aparece en sus dos huecos');
    const uniones = (s.match(/concat=n=2|xfade=/g) || []).length;
    igual(uniones, 2, 'faltan uniones entre los tres cortes');
  });

  // ── El audio ──
  console.log('\nEl audio');

  comprobar('unir fragmentos da exactamente la duración pedida', () => {
    const sr = 44100;
    const tono = (f, seg) => {
      const n = sr * seg;
      const m = new Float32Array(n);
      for (let i = 0; i < n; i++) m[i] = 0.6 * Math.sin((2 * Math.PI * f * i) / sr);
      return audio.encodeWav(m, sr);
    };
    const unido = audio.unirFragmentos([tono(220, 10), tono(330, 10)], { duracionSec: 15 });
    const d = audio.decodeWav(unido);
    igual(Number((d.samples.length / d.sampleRate).toFixed(3)), 15, 'duración');
  });

  comprobar('las juntas no dan un salto audible', () => {
    const sr = 44100;
    // Dos tonos en oposición de fase: pegados a hueso el salto sería enorme.
    const tono = (f, fase) => {
      const n = sr * 6;
      const m = new Float32Array(n);
      for (let i = 0; i < n; i++) m[i] = 0.8 * Math.sin((2 * Math.PI * f * i) / sr + fase);
      return audio.encodeWav(m, sr);
    };
    const d = audio.decodeWav(audio.unirFragmentos([tono(330, 0), tono(330, Math.PI)], { duracionSec: 11 }));
    let salto = 0;
    for (let i = 1; i < d.samples.length; i++) {
      salto = Math.max(salto, Math.abs(d.samples[i] - d.samples[i - 1]));
    }
    cierto(salto < 0.1, 'salto máximo entre muestras: ' + salto.toFixed(4) + ' (debería ser pequeño)');
  });

  comprobar('«pentatónica menor» no se confunde con «menor»', () => {
    const penta = audio.parseScale('pentatónica menor', 'Re');
    const menor = audio.parseScale('menor natural', 'Re');
    cierto(JSON.stringify(penta) !== JSON.stringify(menor), 'las dos escalas salen iguales');
    igual(penta.length, 5, 'notas de la pentatónica');
  });

  // ── Resumen ──
  console.log('');
  if (fallos.length) {
    console.log(fallos.length + ' FALLOS de ' + (pasadas + fallos.length) + ' comprobaciones\n');
    for (const f of fallos) console.log('  ✗ ' + f.nombre + '\n      ' + f.error);
    console.log('');
    process.exit(1);
  }
  console.log(pasadas + ' comprobaciones, todas correctas.\n');
}

principal().catch((e) => {
  console.error('\nLas pruebas no llegaron a terminar: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
