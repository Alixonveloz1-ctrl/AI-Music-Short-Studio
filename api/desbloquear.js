// ════════════════════════════════════════════════════════════════
// DESBLOQUEAR — reabrir un activo ya aprobado.
//
//   POST { id, activo }  ->  { proyecto, estado }
//
// Un activo aprobado queda BLOQUEADO a propósito: es la forma de que nada
// vuelva a tocar por accidente algo que el usuario ya dio por bueno, ni la IA
// ni un doble clic. Levantar ese bloqueo es una decisión explícita y con
// consecuencias — al regenerar, todo lo que se construyó encima queda
// desactualizado — así que necesita su propia petición y su propio botón.
//
// Desbloquear NO borra la versión aprobada ni la desaprueba: sólo permite
// generar otra. Mientras no se apruebe la nueva, la oficial sigue siendo la
// que había, y las etapas siguientes siguen abiertas.
// ════════════════════════════════════════════════════════════════
const { empezar, cuerpo, requerido, fallo } = require('./_lib/http.js');
const { modificarProyecto } = require('./_lib/almacen.js');
const { unlockAsset } = require('./_lib/dominio.js');
const { computeProductionStatus } = require('./_lib/progreso.js');
const { cfg } = require('./_lib/gcp.js');
const { paraEnviar } = require('./_lib/respuesta.js');

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['POST'])) return;

  try {
    const datos = await cuerpo(req);
    const id = String(requerido(datos, 'id')).trim();
    const activo = String(requerido(datos, 'activo')).trim();

    const { proyecto } = await modificarProyecto(id, (p) => {
      // Si el activo no existe, el dominio contesta 404. Si ya estaba
      // desbloqueado no hace nada: la interfaz desbloquea antes de regenerar y
      // pedirlo dos veces tiene que ser inofensivo.
      unlockAsset(p, activo);
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
// NOTA PARA EL COORDINADOR: copia deliberada de la lógica de api/proyecto.js,
// porque la interfaz repinta con esta respuesta y pinta los medios con
// `gen.file.url`. Local para no tocar el archivo de otro agente; unificarlo en
// _lib es tarea del coordinador.

