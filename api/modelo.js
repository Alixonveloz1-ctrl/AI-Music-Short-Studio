// ════════════════════════════════════════════════════════════════
// MODELO — cambiar con qué se genera, con el corto ya empezado.
//
//   POST { id, imageModelId?, videoModelId? }  ->  { proyecto, estado }
//
// POR QUÉ CAMBIÓ LA REGLA. El modelo se fijaba al crear el corto y ya no se
// tocaba, con este razonamiento escrito en la pantalla: «mezclar modelos a
// mitad de producción rompe la continuidad visual entre tomas». Es verdad que
// la puede romper, pero la decisión no era nuestra:
//
//   «Después que ya tengo seleccionado un modelo de imagen o de video, ya no
//   puedo cambiarlo otra vez, debería poder estar libre, para yo intercambiar
//   generaciones entre modelos.»
//
// Y tiene razón práctica además de la de mando. Cuando un modelo rechaza un
// clip una y otra vez —le pasó nueve veces seguidas con Veo— quedarse encerrado
// en él significa tirar el corto entero y empezar de cero. Poder probar otro es
// la diferencia entre seguir trabajando y no poder.
//
// LO QUE NO CAMBIA:
//
//   NADA SE DESAPRUEBA NI SE PIERDE. Lo ya generado y aprobado sigue siendo lo
//   oficial, hecho con el modelo con el que se hizo. Cada generación guarda con
//   qué se hizo, así que en el historial se pueden comparar unas con otras.
//
//   LO QUE ESTÁ EN VUELO NO SE ENTERA. Una operación de vídeo se consulta
//   SIEMPRE con el modelo que la lanzó, que va guardado en el propio trabajo
//   (ver `consultarVideo`). Preguntar por ella en otro sitio devolvería «no
//   existe» y daría por perdido un clip ya pagado.
// ════════════════════════════════════════════════════════════════
const { empezar, cuerpo, requerido, fallo, ErrorPeticion } = require('./_lib/http.js');
const { modificarProyecto } = require('./_lib/almacen.js');
const { makeEventAndPush } = require('./_lib/dominio.js');
const { computeProductionStatus } = require('./_lib/progreso.js');
const modelos = require('./_lib/modelos.js');
const { cfg } = require('./_lib/gcp.js');
const { paraEnviar } = require('./_lib/respuesta.js');

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['POST'])) return;

  try {
    const datos = await cuerpo(req);
    const id = String(requerido(datos, 'id')).trim();

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

      // Se deja constancia en la actividad del corto. Importa: dentro de un mes,
      // mirando dos tomas que no se parecen, lo primero que hay que poder saber
      // es si se generaron con modelos distintos.
      makeEventAndPush(p, 'model_changed', 'Modelo cambiado — ' + cambios.join('; ') +
        '. Lo ya aprobado no se toca; lo que generes a partir de ahora usará el nuevo.');
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      proyecto: paraEnviar(proyecto),
      estado: computeProductionStatus(proyecto),
      cambios,
    });
  } catch (e) {
    return fallo(res, e);
  }
};

// `cfg` se lee al arrancar para que un despliegue sin credenciales falle aquí y
// no a mitad de la petición, igual que en el resto de los puntos de entrada.
void cfg;
