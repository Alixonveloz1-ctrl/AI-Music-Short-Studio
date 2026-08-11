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
  { id: 'nature', label: 'Naturaleza', elements: ['vegetación densa', 'luz filtrada', 'suelo natural'], outdoor: true, acoustics: 'natural' },
  { id: 'forest', label: 'Bosque', elements: ['troncos altos', 'musgo', 'rayos de luz entre las copas', 'niebla baja'], outdoor: true, acoustics: 'natural' },
  { id: 'mountain', label: 'Montaña', elements: ['cumbres lejanas', 'roca desnuda', 'cielo abierto'], outdoor: true, acoustics: 'reverberant' },
  { id: 'beach', label: 'Playa', elements: ['orilla', 'arena húmeda', 'horizonte marino'], outdoor: true, acoustics: 'dry' },
  { id: 'desert', label: 'Desierto', elements: ['dunas', 'cielo despejado', 'calima'], outdoor: true, acoustics: 'dry' },
  { id: 'lake', label: 'Lago', elements: ['agua en calma', 'reflejos', 'juncos en la orilla'], outdoor: true, acoustics: 'natural' },
  { id: 'river', label: 'Río', elements: ['corriente', 'piedras húmedas', 'vegetación de ribera'], outdoor: true, acoustics: 'natural' },
  { id: 'field', label: 'Campo', elements: ['hierba alta', 'horizonte bajo', 'cielo amplio'], outdoor: true, acoustics: 'dry' },
  { id: 'auditorium', label: 'Auditorio', elements: ['butacas en penumbra', 'escenario iluminado', 'techo acústico'], outdoor: false, acoustics: 'reverberant' },
  { id: 'theatre', label: 'Teatro', elements: ['telón', 'palcos', 'foco cenital'], outdoor: false, acoustics: 'reverberant' },
  { id: 'stadium', label: 'Estadio', elements: ['gradas', 'estructura de luces', 'escenario grande'], outdoor: true, acoustics: 'cavernous' },
  { id: 'open_air_concert', label: 'Concierto al aire libre', elements: ['escenario montado', 'torres de luz', 'público lejano'], outdoor: true, acoustics: 'natural' },
  { id: 'square', label: 'Plaza', elements: ['pavimento de piedra', 'fachadas alrededor', 'farolas'], outdoor: true, acoustics: 'reverberant' },
  { id: 'street', label: 'Vía pública', elements: ['acera', 'escaparates', 'tráfico al fondo'], outdoor: true, acoustics: 'dry' },
  { id: 'city', label: 'Ciudad', elements: ['siluetas de edificios', 'luces urbanas', 'reflejos en cristal'], outdoor: true, acoustics: 'reverberant' },
  { id: 'rooftop', label: 'Azotea', elements: ['skyline al fondo', 'suelo de grava', 'antenas'], outdoor: true, acoustics: 'dry' },
  { id: 'church', label: 'Iglesia', elements: ['columnas', 'vidrieras', 'bancos de madera'], outdoor: false, acoustics: 'cavernous' },
  { id: 'temple', label: 'Templo', elements: ['madera lacada', 'lámparas colgantes', 'suelo de piedra'], outdoor: false, acoustics: 'reverberant' },
  { id: 'room', label: 'Habitación', elements: ['ventana lateral', 'pared sencilla', 'suelo de madera'], outdoor: false, acoustics: 'dry' },
  { id: 'studio', label: 'Estudio', elements: ['paneles acústicos', 'focos dirigidos', 'fondo neutro'], outdoor: false, acoustics: 'dry' },
  { id: 'other', label: 'Otro', elements: [], outdoor: false, acoustics: 'natural' },
];

const SCENARIOS_BY_ID = new Map(SCENARIOS.map((s) => [s.id, s]));

// --- Estilo visual (PRD §10) --------------------------------------------------

// VisualStyleOption: { id, label, treatment, photography, palette }
// treatment   = lenguaje de renderizado que se le pasa al modelo de imagen.
// photography = lenguaje de óptica y grano que se le pasa al modelo de vídeo.
// palette     = dirección de color de partida.

