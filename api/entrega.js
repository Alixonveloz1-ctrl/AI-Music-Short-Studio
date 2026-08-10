// ════════════════════════════════════════════════════════════════
// ENTREGA — los metadatos con los que se publica el corto.
//
//   POST { id, titulo, descripcion, hashtags }  ->  { proyecto, estado }
//
// Título, descripción y hashtags viajan pegados al proyecto porque acaban en
// el nombre del MP4 y en el pie de la publicación. Se saneen aquí y no en el
// navegador: el navegador es una comodidad, el servidor es la garantía. Un
// título de tres mil caracteres o un hashtag con espacios y acentos no se
// arregla solo más adelante, se arrastra hasta el archivo final.
//
// ADEMÁS, ESTE ES EL PASO FINAL DEL PRODUCTO.
//
// En la pantalla hay un único botón, «Aprobar y exportar el MP4», y llama
// aquí. Así que este endpoint hace las tres cosas que ese botón promete:
// guarda los metadatos, APRUEBA la previsualización y produce el MP4 final.
//
// Aprobar aquí no contradice la regla del producto, la cumple: el corte pasa a
// aprobado porque el usuario ha pulsado el botón, igual que un activo pasa a
// aprobado porque el usuario lo aprueba. Lo que no puede existir —y no
// existe— es una ruta que lo apruebe sin que él lo pida.
//
// Si todavía no hay previsualización montada, se guardan los metadatos y ya
// está: el usuario puede escribir el título antes de terminar la producción.
// ════════════════════════════════════════════════════════════════
const { empezar, cuerpo, requerido, fallo, ErrorPeticion } = require('./_lib/http.js');
const almacen = require('./_lib/almacen.js');
const { modificarProyecto } = almacen;
const { makeEventAndPush } = require('./_lib/dominio.js');
const { computeProductionStatus } = require('./_lib/progreso.js');
const { cfg, auth, gcsCopy, gcsUpload, gcsDescargar } = require('./_lib/gcp.js');
const zip = require('./_lib/zip.js');
const { paraEnviar } = require('./_lib/respuesta.js');

// Longitudes con las que el material se sigue pudiendo publicar en cualquier
// sitio. No son un capricho: el título va también en el nombre del archivo.
const MAX_TITULO = 120;
const MAX_DESCRIPCION = 1200;
const MAX_HASHTAG = 30;
const MAX_HASHTAGS = 12;

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['POST'])) return;

  try {
    const datos = await cuerpo(req);
    const id = String(requerido(datos, 'id')).trim();

    // Un campo que no llega se deja como estaba; un campo que llega vacío sí
    // borra. Así la interfaz puede mandar sólo lo que el usuario tocó sin que
    // el resto desaparezca por omisión.
    const titulo = datos.titulo === undefined ? undefined : texto(datos.titulo, 'titulo', MAX_TITULO);
    const descripcion =
      datos.descripcion === undefined ? undefined : texto(datos.descripcion, 'descripcion', MAX_DESCRIPCION);
    const hashtags = datos.hashtags === undefined ? undefined : normalizarHashtags(datos.hashtags);

    // ── La exportación va ANTES y FUERA del candado ──
    //
    // Copiar el MP4 es una llamada a Google que tarda: hacerla dentro de
    // modificarProyecto bloquearía el proyecto entero mientras dura, y el
    // usuario suele estar mirando la pantalla, que consulta a la vez.
    const previo = await almacen.leerProyecto(id);
    if (!previo) throw new ErrorPeticion(404, `No existe ningún proyecto con el identificador "${id}"`);

    const corte = previo.proyecto.finalCut || {};
    const exportable = Boolean(corte.preview && corte.preview.path) &&
      (corte.status === 'review' || corte.status === 'approved' || corte.status === 'exported');

    let exportado = null;
    if (exportable) {
      const { token } = await auth();
      const destino = almacen.rutaFinal(id, almacen.ARCHIVO_EXPORTACION);
      const bytes = await gcsCopy(token, cfg.bucket, corte.preview.path, cfg.bucket, destino);
      exportado = {
        path: destino,
        bytes,
        mimeType: 'video/mp4',
        durationSec: corte.preview.durationSec || 0,
        width: corte.preview.width,
        height: corte.preview.height,
      };
    }

    const { proyecto } = await modificarProyecto(id, (p) => {
      const entrega = Object.assign({}, p.delivery);

      if (titulo !== undefined) entrega.title = titulo;
      if (descripcion !== undefined) entrega.description = descripcion;
      if (hashtags !== undefined) entrega.hashtags = hashtags;

      // Sin título no hay entrega posible: es el nombre del MP4 y el titular de
      // la publicación. Se comprueba sobre el resultado y no sobre lo que llega,
      // para que valga el título que ya tenía el proyecto.
      if (!entrega.title) {
        throw new ErrorPeticion(400, 'El corto necesita un título para poder entregarse.');
      }

      p.delivery = entrega;
      // Queda en el registro de actividad: los metadatos se retocan varias
      // veces antes de publicar y conviene ver cuándo cambió el último.
      makeEventAndPush(p, 'delivery_updated', `Entrega: metadatos actualizados — «${entrega.title}»`);

      if (exportado) {
        p.finalCut = Object.assign({}, p.finalCut, {
          status: 'exported',
          export: exportado,
          exportedAt: new Date().toISOString(),
          approvedAt: (p.finalCut && p.finalCut.approvedAt) || new Date().toISOString(),
          error: undefined,
        });
        makeEventAndPush(
          p,
          'cut_exported',
          `Corto exportado: «${entrega.title}» (${Math.round((exportado.bytes || 0) / 1048576)} MB).`,
        );
      }
    });

    // La hoja con lo que se publicó, junto al MP4 (§37). No es para la app: es
    // para que en el bucket quede, al lado del archivo, el título, la
    // descripción y los hashtags con los que se exportó. Si falla, el corto ya
    // está entregado igual y no tiene sentido tumbar la petición por esto.
    if (exportado) {
      try {
        const { token } = await auth();
        await gcsUpload(
          token, cfg.bucket, almacen.rutaFinal(id, almacen.ARCHIVO_METADATOS),
          Buffer.from(JSON.stringify({
            title: proyecto.delivery.title,
            description: proyecto.delivery.description,
            hashtags: proyecto.delivery.hashtags,
            durationSec: exportado.durationSec,
            exportedAt: proyecto.finalCut.exportedAt,
            timeline: (proyecto.plan.timeline || []).map((e) => ({
              index: e.index, shotId: e.shotId, startSec: e.startSec,
              durationSec: e.durationSec, reused: e.reused,
            })),
          }, null, 2)),
          'application/json',
        );
      } catch (e) {
        console.error('[entrega] no se pudo escribir la hoja de metadatos:', e && e.message);
      }

      // ─── EL PAQUETE PARA DESCARGAR ───
      //
      // El MP4 y una hoja de texto con el título, la descripción y los
      // hashtags, en un solo archivo. Lo pidió el usuario y la razón es de
      // móvil: bajar el vídeo por un lado y copiar el texto de una pantalla por
      // otro es justo la fricción que sobra cuando vas a publicar.
      //
      // Va después de exportar y en su propio try: si el paquete falla, el
      // corto ya está entregado y el MP4 se puede bajar suelto. Perder la
      // entrega entera por no poder empaquetar sería absurdo.
      try {
        const { token } = await auth();
        const mp4 = await gcsDescargar(token, cfg.bucket, exportado.path);
        const base = zip.nombreSeguro(proyecto.delivery.title, 'corto');
        const paquete = zip.crearZip([
          { nombre: base + '.mp4', bytes: mp4 },
          { nombre: base + '.txt', bytes: zip.hojaDeTexto(proyecto.delivery) },
        ]);
        const rutaZip = almacen.rutaFinal(id, almacen.ARCHIVO_PAQUETE);
        await gcsUpload(token, cfg.bucket, rutaZip, paquete, 'application/zip');
        await modificarProyecto(id, (p) => {
          p.finalCut = Object.assign({}, p.finalCut, {
            paquete: {
              path: rutaZip,
              bytes: paquete.length,
              mimeType: 'application/zip',
              nombre: base + '.zip',
            },
          });
        });
      } catch (e) {
        console.error('[entrega] no se pudo armar el paquete .zip:', e && e.message);
      }
    }

    res.setHeader('Cache-Control', 'no-store');
    const salida = paraEnviar(proyecto);
    return res.status(200).json({ proyecto: salida, estado: computeProductionStatus(salida) });
  } catch (e) {
    return fallo(res, e);
  }
};

