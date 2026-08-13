// ════════════════════════════════════════════════════════════════
// PROYECTO — un corto entero, listo para pintarse.
//
//   GET   ?id=                                  ->  { proyecto, estado }
//   PATCH { id, imageModelId?, videoModelId? }  ->  { proyecto, estado, cambios }
//   DELETE ?id=                                 ->  { borrado }
//
// EL PATCH VIVE AQUÍ Y NO EN SU PROPIO ARCHIVO, y el motivo no es de diseño:
// Vercel sólo deja DOCE funciones serverless por despliegue en el plan gratuito.
// Este proyecto estaba justo en doce, así que crear `api/modelo.js` fue la
// número trece y a partir de ahí NINGÚN despliegue pasó — producción se quedó
// clavada tres horas en una versión vieja mientras yo daba por desplegados unos
// cambios que nunca salieron. Cambiar el modelo es modificar el corto, así que
// su sitio natural es este archivo de todas formas.
//
// Es la petición que más veces se hace: la interfaz vuelve aquí después de
// cada generación, de cada aprobación y en cada latido mientras algo se está
// produciendo. Por eso no hace nada caro: lee el documento y firma URLs.
//
// LO IMPORTANTE DE ESTE ARCHIVO SON LAS URLS.
//
// El material vive en un bucket privado y el proyecto guarda rutas relativas
// ("videos/clip_3/gen_002.mp4"), que un navegador no sabe abrir. La interfaz
// pinta cada imagen, cada vídeo y cada audio con `gen.file.url`, así que aquí
// se le añade a cada archivo una URL firmada. Sin esto la pantalla de revisión
// sale entera en blanco: nada que aprobar, nada que rechazar, y la regla del
// producto —el usuario aprueba— deja de poder cumplirse.
// ════════════════════════════════════════════════════════════════
const { empezar, cuerpo, fallo, ErrorPeticion } = require('./_lib/http.js');
const { leerProyecto, borrarProyecto, modificarProyecto } = require('./_lib/almacen.js');
const { computeProductionStatus } = require('./_lib/progreso.js');
const { makeEventAndPush } = require('./_lib/dominio.js');
const modelos = require('./_lib/modelos.js');
const { cfg } = require('./_lib/gcp.js');
const { paraEnviar } = require('./_lib/respuesta.js');

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['GET', 'PATCH', 'DELETE'])) return;

  try {
    // El PATCH trae el id en el cuerpo; el resto, en la query.
    const datos = req.method === 'PATCH' ? await cuerpo(req) : null;
    const id = datos ? String(datos.id || '').trim() : parametro(req, 'id');
    if (!id) throw new ErrorPeticion(400, 'Falta el parámetro "id"');

    if (req.method === 'PATCH') return await cambiarModelos(res, id, datos);

    // ─── Borrar el proyecto entero ───
    //
    // Se lleva TODO lo suyo del bucket: el documento, las imágenes, los clips,
    // las pistas y el montaje. Un proyecto de prueba que salió mal ocupa igual
    // que uno bueno, y dejarlo ahí sin poder quitarlo convierte la lista en un
    // cementerio.
    //
    // No hay papelera y no hace falta: lo que se borra es material que se puede
    // volver a generar, y la confirmación la pide la interfaz antes de llamar.
    if (req.method === 'DELETE') {
      const existe = await leerProyecto(id);
      if (!existe) {
        throw new ErrorPeticion(404, `No existe ningún proyecto con el identificador "${id}"`);
      }
      const resultado = await borrarProyecto(id);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ borrado: true, id, archivos: resultado.borrados });
    }

    const leido = await leerProyecto(id);
    if (!leido) {
      throw new ErrorPeticion(404, 'No existe ningún proyecto con el identificador "' + id + '".');
    }

    const proyecto = leido.proyecto;

    // El documento cambia con cada aprobación: si un intermediario lo cachea,
    // el usuario ve el proyecto de hace un minuto y cree que su cambio se perdió.
    res.setHeader('Cache-Control', 'no-store');
    const salida = paraEnviar(proyecto);
    return res.status(200).json({ proyecto: salida, estado: computeProductionStatus(salida) });
  } catch (e) {
    return fallo(res, e);
  }
};

/** Un parámetro de la query, venga de `req.query` (Vercel) o de la propia URL. */
/**
 * CAMBIAR CON QUÉ SE GENERA, con el corto ya empezado.
 *
 * Antes el modelo se fijaba al crear el corto. La razón era buena —dos modelos
 * no dibujan igual y mezclarlos se nota entre tomas— pero la decisión es del
 * usuario: «debería poder estar libre, para yo intercambiar generaciones entre
 * modelos». Y hay una razón práctica encima: cuando un modelo rechaza un clip
 * una y otra vez, quedarse encerrado en él significa tirar el corto entero.
 *
 * NADA SE DESAPRUEBA NI SE PIERDE. Lo generado sigue siendo lo oficial, hecho
 * con el modelo con el que se hizo, y cada generación guarda con cuál salió.
 *
 * LO QUE ESTÁ EN VUELO NO SE ENTERA: una operación de vídeo se consulta SIEMPRE
 * con el modelo que la lanzó, que va guardado en el propio trabajo. Preguntar
 * por ella en otro sitio devolvería «no existe» y daría por perdido un clip ya
 * pagado.
 */
async function cambiarModelos(res, id, datos) {
  const imagen = datos.imageModelId === undefined ? null : String(datos.imageModelId).trim();
  const video = datos.videoModelId === undefined ? null : String(datos.videoModelId).trim();
  if (imagen === null && video === null) {
    throw new ErrorPeticion(400, 'No has indicado ningún modelo que cambiar.');
  }
  if (imagen !== null && !modelos.esImagenConocido(imagen)) {
    throw new ErrorPeticion(400, 'Modelo de imagen desconocido: "' + imagen + '".');
  }
  if (video !== null && !modelos.esVideoConocido(video)) {
    throw new ErrorPeticion(400, 'Modelo de vídeo desconocido: "' + video + '".');
  }

  const cambios = [];
  const { proyecto } = await modificarProyecto(id, (p) => {
    const config = p.config || (p.config = {});
    if (imagen !== null && imagen !== config.imageModelId) {
      cambios.push('imágenes: ' + (config.imageModelId || 'por defecto') + ' → ' + imagen);
      config.imageModelId = imagen;
    }
    if (video !== null && video !== config.videoModelId) {
      cambios.push('vídeo: ' + (config.videoModelId || 'por defecto') + ' → ' + video);
      config.videoModelId = video;
    }
    if (!cambios.length) return;
    // Queda en la actividad del corto: dentro de un mes, mirando dos tomas que
    // no se parecen, lo primero que hay que poder saber es si se generaron con
    // modelos distintos.
    makeEventAndPush(p, 'model_changed', 'Modelo cambiado — ' + cambios.join('; ') +
      '. Lo ya aprobado no se toca; lo que generes a partir de ahora usará el nuevo.');
  });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    proyecto: paraEnviar(proyecto),
    estado: computeProductionStatus(proyecto),
    cambios,
  });
}

function parametro(req, nombre) {
  const directo = req.query && req.query[nombre];
  if (directo !== undefined && directo !== null) {
    return String(Array.isArray(directo) ? directo[0] : directo).trim();
  }
  const url = String(req.url || '');
  const interrogante = url.indexOf('?');
  if (interrogante === -1) return '';
  const valor = new URLSearchParams(url.slice(interrogante + 1)).get(nombre);
  return valor === null ? '' : valor.trim();
}

