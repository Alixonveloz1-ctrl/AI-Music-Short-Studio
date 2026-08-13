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
  generoDe,
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
  // El plano con el que termina todo corto. Su etiqueta ya dice lo esencial,
  // porque es lo que lo distingue de los otros trece: aquí no se toca.
  closing_still: 'plano final, con el instrumento ya bajado y SIN TOCAR',
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
  // Y esto es lo tercero: no un defecto de dibujo ni de gusto, sino de MONTAJE.
  // La figura y el sitio salían como dos capas pegadas.
  'personaje recortado y pegado sobre el fondo',
  'fondo plano como un telón pintado detrás',
  'figura flotando, sin sombra de contacto con el suelo',
  'persona y fondo con perspectivas distintas',
  'persona a una escala que no corresponde al fondo',
  'fotomontaje',
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
    // Decisión del Director sobre el vestuario del grupo: 'conjuntado' o
    // 'individual'. No es una regla del producto, es una opción creativa.
    wardrobeGroup: brief.wardrobeGroup === 'individual' ? 'individual' : 'conjuntado',
    instrument: {
      names: instrumentNames,
      appearance: brief.instrumentAppearance,
      scale: 'proporción realista respecto al cuerpo del intérprete',
      positioning: postures.join('; '),
      physicalRelation: techniques.join('; '),
    },
    environment: {
      location,
      // DÓNDE SE PONE LA PERSONA DENTRO DEL SITIO, y qué se mueve ahí. Sin el
      // primero, el modelo la coloca donde le parece —el usuario mandó un
      // guitarrista de pie ENCIMA DE LAS BUTACAS de un auditorio, teniendo el
      // escenario al lado— y sin el segundo, el vídeo anima al personaje sobre
      // un fondo congelado: «un bosque lleno de árboles, y los árboles quietos
      // ni se movían, parecían una imagen fija».
      donde: (scenario && scenario.donde) || '',
      movimiento: (scenario && scenario.movimiento) || '',
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
    // QUÉ MÚSICA SUENA MIENTRAS SE VE ESTO. No es un adorno del prompt: de aquí
    // sale con cuánta fuerza se mueven las manos. Sin este dato la imagen y la
    // música salían de fuentes distintas y no pegaban — el usuario montó un
    // cuatro y el personaje rasgueaba joropo a toda velocidad mientras sonaba
    // una pieza melancólica de cuerdas pulsadas una a una.
    music: musicaQueSuena(config, instruments, brief),
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

/**
 * CÓMO SE TOCA, según lo que va a sonar.
 *
 * Tres intensidades, y cada una dice lo mismo de dos maneras: `imagen` describe
 * una postura congelada —que es lo único que puede enseñar una foto— y `video`
 * describe el movimiento. Están separadas porque pedirle «las manos vuelan» a
 * una imagen fija sólo consigue manos borrosas.
 */
const ENERGIA_AL_TOCAR = {
  alta: {
    resumen: 'a toda intensidad',
    imagen: [
      'Está tocando FUERTE, en pleno esfuerzo: el gesto está en su punto más amplio',
      'El cuerpo acompaña —hombros y torso metidos en el golpe, peso hacia delante—',
      'La cara es de concentración intensa, no de calma; puede haber ceño, boca entreabierta o sonrisa de disfrute',
      'Manos y dedos en una posición de ataque, no en reposo sobre el instrumento',
    ],
    video: [
      'Toca RÁPIDO y FUERTE: el gesto es amplio, rítmico y sin pausas',
      'El cuerpo se mueve con la música: hombros, torso y cabeza marcan el pulso',
      'Nada de un movimiento lento y contemplativo: aquí hay energía y esfuerzo visible',
    ],
  },
  media: {
    resumen: 'con energía sostenida',
    imagen: [
      'Está tocando con energía sostenida: el gesto es firme y claro, ni tímido ni desbocado',
      'El cuerpo acompaña la música con un movimiento contenido',
      'La cara está concentrada en lo que toca',
    ],
    video: [
      'Toca con energía sostenida y constante, con el gesto claro y bien marcado',
      'El cuerpo acompaña el pulso sin exagerarlo',
    ],
  },
  suave: {
    resumen: 'con delicadeza',
    imagen: [
      'Está tocando SUAVE: el gesto es pequeño, delicado y sin tensión',
      'El cuerpo está sereno, casi quieto; el peso repartido y los hombros bajos',
      'La cara es de calma o de recogimiento, con los ojos entornados o cerrados',
    ],
    video: [
      'Toca DESPACIO y SUAVE: el gesto es lento, mínimo y muy controlado',
      'El cuerpo casi no se mueve; sólo respira y sigue la música por dentro',
      'Nada de golpes fuertes ni de movimientos rápidos: aquí la música es delicada',
    ],
  },
};

/**
 * El género que va a sonar y con cuánta fuerza se toca, para la parte visual.
 *
 * DE DÓNDE SALE LA ENERGÍA, y por qué de ahí. Si el usuario ELIGIÓ el género a
 * mano, manda su energía: es la señal más clara que puede dar. Si lo dejó en
 * «que lo decida el director», manda el TEMPO que el Director acabó fijando —
 * que es el mismo arbitraje que ya se hace con el carácter, donde el género
 * sugerido por el instrumento entra el último, por detrás del estilo visual y
 * del escenario.
 *
 * Sin esa distinción salía una contradicción dentro del propio prompt: un
 * cuatro sugiere joropo, joropo es energía alta, y el prompt de vídeo pedía «a
 * toda intensidad» encima de una pieza que el Director había puesto a 84 BPM.
 */
const ENERGIA_POR_TEMPO = { alta: 110, suave: 70 };

function musicaQueSuena(config, instruments, brief) {
  const genero = generoDe(config || {}, instruments || []);
  const elegidoAMano = genero.id !== 'other' && Boolean(config && config.musicGenreId) &&
    config.musicGenreId !== 'auto' && config.musicGenreId === genero.id;

  const bpm = Number((brief && brief.music && brief.music.tempoBpm) || genero.bpm || 0);
  const porTempo = bpm >= ENERGIA_POR_TEMPO.alta ? 'alta'
    : bpm && bpm <= ENERGIA_POR_TEMPO.suave ? 'suave'
      : 'media';

  return {
    genreId: genero.id,
    genreLabel: genero.label || '',
    energia: (elegidoAMano && genero.energia) || porTempo,
    tempoBpm: bpm,
  };
}

/** El bloque de prompt que ata el gesto del intérprete a la música que suena. */
function bloqueComoSeToca(bible, cual) {
  const musica = bible && bible.music;
  if (!musica) return '';
  const nivel = ENERGIA_AL_TOCAR[musica.energia] || ENERGIA_AL_TOCAR.media;
  const suena = musica.genreLabel
    ? `La música que suena en este momento es ${musica.genreLabel}` +
      (musica.tempoBpm ? ` (unos ${musica.tempoBpm} BPM)` : '') +
      `, y se toca ${nivel.resumen}`
    : `La música se toca ${nivel.resumen}`;
  return block('LA MÚSICA Y LA IMAGEN TIENEN QUE PEGAR', [suena, ...nivel[cual]]);
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
    'piel bien iluminada y con buen tratamiento, ojos con brillo y detalle, desenfoque limpio ' +
    'en el fondo y máximo nivel de detalle en el primer término',
  // Retro, vintage y «otro» no tienen un enemigo claro del que protegerlos,
  // pero el listón sí les toca: el usuario dijo que la imagen tiene que ser
  // fiel a SU estilo y además hermosa, sea el estilo que sea.
  libre:
    'ACABADO DE GAMA ALTA, del nivel de una portada, dentro del estilo indicado: máximo nivel ' +
    'de detalle en el primer término, rostro y manos bien resueltos, luz trabajada y ningún ' +
    'rastro de acabado tosco o descuidado',
};
/**
 * LA BELLEZA, que no depende del estilo.
 *
 * El usuario lo pidió con todas las letras, y luego subió el listón: «guapas no
 * es suficiente, quiero hermosas». No era el requisito de un proyecto suyo,
 * era del producto, así que vive aquí y entra en todos los prompts donde
 * aparezca una persona, en TODOS los estilos: si elige óleo o realismo, la
 * imagen tiene que ser fiel a ese estilo y además con gente hermosa.
 *
 * Está escrito sin una sola palabra de anime a propósito: la belleza es
 * transversal y el estilo de dibujo ya lo pone la cabecera.
 *
 * Va por género porque no se pide lo mismo, y porque el usuario elige el tipo
 * de intérprete en la pantalla de configuración.
 */
const BELLEZA_POR_BANCO = {
  femenino:
    'ELLA TIENE QUE SER HERMOSA, no simplemente correcta: una belleza notable y memorable, ' +
    'de la cabeza a los pies. Rostro delicado y de rasgos armónicos, cuerpo esbelto y de ' +
    'proporciones perfectas, melena bonita, manos finas y porte elegante. Si al mirar la ' +
    'imagen no se piensa «qué guapa es», está mal hecha',
  masculino:
    'ÉL TIENE QUE SER MUY ATRACTIVO, no simplemente correcto: guapo de verdad, de la cabeza ' +
    'a los pies. Facciones armónicas y bien definidas, cuerpo atlético y de proporciones ' +
    'perfectas, buen pelo, manos cuidadas y porte elegante. Si al mirar la imagen no se ' +
    'piensa «qué guapo es», está mal hecha',
};

const BELLEZA_COMUN = [
  // Petición literal: «la belleza va en todo, desde la cara, cuerpo, cabello,
  // todo». Antes sólo se hablaba del rostro y el resto salía descuidado.
  'La belleza está en TODO, no sólo en la cara: el rostro, el cuerpo, el cabello, las manos, ' +
    'la piel, la ropa y la manera de moverse. Cada una de esas cosas tiene que estar bonita',
  'Piel luminosa, tersa y cuidada; expresión serena y agradable',
  'Cabello con brillo, volumen y buena caída, peinado con intención',
  'Ojos expresivos y con vida, de mirada limpia; pestañas y cejas bien dibujadas',
  'Manos bonitas y bien dibujadas, de dedos largos y bien colocados sobre el instrumento',
  'Silueta favorecedora y postura elegante, propia de quien sabe estar en escena',
  'Vestuario impecable, bien puesto y que favorezca la figura: nada arrugado, sucio ni descolocado',
  'Nada de aspecto corriente, cansado ni desaliñado: esta imagen tiene que ser bonita de ver',
  'Sigue siendo una persona creíble: hermosa, no artificial ni de muñeco',
];
/**
 * La exigencia de belleza que le toca a un intérprete concreto.
 *
 * `banco` sale del tipo de intérprete que eligió el usuario. Si no se sabe
 * —una biblia vieja, un grupo mixto en un plano donde salen todos— se piden
 * las dos, que es lo correcto cuando en el cuadro hay hombres y mujeres.
 */
function exigenciaDeBelleza(banco) {
  const cual = BELLEZA_POR_BANCO[banco];
  return [...(cual ? [cual] : Object.values(BELLEZA_POR_BANCO)), ...BELLEZA_COMUN];
}
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
  retro: 'libre',
  vintage: 'libre',
  other: 'libre',
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
  const liston = LISTON_POR_FAMILIA[familia] || LISTON_POR_FAMILIA.libre;
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
/**
 * QUIÉN SALE EN ESTA TOMA, dicho en su propio bloque y sin ambigüedad.
 *
 * `shot.subject` lo decide el Director: 'todos' o el número del intérprete.
 * Con un solo músico no hay nada que aclarar y el bloque no aparece.
 */
function bloqueQuienSale(bible, shot) {
  const reparto = Array.isArray(bible.cast) ? bible.cast : [];
  if (reparto.length < 2) return null;

  if (typeof shot.subject === 'number' && reparto[shot.subject - 1]) {
    const quien = reparto[shot.subject - 1];
    return block('QUIÉN SALE EN ESTA TOMA', [
      `UNA SOLA PERSONA: el intérprete ${shot.subject} del grupo, el de${quien.instrument ? 'l ' + quien.instrument : ' este plano'}`,
      `Es esta persona y no otra: ${quien.face}. Cabello: ${quien.hair}. Vestuario: ${quien.wardrobe}`,
      'Los demás intérpretes del grupo NO aparecen en el encuadre, ni de fondo ni desenfocados',
    ]);
  }

  return block('QUIÉN SALE EN ESTA TOMA', [
    `LOS ${reparto.length} INTÉRPRETES, todos dentro del encuadre y todos tocando`,
    'No falta ninguno y no sobra nadie: son exactamente ' + reparto.length + ' personas',
  ]);
}

/** La exigencia de belleza de quien sale en la toma, no la del grupo entero. */
function bellezaDelSujeto(bible, sujeto) {
  const reparto = Array.isArray(bible.cast) ? bible.cast : [];
  if (typeof sujeto === 'number' && reparto[sujeto - 1]) {
    return exigenciaDeBelleza(reparto[sujeto - 1].banco);
  }
  return bellezaDelReparto(bible);
}

/** La exigencia de belleza para un plano donde puede salir todo el reparto. */
function bellezaDelReparto(bible) {
  const bancos = new Set((bible.cast || []).map((m) => m.banco).filter(Boolean));
  return exigenciaDeBelleza(bancos.size === 1 ? [...bancos][0] : null);
}

function bloqueReparto(bible, sujeto) {
  let reparto = Array.isArray(bible.cast) ? bible.cast : [];
  // Si la toma es de una sola persona, listar a las cuatro es invitar al modelo
  // a meterlas todas en el cuadro. Se lista sólo a quien sale.
  if (typeof sujeto === 'number' && reparto[sujeto - 1]) return null;
  if (reparto.length < 2) return null;
  return block(
    'REPARTO — son ' + reparto.length + ' PERSONAS DISTINTAS, no la misma repetida',
    reparto.map(
      (m, i) =>
        `Intérprete ${i + 1}${m.instrument ? ' (' + m.instrument + ')' : ''}: ` +
        `${m.face}. Cabello: ${m.hair}. ${m.build}. ` +
        `${m.apparentAge ? 'Edad aparente: ' + m.apparentAge + '. ' : ''}` +
        `Vestuario: ${m.wardrobe}${m.mood ? '. Actitud: ' + m.mood : ''}`,
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
      // Lo que el usuario eligió en la ficha de este intérprete.
      quien.mood ? `Actitud: ${quien.mood}` : null,
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
      // Que vayan conjuntados o no lo decide el Director por proyecto; lo que
      // no cambia nunca es que sean personas distintas.
      enGrupo
        ? bible.wardrobeGroup === 'individual'
          ? 'El vestuario de esta persona es el suyo, distinto del de los demás, ' +
            'pero dentro de la misma gama y del mismo mundo: se tienen que ver como ' +
            'un mismo grupo tocando junto'
          : 'El VESTUARIO es el mismo para todo el grupo: van conjuntados, como un ' +
            'dúo o un ensamble que sale a tocar junto. Sólo cambia el pequeño ' +
            'detalle que lleva esta persona'
        : null,
      ...exigenciaDeBelleza(quien.banco),
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
    // Ésta es LA referencia de todas las tomas: si aquí la gente sale pegada
    // sobre el fondo, sale pegada en el corto entero.
    bloqueDentroDelSitio(bible, null),
    // Con más de un músico hay que decir quién es quién, o la escena maestra
    // devuelve dos veces la misma persona y arrastra ese error a todas las tomas.
    bloqueReparto(bible, 'todos'),
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
      ...bellezaDelReparto(bible),
      'Esta imagen será la referencia oficial de la escena para todas las tomas',
    ]),
  ]);
}

