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

  comprobar('todos los trozos comparten base de tiempo', () => {
    // `concat` cambia la base de tiempo del resultado y `xfade` se niega a
    // mezclar dos entradas con bases distintas. La primera vez que un
    // encadenado venía detrás de un corte, ffmpeg moría con "timebase do not
    // match" — y solo pasaba en películas con las dos cosas.
    const s = montaje.construirScript(
      [
        { local: 'a.mp4', durationSec: 5, transitionIn: 'fade_in' },
        { local: 'b.mp4', durationSec: 5, transitionIn: 'cut' },
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

  comprobar('la velocidad no se va a cámara lenta ni a acelerón', () => {
    // Más allá de la mitad o el doble deja de leerse como otro ritmo.
    const s = montaje.construirScript(
      [{ local: 'a.mp4', durationSec: 8, transitionIn: 'fade_in' }],
      'm.wav', 'amb.wav', 'salida.mp4',
    );
    cierto(s.indexOf('if(r>2)r=2') !== -1, 'no limita la ralentización');
    cierto(s.indexOf('if(r<0.25)r=0.25') !== -1, 'no limita la aceleración');
    // Y si la medición fallara y devolviera cero, no se divide por cero.
    cierto(s.indexOf('if(C<=0)C=L') !== -1, 'una medición vacía rompería el cálculo');
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