// --- Género musical -----------------------------------------------------------
//
// POR QUÉ HACE FALTA ELEGIRLO. El usuario puso un CUATRO —instrumento de la
// música llanera venezolana, que en el catálogo se toca con «rasgueo rápido»— y
// la herramienta le compuso una pieza melancólica de cuerdas pulsadas una a
// una, mientras el vídeo mostraba al personaje rasgueando joropo a toda
// velocidad. La música y la imagen salieron de datos distintos y no pegaban.
//
// El género lo arregla por los dos lados: le dice a Lyria qué escribir y le dice
// al vídeo con cuánta energía se toca.
//
// `en` es lo que se le manda al modelo de música, que sólo entiende inglés.
// `energia` es cuánto se mueve el intérprete en el vídeo: 'suave', 'media' o
// 'alta'. Y `bpm` es el pulso típico, que manda sobre la deducción del contexto
// cuando el usuario elige el género a mano.

const MUSIC_GENRES = [
  // «auto» y «other» no llevan carácter ni pulso propios a propósito: el primero
  // deja que el Director lo deduzca del contexto y el segundo, de lo que escriba
  // el usuario. Poner aquí un mood de relleno sería inventarle un género.
  { id: 'auto', label: 'Que lo decida el director', en: '', mood: [], energia: '', bpm: 0 },
  { id: 'cinematic', label: 'Cinematográfico', en: 'cinematic orchestral score', mood: ['cinematográfico','amplio'], energia: 'media', bpm: 80 },
  { id: 'classical', label: 'Clásico', en: 'classical chamber music', mood: ['clásico','elegante'], energia: 'media', bpm: 76 },
  { id: 'ambient', label: 'Ambiental', en: 'slow ambient, long sustained textures', mood: ['sereno','flotante'], energia: 'suave', bpm: 60 },
  { id: 'folk', label: 'Folk / tradicional', en: 'traditional acoustic folk', mood: ['cálido','sencillo'], energia: 'media', bpm: 96 },
  { id: 'joropo', label: 'Joropo / música llanera', en: 'Venezuelan joropo: fast strummed cuatro, driving 3/4 and 6/8 cross-rhythm, bright and festive', mood: ['festivo','vivo','virtuoso'], energia: 'alta', bpm: 150 },
  // OJO CON LOS ACENTOS. Este texto viaja tal cual al modelo de música, que
  // rechaza la petición entera si detecta que no está en inglés. «compás» y
  // «palmas» tumbaban la generación: van escritos como los diría un músico
  // anglosajón.
  { id: 'flamenco', label: 'Flamenco', en: 'flamenco: rasgueado guitar, twelve-beat compas rhythm, handclaps', mood: ['intenso','pasional'], energia: 'alta', bpm: 120 },
  { id: 'tango', label: 'Tango', en: 'tango: marcato bandoneon, dramatic and precise', mood: ['dramático','elegante'], energia: 'media', bpm: 112 },
  { id: 'bolero', label: 'Bolero', en: 'bolero: slow romantic latin ballad', mood: ['romántico','íntimo'], energia: 'suave', bpm: 72 },
  { id: 'salsa', label: 'Salsa', en: 'salsa: montuno, clave, brass hits', mood: ['festivo','bailable'], energia: 'alta', bpm: 180 },
  { id: 'bossa', label: 'Bossa nova', en: 'bossa nova: soft syncopated guitar, brushed drums', mood: ['suave','sofisticado'], energia: 'suave', bpm: 130 },
  { id: 'jazz', label: 'Jazz', en: 'jazz: swung, walking bass, improvised feel', mood: ['jazzístico','libre'], energia: 'media', bpm: 120 },
  { id: 'blues', label: 'Blues', en: 'blues: twelve-bar, bent notes, smoky', mood: ['humeante','doliente'], energia: 'media', bpm: 88 },
  { id: 'rock', label: 'Rock', en: 'rock: driving drums, distorted guitars', mood: ['crudo','con garra'], energia: 'alta', bpm: 128 },
  { id: 'alt_rock', label: 'Rock alternativo', en: 'alternative rock: raw, gritty, loud-quiet dynamics', mood: ['crudo','eléctrico'], energia: 'alta', bpm: 132 },
  { id: 'metal', label: 'Metal', en: 'metal: heavy distorted riffs, double kick, relentless', mood: ['agresivo','implacable'], energia: 'alta', bpm: 150 },
  { id: 'punk', label: 'Punk', en: 'punk: fast, raw, three chords, no polish', mood: ['crudo','urgente'], energia: 'alta', bpm: 170 },
  { id: 'electronic', label: 'Electrónica', en: 'electronic: synth layers, steady pulse', mood: ['pulsante','sintético'], energia: 'alta', bpm: 124 },
  { id: 'synthwave', label: 'Synthwave', en: 'synthwave: retro analog synths, neon, arpeggios', mood: ['nocturno','sintético'], energia: 'media', bpm: 110 },
  { id: 'lofi', label: 'Lo-fi', en: 'lo-fi: dusty loops, laid-back, warm', mood: ['cálido','relajado'], energia: 'suave', bpm: 82 },
  { id: 'hiphop', label: 'Hip-hop', en: 'hip-hop: hard boom-bap drums, heavy groove', mood: ['contundente','rítmico'], energia: 'alta', bpm: 92 },
  { id: 'epic', label: 'Épico', en: 'epic trailer music: huge percussion, soaring strings', mood: ['épico','poderoso'], energia: 'alta', bpm: 100 },
  { id: 'horror', label: 'Terror', en: 'horror score: dissonant, unsettling, sparse', mood: ['siniestro','inquietante'], energia: 'suave', bpm: 66 },
  { id: 'other', label: 'Otro', en: '', mood: [], energia: '', bpm: 0 },
];
const MUSIC_GENRES_BY_ID = new Map(MUSIC_GENRES.map((g) => [g.id, g]));