/** Planos donde no aparece ninguna cara, asi que no hay belleza que exigir. */
/**
 * LA PERSONA ESTÁ DENTRO DEL SITIO, NO PEGADA ENCIMA.
 *
 * EL FALLO, y es el más grave que ha tenido la herramienta: «no está poniendo
 * al personaje en los escenarios, simplemente lo está montando como sobre un
 * fondo y ya». Un guitarrista de pie sobre las butacas de un auditorio, con el
 * escenario iluminado ahí al lado. Una chica sentada en un bosque «como si el
 * bosque fuera una pancarta de fondo».
 *
 * POR QUÉ PASABA. El prompt describía a la persona en una lista y el lugar en
 * otra, sin nada que las uniera. Dos listas separadas se componen como dos
 * capas separadas, que es literalmente lo que salía. Nada pedía lo único que
 * hace que una figura pertenezca a un sitio:
 *
 *   - APOYARSE en algo concreto de ese sitio, y proyectar sombra sobre ello.
 *   - Compartir la PERSPECTIVA: un solo horizonte, una sola altura de cámara.
 *     Sin esto la figura se dibuja de frente y a tamaño de retrato mientras el
 *     fondo tiene su propia fuga, y el ojo lo lee como un recorte.
 *   - Recibir la LUZ del lugar, con su dirección y su color.
 *   - Tener algo DELANTE y algo DETRÁS. Un encuadre con sólo figura y fondo son
 *     dos capas; con primer término son tres, y ahí ya hay espacio.
 */
