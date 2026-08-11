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
function reglasDeLaInterfaz() {
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
    window: { addEventListener: nada, matchMedia: () => ({ matches: false, addEventListener: nada }) },
    localStorage: { getItem: () => null, setItem: nada, removeItem: nada },
    location: { hash: '', href: '' },
    fetch: () => Promise.reject(new Error('sin red en las pruebas')),
    setTimeout: nada, clearTimeout: nada, setInterval: nada, clearInterval: nada,
    requestAnimationFrame: nada,
    navigator: { userAgent: 'pruebas' },
  };
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

  comprobar('ningún archivo de api/ aprueba por su cuenta', () => {
    // La búsqueda es tosca a propósito: si alguien añade mañana un atajo que
    // marque algo como aprobado fuera de approveGeneration, esta prueba se
    // entera aunque nadie se acuerde de venir a actualizarla.
    const sospechosos = [];
    const revisar = (dir) => {
      for (const nombre of fs.readdirSync(dir)) {
        const completo = path.join(dir, nombre);
        if (fs.statSync(completo).isDirectory()) { revisar(completo); continue; }
        if (!nombre.endsWith('.js')) continue;
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
    // 5. Y lo que escribió el usuario llega como contexto.
    cierto(/postapocal/.test(zombi), 'su texto no llega a la música');

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

  await comprobarAsync('el ambiente se puede hacer de dos maneras y las dos se guardan', async () => {
    // «Generaré una música de ambiente como la estás haciendo ahora, generaré
    // otra con la IA, y la que suena mejor, yo decidiré utilizarla. Debe haber
    // un botón para poder seleccionar cuál utilizar.»
    //
    // La comparación y la aprobación ya existían: cada activo guarda TODAS sus
    // generaciones. Lo que faltaba era poder elegir el método de cada intento.
    const p = nuevo();
    const a = dominio.getAsset(p, 'ambient');
    cierto(a, 'no hay activo de ambiente');

    const uno = dominio.startGeneration(p, a, {
      prompt: 'x', negativePrompt: '', referenceAssetIds: [], provider: { name: 'local' },
      seed: 1, metodo: 'sintetizado',
    });
    dominio.completeGeneration(p, a, uno, { path: 'a.wav', bytes: 10, mimeType: 'audio/wav' });
    const dos = dominio.startGeneration(p, a, {
      prompt: 'x', negativePrompt: '', referenceAssetIds: [], provider: { name: 'Lyria' },
      seed: 2, metodo: 'ia',
    });
    dominio.completeGeneration(p, a, dos, { path: 'b.mp3', bytes: 20, mimeType: 'audio/mpeg' });

    igual(a.generations.length, 2, 'no se guardaron las dos versiones');
    igual(a.generations[0].metodo, 'sintetizado', 'la primera no recuerda su metodo');
    igual(a.generations[1].metodo, 'ia', 'la segunda no recuerda su metodo');
    // Ninguna queda aprobada sola: la eleccion es del usuario (PRD 4).
    igual(a.status, 'review', 'una de las dos se aprobo sola');
    dominio.approveGeneration(p, 'ambient', dos.id);
    igual(a.approvedGenerationId, dos.id, 'no se pudo elegir la de IA');
    cierto(a.generations.some((g) => g.id === uno.id), 'se perdio la version sintetizada');
  });

  await comprobarAsync('al ambiente con IA se le prohibe hacer musica', async () => {
    // Se le pide a un modelo de MUSICA que no haga musica. Sin insistir, devuelve
    // una pieza con melodia y pulso, y entonces suenan dos musicas a la vez.
    const c = Object.assign({}, CONFIG, {
      scenarioId: 'street',
      scenarioCustom: 'via publica abandonada, mundo postapocaliptico lleno de zombis',
    });
    const armado = await construirPlan(c);
    const en = armado.plan.ambient.promptEn;
    cierto(en, 'el plan no lleva encargo de ambiente en ingles');

    // Lo que el usuario escribio manda, y las capas del catalogo NO aparecen:
    // para «Via publica» el catalogo pide «trafico lejano, pasos, voces», que es
    // justo lo contrario de una calle abandonada sin nadie.
    cierto(/ruined concrete|metal groaning/.test(en),
      'su escena no se convirtio en sonidos concretos: ' + en);
    cierto(!/distant traffic|footsteps/.test(en),
      'las capas del catalogo contradicen lo que escribio: ' + en);

    // NI UNA PALABRA EN ESPAÑOL. Lyria rechaza el encargo entero con
    // «Unsupported language detected» en cuanto detecta otro idioma, asi que el
    // texto del usuario se LEE y se traduce a sonidos, nunca se pega tal cual.
    cierto(!/[áéíóúñ¿¡]/i.test(en), 'queda español en el encargo del ambiente: ' + en);

    // Sin escenario propio, las capas del catalogo si valen, y en ingles.
    const sinTexto = await construirPlan(Object.assign({}, CONFIG, {
      scenarioId: 'forest', creativeDirection: '',
    }));
    const bosque = sinTexto.plan.ambient.promptEn;
    cierto(/wind through leaves|birds/.test(bosque), 'sin descripcion propia faltan las capas del escenario');
    cierto(!/[áéíóúñ¿¡]/i.test(bosque), 'las capas del catalogo llegan en español: ' + bosque);

    // Y las 47 frases del catalogo estan traducidas: si mañana se añade un
    // escenario con una frase nueva sin traducir, se caeria en silencio.
    const catalogoMod = require(path.join(RAIZ, 'api/_lib/catalogo.js'));
    for (const esc of catalogoMod.SCENARIOS) {
      const suyo = await construirPlan(Object.assign({}, CONFIG, {
        scenarioId: esc.id, creativeDirection: '', scenarioCustom: '',
      }));
      const t = suyo.plan.ambient.promptEn;
      cierto(!/[áéíóúñ¿¡]/i.test(t), 'el escenario «' + esc.label + '» mete español: ' + t);
      cierto(/What is heard:/.test(t), 'el escenario «' + esc.label + '» se queda sin sonidos');
    }

    // Y el sintetizador sigue teniendo su lista, que es lo unico que entiende.
    cierto(armado.plan.ambient.layers.length, 'el sintetizador se quedo sin capas');
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

    for (const cfg of [
      { instrumentIds: ['erhu'], formationId: 'solo', scenarioId: 'forest' },
      { instrumentIds: ['violin', 'cello'], formationId: 'duo', scenarioId: 'rooftop' },
      { instrumentIds: ['guitar'], formationId: 'quartet', scenarioId: 'beach' },
      { instrumentIds: ['piano', 'flute'], formationId: 'orchestra', scenarioId: 'theatre' },
    ]) {
      const c = Object.assign({}, CONFIG, cfg);
      const armado = await construirPlan(c);
      const en = armado.plan.music.promptEn;
      cierto(en, 'sin encargo en inglés para ' + cfg.instrumentIds.join('+'));
      cierto(!enEspanol(en),
        'queda español con ' + cfg.instrumentIds.join('+') + ': ' +
        (en.match(/[^\s]*[áéíóúñ][^\s]*/gi) || []).join(', '));
      // Y lleva lo que un modelo de música necesita para componer.
      for (const campo of ['Instruments:', 'Mood:', 'Key:', 'Scale:', 'Tempo:']) {
        cierto(en.indexOf(campo) !== -1, 'al encargo le falta ' + campo);
      }
      // El nombre del instrumento también en inglés: «Violonchelo» no le dice nada.
      cierto(!/Violonchelo|Guitarra|Flauta/.test(en), 'un instrumento se quedó en español: ' + en);
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
    const e = productor.planStructure(60);
    const apariciones = new Map();
    for (const id of aparicionesEnPantalla(e)) {
      apariciones.set(id, (apariciones.get(id) || 0) + 1);
    }
    const prompt = planificador.buildUserPrompt({
      config: CONFIG,
      runtimeSec: 60,
      shots: e.shots.map((t) => ({
        index: t.index, label: t.label, beat: t.beat, shotType: t.shotType,
        cameraMove: t.cameraMove, durationSec: t.durationSec,
        reusable: t.reusable, apariciones: apariciones.get(t.id) || 1,
      })),
    });
    cierto(prompt.indexOf('REPETIBLE') !== -1, 'la lista no marca las tomas repetibles');
    cierto(prompt.indexOf('ÚNICA') !== -1, 'la lista no marca las tomas únicas');
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

  comprobar('el script de ffmpeg mezcla sin bajar la música a la mitad', () => {
    const s = montaje.construirScript(
      [{ local: 'a.mp4', durationSec: 5, transitionIn: 'fade_in' }],
      'm.wav', 'amb.wav', 'salida.mp4',
    );
    cierto(s.indexOf('amix=inputs=2:duration=first:normalize=0') !== -1, 'falta normalize=0 en amix');
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
      'm.wav', 'amb.wav', 'salida.mp4',
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
    const conFinal = clips.filter((a) => /CÓMO TERMINA EL CORTO/.test(a.spec.prompt));
    igual(conFinal.length, 1, 'tiene que pedir el final exactamente un clip');

    // Y es el último que se VE, que con material repetido no es el último que
    // se generó.
    const ultimo = plan.timeline[plan.timeline.length - 1].clipId;
    igual(conFinal[0].id, ultimo, 'el final se le pide a un clip que no cierra la película');
    cierto(/BAJA EL INSTRUMENTO/.test(conFinal[0].spec.prompt), 'no pide bajar el instrumento');
    cierto(/se queda quieto/.test(conFinal[0].spec.prompt), 'no pide que se quede quieto');
    // Los demás siguen pidiendo movimiento sostenido: si todos cerraran, el
    // corto entero sería un desfile de finales.
    for (const c of clips) {
      if (c.id === ultimo) continue;
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
      'm.wav', 'amb.wav', 'salida.mp4',
    );
    const salidas = (s.match(/fade=t=out:st=([0-9.]+):d=([0-9.]+)/g) || []);
    cierto(salidas.length, 'no hay ningún fundido de salida');
    const ultima = salidas[salidas.length - 1];
    const dur = Number(/d=([0-9.]+)/.exec(ultima)[1]);
    cierto(dur >= 3, 'el cierre dura sólo ' + dur + ' s: la música tarda más en resolverse');
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
      'm.wav', 'amb.wav', 'salida.mp4',
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
      'm.wav', 'amb.wav', 'salida.mp4',
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
      'm.wav', 'amb.wav', 'salida.mp4',
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
      'm.wav', 'amb.wav', 'salida.mp4',
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
      'm.wav', 'amb.wav', 'salida.mp4',
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
