// ════════════════════════════════════════════════════════════════
// LA RESPUESTA DEL PROYECTO — una sola forma de devolverlo.
//
// Cinco endpoints devuelven el proyecto: proyecto, aprobar, rechazar,
// desbloquear y entrega. Cada uno llevaba su propia copia de esto, y
// las cinco copias tenían el MISMO fallo: firmaban la URL anteponiendo
// otra vez la carpeta del proyecto a una ruta que ya la llevaba, así
// que la URL apuntaba a un objeto inexistente y no se veía ni una
// imagen. Lo peor era el síntoma: la respuesta de /api/generar sí traía
// la URL buena, así que el medio aparecía un instante y desaparecía en
// el siguiente refresco.
//
// Cinco copias de una regla son cinco sitios donde equivocarse a la vez.
// Aquí hay una.
// ════════════════════════════════════════════════════════════════
const { cfg, loadServiceAccount, signedUrl } = require('./gcp');
const { rutaProyecto } = require('./almacen');

/** Cuánto vale una URL firmada. Se recalcula en cada lectura, así que basta. */
const VIGENCIA_SEG = 6 * 60 * 60;

/**
 * Todos los objetos `file` del proyecto que tienen algo que firmar.
 *
 * Se recoge el historial ENTERO, no sólo lo aprobado: el usuario compara
 * versiones antes de decidir, y una generación rechazada que ya no se puede
 * mirar es una decisión que no se puede revisar.
 */
function recogerArchivos(proyecto) {
  const archivos = [];
  const anadir = (f) => {
    if (f && typeof f === 'object' && typeof f.path === 'string' && f.path) archivos.push(f);
  };

  for (const activo of proyecto.assets || []) {
    for (const generacion of activo.generations || []) anadir(generacion.file);
  }
  const corte = proyecto.finalCut;
  if (corte) {
    anadir(corte.preview);
    anadir(corte.export);
  }
  return archivos;
}

/**
 * Añade `url` a cada archivo del proyecto.
 *
 * `file.path` YA ES la ruta completa del objeto en el bucket — la escriben
 * rutaGeneracion() y rutaFinal(), que incluyen el prefijo y la carpeta del
 * proyecto. Se firma tal cual. Volver a componerla es el fallo que había.
 *
 * La credencial se carga UNA vez para todo el proyecto: firmar es una
 * operación local (RSA, sin red), pero volver a parsear el JSON de la cuenta
 * de servicio por cada uno de los cien y pico archivos sí se nota.
 */
function firmarMedios(proyecto) {
  const archivos = recogerArchivos(proyecto);
  if (!archivos.length) return proyecto;

  const sa = loadServiceAccount();
  const bucket = cfg.bucket;
  // Ninguna ruta puede salirse de la carpeta del proyecto. Es barato de
  // comprobar y evita firmar cualquier cosa si un día algo escribe una ruta
  // que no debería.
  const raiz = rutaProyecto(proyecto.id) + '/';

  // El MP4 terminado se baja con el título del corto, no como
  // "corto_final.mp4". Sin Content-Disposition el navegador ABRE el vídeo en
  // una pestaña en vez de descargarlo, y la cabecera va FIRMADA: añadirla a la
  // URL después de firmar hace que Google rechace la petición entera.
  const exportado = proyecto.finalCut && proyecto.finalCut.export;
  const titulo = (proyecto.delivery && proyecto.delivery.title) || '';

  for (const archivo of archivos) {
    try {
      if (archivo.path.indexOf(raiz) !== 0) {
        console.error('[respuesta] ruta fuera del proyecto, no se firma:', archivo.path);
        delete archivo.url;
        continue;
      }
      const opciones = { expiresSeconds: VIGENCIA_SEG };
      if (archivo === exportado && titulo) opciones.descargarComo = titulo + '.mp4';
      archivo.url = signedUrl(sa, bucket, archivo.path, opciones);
    } catch (e) {
      // Un archivo suelto con una ruta rara no puede dejar el proyecto entero
      // sin abrirse: ese se queda sin URL y la interfaz lo enseña como «sin
      // archivo», que es exactamente lo que pasa.
      console.error('[respuesta] no se pudo firmar', archivo.path, e && e.message);
      delete archivo.url;
    }
  }
  return proyecto;
}

/**
 * Quita el estado interno que la interfaz no debe ver.
 *
 * `gen.trabajo` es la libreta del modelo por pasos: el nombre de la operación
 * de Veo, las rutas de los fragmentos de música a medias y los contadores de
 * tropiezos. Viaja en la respuesta que más veces se pide —el latido consulta
 * el proyecto cada pocos segundos mientras algo se genera— y no lo lee nadie.
 */
function limpiarInterno(proyecto) {
  for (const activo of proyecto.assets || []) {
    for (const generacion of activo.generations || []) {
      if (generacion.trabajo) delete generacion.trabajo;
    }
  }
  return proyecto;
}

/**
 * El proyecto listo para mandar: sin estado interno y con las URLs puestas.
 *
 * Trabaja sobre una COPIA. Quien llama suele tener delante el objeto que
 * acaba de guardar en el bucket, y meterle URLs firmadas —que caducan— a algo
 * que puede volver a escribirse es la forma de guardar en el bucket una URL
 * muerta.
 */
function paraEnviar(proyecto) {
  const copia = JSON.parse(JSON.stringify(proyecto));
  limpiarInterno(copia);
  firmarMedios(copia);
  return copia;
}

module.exports = { paraEnviar, firmarMedios, limpiarInterno, recogerArchivos, VIGENCIA_SEG };
