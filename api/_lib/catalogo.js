/**
 * Los catálogos seleccionables con los que se construye la pantalla de
 * configuración (PRD §6–§10).
 *
 * Todo lo de aquí son datos, no interfaz: el servidor usa las mismas listas
 * para validar las configuraciones de proyecto que llegan y para dar al equipo
 * de producción un vocabulario concreto (un erhu se toca con arco y se sostiene
 * vertical sobre el muslo; un taiko se golpea de pie) de forma que los prompts
 * describan a alguien que de verdad está tocando.
 */

// InstrumentCategory: { id, label } — label en español, igual que la lista de
// categorías del PRD.

const INSTRUMENT_CATEGORIES = [
  { id: 'strings', label: 'Cuerdas' },
  { id: 'woodwind', label: 'Viento madera' },
  { id: 'brass', label: 'Viento metal' },
  { id: 'percussion', label: 'Percusión' },
  { id: 'keyboards', label: 'Teclados' },
  { id: 'traditional', label: 'Instrumentos tradicionales' },
  { id: 'electronic', label: 'Instrumentos electrónicos' },
  { id: 'folk', label: 'Instrumentos folclóricos' },
  { id: 'orchestral', label: 'Instrumentos orquestales' },
  { id: 'world', label: 'Instrumentos del mundo' },
];

/**
 * Constructor abreviado de instrumento. Cada instrumento es:
 *   id, name (nombre visible en el selector), categoryId,
 *   aliases (nombres locales, grafías alternativas, nombre en inglés: sirven
 *            para buscar),
 *   technique (cómo se toca — alimenta las notas de continuidad del Director
 *              de Arte),
 *   posture (cómo lo sostiene físicamente el intérprete — alimenta los prompts
 *            para que la anatomía salga bien),
 *   origin (origen cultural o estilístico, para los briefs de escena y música).
 * El orden de los argumentos NO es el orden de las claves del objeto: se
 * conserva tal cual estaba en el original para no tocar ninguna de las ~120
 * llamadas de abajo.
 */
const I = (id, name, categoryId, technique, posture, origin, aliases = []) => ({
  id,
  name,
  categoryId,
  technique,
  posture,
  origin,
  aliases,
});

