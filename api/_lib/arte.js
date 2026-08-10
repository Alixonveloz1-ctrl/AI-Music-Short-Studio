/**
 * El Director de Arte (PRD §16) y el Director de Fotografía (PRD §18).
 *
 * El Director de Arte es el dueño de la *biblia visual*: una única descripción
 * del personaje, el instrumento, el entorno, la luz y el acabado a partir de la
 * cual se compone absolutamente todo prompt del proyecto. Eso es lo que evita
 * que cada generación parezca una película distinta (PRD §17).
 *
 * Los prompts se escriben en español, igual que el resto del producto, y se le
 * muestran al usuario tal cual (PRD §19).
 */
const {
  FORMATIONS_BY_ID,
  INSTRUMENTS_BY_ID,
  PERFORMER_TYPES_BY_ID,
  SCENARIOS_BY_ID,
  VISUAL_STYLES_BY_ID,
} = require('./catalogo.js');

const SHOT_TYPE_LABELS = {
  establishing_wide: 'plano general de situación',
  wide: 'plano general',
  medium: 'plano medio',
  close_up: 'primer plano',
  face: 'primer plano del rostro',
  hands: 'plano detalle de las manos sobre el instrumento',
  instrument_detail: 'plano detalle del instrumento',
  detail: 'plano detalle del entorno',
  over_shoulder: 'plano por encima del hombro',
  low_angle: 'contrapicado',
  high_angle: 'picado',
  profile: 'plano lateral de perfil',
};

const CAMERA_MOVE_LABELS = {
  static: 'cámara fija',
  slow_push_in: 'acercamiento lento de cámara',
  slow_pull_out: 'alejamiento lento de cámara',
  pan_left: 'panorámica hacia la izquierda',
  pan_right: 'panorámica hacia la derecha',
  tilt_up: 'inclinación de cámara hacia arriba',
  tilt_down: 'inclinación de cámara hacia abajo',
  lateral_track_left: 'travelling lateral hacia la izquierda',
  lateral_track_right: 'travelling lateral hacia la derecha',
  handheld_drift: 'cámara en mano con deriva muy sutil',
  crane_up: 'grúa ascendente',
};

function shotTypeLabel(shotType) {
  return SHOT_TYPE_LABELS[shotType];
}

function cameraMoveLabel(move) {
  return CAMERA_MOVE_LABELS[move];
}

/**
 * Cosas que nunca queremos ver en un cortometraje musical.
 *
 * Cubre los fallos típicos de los generadores (manos y dedos, instrumentos
 * imposibles, texto y marcas de agua) y, sobre todo, que nadie cante: el
 * producto es instrumental, así que un cantante o una boca abierta cantando son
 * un defecto, no una variante aceptable.
 */
const BASE_NEGATIVE = [
  'manos deformes',
  'dedos de más o de menos',
  'anatomía imposible',
  'instrumento deformado o incompleto',
  'cuerdas o teclas mal alineadas',
  'rostro distorsionado',
  'ojos asimétricos',
  'texto',
  'logotipos',
  'marcas de agua',
  'subtítulos',
  'micrófono de voz',
  'cantante cantando',
  'boca abierta cantando',
  'collage',
  'doble exposición no intencionada',
  'baja resolución',
  // Lo de arriba son DEFECTOS. Lo de abajo es MEDIOCRIDAD, que hasta ahora no
  // contaba como fallo: una cara correcta, sana y del montón puntuaba como
  // éxito perfecto. Para este producto no lo es.
  'rostro anodino',
  'cara de foto de carné',
  'persona corriente o del montón',
  'aspecto desaliñado',
  'gesto cansado o de mal humor',
  'ojos apagados y sin brillo',
  'dibujo tosco o de aficionado',
  'proporciones torpes',
  'acabado sucio o descuidado',
];

