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

  comprobar('se reutiliza material en vez de generarlo todo (PRD §15, §25, §33)', () => {
    for (const segundos of [60, 120, 180]) {
      const e = productor.planStructure(segundos);
      cierto(e.timeline.length > e.shots.length, segundos + ' s: no reutiliza nada');
    }
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

  comprobar('un clip repetido se descarga una sola vez', () => {
    const s = montaje.construirScript(
      [
        { local: 'a.mp4', durationSec: 4, transitionIn: 'fade_in' },
        { local: 'b.mp4', durationSec: 4, transitionIn: 'cut' },
        { local: 'a.mp4', durationSec: 4, transitionIn: 'cut' },
      ],
      'm.wav', 'amb.wav', 'salida.mp4',
    );
    igual(s.indexOf('concat=n=3') !== -1, true, 'los tres cortes están en el concat');
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