const INSTRUMENTS = [
  // --- Cuerdas --------------------------------------------------------------
  I('violin', 'Violín', 'strings', 'arco sobre cuerdas', 'apoyado entre hombro y mentón, arco en la mano derecha', 'europeo', ['violin', 'fiddle']),
  I('viola', 'Viola', 'strings', 'arco sobre cuerdas', 'apoyada entre hombro y mentón', 'europeo', ['viola']),
  I('cello', 'Violonchelo', 'strings', 'arco sobre cuerdas, sentado', 'entre las rodillas, pica apoyada en el suelo', 'europeo', ['cello', 'violoncello', 'chelo']),
  I('double_bass', 'Contrabajo', 'strings', 'arco o pizzicato, de pie', 'vertical apoyado en el suelo, cuerpo inclinado hacia el intérprete', 'europeo', ['contrabajo', 'double bass', 'upright bass']),
  I('harp', 'Arpa', 'strings', 'pulsación con ambas manos', 'sentado, arpa inclinada sobre el hombro derecho', 'europeo', ['harp']),
  I('acoustic_guitar', 'Guitarra acústica', 'strings', 'punteo o rasgueo', 'sentado o de pie, guitarra sobre el muslo derecho', 'universal', ['guitarra', 'guitar', 'acoustic guitar']),
  I('classical_guitar', 'Guitarra clásica', 'strings', 'punteo con uñas', 'sentado, pie izquierdo elevado, guitarra sobre el muslo izquierdo', 'español', ['guitarra clasica', 'classical guitar']),
  I('flamenco_guitar', 'Guitarra flamenca', 'strings', 'rasgueo, picado y golpe', 'sentado, guitarra cruzada sobre el muslo derecho', 'español', ['guitarra flamenca', 'flamenco guitar']),
  I('electric_guitar', 'Guitarra eléctrica', 'strings', 'punteo con púa', 'de pie con correa', 'moderno', ['guitarra electrica', 'electric guitar']),
  I('bass_guitar', 'Bajo eléctrico', 'strings', 'pulsación con dedos o púa', 'de pie con correa', 'moderno', ['bajo', 'bass']),
  I('mandolin', 'Mandolina', 'strings', 'trémolo con púa', 'sostenida en diagonal sobre el pecho', 'italiano', ['mandolin']),
  I('banjo', 'Banjo', 'strings', 'punteo con dedales', 'sentado, resonador sobre el muslo', 'estadounidense', ['banjo']),
  I('ukulele', 'Ukelele', 'strings', 'rasgueo suave', 'sostenido contra el pecho', 'hawaiano', ['ukulele', 'uke']),
  I('lute', 'Laúd', 'strings', 'punteo con dedos', 'cuerpo abombado apoyado en el regazo', 'europeo/árabe', ['laud', 'lute']),
  I('sitar', 'Sitar', 'strings', 'punteo con mizrab y glissandos', 'sentado en el suelo, calabaza apoyada en el pie izquierdo', 'indio', ['sitar']),
  I('erhu', 'Erhu', 'strings', 'arco atrapado entre las dos cuerdas', 'sentado, resonador apoyado sobre el muslo izquierdo, mástil vertical', 'chino', ['erhu', 'violin chino', 'chinese fiddle']),
  I('guzheng', 'Guzheng', 'strings', 'pulsación con púas en los dedos', 'de pie o sentado frente a la cítara horizontal sobre soportes', 'chino', ['guzheng', 'citara china', 'zheng']),
  I('pipa', 'Pipa', 'strings', 'trémolo con cinco dedos', 'sentado, instrumento vertical sobre el regazo', 'chino', ['pipa']),
  I('koto', 'Koto', 'strings', 'pulsación con tsume', 'arrodillado frente al instrumento horizontal', 'japonés', ['koto']),
  I('shamisen', 'Shamisen', 'strings', 'percusión con bachi', 'sentado, cuerpo sobre el muslo derecho', 'japonés', ['shamisen']),
  I('oud', 'Oud', 'strings', 'punteo con risha', 'sentado, cuerpo abombado sobre el muslo derecho', 'árabe', ['oud', 'ud']),
  I('kora', 'Kora', 'strings', 'pulsación con pulgares e índices', 'sentado, calabaza apoyada frente al cuerpo, dos mangos verticales', 'África occidental', ['kora']),
  I('charango', 'Charango', 'strings', 'rasgueo rápido', 'sostenido contra el pecho', 'andino', ['charango']),
  I('bouzouki', 'Bouzouki', 'strings', 'trémolo con púa', 'sostenido en diagonal', 'griego', ['bouzouki']),
  I('hardanger_fiddle', 'Violín de Hardanger', 'strings', 'arco con cuerdas simpáticas', 'apoyado en el hombro', 'noruego', ['hardanger', 'hardingfele']),

  // --- Viento madera --------------------------------------------------------
  I('flute', 'Flauta travesera', 'woodwind', 'soplo lateral en la embocadura', 'horizontal hacia la derecha, codos elevados', 'europeo', ['flauta', 'flute']),
  I('piccolo', 'Flautín', 'woodwind', 'soplo lateral', 'horizontal, instrumento pequeño', 'europeo', ['piccolo', 'flautin']),
  I('clarinet', 'Clarinete', 'woodwind', 'soplo con caña simple', 'vertical frente al cuerpo', 'europeo', ['clarinete', 'clarinet']),
  I('oboe', 'Oboe', 'woodwind', 'soplo con caña doble', 'vertical frente al cuerpo', 'europeo', ['oboe']),
  I('bassoon', 'Fagot', 'woodwind', 'soplo con caña doble', 'diagonal, sostenido por correa', 'europeo', ['fagot', 'bassoon']),
  I('saxophone', 'Saxofón', 'woodwind', 'soplo con caña simple', 'colgado del cuello, campana hacia adelante', 'moderno', ['saxofon', 'sax', 'saxophone']),
  I('recorder', 'Flauta dulce', 'woodwind', 'soplo directo', 'vertical frente al cuerpo', 'europeo', ['flauta dulce', 'recorder']),
  I('shakuhachi', 'Shakuhachi', 'woodwind', 'soplo en bisel abierto', 'vertical, bambú grueso', 'japonés', ['shakuhachi']),
  I('dizi', 'Dizi', 'woodwind', 'soplo lateral con membrana', 'horizontal', 'chino', ['dizi', 'flauta china']),
  I('bansuri', 'Bansuri', 'woodwind', 'soplo lateral', 'horizontal, bambú largo', 'indio', ['bansuri']),
  I('ney', 'Ney', 'woodwind', 'soplo oblicuo en el borde', 'diagonal frente al rostro', 'persa/árabe', ['ney', 'nay']),
  I('duduk', 'Duduk', 'woodwind', 'soplo con caña doble ancha', 'vertical, sonido nasal y grave', 'armenio', ['duduk']),
  I('pan_flute', 'Flauta de pan', 'woodwind', 'soplo sobre tubos en fila', 'sostenida frente a los labios con ambas manos', 'andino', ['zampoña', 'siku', 'pan flute']),
  I('quena', 'Quena', 'woodwind', 'soplo en muesca', 'vertical', 'andino', ['quena']),

  // --- Viento metal ---------------------------------------------------------
  I('trumpet', 'Trompeta', 'brass', 'soplo con boquilla y pistones', 'horizontal hacia adelante', 'europeo', ['trompeta', 'trumpet']),
  I('trombone', 'Trombón', 'brass', 'soplo con vara deslizante', 'horizontal, vara extendida con el brazo derecho', 'europeo', ['trombon', 'trombone']),
  I('french_horn', 'Trompa', 'brass', 'soplo con mano dentro de la campana', 'campana hacia atrás y abajo', 'europeo', ['trompa', 'french horn', 'corno']),
  I('tuba', 'Tuba', 'brass', 'soplo con boquilla grande', 'apoyada en el regazo, campana hacia arriba', 'europeo', ['tuba']),
  I('flugelhorn', 'Fliscorno', 'brass', 'soplo con boquilla cónica', 'horizontal hacia adelante', 'europeo', ['fliscorno', 'flugelhorn']),

  // --- Percusión ------------------------------------------------------------
  I('drum_kit', 'Batería', 'percussion', 'baquetas y pedales', 'sentado tras el set, brazos y pies en movimiento', 'moderno', ['bateria', 'drums', 'drum kit']),
  I('cajon', 'Cajón', 'percussion', 'golpes con las palmas', 'sentado a horcajadas sobre la caja', 'peruano/flamenco', ['cajon']),
  I('congas', 'Congas', 'percussion', 'golpes con las manos', 'de pie tras dos tambores en soporte', 'afrocubano', ['conga', 'congas']),
  I('bongos', 'Bongós', 'percussion', 'golpes con dedos y palmas', 'sentado, tambores entre las rodillas', 'afrocubano', ['bongos']),
  I('djembe', 'Djembé', 'percussion', 'golpes con las manos', 'sentado, tambor inclinado entre las piernas', 'África occidental', ['djembe', 'yembe']),
  I('taiko', 'Taiko', 'percussion', 'golpes amplios con bachi', 'de pie, postura abierta, brazos extendidos', 'japonés', ['taiko', 'wadaiko']),
  I('tabla', 'Tabla', 'percussion', 'golpes con dedos y palma', 'sentado en el suelo, dos tambores frente a las rodillas', 'indio', ['tabla']),
  I('timpani', 'Timbales sinfónicos', 'percussion', 'mazas sobre parches grandes', 'de pie tras varios calderos', 'europeo', ['timpani', 'timbales sinfonicos']),
  I('marimba', 'Marimba', 'percussion', 'mazas sobre láminas de madera', 'de pie frente al teclado horizontal', 'centroamericano', ['marimba']),
  I('vibraphone', 'Vibráfono', 'percussion', 'mazas sobre láminas metálicas', 'de pie frente al teclado con motor', 'moderno', ['vibrafono', 'vibraphone', 'vibes']),
  I('xylophone', 'Xilófono', 'percussion', 'mazas duras sobre madera', 'de pie frente al teclado', 'universal', ['xilofono', 'xylophone']),
  I('handpan', 'Handpan', 'percussion', 'golpes suaves con los dedos', 'sentado, instrumento sobre el regazo', 'moderno', ['handpan', 'hang']),
  I('frame_drum', 'Pandero', 'percussion', 'golpes y roces con dedos', 'sostenido en vertical con una mano', 'mediterráneo', ['pandero', 'frame drum', 'bodhran']),
  I('gong', 'Gong', 'percussion', 'golpe con maza acolchada', 'de pie frente al disco suspendido', 'asiático', ['gong', 'tam-tam']),

  // --- Teclados -------------------------------------------------------------
  I('piano', 'Piano', 'keyboards', 'pulsación con ambas manos', 'sentado en banqueta frente al teclado', 'europeo', ['piano', 'grand piano']),
  I('grand_piano', 'Piano de cola', 'keyboards', 'pulsación con ambas manos, tapa abierta', 'sentado en banqueta, cuerpo del piano a la izquierda', 'europeo', ['piano de cola', 'grand piano']),
  I('upright_piano', 'Piano vertical', 'keyboards', 'pulsación con ambas manos', 'sentado frente al mueble vertical', 'europeo', ['piano vertical', 'upright']),
  I('electric_piano', 'Piano eléctrico', 'keyboards', 'pulsación con ambas manos', 'de pie o sentado frente al teclado en soporte', 'moderno', ['rhodes', 'piano electrico']),
  I('organ', 'Órgano', 'keyboards', 'manuales y pedalero', 'sentado ante varios teclados', 'europeo', ['organo', 'organ', 'pipe organ']),
  I('harpsichord', 'Clavecín', 'keyboards', 'pulsación con plectros', 'sentado frente al teclado doble', 'barroco', ['clavecin', 'harpsichord']),
  I('accordion', 'Acordeón', 'keyboards', 'fuelle y teclado', 'de pie o sentado, instrumento sujeto al torso', 'europeo', ['acordeon', 'accordion']),
  I('celesta', 'Celesta', 'keyboards', 'pulsación ligera', 'sentado frente al mueble pequeño', 'europeo', ['celesta']),

  // --- Instrumentos electrónicos -------------------------------------------
  I('synthesizer', 'Sintetizador', 'electronic', 'teclado y control de parámetros', 'de pie tras el teclado en soporte', 'moderno', ['sintetizador', 'synth', 'synthesizer']),
  I('modular_synth', 'Sintetizador modular', 'electronic', 'cables y potenciómetros', 'de pie frente a un rack de módulos', 'moderno', ['modular', 'eurorack']),
  I('theremin', 'Theremin', 'electronic', 'movimiento de manos sin contacto', 'de pie entre dos antenas', 'moderno', ['theremin']),
  I('drum_machine', 'Caja de ritmos', 'electronic', 'pads y secuenciador', 'de pie frente a la máquina', 'moderno', ['drum machine', 'caja de ritmos']),
  I('sampler', 'Sampler', 'electronic', 'pads y bancos de sonido', 'de pie frente al controlador de pads', 'moderno', ['sampler', 'mpc']),

  // --- Instrumentos tradicionales / folclóricos / del mundo -----------------
  I('bagpipes', 'Gaita', 'folk', 'soplo continuo con odre', 'de pie, odre bajo el brazo izquierdo', 'celta/gallego', ['gaita', 'bagpipes']),
  I('hurdy_gurdy', 'Zanfona', 'folk', 'manivela y teclas', 'sentado, instrumento sobre el regazo', 'europeo', ['zanfona', 'hurdy gurdy']),
  I('nyckelharpa', 'Nyckelharpa', 'folk', 'arco corto y teclas', 'colgada del hombro, arco en la mano derecha', 'sueco', ['nyckelharpa']),
  I('balalaika', 'Balalaica', 'folk', 'rasgueo con el índice', 'cuerpo triangular sobre el muslo', 'ruso', ['balalaika', 'balalaica']),
  I('dulcimer', 'Salterio', 'folk', 'martillos sobre cuerdas', 'de pie frente a la caja trapezoidal', 'universal', ['dulcimer', 'salterio', 'santur']),
  I('kalimba', 'Kalimba', 'traditional', 'pulsación con los pulgares', 'sostenida con ambas manos frente al pecho', 'africano', ['kalimba', 'mbira']),
  I('didgeridoo', 'Didgeridoo', 'traditional', 'respiración circular', 'sentado, tubo largo apoyado en el suelo', 'australiano', ['didgeridoo', 'yidaki']),
  I('morin_khuur', 'Morin khuur', 'traditional', 'arco sobre dos cuerdas de crin', 'sentado, instrumento vertical entre las rodillas', 'mongol', ['morin khuur', 'violin de cabeza de caballo']),
  I('guqin', 'Guqin', 'traditional', 'pulsación sutil sobre siete cuerdas', 'sentado frente a la cítara horizontal sobre una mesa baja', 'chino', ['guqin', 'qin']),
  I('sarangi', 'Sarangi', 'traditional', 'arco y presión con las uñas', 'sentado en el suelo, instrumento vertical', 'indio', ['sarangi']),
  I('bandoneon', 'Bandoneón', 'traditional', 'fuelle y botones', 'sentado, instrumento sobre las rodillas', 'argentino', ['bandoneon']),
  I('cuatro', 'Cuatro', 'world', 'rasgueo rápido de cuatro cuerdas', 'sostenido contra el pecho', 'venezolano', ['cuatro']),
  I('gamelan', 'Gamelán', 'world', 'mazas sobre gongs y metalófonos', 'sentado en el suelo frente al set', 'indonesio', ['gamelan']),
  I('steel_drum', 'Steel drum', 'world', 'mazas sobre superficie martillada', 'de pie frente al bidón afinado', 'caribeño', ['steel drum', 'steelpan']),

  // --- Instrumentos orquestales (secciones) --------------------------------
  I('string_section', 'Sección de cuerdas', 'orchestral', 'arcos coordinados', 'sentados en semicírculo con atriles', 'orquestal', ['seccion de cuerdas', 'strings section']),
  I('brass_section', 'Sección de metales', 'orchestral', 'soplo coordinado', 'sentados en filas al fondo', 'orquestal', ['seccion de metales', 'brass section']),
  I('full_orchestra', 'Orquesta sinfónica', 'orchestral', 'conjunto dirigido', 'dispuesta en semicírculo alrededor del director', 'orquestal', ['orquesta', 'orchestra', 'symphony']),
  I('chamber_ensemble', 'Ensamble de cámara', 'orchestral', 'conjunto reducido sin director', 'sentados en círculo cerrado', 'orquestal', ['ensamble de camara', 'chamber']),
];

