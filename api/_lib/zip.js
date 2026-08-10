/**
 * UN ZIP, ESCRITO A MANO.
 *
 * El usuario pidió descargar «un zip donde venga el MP4 y venga un archivo de
 * texto con el nombre, la descripción y los hashtags, solamente de copiar y
 * pegar». Dos archivos, una descarga: en el móvil, bajar el vídeo por un lado y
 * copiar el texto de una pantalla por otro es justo la fricción que sobra.
 *
 * Se escribe a mano porque este proyecto no tiene dependencias y no va a
 * empezar a tenerlas por esto. Un ZIP no comprimido son tres cosas pegadas: una
 * cabecera delante de cada archivo, los bytes del archivo, y al final un índice
 * que dice dónde empieza cada uno. Cabe en un fichero corto.
 *
 * SIN COMPRIMIR, Y A PROPÓSITO. Un MP4 ya está comprimido: pasarlo por deflate
 * gasta segundos de función y memoria para ahorrar puede que un uno por ciento.
 * El método «store» —guardar tal cual— es el correcto aquí, y además evita
 * meter zlib en la ecuación.
 *
 * Límites conocidos: sin ZIP64, así que ni el conjunto ni un archivo suelto
 * pueden pasar de 4 GB. Un corto de tres minutos anda por los cincuenta megas,
 * de modo que el margen es de tres órdenes de magnitud. Se comprueba igual, con
 * un error claro, porque un ZIP corrupto silencioso es peor que no tenerlo.
 */

const LIMITE = 0xfffffffe;

// ─── CRC-32 ───
//
// El ZIP guarda una suma de comprobación por archivo y los descompresores la
// verifican: si no cuadra, avisan de que el archivo está dañado. La tabla se
// calcula una vez al cargar el módulo, que es más rápido que hacer las ocho
// vueltas de bit por cada byte del MP4.
const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i += 1) c = (c >>> 8) ^ TABLA_CRC[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/**
 * La fecha en el formato de MS-DOS que usa el ZIP: dos enteros de 16 bits.
 *
 * Es de 1980 y guarda los segundos de dos en dos. No importa que sea tosco —lo
 * único que hace es que el archivo no salga con fecha «1 de enero de 1980» en
 * el explorador— pero un ZIP sin fecha se ve descuidado.
 */
function fechaDos(cuando) {
  const d = cuando instanceof Date ? cuando : new Date();
  const anio = Math.max(1980, d.getFullYear());
  return {
    hora: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    fecha: (((anio - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

/**
 * Arma el ZIP.
 *
 * `archivos` es una lista de `{ nombre, bytes }`. El orden se respeta: es el
 * que verá quien lo abra.
 */
function crearZip(archivos, cuando) {
  const lista = (archivos || []).filter((a) => a && a.nombre && a.bytes);
  if (!lista.length) throw new Error('crearZip no recibió ningún archivo.');

  const { hora, fecha } = fechaDos(cuando);
  const trozos = [];
  const indice = [];
  let desplazamiento = 0;

  for (const archivo of lista) {
    const nombre = Buffer.from(String(archivo.nombre), 'utf8');
    const datos = Buffer.isBuffer(archivo.bytes) ? archivo.bytes : Buffer.from(archivo.bytes);
    if (datos.length > LIMITE) {
      throw new Error(
        'El archivo "' + archivo.nombre + '" mide ' + datos.length +
        ' bytes y no cabe en un ZIP sin ZIP64 (máximo 4 GB).',
      );
    }
    const suma = crc32(datos);

    // Cabecera local: va justo delante de los bytes del archivo.
    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0);   // firma
    cabecera.writeUInt16LE(20, 4);           // versión mínima para abrirlo
    // Bit 11: los nombres van en UTF-8. Sin esto, un nombre con tilde o con «ñ»
    // se abre con caracteres raros en Windows.
    cabecera.writeUInt16LE(0x0800, 6);
    cabecera.writeUInt16LE(0, 8);            // método 0 = guardar sin comprimir
    cabecera.writeUInt16LE(hora, 10);
    cabecera.writeUInt16LE(fecha, 12);
    cabecera.writeUInt32LE(suma, 14);
    cabecera.writeUInt32LE(datos.length, 18); // tamaño comprimido
    cabecera.writeUInt32LE(datos.length, 22); // tamaño real (iguales: no se comprime)
    cabecera.writeUInt16LE(nombre.length, 26);
    cabecera.writeUInt16LE(0, 28);           // sin campos extra

    trozos.push(cabecera, nombre, datos);

    // Entrada del índice final, que apunta a la cabecera de arriba.
    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4);            // versión con la que se creó
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt16LE(0x0800, 8);
    entrada.writeUInt16LE(0, 10);
    entrada.writeUInt16LE(hora, 12);
    entrada.writeUInt16LE(fecha, 14);
    entrada.writeUInt32LE(suma, 16);
    entrada.writeUInt32LE(datos.length, 20);
    entrada.writeUInt32LE(datos.length, 24);
    entrada.writeUInt16LE(nombre.length, 28);
    entrada.writeUInt32LE(desplazamiento, 42);
    indice.push(entrada, nombre);

    desplazamiento += cabecera.length + nombre.length + datos.length;
    if (desplazamiento > LIMITE) {
      throw new Error('El ZIP entero pasa de 4 GB, que es el máximo sin ZIP64.');
    }
  }

  const cuerpoIndice = Buffer.concat(indice);

  // Y el cierre: dónde empieza el índice y cuántos archivos hay.
  const cierre = Buffer.alloc(22);
  cierre.writeUInt32LE(0x06054b50, 0);
  cierre.writeUInt16LE(lista.length, 8);
  cierre.writeUInt16LE(lista.length, 10);
  cierre.writeUInt32LE(cuerpoIndice.length, 12);
  cierre.writeUInt32LE(desplazamiento, 16);

  return Buffer.concat([...trozos, cuerpoIndice, cierre]);
}

/**
 * La hoja de texto que acompaña al vídeo.
 *
 * Pensada para el móvil: cada bloque va separado y etiquetado para poder
 * seleccionarlo entero de un toque, y al final va todo junto, que es lo que se
 * pega de verdad en la caja de subida de una red social.
 *
 * Empieza con la marca de orden de bytes (BOM) porque sin ella el Bloc de notas
 * de Windows abre el archivo como si fuera de la época de los acentos rotos.
 */
function hojaDeTexto(entrega) {
  const titulo = String((entrega && entrega.title) || '').trim();
  const descripcion = String((entrega && entrega.description) || '').trim();
  const etiquetas = (Array.isArray(entrega && entrega.hashtags) ? entrega.hashtags : [])
    .map((h) => String(h).trim())
    .filter(Boolean)
    .join(' ');

  const raya = (que) => '─────────  ' + que + '  ─────────';
  const bloques = [
    raya('TÍTULO'),
    titulo || '(sin título)',
    '',
    raya('DESCRIPCIÓN'),
    descripcion || '(sin descripción)',
    '',
    raya('HASHTAGS'),
    etiquetas || '(sin hashtags)',
    '',
    raya('TODO JUNTO, PARA PEGAR'),
    [titulo, descripcion, etiquetas].filter(Boolean).join('\n\n'),
    '',
  ];
  return Buffer.from('﻿' + bloques.join('\n'), 'utf8');
}

/** Un nombre de archivo que no dé problemas en ningún sistema. */
function nombreSeguro(texto, porDefecto) {
  const limpio = String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return limpio || porDefecto || 'corto';
}

module.exports = { crearZip, crc32, hojaDeTexto, nombreSeguro };
