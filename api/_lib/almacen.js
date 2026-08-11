'use strict';

// ════════════════════════════════════════════════════════════════
// ALMACÉN — el estado de los proyectos, sobre Google Cloud Storage.
//
// La versión anterior guardaba cada proyecto en una carpeta del disco
// (data/projects/<id>/project.json) y serializaba las escrituras con un
// mutex en memoria. En Vercel eso NO funciona por dos razones distintas:
//
//   1. El disco es efímero: lo que escribe una petición desaparece.
//   2. Cada petición puede caer en una instancia distinta, así que un
//      mutex en memoria no protege nada — hay varias memorias.
//
// Así que el estado vive en el bucket y la exclusión mutua se hace con
// las precondiciones de GCS en vez de con un candado. Ver
// `modificarProyecto`, que es el sustituto directo de `withLock`.
//
// Sin dependencias: la API REST de Cloud Storage con `fetch` y el token
// que da gcp.js.
// ════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { cfg, auth, gcsUpload, gcsDelete, gcsList, signedUrl } = require('./gcp.js');

// Los módulos hermanos se cargan de forma perezosa, igual que en dominio.js y
// progreso.js: en CommonJS un require de cabecera se resuelve al cargar el
// archivo, y un ciclo entre hermanos devolvería un objeto a medio construir.
let _dominio = null;
function dominio() {
  if (!_dominio) _dominio = require('./dominio.js');
  return _dominio;
}
let _progreso = null;
function progreso() {
  if (!_progreso) _progreso = require('./progreso.js');
  return _progreso;
}

function errorDominio(mensaje, estado) {
  return new (dominio().DomainError)(mensaje, estado || 400);
}

// ---------------------------------------------------------------------------
// Rutas dentro del bucket
// ---------------------------------------------------------------------------
//
// Se conserva la estructura que ya existía (PRD §37), traducida y colgada del
// prefijo configurable, para que el bucket se pueda compartir:
//
//   <prefijo>/proyectos/<id>/proyecto.json
//   <prefijo>/proyectos/<id>/imagenes/personaje/gen_001.png
//   <prefijo>/proyectos/<id>/imagenes/<toma>/gen_002.png
//   <prefijo>/proyectos/<id>/videos/<clip>/gen_001.mp4
//   <prefijo>/proyectos/<id>/musica/gen_001.wav

//   <prefijo>/proyectos/<id>/final/corto_final.mp4
//
// Las generaciones RECHAZADAS no se borran: son el historial que el usuario
// puede volver a mirar. Sólo el puntero a la aprobada manda.

const ARCHIVO_PROYECTO = 'proyecto.json';
const CARPETA_FINAL = 'final';
const ARCHIVO_PREVISUALIZACION = 'previsualizacion.mp4';
const ARCHIVO_EXPORTACION = 'corto_final.mp4';
const ARCHIVO_METADATOS = 'corto_final.json';
// El paquete que se descarga: el MP4 y la hoja de texto en un solo archivo.
const ARCHIVO_PAQUETE = 'corto_final.zip';

// El identificador va DENTRO de una ruta de objeto. Sin validarlo, un id con
// "../" o con una barra escribiría fuera de su carpeta o encima de otro
// proyecto. Los ids que genera dominio.js son `prj_` + alfanuméricos.
const ID_SEGURO = /^[A-Za-z0-9_-]{1,64}$/;

function comprobarId(id) {
  if (typeof id !== 'string' || !ID_SEGURO.test(id)) {
    throw errorDominio(`Identificador de proyecto no válido: ${id}`, 400);
  }
  return id;
}

