/**
 * LA FICHA DE CADA INTÉRPRETE.
 *
 * POR QUÉ EXISTE ESTE FICHERO. El usuario escribió «dos chicas rubias de cuerpo
 * perfecto en minifalda» en el cuadro de dirección creativa y la herramienta le
 * devolvió una chica de pelo negro con falda larga. El texto SÍ llegaba al
 * prompt, y encima con un cartel que decía «esto manda sobre todo lo que venga
 * después» — pero cinco líneas más abajo el mismo prompt seguía diciendo
 * «Cabello: negro azabache. Vestuario: falda negra de talle alto». Un modelo de
 * imagen no arbitra entre dos frases contradictorias: se queda con el dato
 * concreto.
 *
 * La conclusión es que declarar prioridad en prosa no sirve de nada. Lo que el
 * usuario elige tiene que SUSTITUIR el dato, no ganarle una discusión. Para
 * sustituirlo hay que saber de qué dato habla, y para saberlo hace falta que lo
 * elija en campos con nombre en vez de en un párrafo suelto. Eso es esta ficha.
 *
 * Cómo funciona: hay una ficha por intérprete principal (hasta cuatro, los
 * mismos que tienen retrato maestro). Cada campo puede quedarse VACÍO, y vacío
 * significa «decide tú»: el Director lo rellena desde sus bancos como ha hecho
 * siempre. Lo que el usuario rellena, manda, y el banco ni se consulta.
 *
 * Las listas de abajo son la única fuente: el servidor valida contra ellas y la
 * interfaz dibuja sus botones desde ellas, así que no pueden desincronizarse.
 * Ninguna es cerrada — junto a los botones hay una casilla de texto libre para
 * lo que no esté en la lista.
 */

/** Cuántas fichas se ofrecen como máximo. El mismo tope que los retratos maestros. */
const MAX_FICHAS = 4;

/**
 * Un rasgo: `id` es lo que viaja en la configuración, `opciones` son los botones
 * y `texto` dice si además admite escribir a mano.
 *
 * `frase` convierte el valor elegido en la línea que va al prompt. Se guarda la
 * etiqueta corta («Rubio») y el prompt recibe la frase larga («cabello rubio»),
 * porque en el prompt una palabra suelta se lee como una etiqueta y una frase
 * se lee como una instrucción.
 */
const RASGOS = [
  {
    id: 'hairColor',
    etiqueta: 'Color de pelo',
    frase: (v) => `cabello ${v.toLowerCase()}`,
    opciones: [
      'Rubio', 'Castaño claro', 'Castaño oscuro', 'Negro',
      'Pelirrojo', 'Blanco', 'Plateado', 'Rosa', 'Azul',
    ],
  },
  {
    id: 'hairStyle',
    etiqueta: 'Peinado',
    frase: (v) => v.toLowerCase(),
    porGenero: {
      femenino: [
        'Melena larga y lisa', 'Melena larga ondulada', 'Media melena', 'Corto',
        'Coleta alta', 'Coleta baja', 'Trenza', 'Moño', 'Recogido con lazo', 'Rizado',
      ],
      masculino: [
        'Corto y revuelto', 'Corto y peinado', 'Rapado a los lados', 'Media melena',
        'Peinado hacia atrás', 'Con flequillo', 'Coleta baja', 'Rizado', 'Ondulado'
      ],
    },
  },
  {
    id: 'eyes',
    etiqueta: 'Ojos',
    frase: (v) => `ojos ${v.toLowerCase()}`,
    opciones: ['Negros', 'Castaños', 'Color miel', 'Verdes', 'Azules', 'Grises', 'Ámbar', 'Violetas'],
  },
  {
    id: 'skin',
    etiqueta: 'Piel',
    frase: (v) => `piel ${v.toLowerCase()}`,
    opciones: ['Muy clara', 'Clara', 'Cálida', 'Morena', 'Oscura'],
  },
  {
    id: 'build',
    etiqueta: 'Cuerpo',
    frase: (v) => v.toLowerCase(),
    porGenero: {
      femenino: [
        'Esbelta y estilizada', 'Atlética', 'Curvilínea', 'Menuda',
        'Alta y de piernas largas', 'Grácil y de cuello largo',
      ],
      masculino: [
        'Atlético y de hombros anchos', 'Esbelto y fibrado', 'Alto y de línea limpia',
        'Fuerte y corpulento', 'Delgado', 'Complexión media',
      ],
    },
  },
  {
    id: 'age',
    etiqueta: 'Edad aparente',
    frase: (v) => v.toLowerCase(),
    opciones: ['Entre 18 y 24 años', 'Entre 25 y 32 años', 'Entre 33 y 45 años', 'Más de 45 años'],
  },
  {
    id: 'wardrobe',
    etiqueta: 'Vestuario',
    frase: (v) => v.toLowerCase(),
    porGenero: {
      femenino: [
        'Minifalda', 'Falda corta', 'Falda larga', 'Vestido corto', 'Vestido largo',
        'Blusa y falda', 'Pantalón elegante', 'Vaqueros', 'Shorts',
        'Traje de concierto', 'Chaqueta de cuero', 'Vestido de gala',
      ],
      masculino: [
        'Camisa y pantalón', 'Camisa remangada', 'Traje completo', 'Esmoquin',
        'Chaleco y camisa', 'Jersey fino', 'Camiseta y vaqueros',
        'Chaqueta de cuero', 'Abrigo largo', 'Traje de concierto',
      ],
    },
  },
  {
    id: 'mood',
    etiqueta: 'Actitud',
    frase: (v) => `actitud ${v.toLowerCase()} al tocar`,
    opciones: ['Serena', 'Apasionada', 'Melancólica', 'Alegre', 'Intensa', 'Sensual', 'Elegante', 'Soñadora'],
  },
];