function buildVisualBible(config, brief) {
  const instruments = config.instrumentIds
    .map((id) => INSTRUMENTS_BY_ID.get(id))
    .filter((i) => Boolean(i));
  const scenario = SCENARIOS_BY_ID.get(config.scenarioId);
  const style = VISUAL_STYLES_BY_ID.get(config.visualStyleId);
  const formation = FORMATIONS_BY_ID.get(config.formationId);
  const performerType = PERFORMER_TYPES_BY_ID.get(config.performerTypeId);

  const instrumentNames = instruments.map((i) => i.name);
  const postures = instruments.map((i) => `${i.name}: ${i.posture}`);
  const techniques = instruments.map((i) => `${i.name} se toca con ${i.technique}`);

  const location = config.scenarioCustom?.trim()
    ? `${scenario?.label ?? 'Escenario'} — ${config.scenarioCustom.trim()}`
    : brief.environment.location;

  const treatment = config.visualStyleCustom?.trim()
    ? `${style?.treatment ?? ''}. Indicaciones del usuario: ${config.visualStyleCustom.trim()}`
    : (style?.treatment ?? 'imagen cinematográfica');

  const reparto =
    Array.isArray(brief.cast) && brief.cast.length
      ? brief.cast.map((m) => ({ ...m }))
      : [{ ...brief.character, instrument: instrumentNames[0] ?? '' }];

  return {
    character: {
      summary: `${performerType?.descriptor ?? 'un intérprete'} — ${brief.character.summary}`,
      face: brief.character.face,
      hair: brief.character.hair,
      wardrobe: brief.character.wardrobe,
      build: brief.character.build,
      apparentAge: brief.character.apparentAge,
      accessories: brief.character.accessories,
    },
    // Un intérprete por músico, cada uno con su rostro. `character` es el
    // primero de la lista, para todo lo que sigue hablando en singular.
    cast: reparto,
    instrument: {
      names: instrumentNames,
      appearance: brief.instrumentAppearance,
      scale: 'proporción realista respecto al cuerpo del intérprete',
      positioning: postures.join('; '),
      physicalRelation: techniques.join('; '),
    },
    environment: {
      location,
      // El brief va PRIMERO porque es donde entra, encabezándolo, lo que
      // escribió el usuario. Al revés, su «decorada con luces decorativas»
      // quedaba el último de la lista, detrás de «skyline, grava, antenas».
      primaryElements: dedupe([...brief.environment.primaryElements, ...(scenario?.elements ?? [])]),
      secondaryElements: brief.environment.secondaryElements,
      atmosphere: brief.environment.atmosphere,
    },
    lighting: {
      timeOfDay: brief.timeOfDay,
      direction: brief.lighting.direction,
      intensity: brief.lighting.intensity,
      atmosphere: brief.lighting.atmosphere,
    },
    aesthetic: {
      style: style?.label ?? 'Cinematográfico',
      treatment,
      photography: style?.photography ?? 'fotografía cinematográfica',
      finish: `paleta dominante: ${brief.palette.join(', ')}`,
    },
    continuityRules: dedupe([
      // Con un solo músico la regla habla de él. Con varios, decir «mismo
      // rostro» sería pedir justo lo contrario de lo que hace falta: los
      // rostros son varios y lo que se repite es cuál le toca a cada uno.
      ...(reparto.length > 1
        ? [
            `Son ${reparto.length} personas distintas y cada una conserva SU rostro en todas las tomas`,
            ...reparto.map(
              (m, i) =>
                `Intérprete ${i + 1}${m.instrument ? ' (' + m.instrument + ')' : ''}: ${m.face}. Cabello: ${m.hair}. Vestuario: ${m.wardrobe}`,
            ),
          ]
        : [
            `Mismo rostro en todas las tomas: ${brief.character.face}`,
            `Mismo cabello: ${brief.character.hair}`,
            `Mismo vestuario: ${brief.character.wardrobe}`,
          ]),
      `Mismo instrumento: ${instrumentNames.join(' + ')} — ${brief.instrumentAppearance}`,
      `Misma relación física intérprete-instrumento: ${postures.join('; ')}`,
      `Mismo escenario y mismos elementos: ${location}`,
      `Misma iluminación: ${brief.lighting.direction}, ${brief.lighting.intensity}`,
      `Formación visible: ${formation?.description ?? 'un intérprete'}`,
      ...brief.continuityRules,
    ]),
    negativePrompt: BASE_NEGATIVE.join(', '),
  };
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

// Un bloque vacío devuelve cadena vacía para que joinBlocks lo descarte: así no
// aparecen encabezados sueltos sin viñetas debajo en el prompt final.
function block(title, lines) {
  const body = lines.filter((l) => Boolean(l && l.trim())).map((l) => `- ${l}`);
  if (body.length === 0) return '';
  return `${title}:\n${body.join('\n')}`;
}

function joinBlocks(blocks) {
  // Los bloques opcionales devuelven null cuando no aplican —una indicación
  // que el usuario no escribió, por ejemplo— así que se descartan antes de
  // tocarlos.
  return blocks.filter((b) => b && String(b).trim().length > 0).join('\n\n');
}

const CONTINUITY_HEADER =
  'CONTINUIDAD OBLIGATORIA (usa las imágenes de referencia aprobadas como verdad visual)';

// ─── El estilo manda, y va delante ───
//
// POR QUÉ ESTO EXISTE: se pidió «anime cinematográfico» y el personaje maestro
// salió fotorrealista, mientras que el escenario sí salió en anime. El prompt
// SÍ decía «anime cinematográfico» — pero como un punto más dentro de un bloque
// «Estilo» a mitad del texto, y el modelo lo trató como una sugerencia.
//
// Lo que funciona, y está comprobado en los otros estudios: el estilo va
// PRIMERO, en mayúsculas, declarado innegociable y con la lista de lo que
// queda prohibido. Un modelo de imagen obedece mucho mejor una prohibición
// concreta («nada de fotografía») que una descripción positiva.
//
// Y la segunda mitad del mismo problema: la prohibición sólo hablaba del MEDIO
// —«no me hagas una foto»— y nunca del NIVEL. El modelo obedecía y devolvía un
// dibujo cualquiera, con la cara que le saliera por defecto. Por eso ahora
// también está prohibido lo mediocre, en la misma línea y con el mismo tono.
const PROHIBIDO_MEDIOCRE =
  'rostro anodino o de foto de carné, personas corrientes o desaliñadas, ' +
  'gesto cansado o de mal humor, dibujo tosco o de aficionado, ' +
  'proporciones torpes, ojos apagados y sin brillo, acabado sucio o descuidado';

const PROHIBIDO_POR_ESTILO = {
  // Los estilos dibujados comparten enemigo: que se cuele la fotografía.
  dibujado: 'fotografía, fotorrealismo, render 3D, CGI, imagen de acción real, ' +
    'piel con poros y textura fotográfica, aspecto de Pixar o Disney 3D',
  // Y los realistas, el contrario.
  real: 'anime, manga, dibujo animado, ilustración, cel-shading, línea de tinta, ' +
    'aspecto de cómic o de caricatura',
};

/**
 * EL LISTÓN. Va en la cabecera, junto al estilo y con el mismo rango.
 *
 * Decir de qué medio es la imagen no dice de qué calidad es. Sin esta línea el
 * modelo entiende «esto es un dibujo» y entrega el dibujo del montón.
 */
const LISTON_POR_FAMILIA = {
  dibujado:
    'ILUSTRACIÓN DE GAMA ALTA, del nivel de una portada o de una lámina promocional: ' +
    'línea limpia y fina, sombreado suave con degradados pintados, piel luminosa y sin ' +
    'textura fotográfica, ojos dibujados con detalle —iris con matices y brillos, pestañas ' +
    'marcadas—, resplandor suave en cada fuente de luz, fondo con desenfoque y máximo nivel ' +
    'de detalle en el primer término',
  real:
    'IMAGEN DE GAMA ALTA, del nivel de una portada: enfoque nítido en el rostro y en las manos, ' +
    'piel bien iluminada, ojos con brillo y detalle, desenfoque limpio en el fondo y máximo ' +
    'nivel de detalle en el primer término',
};

/**
 * LA BELLEZA, que no depende del estilo.
 *
 * El usuario lo pidió con todas las letras: «los personajes que genere la
 * herramienta siempre tienen que ser hermosos». No era un requisito de un
 * proyecto suyo, era del producto, así que vive aquí y entra en todos los
 * prompts donde aparezca una persona.
 *
 * Está escrito sin una sola palabra de anime a propósito: la belleza es
 * transversal y el estilo de dibujo ya lo pone la cabecera, así que estas
 * mismas líneas tienen que servir igual en óleo, en acuarela o en realista.
 */
const EXIGENCIA_DE_BELLEZA = [
  'La persona tiene que ser GUAPA y con encanto: rasgos armónicos y bien proporcionados, ' +
    'expresión serena y agradable, piel luminosa y cuidada',
  'Ojos expresivos y con vida, de mirada limpia; pestañas y cejas bien dibujadas',
  'Postura elegante y natural, propia de quien sabe estar en escena',
  'Vestuario impecable y bien puesto: nada arrugado, sucio ni descolocado',
  'Nada de aspecto corriente, cansado ni desaliñado: esta imagen tiene que ser bonita de ver',
  'Sigue siendo una persona real y creíble: guapa, no artificial ni de muñeco',
  'Es una intérprete de música en escena, vestida y elegante: nada de poses ni de encuadres sexualizados',
];

/** Qué familia es cada estilo, para saber contra qué hay que protegerlo. */
const FAMILIA_DE_ESTILO = {
  anime_2d: 'dibujado',
  anime_cinematic: 'dibujado',
  manga: 'dibujado',
  illustration: 'dibujado',
  fantasy: 'dibujado',
  dark_fantasy: 'dibujado',
  oil: 'dibujado',
  watercolor: 'dibujado',
  realistic: 'real',
  cinematic_realistic: 'real',
  retro: '',
  vintage: '',
  other: '',
};

/**
 * La cabecera de estilo que abre TODOS los prompts de imagen del proyecto.
 *
 * Se compone una sola vez en la biblia visual y se repite igual en el
 * personaje, el escenario, la escena y cada toma: si cada prompt describiera el
 * estilo a su manera, las imágenes no parecerían la misma película, que es
 * justo lo que esta herramienta viene a evitar.
 */
function cabeceraDeEstilo(bible, config) {
  const familia = FAMILIA_DE_ESTILO[config.visualStyleId] || '';
  const prohibido = PROHIBIDO_POR_ESTILO[familia] || '';
  const liston = LISTON_POR_FAMILIA[familia] || LISTON_POR_FAMILIA.dibujado;
  const partes = [
    'ESTILO VISUAL (INNEGOCIABLE, se aplica a TODA la imagen y a cada persona ' +
      'que aparezca en ella): ' + bible.aesthetic.treatment + '. ' +
      bible.aesthetic.photography + '. ' + bible.aesthetic.finish + '.',
    'CALIDAD (mismo rango que el estilo): ' + liston + '.',
  ];
  if (config.visualStyleCustom && String(config.visualStyleCustom).trim()) {
    partes.push('Indicación del usuario sobre el estilo: ' + String(config.visualStyleCustom).trim() + '.');
  }
  partes.push(
    'TERMINANTEMENTE PROHIBIDO: ' +
      (prohibido ? prohibido + ', ' : '') +
      PROHIBIDO_MEDIOCRE + '.',
  );
  return partes.join(' ');
}


/** PERSONAJE MAESTRO — el primer eslabón de la cadena de continuidad (PRD §17). */
/**
 * LO QUE ESCRIBIÓ EL USUARIO, con prioridad declarada.
 *
 * Su texto ya se mezclaba en la descripción del lugar, pero como una frase más
 * entre las demás: pidió «azotea de noche con luces decorativas» y el prompt
 * seguía enumerando «skyline, suelo de grava, antenas» del catálogo y una hora
 * del día que había puesto el planificador. Tres indicaciones del mismo rango
 * que se contradicen, y el modelo eligió la que quiso.
 *
 * Lo que él escribe no es una sugerencia: es lo único que no salió de una
 * lista. Va aparte, señalado, y diciendo que gana.
 */
function bloqueIndicacion(texto, sobre) {
  const t = String(texto || '').trim();
  if (!t) return null;
  return 'INDICACIÓN DEL USUARIO SOBRE ' + sobre + ' (MANDA sobre todo lo que ' +
    'venga después: si algo de abajo la contradice, se ignora): ' + t;
}

/**
 * RETRATO MAESTRO DE UN INTÉRPRETE.
 *
 * Hay UNO POR CADA intérprete de la formación, no uno con todos dentro. Con
 * todos en la misma imagen no se puede usar ninguno como referencia limpia: al
 * generar una toma, el modelo recibe una imagen con dos personas y mezcla sus
 * caras, sus ropas y sus instrumentos. Separados, cada toma puede pedir
 * exactamente la identidad que necesita.
 *
 * `indice` va de 1 a `total`, e `instrumento` es el que le toca a ESTE
 * intérprete.
 */
/**
 * El intérprete número `n` (contando desde 1) del reparto.
 *
 * Si la biblia viene de una versión anterior y no trae reparto, se cae al
 * personaje único de siempre: peor, pero nunca roto.
 */
function interprete(bible, n) {
  const reparto = Array.isArray(bible.cast) ? bible.cast : [];
  return reparto[n - 1] || reparto[0] || bible.character;
}

/**
 * El reparto entero, uno por línea, para los prompts donde salen varios a la vez.
 *
 * Devuelve null cuando sólo hay un intérprete: ahí no hay a quién distinguir y
 * la lista sólo sería ruido.
 */
function bloqueReparto(bible) {
  const reparto = Array.isArray(bible.cast) ? bible.cast : [];
  if (reparto.length < 2) return null;
  return block(
    'REPARTO — son ' + reparto.length + ' PERSONAS DISTINTAS, no la misma repetida',
    reparto.map(
      (m, i) =>
        `Intérprete ${i + 1}${m.instrument ? ' (' + m.instrument + ')' : ''}: ` +
        `${m.face}. Cabello: ${m.hair}. Vestuario: ${m.wardrobe}. ${m.build}`,
    ),
  );
}

/**
 * De un texto que describe VARIOS instrumentos, deja sólo el del intérprete.
 *
 * La biblia guarda la apariencia y la posición de todos los instrumentos del
 * proyecto en una sola cadena, con el formato «Violín: … ; Violonchelo: …».
 * Para un retrato individual hay que quedarse con su trozo. Si no se reconoce
 * el formato se devuelve el texto entero: peor, pero nunca vacío.
 */
function soloSuInstrumento(texto, nombre) {
  const entero = String(texto || '');
  if (!nombre) return entero;
  const trozos = entero.split(/(?:\. |; )/);
  const suyos = trozos.filter((t) => t.trim().toLowerCase().startsWith(nombre.toLowerCase() + ':'));
  return suyos.length ? suyos.join('. ') : entero;
}

function buildCharacterPrompt(bible, config, indice, total, instrumento) {
  const n = indice || 1;
  const cuantos = total || 1;
  const enGrupo = cuantos > 1;
  // Cada intérprete tiene SU descripción en el reparto. Compartir una sola era
  // la razón de que salieran dos veces la misma chica.
  const quien = interprete(bible, n);
  const suyo = instrumento || quien.instrument || bible.instrument.names.join(' y ');

  return joinBlocks([
    cabeceraDeEstilo(bible, config),
    bloqueIndicacion(config.creativeDirection, 'EL CORTO'),
    'RETRATO MAESTRO DE INTÉRPRETE' + (enGrupo ? ' ' + n + ' DE ' + cuantos : '') +
      '. UNA SOLA PERSONA en el encuadre, de cuerpo entero, sosteniendo su ' + suyo +
      ' en posición de interpretación, sobre fondo neutro y limpio.',
    block('Persona', [
      quien.summary,
      `Rostro: ${quien.face}`,
      `Cabello: ${quien.hair}`,
      `Complexión: ${quien.build}`,
      `Edad aparente: ${quien.apparentAge}`,
      `Vestuario: ${quien.wardrobe}`,
      quien.accessories && quien.accessories.length
        ? `Accesorios: ${quien.accessories.join(', ')}`
        : null,
    ]),
    block('Instrumento', [
      `Instrumento: ${suyo}`,
      // En un retrato individual sólo cabe SU instrumento. Antes se volcaba la
      // descripción de todos los del proyecto, así que al retrato del chelo se
      // le colaba la ficha del violín y a veces salía el instrumento cambiado.
      `Apariencia: ${soloSuInstrumento(bible.instrument.appearance, suyo)}`,
      `Posición: ${soloSuInstrumento(bible.instrument.positioning, suyo)}`,
      `Escala: ${bible.instrument.scale}`,
    ]),
    block('Acabado', [bible.aesthetic.finish]),
    block('Requisitos', [
      'UNA SOLA PERSONA: no debe aparecer nadie más en el encuadre',
      'UN SOLO INSTRUMENTO: el suyo, y ninguno más',
      // Sin esto salen clones: el modelo recibe la misma descripción para los
      // dos intérpretes y devuelve dos veces la misma cara. Pero la diferencia
      // va en la CARA y el PELO, no en la ropa: la versión anterior pedía «otro
      // color de ropa» y eso deshacía el grupo. Un dúo va conjuntado.
      enGrupo
        ? 'Esta persona tiene que ser CLARAMENTE DISTINTA ' +
          (cuantos === 2
            ? 'del otro intérprete del grupo'
            : 'de los otros ' + (cuantos - 1) + ' intérpretes del grupo') +
          ': OTRO ROSTRO y OTRO PEINADO, que se reconozcan a simple vista como ' +
          'personas diferentes'
        : null,
      enGrupo
        ? 'El VESTUARIO, en cambio, es el mismo para todo el grupo: van ' +
          'conjuntados, como un dúo o un ensamble que sale a tocar junto. Sólo ' +
          'cambia el pequeño detalle que lleva esta persona'
        : null,
      ...EXIGENCIA_DE_BELLEZA,
      'Manos completas y correctas, cinco dedos por mano',
      'El instrumento debe estar completo y bien construido',
      'Sin texto ni marcas de agua',
      'Esta imagen será la referencia oficial de este intérprete para todo el corto',
    ]),
  ]);
}

/** ESCENARIO MAESTRO — la localización sin el intérprete. */
function buildEnvironmentPrompt(bible, config) {
  return joinBlocks([
    cabeceraDeEstilo(bible, config),
    // ESTA IMAGEN VA VACÍA, y hay que decirlo tres veces.
    //
    // Es la referencia del LUGAR: sirve para que todas las tomas ocurran en el
    // mismo sitio. Si aquí sale alguien tocando, esa persona se cuela como
    // referencia en las tomas siguientes y acaban saliendo intérpretes
    // duplicados en el mismo encuadre.
    //
    // Decirlo una vez y de pasada no basta: ya se probó, y el modelo puso dos
    // músicas en la azotea igual. Va al principio, en mayúsculas, y se repite
    // al final entre los requisitos.
    'ESCENARIO VACÍO. NO debe aparecer ninguna persona, ni figura humana, ' +
      'ni silueta, ni sombra de nadie, ni instrumentos musicales. Solo el lugar.',
    bloqueIndicacion(config && config.scenarioCustom, 'EL ESCENARIO'),
    bloqueIndicacion(config && config.creativeDirection, 'EL CORTO'),
    `PLANO MAESTRO DE ESCENARIO: ${bible.environment.location}.`,
    block('Elementos principales', bible.environment.primaryElements),
    block('Elementos secundarios', bible.environment.secondaryElements),
    block('Iluminación', [
      `Momento del día: ${bible.lighting.timeOfDay}`,
      `Dirección: ${bible.lighting.direction}`,
      `Intensidad: ${bible.lighting.intensity}`,
      `Atmósfera: ${bible.lighting.atmosphere}`,
    ]),
    block('Acabado', [bible.aesthetic.finish]),
    block('Requisitos', [
      'SIN PERSONAS: el encuadre está completamente vacío de figuras humanas',
      'Sin instrumentos musicales: solo el lugar',
      'Composición amplia y legible, con sitio libre donde colocar al intérprete después',
      'Esta imagen será la referencia oficial del escenario para todo el corto',
    ]),
  ]);
}

/** ESCENA MAESTRA — personaje y entorno juntos; el ancla de todas las tomas. */
function buildScenePrompt(bible, config) {
  const formation = FORMATIONS_BY_ID.get(config.formationId);
  return joinBlocks([
    cabeceraDeEstilo(bible, config),
    bloqueIndicacion(config.scenarioCustom, 'EL ESCENARIO'),
    bloqueIndicacion(config.creativeDirection, 'EL CORTO'),
    `PLANO MAESTRO DE ESCENA. ${bible.character.summary} interpretando su ${bible.instrument.names.join(' y ')} dentro de ${bible.environment.location}.`,
    // Con más de un músico hay que decir quién es quién, o la escena maestra
    // devuelve dos veces la misma persona y arrastra ese error a todas las tomas.
    bloqueReparto(bible),
    block('Puesta en escena', [
      formation?.description ?? 'un intérprete en el centro de la escena',
      `Relación con el instrumento: ${bible.instrument.physicalRelation}`,
      `Atmósfera: ${bible.environment.atmosphere}`,
    ]),
    block(CONTINUITY_HEADER, bible.continuityRules),
    block('Acabado', [bible.aesthetic.finish]),
    block('Requisitos', [
      'El personaje debe ser exactamente el de la referencia de personaje aprobada',
      'El escenario debe ser exactamente el de la referencia de escenario aprobada',
      ...EXIGENCIA_DE_BELLEZA,
      'Esta imagen será la referencia oficial de la escena para todas las tomas',
    ]),
  ]);
}

/** Planos donde no aparece ninguna cara, asi que no hay belleza que exigir. */
const SIN_PERSONAS = ['instrument_detail', 'detail'];

/** Imagen fija de cada toma, compuesta con la biblia más la intención de la toma. */
function buildShotImagePrompt(bible, shot, config) {
  return joinBlocks([
    cabeceraDeEstilo(bible, config || bible.config || {}),
    bloqueIndicacion(config && config.scenarioCustom, 'EL ESCENARIO'),
    bloqueIndicacion(config && config.creativeDirection, 'EL CORTO'),
    `${shot.label.toUpperCase()} — ${SHOT_TYPE_LABELS[shot.shotType]}.`,
    shot.description,
    block('Intención', [shot.purpose, `Momento del corto: ${beatLabel(shot.beat)}`]),
    block('Encuadre', [
      `Tipo de plano: ${SHOT_TYPE_LABELS[shot.shotType]}`,
      `Movimiento previsto en el vídeo: ${CAMERA_MOVE_LABELS[shot.cameraMove]}`,
    ]),
    bloqueReparto(bible),
    // Un plano detalle del instrumento o del entorno no lleva a nadie dentro:
    // pedirle belleza de rostro ahi solo confunde al modelo.
    SIN_PERSONAS.indexOf(shot.shotType) === -1 ? block('La persona', EXIGENCIA_DE_BELLEZA) : null,
    block(CONTINUITY_HEADER, bible.continuityRules),
    block('Acabado', [bible.aesthetic.finish]),
  ]);
}

/** Prompt de vídeo de cada clip, anclado en la imagen aprobada de su toma. */
function buildClipPrompt(bible, shot, clip, totalClips) {
  const phase =
    totalClips === 1
      ? 'toma completa'
      : clip.index === 0
        ? 'primer tramo de la toma'
        : clip.index === totalClips - 1
          ? 'tramo final de la toma'
          : `tramo intermedio ${clip.index + 1} de ${totalClips}`;
  return joinBlocks([
    `${clip.label.toUpperCase()} (${phase}, ${clip.durationSec} s). Anima la imagen de referencia aprobada de ${shot.label}.`,
    shot.description,
    block('Movimiento', [
      `Cámara: ${CAMERA_MOVE_LABELS[shot.cameraMove]}, muy suave y continuo`,
      'Intérprete: movimiento natural de interpretación, coherente con la técnica del instrumento',
      `Relación intérprete-instrumento: ${bible.instrument.physicalRelation}`,
      `Entorno: ${bible.environment.atmosphere}`,
    ]),
    block(CONTINUITY_HEADER, [
      'El primer fotograma debe coincidir con la imagen de referencia aprobada',
      ...bible.continuityRules,
    ]),
    block('Requisitos', [
      'Sin cortes internos ni cambios de plano',
      'Sin deformaciones en manos, rostro ni instrumento',
      'Sin texto en pantalla',
      'Movimiento contenido: mejor poco movimiento correcto que mucho movimiento roto',
    ]),
  ]);
}

function beatLabel(beat) {
  switch (beat) {
    case 'opening':
      return 'apertura';
    case 'development':
      return 'desarrollo';
    case 'climax':
      return 'clímax';
    case 'closing':
      return 'cierre';
    default:
      return beat;
  }
}

/** Defectos que solo aparecen al animar, así que se añaden solo al prompt de vídeo. */
const NEGATIVE_VIDEO_EXTRA = [
  'parpadeo entre fotogramas',
  'morphing del rostro',
  'dedos que se funden',
  'instrumento que cambia de forma',
  'cambio de plano brusco',
].join(', ');

module.exports = {
  shotTypeLabel,
  cameraMoveLabel,
  buildVisualBible,
  buildCharacterPrompt,
  buildEnvironmentPrompt,
  buildScenePrompt,
  buildShotImagePrompt,
  buildClipPrompt,
  BASE_NEGATIVE,
  NEGATIVE_VIDEO_EXTRA,
};
