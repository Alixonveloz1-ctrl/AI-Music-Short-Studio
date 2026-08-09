// ════════════════════════════════════════════════════════════════
// APROBAR — el único sitio de todo el sistema donde algo pasa a APROBADO.
//
//   POST { id, activo, gen }  ->  { proyecto, estado }
//
// La regla que sostiene el producto entero es que la IA propone y el usuario
// aprueba: una generación técnicamente correcta aterriza en REVISIÓN y se
// queda ahí. Nada la mueve de ahí sola — ni el final de la generación, ni el
// montaje, ni un reintento. Sólo esta petición, que nace de un dedo pulsando
// un botón. Por eso este archivo no decide nada por su cuenta: recibe qué
// generación exacta se aprueba y se lo pide al dominio, que es quien bloquea
// el activo y marca como desactualizado lo que se construyó encima.
// ════════════════════════════════════════════════════════════════
const { empezar, cuerpo, requerido, fallo } = require('./_lib/http.js');
const { modificarProyecto } = require('./_lib/almacen.js');
const { approveGeneration } = require('./_lib/dominio.js');
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

    // Dentro de modificarProyecto: lee, aplica y guarda con precondición. Si
    // otra petición escribió mientras tanto, se reintenta sobre el estado
    // nuevo en vez de pisarlo. Una aprobación perdida en silencio sería el
    // peor fallo posible de esta herramienta.
    const { proyecto } = await modificarProyecto(id, (p) => {
      // Si la generación no está en revisión o no tiene archivo, el dominio
      // lanza DomainError con su propio status: se deja salir tal cual. Tapar
      // ese error con un mensaje genérico escondería justamente el motivo por
      // el que el usuario no puede aprobar.
      approveGeneration(p, activo, gen);
    });

    // El proyecto cambia en cada aprobación: si un intermediario lo cachea, el
    // usuario ve el estado de hace un minuto y cree que su decisión se perdió.
    res.setHeader('Cache-Control', 'no-store');
    const salida = paraEnviar(proyecto);
    return res.status(200).json({ proyecto: salida, estado: computeProductionStatus(salida) });
  } catch (e) {
    return fallo(res, e);
  }
};

// ─── Firmado de medios ───
//
// NOTA PARA EL COORDINADOR: esto es una copia deliberada de lo que hace
// api/proyecto.js. La interfaz repinta con lo que devuelve ESTA respuesta y
// pinta cada medio con `gen.file.url`, así que sin firmar aquí la pantalla se
// quedaría en blanco justo después de aprobar. Se escribe local para no pisar
// el archivo de otro agente; unificar las cuatro copias en _lib es tarea del
// coordinador.