function bloqueDentroDelSitio(bible, shot) {
  const ent = bible.environment || {};
  const luz = bible.lighting || {};
  // Sin toma es el PLANO MAESTRO DE ESCENA, que es abierto por definición: su
  // trabajo es enseñar el sitio entero con la gente dentro.
  const abierto = !shot || PLANOS_ABIERTOS.indexOf(shot.shotType) !== -1;

  return block('LA PERSONA ESTÁ DENTRO DEL SITIO, NO PEGADA ENCIMA', [
    ent.donde ? 'Dónde está exactamente: ' + ent.donde : '',
    'APOYADA de verdad: los pies (o el asiento, o la pica del instrumento) tocan una ' +
      'superficie concreta del lugar, y proyectan SU SOMBRA sobre ella',
    'UNA SOLA PERSPECTIVA para la persona y para el sitio: la misma línea de horizonte ' +
      'y la misma altura de cámara. Su tamaño tiene que corresponder a la distancia a la ' +
      'que está, no al tamaño que tendría en un retrato',
    'La luz del lugar CAE SOBRE ELLA: ' + [luz.direction, luz.intensity].filter(Boolean).join(', ') +
      '. Los mismos colores de luz en su piel, su ropa y su instrumento que en el suelo y las paredes',
    'Algo POR DELANTE y algo POR DETRÁS: primer término, figura y fondo. Tres planos de ' +
      'profundidad, no dos capas',
    'Aire entre la cámara y ella: la distancia se tiene que notar',
    abierto
      ? 'PLANO ABIERTO: el lugar se ve NÍTIDO y se lee entero. Aquí el fondo NO va ' +
        'desenfocado, aunque el estilo lo pida en general — un fondo borroso en un plano ' +
        'general es exactamente lo que lo convierte en un telón pintado'
      : '',
    'La prueba: si la figura se pudiera recortar con unas tijeras y el fondo quedara ' +
      'entero detrás, está MAL HECHA. Tiene que haber sombra, contacto y oclusión',
  ]);
}