const INSTRUMENTS_BY_ID = new Map(INSTRUMENTS.map((i) => [i.id, i]));

/** Búsqueda de instrumentos insensible a mayúsculas y tildes (PRD §6.1). */
function searchInstruments(query, limit = 30) {
  const q = normalize(query);
  if (!q) return INSTRUMENTS.slice(0, limit);
  const scored = [];
  for (const instrument of INSTRUMENTS) {
    const haystacks = [instrument.name, instrument.id, ...instrument.aliases].map(normalize);
    // Infinito significa "no coincide con nada": solo entran en la lista los
    // instrumentos cuya puntuación baja de infinito. Menor puntuación = mejor
    // coincidencia (0 exacta, 1 por prefijo, 2 por contener).
    let best = Number.POSITIVE_INFINITY;
    for (const hay of haystacks) {
      if (hay === q) best = Math.min(best, 0);
      else if (hay.startsWith(q)) best = Math.min(best, 1);
      else if (hay.includes(q)) best = Math.min(best, 2);
    }
    if (Number.isFinite(best)) scored.push({ instrument, score: best });
  }
  scored.sort((a, b) => a.score - b.score || a.instrument.name.localeCompare(b.instrument.name));
  return scored.slice(0, limit).map((s) => s.instrument);
}

function normalize(value) {
  // NFD separa la letra de su tilde y el rango U+0300–U+036F borra los signos
  // diacríticos ya sueltos: así "Violín" y "violin" son la misma cadena.
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// --- Formación musical (PRD §7) ---------------------------------------------

// FormationOption: { id, label, performerCount, description }
// performerCount = número de intérpretes visibles que debe poner en escena el
// Director de Arte.

const FORMATIONS = [
  { id: 'solo', label: 'Solista', performerCount: 1, description: 'un único intérprete en el centro de la escena' },
  { id: 'duo', label: 'Dúo', performerCount: 2, description: 'dos intérpretes enfrentados o en paralelo' },
  { id: 'trio', label: 'Trío', performerCount: 3, description: 'tres intérpretes en formación triangular' },
  { id: 'quartet', label: 'Cuarteto', performerCount: 4, description: 'cuatro intérpretes en semicírculo cerrado' },
  { id: 'quintet', label: 'Quinteto', performerCount: 5, description: 'cinco intérpretes en semicírculo abierto' },
  { id: 'band', label: 'Banda', performerCount: 5, description: 'banda con sección rítmica y frontline' },
  { id: 'solo_band', label: 'Solista + banda', performerCount: 5, description: 'un solista destacado al frente y la banda detrás' },
  { id: 'group', label: 'Grupo', performerCount: 6, description: 'grupo informal reunido alrededor de la música' },
  { id: 'orchestra', label: 'Orquesta', performerCount: 24, description: 'orquesta dispuesta en semicírculo con atriles' },
  { id: 'ensemble', label: 'Ensamble', performerCount: 8, description: 'ensamble equilibrado sin jerarquía visual' },
];

const FORMATIONS_BY_ID = new Map(FORMATIONS.map((f) => [f.id, f]));

// --- Intérprete (PRD §8) -----------------------------------------------------

// PerformerGenderOption: { id, label }

const PERFORMER_GENDERS = [
  { id: 'female', label: 'Femenino' },
  { id: 'male', label: 'Masculino' },
  { id: 'mixed', label: 'Mixto' },
];

// PerformerTypeOption: { id, label, genderIds, descriptor, plural }
// descriptor = cómo debe describir la figura el Director de Arte.

const PERFORMER_TYPES = [
  { id: 'adult_woman', label: 'Mujer adulta', genderIds: ['female'], descriptor: 'una mujer adulta', plural: false },
  { id: 'adult_man', label: 'Hombre adulto', genderIds: ['male'], descriptor: 'un hombre adulto', plural: false },
  { id: 'young_woman', label: 'Chica', genderIds: ['female'], descriptor: 'una chica joven', plural: false },
  { id: 'young_man', label: 'Chico', genderIds: ['male'], descriptor: 'un chico joven', plural: false },
  { id: 'female_group', label: 'Grupo femenino', genderIds: ['female'], descriptor: 'un grupo de intérpretes femeninas', plural: true },
  { id: 'male_group', label: 'Grupo masculino', genderIds: ['male'], descriptor: 'un grupo de intérpretes masculinos', plural: true },
  { id: 'mixed_group', label: 'Grupo mixto', genderIds: ['mixed'], descriptor: 'un grupo mixto de intérpretes', plural: true },
];

const PERFORMER_TYPES_BY_ID = new Map(PERFORMER_TYPES.map((p) => [p.id, p]));

// --- Escenario (PRD §9) -------------------------------------------------------

// ScenarioOption: { id, label, elements, ambience, outdoor, acoustics }
// elements  = anclas visuales que el Director de Arte debe mantener iguales
//             entre planos.
// ambience  = paleta de sonido ambiente (PRD §31).
// outdoor   = si la escena es en exterior; condiciona la luz y el viento.
// acoustics = carácter de reverberación por defecto de la mezcla; uno de
//             'dry' | 'natural' | 'reverberant' | 'cavernous'.

const SCENARIOS = [
  { id: 'nature', label: 'Naturaleza', elements: ['vegetación densa', 'luz filtrada', 'suelo natural'], ambience: ['viento suave', 'hojas', 'pájaros lejanos'], outdoor: true, acoustics: 'natural' },
  { id: 'forest', label: 'Bosque', elements: ['troncos altos', 'musgo', 'rayos de luz entre las copas', 'niebla baja'], ambience: ['viento entre las hojas', 'pájaros', 'crujido de ramas', 'insectos'], outdoor: true, acoustics: 'natural' },
  { id: 'mountain', label: 'Montaña', elements: ['cumbres lejanas', 'roca desnuda', 'cielo abierto'], ambience: ['viento de altura', 'eco lejano'], outdoor: true, acoustics: 'reverberant' },
  { id: 'beach', label: 'Playa', elements: ['orilla', 'arena húmeda', 'horizonte marino'], ambience: ['olas', 'viento marino', 'gaviotas'], outdoor: true, acoustics: 'dry' },
  { id: 'desert', label: 'Desierto', elements: ['dunas', 'cielo despejado', 'calima'], ambience: ['viento de arena', 'silencio amplio'], outdoor: true, acoustics: 'dry' },
  { id: 'lake', label: 'Lago', elements: ['agua en calma', 'reflejos', 'juncos en la orilla'], ambience: ['agua suave', 'aves acuáticas', 'brisa'], outdoor: true, acoustics: 'natural' },
  { id: 'river', label: 'Río', elements: ['corriente', 'piedras húmedas', 'vegetación de ribera'], ambience: ['agua corriente', 'pájaros', 'brisa'], outdoor: true, acoustics: 'natural' },
  { id: 'field', label: 'Campo', elements: ['hierba alta', 'horizonte bajo', 'cielo amplio'], ambience: ['viento sobre la hierba', 'grillos', 'pájaros'], outdoor: true, acoustics: 'dry' },
  { id: 'auditorium', label: 'Auditorio', elements: ['butacas en penumbra', 'escenario iluminado', 'techo acústico'], ambience: ['ambiente de sala', 'reverberación', 'público en silencio'], outdoor: false, acoustics: 'reverberant' },
  { id: 'theatre', label: 'Teatro', elements: ['telón', 'palcos', 'foco cenital'], ambience: ['sala en silencio', 'reverberación cálida'], outdoor: false, acoustics: 'reverberant' },
  { id: 'stadium', label: 'Estadio', elements: ['gradas', 'estructura de luces', 'escenario grande'], ambience: ['ambiente del público', 'eco del recinto'], outdoor: true, acoustics: 'cavernous' },
  { id: 'open_air_concert', label: 'Concierto al aire libre', elements: ['escenario montado', 'torres de luz', 'público lejano'], ambience: ['público', 'viento', 'eco abierto'], outdoor: true, acoustics: 'natural' },
  { id: 'square', label: 'Plaza', elements: ['pavimento de piedra', 'fachadas alrededor', 'farolas'], ambience: ['pasos', 'voces lejanas', 'palomas'], outdoor: true, acoustics: 'reverberant' },
  { id: 'street', label: 'Vía pública', elements: ['acera', 'escaparates', 'tráfico al fondo'], ambience: ['tráfico lejano', 'pasos', 'voces'], outdoor: true, acoustics: 'dry' },
  { id: 'city', label: 'Ciudad', elements: ['siluetas de edificios', 'luces urbanas', 'reflejos en cristal'], ambience: ['rumor urbano', 'tráfico lejano'], outdoor: true, acoustics: 'reverberant' },
  { id: 'rooftop', label: 'Azotea', elements: ['skyline al fondo', 'suelo de grava', 'antenas'], ambience: ['viento en altura', 'ciudad lejana'], outdoor: true, acoustics: 'dry' },
  { id: 'church', label: 'Iglesia', elements: ['columnas', 'vidrieras', 'bancos de madera'], ambience: ['reverberación larga', 'silencio denso'], outdoor: false, acoustics: 'cavernous' },
  { id: 'temple', label: 'Templo', elements: ['madera lacada', 'lámparas colgantes', 'suelo de piedra'], ambience: ['reverberación suave', 'campanillas lejanas'], outdoor: false, acoustics: 'reverberant' },
  { id: 'room', label: 'Habitación', elements: ['ventana lateral', 'pared sencilla', 'suelo de madera'], ambience: ['silencio interior', 'ruido de casa muy leve'], outdoor: false, acoustics: 'dry' },
  { id: 'studio', label: 'Estudio', elements: ['paneles acústicos', 'focos dirigidos', 'fondo neutro'], ambience: ['silencio tratado', 'zumbido eléctrico muy leve'], outdoor: false, acoustics: 'dry' },
  { id: 'other', label: 'Otro', elements: [], ambience: ['ambiente neutro'], outdoor: false, acoustics: 'natural' },
];

const SCENARIOS_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));