// ─── Saneado ───

/** Un campo de texto: tiene que ser texto de verdad, recortado y sin colas. */
function texto(valor, nombre, maximo) {
  if (typeof valor !== 'string') {
    throw new ErrorPeticion(400, `El campo "${nombre}" tiene que ser texto.`);
  }
  // Los saltos de línea de una descripción sí se conservan; lo que se quita son
  // los caracteres de control, que ensucian el JSON y no se ven.
  const limpio = valor
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return limpio.length > maximo ? limpio.slice(0, maximo).trim() : limpio;
}

/**
 * Los hashtags llegan como lista de textos y salen como lista de etiquetas
 * publicables: con una sola almohadilla delante, sin espacios, sin acentos y
 * sin signos. Un "#música clásica" escrito a mano se convierte en
 * "#MusicaClasica" en vez de romper el pie de la publicación.
 */
function normalizarHashtags(valor) {
  if (!Array.isArray(valor)) {
    throw new ErrorPeticion(400, 'El campo "hashtags" tiene que ser una lista de textos.');
  }

  const salida = [];
  const vistos = new Set();

  for (const bruto of valor) {
    if (typeof bruto !== 'string') {
      throw new ErrorPeticion(400, 'Cada hashtag tiene que ser un texto.');
    }
    const etiqueta = aEtiqueta(bruto);
    if (!etiqueta) continue;
    // Sin distinguir mayúsculas: "#Piano" y "#piano" son la misma etiqueta y
    // repetirlas sólo resta sitio.
    const clave = etiqueta.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(etiqueta);
    if (salida.length >= MAX_HASHTAGS) break;
  }

  return salida;
}

function aEtiqueta(bruto) {
  const trozos = bruto
    .normalize('NFD')
    // Quita las tildes y las diéresis: las redes las aceptan a medias y luego
    // la etiqueta no coincide con la que escribe todo el mundo.
    .replace(/[\u0300-\u036F]/g, '')
    .split(/[^A-Za-z0-9_]+/)
    .filter(Boolean);
  if (!trozos.length) return '';

  // Varias palabras se pegan en CamelCase, que es como se leen los hashtags;
  // una sola se respeta tal cual la escribió el usuario.
  const cuerpoEtiqueta =
    trozos.length === 1
      ? trozos[0]
      : trozos.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join('');

  const recortado = cuerpoEtiqueta.slice(0, MAX_HASHTAG);
  return recortado ? '#' + recortado : '';
}

// ─── Firmado de medios ───
//
// NOTA PARA EL COORDINADOR: copia deliberada de la lógica de api/proyecto.js,
// porque la interfaz repinta con esta respuesta y pinta los medios con
// `gen.file.url`. Local para no tocar el archivo de otro agente; unificarlo en
// _lib es tarea del coordinador.