/** Planos en los que el sitio se ve entero y tiene que leerse, no difuminarse. */
const PLANOS_ABIERTOS = ['establishing_wide', 'wide', 'high_angle', 'low_angle'];

const SIN_PERSONAS = ['instrument_detail', 'detail'];

/** El tipo de plano que cierra el corto. Mismo valor que en productor.js. */
const PLANO_DE_CIERRE = 'closing_still';

/**
 * EL PLANO CON EL QUE TERMINA EL CORTO: aquí nadie está tocando.
 *
 * Es la pieza que faltaba. La música que compone Lyria resuelve y deja dos o
 * tres segundos de silencio al final, y el corto terminaba con un plano
 * reutilizado en el que el intérprete seguía dándole al instrumento. El usuario:
 * «ya termina la música y quedan unos dos, tres segundos de silencio, pero el
 * personaje sigue tocando el instrumento, como si estuviera sonando».
 *
 * Pedirle al último clip que «dejara de tocar» no funcionaba porque ese clip era
 * material repetido de otro momento. Así que ahora hay un plano propio, con su
 * imagen, cuyo único trabajo es éste — y la imagen ya lo enseña quieto, así que
 * el vídeo no tiene que inventarse la transición de tocar a no tocar.
 */
const CIERRE_IMAGEN = [
  'NO ESTÁ TOCANDO. Éste es el único plano del corto en el que el instrumento no ' +
    'se está tocando, y es lo más importante de la imagen',
  'El instrumento está BAJADO y en reposo: colgando de la mano, apoyado en el ' +
    'suelo o sobre las piernas, o sujeto contra el cuerpo sin tocarlo. Nunca en ' +
    'posición de tocar',
  'Las manos están quietas y fuera de las cuerdas, las teclas o los parches: ' +
    'ni una mano en posición de ataque',
  'De pie o sentado en el mismo escenario, en una postura tranquila; puede mirar ' +
    'a cámara, al horizonte o al instrumento',
  'La expresión es de después: calma, respiración, algo de satisfacción o de ' +
    'melancolía. No es esfuerzo, no es concentración',
  'Todo lo demás sigue igual que en el resto del corto: la misma persona, el mismo ' +
    'vestuario, el mismo escenario y la misma luz',
];