/**
 * El género que le pega a un instrumento, cuando el usuario deja «que lo decida
 * el director». Se mira el ORIGEN, que es lo que el catálogo sabe de él.
 */
const GENERO_POR_ORIGEN = {
  venezolano: 'joropo',
  'peruano/flamenco': 'flamenco',
  español: 'flamenco',
  argentino: 'tango',
  caribeño: 'salsa',
  afrocubano: 'salsa',
  moderno: 'rock',
  orquestal: 'cinematic',
  barroco: 'classical',
  europeo: 'classical',
  italiano: 'classical',
  estadounidense: 'blues',
};

/** El género por defecto para estos instrumentos, por encima de su origen. */
const GENERO_POR_INSTRUMENTO = {
  drum_kit: 'rock', electric_guitar: 'rock', bass_guitar: 'rock',
  synthesizer: 'electronic', modular_synth: 'electronic', drum_machine: 'electronic',
  sampler: 'hiphop', bandoneon: 'tango', cuatro: 'joropo',
  flamenco_guitar: 'flamenco', saxophone: 'jazz', full_orchestra: 'cinematic',
  string_section: 'cinematic', brass_section: 'epic',
};

function generoSugerido(instrumento) {
  if (!instrumento) return 'cinematic';
  return GENERO_POR_INSTRUMENTO[instrumento.id] ||
    GENERO_POR_ORIGEN[instrumento.origin] ||
    'cinematic';
}

/**
 * Cómo se llama en inglés un género escrito a mano.
 *
 * El cuadro «Otro» es texto libre y el usuario escribe en español, pero al
 * modelo de música no le puede llegar ni una palabra que no sea inglesa: si
 * detecta otro idioma rechaza la petición entera y no compone nada. Aquí están
 * los géneros que se escriben a mano y no están en la lista de arriba, con su
 * descripción en inglés, para que escribir «cumbia» funcione igual de bien que
 * elegir «Salsa» en el desplegable.
 */