/** Un tramo de ruta que viene de un id de activo o de toma, saneado. */
function segmento(valor) {
  const limpio = String(valor || '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80);
  if (!limpio) throw errorDominio('Nombre de carpeta de activo vacío', 400);
  return limpio;
}

/** Carpeta raíz de todos los proyectos, sin barra final. */
function raizProyectos() {
  const bucket = cfg.bucket;
  if (!bucket) {
    throw errorDominio('GCS_OUTPUT_BUCKET no configurado en Vercel', 500);
  }
  return cfg.prefix + '/proyectos';
}

/** Carpeta de un proyecto (prefijo, sin barra final). */
function rutaProyecto(id) {
  return raizProyectos() + '/' + comprobarId(id);
}

/** El documento de estado del proyecto: la única fuente de verdad. */
function rutaProyectoJson(id) {
  return rutaProyecto(id) + '/' + ARCHIVO_PROYECTO;
}

// Carpeta relativa por tipo de activo. Los tres másteres tienen carpeta fija
// porque sólo hay uno de cada; las tomas y los clips llevan una carpeta propia
// para que sus generaciones sucesivas no se mezclen entre sí.
const CARPETA_POR_TIPO = {
  master_character: 'imagenes/personaje',
  master_environment: 'imagenes/entorno',
  master_scene: 'imagenes/escena',
  shot_image: 'imagenes',
  clip: 'videos',
  music: 'musica',
};

// Un tipo de medio, una extensión. El corto es siempre instrumental: el audio
// se guarda en WAV sin comprimir porque después se vuelve a mezclar, y volver a
// codificar un MP3 en cada pasada degrada el sonido.
const EXTENSION_POR_MEDIO = { image: '.png', video: '.mp4', audio: '.wav' };

/** Carpeta de un activo, relativa a la carpeta del proyecto. */
function carpetaActivo(activo) {
  const raiz = CARPETA_POR_TIPO[activo && activo.kind];
  if (!raiz) throw errorDominio(`Tipo de activo desconocido: ${activo && activo.kind}`, 400);
  // Una toma puede tener varios encuadres del mismo plano: mandan el shotId.
  if (activo.kind === 'shot_image') return raiz + '/' + segmento(activo.shotId || activo.id);
  if (activo.kind === 'clip') return raiz + '/' + segmento(activo.id);
  return raiz;
}

/** Extensión que le toca a un activo según su tipo de medio. */
function extensionDe(activo) {
  const { ASSET_KIND_MEDIA } = require('./constantes.js');
  const medio = ASSET_KIND_MEDIA[activo && activo.kind];
  return EXTENSION_POR_MEDIO[medio] || '.bin';
}

/** gen_001.png — se rellena con ceros para que ordenen bien alfabéticamente. */
function nombreGeneracion(indice, extension) {
  return 'gen_' + String(indice).padStart(3, '0') + (extension || '');
}

/** Ruta completa en el bucket de una generación concreta de un activo. */
function rutaGeneracion(idProyecto, activo, indice, extension) {
  const ext = extension === undefined ? extensionDe(activo) : extension;
  return rutaProyecto(idProyecto) + '/' + carpetaActivo(activo) + '/' + nombreGeneracion(indice, ext);
}

/** Ruta completa de un archivo de la entrega final. */
function rutaFinal(idProyecto, nombre) {
  return rutaProyecto(idProyecto) + '/' + CARPETA_FINAL + '/' + segmentoArchivo(nombre || ARCHIVO_EXPORTACION);
}

function segmentoArchivo(nombre) {
  const limpio = String(nombre).replace(/[^A-Za-z0-9_.-]+/g, '_');
  if (!limpio || limpio.indexOf('..') !== -1) throw errorDominio('Nombre de archivo no permitido', 400);
  return limpio;
}

/**
 * Ruta completa a partir de una ruta relativa al proyecto ("videos/x/gen_001.mp4").
 * Rechaza cualquier cosa que se salga de la carpeta del proyecto: el original
 * hacía la misma comprobación con path.resolve y aquí sigue haciendo falta,
 * porque estas rutas relativas llegan desde el cliente.
 */
function rutaMedio(idProyecto, rutaRelativa) {
  const partes = String(rutaRelativa || '').split('/').filter((p) => p !== '');
  if (!partes.length) throw errorDominio('Ruta de archivo vacía', 400);
  for (const p of partes) {
    if (p === '.' || p === '..') throw errorDominio('Ruta de archivo no permitida', 400);
  }
  return rutaProyecto(idProyecto) + '/' + partes.map(segmentoArchivo).join('/');
}

// ---------------------------------------------------------------------------
// Conflictos de versión
// ---------------------------------------------------------------------------

/**
 * POR QUÉ ESTO EXISTE, Y POR QUÉ ES LO MÁS IMPORTANTE DEL ARCHIVO.
 *
 * Escena real: el usuario aprueba una imagen mientras un clip se está
 * generando en otra petición. Las dos peticiones leyeron el proyecto casi a la
 * vez y las dos lo van a escribir entero. Sin precondición gana la que escribe
 * más tarde, y esa lleva una copia del proyecto SIN la aprobación. Resultado:
 * la aprobación desaparece sin ningún error, sin ningún aviso, y el usuario
 * cree que aprobó algo que en realidad se descartó.
 *
 * Ese es el peor fallo posible en esta herramienta: toda ella se sostiene sobre
 * "la IA propone, el usuario aprueba". Una aprobación perdida en silencio
 * rompe la única garantía que el producto da.
 *
 * La defensa: cada objeto de GCS tiene un número de `generation` que cambia en
 * cada escritura. Al escribir se manda `ifGenerationMatch=<n>`; si el objeto ya
 * no está en esa versión, GCS responde 412 y NO escribe nada. El escritor
 * perdedor se entera, vuelve a leer y reaplica su cambio sobre el estado nuevo.
 * `ifGenerationMatch=0` significa "sólo si no existe todavía".
 */
class ConflictoDeVersion extends Error {
  constructor(mensaje) {
    super(mensaje || 'El proyecto cambió mientras se guardaba');
    this.name = 'ConflictoDeVersion';
    this.conflicto = true;
    this.status = 409;
  }
}

function esConflicto(err) {
  return !!(err && (err.conflicto || err.status === 412 || err.name === 'ConflictoDeVersion'));
}

// ---------------------------------------------------------------------------
// Lectura y escritura del documento
// ---------------------------------------------------------------------------

const HOST = 'https://storage.googleapis.com';

function urlObjeto(ruta) {
  return HOST + '/storage/v1/b/' + cfg.bucket + '/o/' + encodeURIComponent(ruta);
}

/**
 * Lee el proyecto y su generación en UNA sola petición (la generación viene en
 * la cabecera x-goog-generation, no hace falta pedir los metadatos aparte).
 *
 * No se usa gcsReadText de gcp.js a propósito: aquélla devuelve null ante
 * CUALQUIER respuesta que no sea 200, así que un 403 por credenciales o un 503
 * pasajero se contarían como "el proyecto no existe". Al usuario le aparecería
 * "proyecto no encontrado" cuando su proyecto está perfectamente ahí, y desde
 * un teléfono ese diagnóstico falso no hay manera de deshacerlo. Aquí sólo el
 * 404 significa "no existe"; lo demás se lanza como error.
 *
 * Devuelve { proyecto, generacion } o null si no existe.
 */
async function leerProyecto(id) {
  const ruta = rutaProyectoJson(id);
  const { token } = await auth();
  const r = await fetch(urlObjeto(ruta) + '?alt=media', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const detalle = (await r.text().catch(() => '')).slice(0, 200);
    throw errorDominio(`No se pudo leer el proyecto ${id}: ${r.status} ${detalle}`, 502);
  }

  const texto = await r.text();
  let proyecto;
  try {
    proyecto = JSON.parse(texto);
  } catch (e) {
    throw errorDominio(`El proyecto ${id} está corrupto y no se puede leer`, 500);
  }

  jubilarSonidoAmbiental(proyecto);

  // La etapa guardada es sólo una caché. Se recalcula en cada lectura para que
  // nunca se quede vieja respecto a los activos: la etapa se deduce de qué hay
  // aprobado, y aprobar algo no debería obligar a acordarse de actualizarla.
  proyecto.currentStage = progreso().computeCurrentStage(proyecto);

  return { proyecto, generacion: r.headers.get('x-goog-generation') || null };
}

/**
 * EL SONIDO AMBIENTAL YA NO EXISTE, y los cortos de antes lo llevan dentro.
 *
 * Se quitó del producto porque no servía: el sintetizado era un ruido plano que
 * ensuciaba la música y el de IA fallaba casi siempre y, cuando salía, venía con
 * música dentro. Pero hay proyectos guardados en el bucket que tienen su activo
 * «ambient», a veces hasta aprobado.
 *
 * Se retira AL LEER, en un solo sitio, y no repartiendo comprobaciones por todo
 * el código. Así ninguna otra parte tiene que acordarse de que esto existió: ni
 * el cálculo del progreso, ni la puerta del montaje, ni la cola, ni la pantalla.
 * Para todos ellos, el ambiente no está y nunca estuvo.
 *
 * Como `modificarProyecto` lee y vuelve a guardar, el activo desaparece del
 * JSON de verdad la primera vez que se toque el corto. No se fuerza esa
 * escritura: un corto que nadie vuelve a abrir se queda como está, y da igual.
 *
 * El MP4 ya exportado sigue siendo el suyo, con su ambiente dentro. Sólo
 * cambiaría si decide volver a montarlo — que es justo lo que querrá.
 */
function jubilarSonidoAmbiental(proyecto) {
  if (!proyecto || !Array.isArray(proyecto.assets)) return;
  proyecto.assets = proyecto.assets.filter((a) => a && a.kind !== 'ambient');
  if (proyecto.plan) delete proyecto.plan.ambient;
}

async function existeProyecto(id) {
  const { token } = await auth();
  const r = await fetch(urlObjeto(rutaProyectoJson(id)) + '?fields=generation', {
    headers: { Authorization: 'Bearer ' + token },
  });
  return r.ok;
}

// Tope del registro de auditoría. Cada guardado reescribe el objeto ENTERO, así
// que un historial que crece sin límite encarece y ralentiza todas las
// escrituras siguientes, no sólo la suya.
const MAX_EVENTOS = 500;

// Los metadatos personalizados de un objeto de GCS caben en 8 KiB en total. Si
// el resumen se pasa, se guarda el proyecto sin él y el listado lo recompone
// leyendo el documento; mejor un listado más lento que un guardado que falla.
const MAX_RESUMEN = 4000;

/**
 * Guarda el proyecto con precondición y devuelve la generación NUEVA.
 *
 * `generacionEsperada`:
 *   - un número/cadena: sólo escribe si el objeto sigue en esa versión.
 *   - 0: sólo escribe si el objeto no existe todavía (creación).
 *   - null o undefined: SIN precondición. Es la vía insegura y sólo tiene
 *     sentido para tareas de mantenimiento; los endpoints deben usar
 *     `modificarProyecto`, que se encarga de esto solo.
 *
 * Lanza ConflictoDeVersion si la precondición no se cumple.
 */
async function guardarProyecto(proyecto, generacionEsperada) {
  comprobarId(proyecto && proyecto.id);
  if (proyecto.events && proyecto.events.length > MAX_EVENTOS) {
    proyecto.events = proyecto.events.slice(-MAX_EVENTOS);
  }

  const ruta = rutaProyectoJson(proyecto.id);
  // Con sangría: este archivo se acaba mirando a mano desde la consola de Google
  // Cloud cuando algo va mal, y un JSON en una sola línea ahí no se lee.
  const texto = JSON.stringify(proyecto, null, 2);

  // El resumen viaja como metadato del propio objeto, no en un archivo aparte:
  // se escribe en la MISMA petición que el documento, así que no puede quedarse
  // desincronizado ni sobrevivir a un guardado que falla a medias.
  let resumen = null;
  try {
    const json = JSON.stringify(progreso().summarizeProject(proyecto));
    if (json.length <= MAX_RESUMEN) resumen = { resumen: json };
  } catch (e) {
    // Un proyecto incompleto todavía se tiene que poder guardar. Sin resumen,
    // el listado lo recompone leyendo el documento entero.
  }

  const { token } = await auth();
  const respuesta = await subirDocumento(token, ruta, texto, resumen, generacionEsperada);
  return respuesta.generation ? String(respuesta.generation) : null;
}

/** Crea el proyecto, fallando si ya existe (precondición `ifGenerationMatch=0`). */
async function crearProyecto(proyecto) {
  return guardarProyecto(proyecto, 0);
}

/**
 * Subida multipart: una sola petición lleva los metadatos del objeto y su
 * contenido. gcsUpload de gcp.js usa uploadType=media, que no admite metadatos
 * personalizados, y el resumen tiene que ir con el documento sí o sí (ver
 * arriba), así que aquí se arma el multipart a mano.
 */
async function subirDocumento(token, ruta, texto, metadatos, generacionEsperada) {
  const frontera = 'ams' + crypto.randomBytes(16).toString('hex');

  // UNA sola constante para el tipo, y no dos cadenas escritas a mano.
  //
  // Google compara LETRA A LETRA el Content-Type de la parte del cuerpo con el
  // que declaran los metadatos, y rechaza la subida entera si difieren.
  // Difieran en lo que difieran: aquí una decía "charset=utf-8" y la otra
  // "charset=UTF-8", y eso bastaba para un 400 en cada guardado — o sea, no se
  // podía crear ni un proyecto.
  const TIPO = 'application/json; charset=utf-8';

  const cabecera = {
    name: ruta,
    contentType: TIPO,
    // Este documento cambia constantemente: si un intermediario lo cachea, el
    // usuario ve el proyecto de hace un minuto y cree que su cambio se perdió.
    cacheControl: 'no-store',
  };
  if (metadatos) cabecera.metadata = metadatos;

  const cuerpo =
    '--' + frontera + '\r\n' +
    'Content-Type: ' + TIPO + '\r\n\r\n' +
    JSON.stringify(cabecera) + '\r\n' +
    '--' + frontera + '\r\n' +
    'Content-Type: ' + TIPO + '\r\n\r\n' +
    texto + '\r\n' +
    '--' + frontera + '--';

  let url = HOST + '/upload/storage/v1/b/' + cfg.bucket + '/o?uploadType=multipart';
  if (generacionEsperada !== undefined && generacionEsperada !== null) {
    url += '&ifGenerationMatch=' + encodeURIComponent(String(generacionEsperada));
  }

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'multipart/related; boundary=' + frontera,
    },
    body: cuerpo,
  });

  if (r.status === 412) {
    throw new ConflictoDeVersion(
      String(generacionEsperada) === '0'
        ? 'Ya existe un proyecto con ese identificador'
        : 'Otra operación modificó el proyecto al mismo tiempo',
    );
  }
  if (!r.ok) {
    const detalle = (await r.text().catch(() => '')).slice(0, 200);
    const err = errorDominio(`No se pudo guardar el proyecto: ${r.status} ${detalle}`, 502);
    err.status = r.status === 429 || r.status === 503 ? 503 : 502;
    err.reintentable = r.status === 429 || r.status === 503;
    throw err;
  }
  return r.json().catch(() => ({}));
}