// El clip de este plano puede colocarse VARIAS VECES en el montaje —vuelve
// durante el corto y además lo cierra—, así que sus instrucciones describen el
// PLANO y no el momento: nada de «la película se está apagando», que sería falso
// las veces que aparece a mitad.
const CIERRE_VIDEO = [
  'NO TOCA EN NINGÚN MOMENTO de este clip. Nada de retomar la interpretación, ni ' +
    'una nota, ni un gesto de empezar',
  'El movimiento es mínimo y de reposo: respirar, un parpadeo, el pelo o la ropa ' +
    'con el aire, una mirada lenta',
  'El instrumento sigue bajado del primer fotograma al último',
  'Empieza quieto y termina quieto, en la misma postura: este plano vuelve varias ' +
    'veces en el montaje y tiene que poder encajar en cualquiera de ellas',
];

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
    // DÓNDE SE PONE, y que de verdad esté ahí dentro. Va ANTES de describir a la
    // persona: primero el sitio y su sitio en él, después cómo es ella. Al revés
    // —que es como estaba— el modelo compone un retrato y luego le busca fondo.
    SIN_PERSONAS.indexOf(shot.shotType) === -1 ? bloqueDentroDelSitio(bible, shot) : null,
    // QUIÉN SALE. Sin esto, un dúo salía trece veces con la misma chica y la
    // otra desaparecía del corto entero.
    bloqueQuienSale(bible, shot),
    bloqueReparto(bible, shot.subject),
    // Un plano detalle del instrumento o del entorno no lleva a nadie dentro:
    // pedirle belleza de rostro ahi solo confunde al modelo.
    SIN_PERSONAS.indexOf(shot.shotType) === -1
      ? block('La persona', bellezaDelSujeto(bible, shot.subject))
      : null,
    // Con cuánta fuerza está tocando. En un plano detalle del instrumento no
    // hay nadie a quien pedírselo, pero en uno de las manos sí — y ahí es justo
    // donde más se nota si el gesto no pega con lo que suena. Y en el plano de
    // cierre no se pide NADA de esto, que es justo el que no toca.
    shot.shotType === 'detail' || shot.shotType === PLANO_DE_CIERRE
      ? null
      : bloqueComoSeToca(bible, 'imagen'),
    shot.shotType === PLANO_DE_CIERRE
      ? block('EL PLANO DE CIERRE: AQUÍ NO SE TOCA', CIERRE_IMAGEN)
      : null,
    block(CONTINUITY_HEADER, bible.continuityRules),
    block('Acabado', [bible.aesthetic.finish]),
  ]);
}