const GENEROS_ESCRITOS = [
  { palabras: ['cumbia'], en: 'cumbia: swaying two-step groove, accordion and guiro' },
  { palabras: ['vallenato'], en: 'vallenato: accordion, caja drum and guacharaca' },
  { palabras: ['merengue'], en: 'merengue: fast two-step, tambora and saxophone' },
  { palabras: ['bachata'], en: 'bachata: syncopated guitar with bongo and guira' },
  { palabras: ['reggaeton', 'reguetón', 'reguet'], en: 'reggaeton: dembow beat, heavy low end' },
  { palabras: ['reggae', 'ska'], en: 'reggae: offbeat skank guitar, deep bass' },
  { palabras: ['mariachi', 'ranchera'], en: 'mariachi ranchera: trumpets, violins and rhythmic guitar' },
  { palabras: ['nortena', 'norteño', 'norten', 'corrido'], en: 'norteno: accordion and bajo sexto, marching two-step' },
  { palabras: ['samba', 'pagode'], en: 'samba: brazilian percussion, fast swinging groove' },
  { palabras: ['gospel', 'soul'], en: 'soul gospel: warm chords, organ and choir-like harmony' },
  { palabras: ['funk'], en: 'funk: tight syncopated groove, slap bass' },
  { palabras: ['country', 'bluegrass'], en: 'country bluegrass: acoustic picking, fiddle and banjo' },
  { palabras: ['tarantela', 'tarantel', 'polka', 'vals', 'waltz'], en: 'european folk dance in lilting triple time' },
  { palabras: ['celta', 'irland', 'celtic'], en: 'celtic folk: jig and reel, fiddle and whistle' },
  { palabras: ['arabe', 'árabe', 'oriental'], en: 'middle eastern: maqam scales, frame drum' },
  { palabras: ['india', 'indi', 'raga'], en: 'indian classical: raga, drone and tabla' },
  { palabras: ['china', 'chino', 'japon', 'oriental asiat'], en: 'east asian traditional: pentatonic, sparse and airy' },
  { palabras: ['africa', 'afro'], en: 'west african: interlocking polyrhythm, hand drums' },
  { palabras: ['tecno', 'techno', 'house', 'trance'], en: 'techno: four on the floor, hypnotic and repetitive' },
  { palabras: ['drum and bass', 'dnb', 'jungle'], en: 'drum and bass: fast breakbeats, deep sub bass' },
  { palabras: ['dubstep', 'trap'], en: 'trap: halftime drums, sparse and heavy' },
  { palabras: ['balada', 'ballad'], en: 'slow ballad: sparse, emotional, unhurried' },
  { palabras: ['marcha', 'march', 'himno', 'hymn'], en: 'march: steady processional pulse, brass and drums' },
  { palabras: ['circo', 'circus', 'carnaval'], en: 'circus carnival music: bouncy, playful, brassy' },
  { palabras: ['navid', 'christmas'], en: 'christmas music: bells, warm and festive' },
  { palabras: ['infantil', 'nana', 'lullaby'], en: 'lullaby: simple, gentle, music-box like' },
];

/**
 * Traduce a inglés lo que el usuario escribió en el cuadro «Otro».
 *
 * Primero se busca en la lista de géneros y en la tabla de arriba, que es lo que
 * da una descripción completa. Si no se reconoce, se manda el texto SIN TILDES:
 * un nombre de género es casi siempre un nombre propio que el modelo entiende
 * igual —«joropo» es «joropo» en cualquier idioma—, y la tilde es justo lo que
 * dispara el rechazo por idioma.
 */
