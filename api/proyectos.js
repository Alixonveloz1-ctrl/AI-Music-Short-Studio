// ════════════════════════════════════════════════════════════════
// PROYECTOS — la lista de cortos y la creación de uno nuevo.
//
//   GET   -> { proyectos: [...] }   resúmenes, del más reciente al más antiguo
//   POST  -> { proyecto, estado, avisos }   crea el corto y su plan
//
// La creación es el único sitio donde la configuración del usuario entra en
// el sistema, así que aquí se valida ENTERA. Todo lo que hay después —el
// Productor, el planificador, el Director de Arte— da por hecho que los
// identificadores existen en el catálogo y que las duraciones son una de las
// tres admitidas. Un error colado aquí no revienta ahora: revienta veinte
// segundos después, dentro de un prompt, con un mensaje que no dice nada.
// ════════════════════════════════════════════════════════════════
const { empezar, cuerpo, fallo, ErrorPeticion } = require('./_lib/http.js');
const { listarProyectos, crearProyecto } = require('./_lib/almacen.js');
const { createProject } = require('./_lib/dominio.js');
const { computeProductionStatus } = require('./_lib/progreso.js');
const { construirPlan } = require('./_lib/plan.js');
const { DURATIONS_SEC, FORMATOS, FORMATO_POR_DEFECTO } = require('./_lib/constantes.js');
const {
  INSTRUMENTS_BY_ID,
  FORMATIONS_BY_ID,
  PERFORMER_GENDERS,
  PERFORMER_TYPES_BY_ID,
  SCENARIOS_BY_ID,
  VISUAL_STYLES_BY_ID,
  MUSIC_GENRES,
} = require('./_lib/catalogo.js');
const modelos = require('./_lib/modelos.js');
const rasgos = require('./_lib/rasgos.js');

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['GET', 'POST'])) return;

  try {
    if (req.method === 'GET') {
      // listarProyectos ya devuelve los resúmenes ordenados del más reciente al
      // más antiguo, leyendo sólo los metadatos de cada documento (no los
      // proyectos enteros). Aquí no hay nada más que hacer: cualquier trabajo
      // extra en esta ruta se paga en cada vuelta a la pantalla de inicio.
      return res.status(200).json({ proyectos: await listarProyectos() });
    }

    const datos = await cuerpo(req);
    const config = validarConfiguracion(extraerConfiguracion(datos));

    const { plan, avisos } = await planificarConPresupuesto(config);
    const proyecto = createProject(config, plan);
    await crearProyecto(proyecto);

    // 201: se ha creado un recurso nuevo. Los avisos van en la misma respuesta
    // porque NO son un fallo — el caso normal es «Claude no pudo, se usó el
    // planificador interno», y el corto está igual de creado y de utilizable.
    return res.status(201).json({
      proyecto,
      estado: computeProductionStatus(proyecto),
      avisos,
    });
  } catch (e) {
    return fallo(res, e);
  }
};

// ---------------------------------------------------------------------------
// El presupuesto de tiempo
// ---------------------------------------------------------------------------

// Una función de Vercel tiene 60 segundos. El plan creativo puede llamar a
// Claude, que a veces tarda o se queda colgado, y después todavía hay que
// escribir el proyecto en el bucket. Este es el tope que se le da a la capa
// creativa; lo que sobra es el margen para guardar y contestar.
const PRESUPUESTO_PLAN_MS = 38000;

/**
 * El plan, con reloj.
 *
 * POR QUÉ: quedarse sin tiempo dentro de `construirPlan` significa que el
 * usuario rellena la pantalla entera, espera un minuto y recibe un error de
 * plataforma sin proyecto y sin explicación. Con respaldo, recibe su corto y
 * un aviso de una línea. El plan determinista es un modo de trabajo válido —
 * existe precisamente para esto—, así que perder la capa creativa de Claude es
 * infinitamente mejor que perder la petición.
 */
async function planificarConPresupuesto(config) {
  let temporizador = null;
  const reloj = new Promise((resolve) => {
    temporizador = setTimeout(() => resolve(null), PRESUPUESTO_PLAN_MS);
  });

  try {
    const resultado = await Promise.race([construirPlan(config), reloj]);
    if (resultado) return resultado;
  } finally {
    clearTimeout(temporizador);
  }

  // Se acabó el tiempo: se rehace el plan por la vía determinista, que es pura
  // aritmética y contesta al instante. La llamada a Claude que sigue en vuelo
  // se abandona; su resultado ya no le sirve a nadie.
  const respaldo = await planDeterminista(config);
  respaldo.avisos.unshift(
    'El planificador de Claude tardó demasiado (más de ' + Math.round(PRESUPUESTO_PLAN_MS / 1000) +
      ' s). Se ha usado el planificador interno para no perder el proyecto.',
  );
  return respaldo;
}

/**
 * `construirPlan` sin pasar por Claude.
 *
 * El planificador elige la vía por la presencia de ANTHROPIC_API_KEY y
 * `construirPlan` no acepta opciones, así que la clave se esconde durante la
 * llamada. Entre esconderla y devolverla NO hay ningún `await`: Node es de un
 * solo hilo, así que ninguna otra petición puede ver el entorno a medias.
 */