/** Prompt de vídeo de cada clip, anclado en la imagen aprobada de su toma. */
function buildClipPrompt(bible, shot, clip, totalClips, esElUltimoDelCorto) {
  // El plano de cierre se reconoce por su TIPO, no por su posición en la lista.
  // Antes se usaba «es el último de la película», y eso fallaba: el último hueco
  // lo ocupaba un clip REUTILIZADO de la apertura, escrito para el minuto uno,
  // así que la instrucción de dejar de tocar caía en un clip que también salía
  // antes tocando. Un clip no puede estar tocando y no tocando a la vez.
  const esCierre = shot.shotType === PLANO_DE_CIERRE || esElUltimoDelCorto === true;
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
      esCierre
        ? 'Intérprete: en reposo, sin tocar. El instrumento se queda bajado'
        : 'Intérprete: movimiento natural de interpretación, coherente con la técnica del instrumento',
      esCierre ? null : `Relación intérprete-instrumento: ${bible.instrument.physicalRelation}`,
      `Entorno: ${bible.environment.atmosphere}`,
    ].filter(Boolean)),
    // EL SITIO TAMBIÉN SE MUEVE. Sin esto Veo anima al personaje y deja el
    // fondo congelado, y el resultado es un recorte moviéndose sobre una foto:
    // «un bosque lleno de árboles, y los árboles quietos ni se movían».
    block('EL SITIO TAMBIÉN SE MUEVE, NO SÓLO LA PERSONA', [
      bible.environment.movimiento || 'algo del entorno se mueve todo el rato: aire, luz, polvo o agua',
      'El fondo NO puede quedarse congelado: si lo único que se mueve es el intérprete, ' +
        'el plano parece un recorte animado sobre una fotografía',
      'Ese movimiento es de fondo y continuo, nunca un acontecimiento que robe la atención',
      'La luz también vive: late, parpadea o cambia muy poco a lo largo del clip',
    ]),
    // Con cuánta fuerza toca. En el plano de cierre no se pide: es el que NO
    // toca, y pedirle intensidad de interpretación sería deshacerlo.
    esCierre ? null : bloqueComoSeToca(bible, 'video'),
    block(CONTINUITY_HEADER, [
      'El primer fotograma debe coincidir con la imagen de referencia aprobada',
      ...bible.continuityRules,
    ]),
    // EL FINAL DEL CORTO. Aquí ya no hay que pedirle al modelo que invente la
    // transición de tocar a no tocar: la imagen de referencia de este plano ya
    // enseña al intérprete quieto y con el instrumento bajado, así que el clip
    // sólo tiene que no estropearlo.
    esCierre ? block('EL PLANO DE CIERRE: AQUÍ NO SE TOCA', CIERRE_VIDEO) : null,
    block('Requisitos', [
      'Sin cortes internos ni cambios de plano',
      'Sin deformaciones en manos, rostro ni instrumento',
      'Sin texto en pantalla',
      esCierre
        ? 'El movimiento se va apagando hasta quedar quieto'
        : 'Movimiento contenido: mejor poco movimiento correcto que mucho movimiento roto',
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
  'fondo congelado mientras el personaje se mueve',
  'fondo que parece una fotografía fija',
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
  musicaQueSuena,
  ENERGIA_AL_TOCAR,
  BASE_NEGATIVE,
  NEGATIVE_VIDEO_EXTRA,
};
