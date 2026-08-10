// ════════════════════════════════════════════════════════════════
// CATÁLOGO — todo lo que la pantalla de configuración necesita elegir.
//
// Es lo PRIMERO que carga la interfaz, así que no toca Google Cloud ni
// Anthropic a propósito: si el bucket está mal configurado o la clave
// de servicio no está puesta, la pantalla de configuración tiene que
// seguir pintándose igual. Un catálogo que depende del bucket deja al
// usuario mirando una pantalla vacía sin saber por qué, y el sitio
// donde se explica qué falta es /api/salud, no éste.
//
// Los datos son constantes del código: no hay nada que leer ni que
// esperar, y por eso esta función siempre puede contestar.
// ════════════════════════════════════════════════════════════════
const { buildCatalog, searchInstruments } = require('./_lib/catalogo.js');
const modelos = require('./_lib/modelos.js');
const { empezar, fallo } = require('./_lib/http.js');

// El buscador de instrumentos es un desplegable: más de 40 resultados no caben
// en pantalla y sólo hacen la respuesta más pesada.
const MAX_RESULTADOS = 40;

/**
 * Un parámetro de la query.
 *
 * Vercel rellena `req.query`, pero no todos los entornos de ejecución lo hacen
 * (ni las pruebas), así que si no está se saca de la URL. Un catálogo que sólo
 * funciona bajo Vercel no se puede probar en local.
 */
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

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['GET'])) return;

  try {
    const consulta = parametro(req, 'q') || parametro(req, 'buscar');

    // Con `?q=` la respuesta es SÓLO la lista de instrumentos: el buscador se
    // dispara con cada tecla y devolverle el catálogo entero en cada pulsación
    // sería mandar cientos de veces lo que ya tiene cargado.
    if (consulta) {
      return res.status(200).json({ instrumentos: searchInstruments(consulta, MAX_RESULTADOS) });
    }

    // Este documento no cambia entre despliegues: dejar que el navegador se lo
    // quede evita volver a pedirlo en cada recarga. `private` a propósito —
    // una caché compartida delante de la API serviría el catálogo sin pasar
    // por la comprobación de la clave.
    res.setHeader('Cache-Control', 'private, max-age=300');

    // Los modelos van junto al resto del catálogo y no en una llamada aparte:
    // se eligen en la MISMA pantalla que los instrumentos y el escenario, y
    // partirlo en dos peticiones sólo añade un momento en el que el desplegable
    // del modelo está vacío mientras lo demás ya se puede rellenar.
    //
    // Las dos listas vienen ya ordenadas del más barato al más caro (ver
    // api/_lib/modelos.js). Ese orden ES la información: no reordenar al
    // pintarlas.
    return res.status(200).json(Object.assign({}, buildCatalog(), {
      modelosImagen: modelos.MODELOS_IMAGEN,
      modelosVideo: modelos.MODELOS_VIDEO,
      // De dónde salen los precios que llevan las descripciones, y de cuándo
      // son. Un precio sin fecha ni fuente envejece sin que se note.
      fuentePrecios: modelos.FUENTE_PRECIOS,
    }));
  } catch (e) {
    return fallo(res, e);
  }
};