// ---------------------------------------------------------------------------
// modificarProyecto — el sustituto del mutex
// ---------------------------------------------------------------------------

const INTENTOS = 5;
const ESPERA_BASE_MS = 60;

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lee el proyecto, le aplica `fn`, y lo guarda exigiendo que nadie lo haya
 * tocado mientras tanto. Si alguien lo tocó, VUELVE A LEER y repite: el cambio
 * se reaplica sobre el estado nuevo en vez de pisarlo. Esto es lo que
 * sustituye al mutex en memoria del servidor viejo, y a diferencia de aquél
 * funciona aunque las dos peticiones caigan en instancias distintas.
 *
 * IMPORTANTE PARA QUIEN ESCRIBA `fn`: puede ejecutarse VARIAS VECES. Sólo debe
 * modificar el objeto `proyecto` que recibe. Nada de lanzar generaciones, subir
 * archivos ni cobrar créditos dentro: eso pasaría dos veces. El patrón correcto
 * es hacer el trabajo caro fuera y usar `modificarProyecto` sólo para anotar el
 * resultado.
 *
 * `fn` recibe el proyecto y puede devolver un valor (o una promesa); ese valor
 * vuelve en `resultado`.
 *
 * Devuelve { proyecto, generacion, resultado }.
 */
async function modificarProyecto(id, fn) {
  comprobarId(id);
  let ultimoConflicto = null;

  for (let intento = 1; intento <= INTENTOS; intento++) {
    const leido = await leerProyecto(id);
    if (!leido) throw errorDominio(`Proyecto no encontrado: ${id}`, 404);
    // Sin número de versión no hay precondición posible, y guardarProyecto
    // interpretaría null como "escribe sin protección" — justo lo que este
    // bucle existe para impedir. Antes fallar que perder una aprobación.
    if (!leido.generacion) {
      throw errorDominio(`No se pudo determinar la versión del proyecto ${id}`, 502);
    }

    const resultado = await fn(leido.proyecto);

    try {
      const generacion = await guardarProyecto(leido.proyecto, leido.generacion);
      return { proyecto: leido.proyecto, generacion, resultado };
    } catch (err) {
      // 412 (otro escritor) y 429/503 (GCS limita a una escritura por segundo
      // sobre el mismo objeto) se resuelven igual: esperar y reintentar.
      if (!esConflicto(err) && !err.reintentable) throw err;
      ultimoConflicto = err;
      // Espera creciente con un poco de azar, para que dos peticiones que
      // chocan no vuelvan a chocar exactamente en el mismo instante.
      await esperar(ESPERA_BASE_MS * intento + Math.floor(Math.random() * 40));
    }
  }

  // Rendirse es correcto: mejor un error visible que dar por buena una
  // aprobación que no se llegó a escribir.
  const err = new ConflictoDeVersion(
    `El proyecto ${id} está recibiendo demasiados cambios a la vez. Inténtalo otra vez en unos segundos.`,
  );
  err.causa = ultimoConflicto && ultimoConflicto.message;
  throw err;
}

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

