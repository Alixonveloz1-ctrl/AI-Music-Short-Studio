// ════════════════════════════════════════════════════════════════
// RECHAZAR — descartar una generación sin borrarla.
//
//   POST { id, activo, gen }  ->  { proyecto, estado }
//
// Descartar NO borra nada. La generación se queda en el historial con estado
// 'rejected', con su prompt, su semilla y su archivo. Poder volver atrás y
// comparar el intento 3 con el intento 1 es parte del producto: el usuario
// decide mirando, y una versión borrada es una decisión que ya no se puede
// revisar. Si lo descartado era la versión oficial, el dominio se encarga
// además de marcar como desactualizado todo lo que se apoyaba en ella.
// ════════════════════════════════════════════════════════════════
const { empezar, cuerpo, requerido, fallo } = require('./_lib/http.js');
const { modificarProyecto } = require('./_lib/almacen.js');
const { rejectGeneration } = require('./_lib/dominio.js');
const { computeProductionStatus } = require('./_lib/progreso.js');
const { cfg } = require('./_lib/gcp.js');
const { paraEnviar } = require('./_lib/respuesta.js');

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['POST'])) return;

  try {
    const datos = await cuerpo(req);
    const id = String(requerido(datos, 'id')).trim();
    const activo = String(requerido(datos, 'activo')).trim();
    const gen = String(requerido(datos, 'gen')).trim();

    const { proyecto } = await modificarProyecto(id, (p) => {
      // Un estado desde el que no se puede descartar (una generación todavía
      // en curso, por ejemplo) sale como DomainError con su status: el motivo
      // exacto le sirve al usuario mucho más que un error genérico.
      rejectGeneration(p, activo, gen);
    });

    res.setHeader('Cache-Control', 'no-store');
    const salida = paraEnviar(proyecto);
    return res.status(200).json({ proyecto: salida, estado: computeProductionStatus(salida) });
  } catch (e) {
    return fallo(res, e);
  }
};

// ─── Firmado de medios ───
//
// NOTA PARA EL COORDINADOR: copia deliberada de la lógica de api/proyecto.js.
// La interfaz repinta con esta misma respuesta y pinta los medios con
// `gen.file.url`, así que tienen que ir firmados. Se escribe local para no
// tocar el archivo de otro agente; unificarlo en _lib es tarea del coordinador.

