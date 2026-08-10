// ════════════════════════════════════════════════════════════════
// PROYECTO — un corto entero, listo para pintarse.
//
//   GET ?id=  ->  { proyecto, estado }
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
const { empezar, fallo, ErrorPeticion } = require('./_lib/http.js');
const { leerProyecto, borrarProyecto } = require('./_lib/almacen.js');
const { computeProductionStatus } = require('./_lib/progreso.js');
const { cfg } = require('./_lib/gcp.js');
const { paraEnviar } = require('./_lib/respuesta.js');

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['GET', 'DELETE'])) return;

  try {
    const id = parametro(req, 'id');
    if (!id) throw new ErrorPeticion(400, 'Falta el parámetro "id"');

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