/**
 * Lista los proyectos, del más reciente al más antiguo.
 *
 * Barato a propósito: una sola petición de listado con `matchGlob`, que filtra
 * en el servidor y devuelve SÓLO los documentos de proyecto (no los cientos de
 * PNG y MP4 que hay debajo), y con `fields` para que de cada uno venga nada más
 * el nombre y el resumen guardado en sus metadatos. Bajar cada proyecto.json
 * entero para pintar la portada tardaría más que el tiempo máximo de la
 * función en cuanto hubiera unos pocos proyectos.
 */
async function listarProyectos() {
  const { token } = await auth();
  const prefijo = raizProyectos() + '/';

  const items = [];
  let pageToken = '';
  do {
    const url =
      HOST + '/storage/v1/b/' + cfg.bucket + '/o' +
      '?prefix=' + encodeURIComponent(prefijo) +
      '&matchGlob=' + encodeURIComponent(prefijo + '*/' + ARCHIVO_PROYECTO) +
      '&fields=' + encodeURIComponent('items(name,generation,updated,metadata),nextPageToken') +
      '&maxResults=1000' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      const detalle = (await r.text().catch(() => '')).slice(0, 200);
      throw errorDominio(`No se pudo listar los proyectos: ${r.status} ${detalle}`, 502);
    }
    const d = await r.json();
    for (const item of d.items || []) items.push(item);
    pageToken = d.nextPageToken || '';
  } while (pageToken);

  const resumenes = [];
  const sinResumen = [];

  for (const item of items) {
    const id = idDesdeRuta(item.name, prefijo);
    if (!id) continue;
    const crudo = item.metadata && item.metadata.resumen;
    if (crudo) {
      try {
        resumenes.push(JSON.parse(crudo));
        continue;
      } catch (e) {
        // Metadato ilegible: se recompone leyendo el documento, más abajo.
      }
    }
    sinResumen.push(id);
  }

  // Camino de respaldo, acotado: sólo los proyectos escritos por una versión
  // anterior o editados a mano llegan aquí. Un proyecto a medio escribir o
  // roto no puede tumbar el listado entero — así era también en la versión de
  // disco y sigue valiendo.
  if (sinResumen.length) {
    const leidos = await Promise.all(
      sinResumen.map((id) =>
        leerProyecto(id)
          .then((r) => (r ? progreso().summarizeProject(r.proyecto) : null))
          .catch(() => null),
      ),
    );
    for (const s of leidos) if (s) resumenes.push(s);
  }

  resumenes.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return resumenes;
}