const RASGOS_POR_ID = new Map(RASGOS.map((r) => [r.id, r]));

/** El campo de texto libre de cada ficha, para lo que no cabe en un botón. */
const NOTAS_MAX = 400;

/**
 * Deja una ficha en la forma que espera el resto de la tubería.
 *
 * Devuelve `null` si la ficha está entera vacía. Eso importa: una ficha vacía
 * guardada como `{}` en el proyecto se leería después como «el usuario eligió
 * algo», y lo que hay que leer es «que decida el Director».
 */
function normalizarFicha(bruta) {
  if (!bruta || typeof bruta !== 'object' || Array.isArray(bruta)) return null;
  const ficha = {};
  for (const rasgo of RASGOS) {
    const valor = String(bruta[rasgo.id] == null ? '' : bruta[rasgo.id]).trim();
    // No se comprueba contra `opciones`: al lado de los botones hay texto libre
    // y «pelo lavanda con las puntas plateadas» es una respuesta legítima.
    if (valor) ficha[rasgo.id] = valor.slice(0, 120);
  }
  const notas = String(bruta.notes == null ? '' : bruta.notes).trim();
  if (notas) ficha.notes = notas.slice(0, NOTAS_MAX);
  return Object.keys(ficha).length ? ficha : null;
}

/**
 * Valida y normaliza la lista entera de fichas.
 *
 * Se conserva la POSICIÓN: la ficha 2 es la del intérprete 2 aunque la 1 esté
 * vacía. Por eso los huecos quedan como `null` en vez de comprimirse.
 * Devuelve `null` si no hay ni una sola ficha con contenido, para no guardar
 * un array de nulls en el proyecto.
 */
function normalizarFichas(bruto) {
  if (!Array.isArray(bruto)) return null;
  const fichas = bruto.slice(0, MAX_FICHAS).map(normalizarFicha);
  while (fichas.length && fichas[fichas.length - 1] === null) fichas.pop();
  return fichas.some(Boolean) ? fichas : null;
}

/** La ficha del intérprete número `n` (contando desde 1), o null. */
function fichaDe(config, n) {
  const fichas = config && config.performers;
  if (!Array.isArray(fichas)) return null;
  return fichas[n - 1] || null;
}

/**
 * Las líneas de prompt de una ficha, ya redactadas.
 *
 * Sólo salen los campos que el usuario rellenó. Los demás no aparecen: si
 * apareciera «Ojos: (sin especificar)» el modelo tendría una instrucción vacía
 * que interpretar.
 */
function frasesDe(ficha) {
  if (!ficha) return [];
  const salida = [];
  for (const rasgo of RASGOS) {
    const valor = ficha[rasgo.id];
    if (valor) salida.push({ id: rasgo.id, etiqueta: rasgo.etiqueta, frase: rasgo.frase(valor) });
  }
  return salida;
}

/** Lo que necesita la pantalla de configuración para dibujar las fichas. */
function catalogoDeRasgos() {
  return {
    max: MAX_FICHAS,
    // Los rasgos que cambian según el género viajan con SUS DOS LISTAS, y la
    // pantalla enseña la que toca. Antes había una sola lista para todo el
    // mundo, así que al elegir «masculino» seguían saliendo minifalda y melena
    // ondulada: la pantalla decía una cosa y el Director hacía otra.
    rasgos: RASGOS.map((r) => ({
      id: r.id,
      etiqueta: r.etiqueta,
      opciones: r.opciones || null,
      porGenero: r.porGenero || null,
    })),
    notasMax: NOTAS_MAX,
  };
}

/**
 * Las opciones de un rasgo para un banco concreto ('femenino' | 'masculino').
 *
 * Un rasgo sin `porGenero` vale igual para todos: un color de ojos es un color
 * de ojos. Sólo el peinado, el cuerpo y el vestuario se separan.
 */
function opcionesDe(rasgo, banco) {
  if (!rasgo) return [];
  if (rasgo.opciones) return rasgo.opciones;
  const dos = rasgo.porGenero || {};
  return dos[banco] || dos.femenino || [];
}

module.exports = {
  MAX_FICHAS,
  NOTAS_MAX,
  RASGOS,
  RASGOS_POR_ID,
  normalizarFicha,
  normalizarFichas,
  fichaDe,
  frasesDe,
  catalogoDeRasgos,
  opcionesDe,
};