// --- Estilo visual (PRD §10) --------------------------------------------------

// VisualStyleOption: { id, label, treatment, photography, palette }
// treatment   = lenguaje de renderizado que se le pasa al modelo de imagen.
// photography = lenguaje de óptica y grano que se le pasa al modelo de vídeo.
// palette     = dirección de color de partida.

const VISUAL_STYLES = [
  { id: 'anime_2d', label: 'Anime 2D', treatment: 'anime 2D tradicional, línea limpia, sombreado plano por celdas', photography: 'composición de animación clásica, movimiento de cámara suave', palette: ['azul cielo', 'blanco cálido', 'rojo suave'] },
  { id: 'anime_cinematic', label: 'Anime cinematográfico', treatment: 'anime cinematográfico de alta gama, iluminación volumétrica, fondos pintados con detalle', photography: 'profundidad de campo marcada, destellos de luz, grano fino', palette: ['ámbar', 'verde profundo', 'azul crepuscular'] },
  { id: 'realistic', label: 'Realista', treatment: 'fotografía realista, texturas de piel y tela creíbles', photography: 'óptica de 50 mm, iluminación natural', palette: ['tonos neutros', 'marrón cálido', 'gris suave'] },
  { id: 'cinematic_realistic', label: 'Cinematográfico realista', treatment: 'imagen cinematográfica realista, etalonaje de película, contraste controlado', photography: 'anamórfico 2.39, halos suaves, grano de 35 mm', palette: ['teal', 'ámbar', 'negro profundo'] },
  { id: 'fantasy', label: 'Fantasía', treatment: 'ilustración de fantasía, luz mágica, atmósfera épica', photography: 'gran angular, partículas suspendidas', palette: ['violeta', 'dorado', 'turquesa'] },
  { id: 'oil', label: 'Óleo', treatment: 'pintura al óleo, pinceladas visibles, empaste', photography: 'composición pictórica, luz de estudio clásica', palette: ['ocre', 'siena', 'verde oliva'] },
  { id: 'watercolor', label: 'Acuarela', treatment: 'acuarela sobre papel, bordes difusos, blancos reservados', photography: 'planos amplios y aireados', palette: ['azul aguado', 'rosa pálido', 'gris húmedo'] },
  { id: 'illustration', label: 'Ilustración', treatment: 'ilustración editorial, formas simplificadas, color plano con textura', photography: 'composición gráfica y frontal', palette: ['coral', 'crema', 'azul tinta'] },
  { id: 'manga', label: 'Manga', treatment: 'manga en blanco y negro, tramas de puntos, líneas cinéticas', photography: 'encuadres dinámicos y diagonales', palette: ['negro', 'blanco', 'gris trama'] },
  { id: 'dark_fantasy', label: 'Fantasía oscura', treatment: 'fantasía oscura, claroscuro intenso, texturas desgastadas', photography: 'contraluz duro, niebla densa', palette: ['negro azulado', 'rojo apagado', 'ceniza'] },
  { id: 'retro', label: 'Retro', treatment: 'estética retro de los años 80, neón y cromo', photography: 'halación intensa, aberración cromática leve', palette: ['magenta', 'cian', 'púrpura'] },
  { id: 'vintage', label: 'Vintage', treatment: 'imagen vintage, color desvaído, grano grueso', photography: 'óptica antigua, viñeteado marcado', palette: ['sepia', 'verde oliva', 'crema'] },
  { id: 'other', label: 'Otro', treatment: 'estilo definido por las instrucciones del usuario', photography: 'fotografía coherente con el estilo indicado', palette: ['según indicación'] },
];