function generoEscritoEn(texto, catalogo) {
  const limpio = sinTildes(String(texto || '').trim().toLowerCase());
  if (!limpio) return '';

  for (const g of catalogo) {
    if (!g.en) continue;
    if (limpio === g.id || limpio === sinTildes(g.label.toLowerCase())) return g.en;
  }
  for (const entrada of GENEROS_ESCRITOS) {
    if (entrada.palabras.some((pal) => limpio.indexOf(sinTildes(pal)) !== -1)) return entrada.en;
  }
  // Reconocer un género por dentro de una frase larga es lo último que se
  // intenta, porque «no quiero rock» contiene «rock».
  for (const g of catalogo) {
    if (!g.en) continue;
    const nombre = sinTildes(g.label.toLowerCase()).split(' /')[0];
    if (nombre.length > 3 && limpio.indexOf(nombre) !== -1) return g.en;
  }
  return sinTildes(String(texto || '').trim());
}

function sinTildes(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * EL GÉNERO DE LA PIEZA, resuelto.
 *
 * Vive aquí y no en el plan musical porque lo leen los dos lados: la música,
 * para saber qué componer, y el VÍDEO, para saber con cuánta fuerza se toca. Ese
 * era el fallo que lo trajo: el personaje rasgueaba joropo a toda velocidad
 * mientras sonaba una pieza melancólica de cuerdas pulsadas una a una.
 */
function generoDe(config, instrumentos) {
  const lista = instrumentos || [];
  const elegido = MUSIC_GENRES_BY_ID.get((config && config.musicGenreId) || 'auto');
  if (elegido && elegido.id === 'other') {
    const escrito = String((config && config.musicGenreCustom) || '').trim();
    return {
      id: 'other',
      label: escrito || 'Otro',
      en: generoEscritoEn(escrito, MUSIC_GENRES),
      mood: [],
      // Sin energía declarada: un género escrito a mano puede ser cualquier
      // cosa, así que el vídeo se queda con lo que diga el resto del contexto en
      // vez de inventarse una intensidad.
      energia: '',
      bpm: 0,
    };
  }
  if (elegido && elegido.en) return elegido;
  // 'auto' o desconocido: lo decide el instrumento.
  return MUSIC_GENRES_BY_ID.get(generoSugerido(lista[0])) || MUSIC_GENRES_BY_ID.get('cinematic');
}

const VISUAL_STYLES = [
  { id: 'anime_2d', label: 'Anime 2D', treatment: 'anime 2D tradicional: PERSONAS dibujadas en anime, línea limpia y sombreado plano por celdas, rostros de ojos grandes y expresivos, piel lisa sin textura fotográfica', photography: 'composición de animación clásica, movimiento de cámara suave', palette: ['azul cielo', 'blanco cálido', 'rojo suave'] },
  { id: 'anime_cinematic', label: 'Anime cinematográfico', treatment: 'ilustración de anime cinematográfico de gama alta: PERSONAS dibujadas en anime, con línea limpia y fina, sombreado suave con degradados pintados, piel luminosa, ojos grandes y expresivos con iris detallado y brillos, pestañas marcadas y rubor suave; fondos pintados con mucho detalle e iluminación volumétrica', photography: 'profundidad de campo marcada con fondo muy desenfocado, resplandor suave en cada luz, destellos y grano fino', palette: ['ámbar', 'verde profundo', 'azul crepuscular'] },
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
    // Cada instrumento viaja con el género que le pegaría si el usuario deja
    // «que lo decida el director». Lo calcula el servidor y no la pantalla,
    // para que lo que se anuncia antes de crear el corto sea exactamente lo
    // que se va a componer después.
    instruments: INSTRUMENTS.map((i) => Object.assign({}, i, { suggestedGenreId: generoSugerido(i) })),
    formations: FORMATIONS,
    performerGenders: PERFORMER_GENDERS,
    performerTypes: PERFORMER_TYPES,
    scenarios: SCENARIOS,
    visualStyles: VISUAL_STYLES,
    musicGenres: MUSIC_GENRES,
    durations: DURATION_OPTIONS,
    characterTraits: require('./rasgos.js').catalogoDeRasgos(),
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
  MUSIC_GENRES,
  MUSIC_GENRES_BY_ID,
  generoSugerido,
  generoDe,
  generoEscritoEn,
  buildCatalog,
  DURATION_OPTIONS,
};