async function planDeterminista(config) {
  const guardada = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let promesa;
  try {
    promesa = construirPlan(config);
  } finally {
    if (guardada !== undefined) process.env.ANTHROPIC_API_KEY = guardada;
  }
  return promesa;
}

// ---------------------------------------------------------------------------
// La configuración que manda la interfaz
// ---------------------------------------------------------------------------

/**
 * La configuración puede llegar anidada o suelta en la raíz del cuerpo: la
 * interfaz manda las dos formas a la vez para no depender del nombre exacto.
 * Se prefiere la anidada, y si no hay, el cuerpo entero.
 */
function extraerConfiguracion(datos) {
  const d = datos || {};
  for (const clave of ['config', 'configuracion', 'configuration']) {
    if (d[clave] && typeof d[clave] === 'object' && !Array.isArray(d[clave])) return d[clave];
  }
  return d;
}

function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

function malaPeticion(mensaje) {
  return new ErrorPeticion(400, mensaje);
}

/**
 * Valida y NORMALIZA la configuración: devuelve un objeto nuevo con sólo los
 * campos conocidos.
 *
 * Se copia campo a campo en vez de guardar lo que llegó porque esta
 * configuración se escribe tal cual en el proyecto y se lee durante toda la
 * producción; colar ahí claves de más significa arrastrarlas para siempre.
 *
 * Las reglas son las mismas que tenía el esquema de validación anterior
 * del PRD, incluidas las cruzadas: la concordancia
 * entre intérprete y tipo visual, y los textos obligatorios cuando se elige
 * «Otro». Los mensajes son concretos a propósito: desde el móvil, «datos no
 * válidos» no se puede arreglar.
 */