function idDesdeRuta(nombre, prefijo) {
  if (!nombre || nombre.indexOf(prefijo) !== 0) return null;
  const resto = nombre.slice(prefijo.length);
  const barra = resto.indexOf('/');
  if (barra <= 0) return null;
  const id = resto.slice(0, barra);
  return ID_SEGURO.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Borrado
// ---------------------------------------------------------------------------

// Cuántos borrados van a la vez. GCS no tiene borrado en lote sin librería, y
// un corto de tres minutos deja cientos de objetos; de uno en uno no daría
// tiempo dentro de la función.
const BORRADOS_A_LA_VEZ = 16;

/**
 * Borra el proyecto entero: el documento y TODOS sus medios.
 *
 * El documento se borra el primero. Si el borrado de los medios se queda a
 * medias (se acaba el tiempo de la función), el proyecto ya no aparece en el
 * listado y el usuario ve que su borrado funcionó; lo que queda son objetos
 * huérfanos, que cuestan unos céntimos, y no un proyecto fantasma que sigue
 * apareciendo y no se deja borrar.
 */
async function borrarProyecto(id) {
  const carpeta = rutaProyecto(id);
  const { token } = await auth();

  await gcsDelete(token, cfg.bucket, rutaProyectoJson(id));

  const objetos = await gcsList(token, cfg.bucket, carpeta + '/', { fields: 'items(name),nextPageToken' });
  let borrados = 0;
  for (let i = 0; i < objetos.length; i += BORRADOS_A_LA_VEZ) {
    const lote = objetos.slice(i, i + BORRADOS_A_LA_VEZ);
    const hechos = await Promise.all(lote.map((o) => gcsDelete(token, cfg.bucket, o.name).catch(() => false)));
    for (const ok of hechos) if (ok) borrados++;
  }
  return { id, borrados: borrados + 1 };
}

// ---------------------------------------------------------------------------
// Medios
// ---------------------------------------------------------------------------

/** Sube un archivo de medios al bucket. `cuerpo` puede ser Buffer o string. */
async function subirMedio(rutaObjeto, cuerpo, contentType) {
  const { token } = await auth();
  return gcsUpload(token, cfg.bucket, rutaObjeto, cuerpo, contentType);
}

/**
 * URL firmada para leer (o subir) un objeto sin pasar por la función.
 * `opciones` es lo que acepta signedUrl de gcp.js: { method, expiresSeconds,
 * descargarComo }. El material pesado no debe atravesar Vercel nunca.
 */
async function urlFirmada(rutaObjeto, opciones) {
  const { sa } = await auth();
  return signedUrl(sa, cfg.bucket, rutaObjeto, opciones);
}

module.exports = {
  jubilarSonidoAmbiental,
  // Rutas
  ARCHIVO_PROYECTO,
  CARPETA_FINAL,
  ARCHIVO_PREVISUALIZACION,
  ARCHIVO_EXPORTACION,
  ARCHIVO_PAQUETE,
  ARCHIVO_METADATOS,
  comprobarId,
  raizProyectos,
  rutaProyecto,
  rutaProyectoJson,
  carpetaActivo,
  extensionDe,
  nombreGeneracion,
  rutaGeneracion,
  rutaFinal,
  rutaMedio,

  // Estado
  leerProyecto,
  existeProyecto,
  guardarProyecto,
  crearProyecto,
  modificarProyecto,
  listarProyectos,
  borrarProyecto,
  ConflictoDeVersion,
  esConflicto,

  // Medios
  subirMedio,
  urlFirmada,
};