const VISUAL_STYLES_BY_ID = new Map(VISUAL_STYLES.map((s) => [s.id, s]));

/** Todo lo que necesita la pantalla de configuración, en un único payload. */
function buildCatalog() {
  return {
    instrumentCategories: INSTRUMENT_CATEGORIES,
    instruments: INSTRUMENTS,
    formations: FORMATIONS,
    performerGenders: PERFORMER_GENDERS,
    performerTypes: PERFORMER_TYPES,
    scenarios: SCENARIOS,
    visualStyles: VISUAL_STYLES,
    durations: DURATION_OPTIONS,
  };
}

// Se declara después de buildCatalog, igual que en el original: la función solo
// lo lee cuando se la llama, y para entonces el módulo ya está evaluado entero.
const DURATION_OPTIONS = [
  { seconds: 60, label: '1 min' },
  { seconds: 120, label: '2 min' },
  { seconds: 180, label: '3 min' },
];

module.exports = {
  INSTRUMENT_CATEGORIES,
  INSTRUMENTS,
  INSTRUMENTS_BY_ID,
  searchInstruments,
  FORMATIONS,
  FORMATIONS_BY_ID,
  PERFORMER_GENDERS,
  PERFORMER_TYPES,
  PERFORMER_TYPES_BY_ID,
  SCENARIOS,
  SCENARIOS_BY_ID,
  VISUAL_STYLES,
  VISUAL_STYLES_BY_ID,
  buildCatalog,
  DURATION_OPTIONS,
};