function validarConfiguracion(bruto) {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw malaPeticion('Falta la configuración del corto.');
  }

  // --- Instrumentos (PRD §6) ---
  const instrumentIds = bruto.instrumentIds;
  if (!Array.isArray(instrumentIds) || instrumentIds.length === 0) {
    throw malaPeticion('Selecciona al menos un instrumento.');
  }
  if (instrumentIds.length > 8) {
    throw malaPeticion('Máximo 8 instrumentos.');
  }
  const vistos = new Set();
  for (const id of instrumentIds) {
    const clave = texto(id);
    if (!clave) throw malaPeticion('Hay un instrumento vacío en la selección.');
    if (!INSTRUMENTS_BY_ID.has(clave)) {
      throw malaPeticion('Instrumento desconocido: "' + clave + '".');
    }
    if (vistos.has(clave)) {
      throw malaPeticion('El instrumento "' + INSTRUMENTS_BY_ID.get(clave).name + '" está repetido.');
    }
    vistos.add(clave);
  }

  // --- Formación (PRD §7) ---
  const formationId = texto(bruto.formationId);
  if (!formationId) throw malaPeticion('Falta la formación.');
  if (!FORMATIONS_BY_ID.has(formationId)) {
    throw malaPeticion('Formación desconocida: "' + formationId + '".');
  }

  // --- Intérprete (PRD §8) ---
  const performerGenderId = texto(bruto.performerGenderId);
  if (!performerGenderId) throw malaPeticion('Falta el tipo de intérprete.');
  if (!PERFORMER_GENDERS.some((g) => g.id === performerGenderId)) {
    throw malaPeticion('Tipo de intérprete desconocido: "' + performerGenderId + '".');
  }

  const performerTypeId = texto(bruto.performerTypeId);
  if (!performerTypeId) throw malaPeticion('Falta el tipo visual del intérprete.');
  const performerType = PERFORMER_TYPES_BY_ID.get(performerTypeId);
  if (!performerType) {
    throw malaPeticion('Tipo visual desconocido: "' + performerTypeId + '".');
  }
  // Regla cruzada: «Hombre adulto» con intérprete femenino describiría a una
  // persona distinta en cada prompt y rompería la continuidad del personaje.
  if (!performerType.genderIds.includes(performerGenderId)) {
    throw malaPeticion(
      'El tipo visual "' + performerType.label + '" no corresponde al intérprete seleccionado.',
    );
  }

  // --- Escenario (PRD §9) ---
  const scenarioId = texto(bruto.scenarioId);
  if (!scenarioId) throw malaPeticion('Falta el escenario.');
  if (!SCENARIOS_BY_ID.has(scenarioId)) {
    throw malaPeticion('Escenario desconocido: "' + scenarioId + '".');
  }
  const scenarioCustom = texto(bruto.scenarioCustom);
  if (scenarioCustom.length > 2000) {
    throw malaPeticion('La descripción del escenario personalizado no puede pasar de 2000 caracteres.');
  }
  // Con «Otro» no hay nada en el catálogo de donde sacar el lugar: sin texto,
  // el Director de Arte no tendría escenario que describir.
  if (scenarioId === 'other' && !scenarioCustom) {
    throw malaPeticion('Describe el escenario personalizado.');
  }

  // --- Estilo visual (PRD §10) ---
  const visualStyleId = texto(bruto.visualStyleId);
  if (!visualStyleId) throw malaPeticion('Falta el estilo visual.');
  if (!VISUAL_STYLES_BY_ID.has(visualStyleId)) {
    throw malaPeticion('Estilo visual desconocido: "' + visualStyleId + '".');
  }
  const visualStyleCustom = texto(bruto.visualStyleCustom);
  if (visualStyleCustom.length > 2000) {
    throw malaPeticion('La descripción del estilo personalizado no puede pasar de 2000 caracteres.');
  }
  if (visualStyleId === 'other' && !visualStyleCustom) {
    throw malaPeticion('Describe el estilo visual personalizado.');
  }

  // --- Dirección creativa y título ---
  const creativeDirection = texto(bruto.creativeDirection);
  if (creativeDirection.length > 6000) {
    throw malaPeticion('La dirección creativa no puede pasar de 6000 caracteres.');
  }
  const titleHint = texto(bruto.titleHint);
  if (titleHint.length > 120) {
    throw malaPeticion('La sugerencia de título no puede pasar de 120 caracteres.');
  }

  // --- Duración (PRD §12) ---
  // --- Formato (vertical o apaisado) ---
  // Entra en el prompt de cada imagen y de cada clip, así que se fija al crear
  // el corto y ya no se cambia: a mitad de producción, unas tomas saldrían
  // verticales y otras apaisadas.
  const formatoId = texto(bruto.formatoId) || FORMATO_POR_DEFECTO;
  if (!FORMATOS.some((f) => f.id === formatoId)) {
    throw malaPeticion(
      'Formato desconocido: "' + formatoId + '". Elige uno de los disponibles (' +
        FORMATOS.map((f) => f.etiqueta).join(', ') + ').',
    );
  }

  const durationSec = Number(bruto.durationSec);
  if (!DURATIONS_SEC.includes(durationSec)) {
    throw malaPeticion(
      'Duración no soportada. Elige ' + DURATIONS_SEC.map((s) => s / 60 + ' min').join(', ') + '.',
    );
  }

  // --- Modelos de imagen y de vídeo ---
  //
  // Se validan aquí y se guardan en el proyecto, no se leen en cada generación:
  // así TODAS las tomas de un mismo corto salen del mismo modelo. Si el modelo
  // pudiera cambiar a mitad —porque el usuario tocó el desplegable, o porque
  // cambió una variable del despliegue—, la toma 12 no encajaría con las once
  // anteriores, y la continuidad visual es justo lo que esta herramienta cuida.
  //
  // Si no llegan, se guarda el por defecto: SIEMPRE queda escrito cuál se usó.
  const imageModelId = texto(bruto.imageModelId) || modelos.porDefectoImagen();
  if (!modelos.esImagenConocido(imageModelId)) {
    throw malaPeticion(
      'Modelo de imagen desconocido: "' + imageModelId + '". Elige uno de la lista ' +
        '(' + modelos.MODELOS_IMAGEN.map((m) => m.etiqueta).join(', ') + ').',
    );
  }

  const videoModelId = texto(bruto.videoModelId) || modelos.porDefectoVideo();
  if (!modelos.esVideoConocido(videoModelId)) {
    throw malaPeticion(
      'Modelo de vídeo desconocido: "' + videoModelId + '". Elige uno de la lista ' +
        '(' + modelos.MODELOS_VIDEO.map((m) => m.etiqueta).join(', ') + ').',
    );
  }

  // --- Fichas de personaje ---
  // Una por intérprete principal. Lo que se deja vacío lo decide el Director.
  const performers = rasgos.normalizarFichas(bruto.performers);

  // --- Género musical ---
  // 'auto' significa que lo decide el Director desde el instrumento.
  const musicGenreId = texto(bruto.musicGenreId) || 'auto';
  if (!MUSIC_GENRES.some((g) => g.id === musicGenreId)) {
    throw malaPeticion(
      'Género musical desconocido: "' + musicGenreId + '". Elige uno de la lista (' +
        MUSIC_GENRES.map((g) => g.label).join(', ') + ').',
    );
  }
  const musicGenreCustom = texto(bruto.musicGenreCustom).trim().slice(0, 200);
  if (musicGenreId === 'other' && !musicGenreCustom) {
    throw malaPeticion('Has elegido «Otro» género musical: descríbelo en el cuadro de al lado.');
  }

  const config = {
    instrumentIds: Array.from(vistos),
    musicGenreId,
    formationId,
    performerGenderId,
    performerTypeId,
    scenarioId,
    visualStyleId,
    creativeDirection,
    durationSec,
    formatoId,
    imageModelId,
    videoModelId,
  };
  // Los campos opcionales sólo se guardan si traen algo: un `scenarioCustom: ''`
  // en el proyecto se leería después como «hay escenario personalizado».
  if (scenarioCustom) config.scenarioCustom = scenarioCustom;
  if (visualStyleCustom) config.visualStyleCustom = visualStyleCustom;
  if (titleHint) config.titleHint = titleHint;
  if (performers) config.performers = performers;
  if (musicGenreCustom) config.musicGenreCustom = musicGenreCustom;

  return config;
}
