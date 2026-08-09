/**
 * El brief creativo: su forma y su normalización defensiva.
 *
 * El brief es la única parte del plan que escribe un modelo. La estructura y
 * los tiempos los calcula el Productor en código, así que aquí solo viven las
 * decisiones CREATIVAS.
 *
 * A propósito el esquema no lleva límites de longitud ni rangos numéricos: la
 * salida estructurada no los impone en el servidor, y que el modelo devuelva
 * una frase un poco larga es mucho menos grave que que la respuesta entera se
 * rechace. Los recortes se hacen después, en `normalizeCreativeBrief`.
 *
 * En el proyecto original la forma se declaraba con zod. Aquí no hay
 * dependencias, así que el esquema JSON se escribe a mano con la misma
 * disciplina que aplicaba el ayudante del SDK de Anthropic: todo objeto lleva
 * `additionalProperties: false` y un `required` con TODAS sus claves. Si se
 * omite alguna de las dos cosas la API rechaza el esquema.
 *
 * Forma del brief (para leer el código sin bucear en el esquema):
 *   {
 *     title, logline, emotionalIntent, emotionalArc,
 *     mood: [], palette: [], timeOfDay,
 *     character: { summary, face, hair, wardrobe, build, apparentAge, accessories: [] },
 *     environment: { location, primaryElements: [], secondaryElements: [], atmosphere },
 *     lighting: { direction, intensity, atmosphere },
 *     instrumentAppearance,
 *     continuityRules: [],
 *     shots: [ { index, purpose, description } ],
 *     music: { style, mood, tempoBpm, key, scale, structure },
 *     ambient: { layers: [], description },
 *     delivery: { description, hashtags: [] },
 *     notes: { director, producer, artDirector, cinematographer, screenwriter, editor }
 *   }
 */

/** Cadena con descripción opcional para el modelo. */
function texto(descripcion) {
  return descripcion ? { type: 'string', description: descripcion } : { type: 'string' };
}

/** Lista de cadenas con descripción opcional. */
function listaDeTextos(descripcion) {
  const nodo = { type: 'array', items: { type: 'string' } };
  if (descripcion) nodo.description = descripcion;
  return nodo;
}

/**
 * Objeto cerrado: `required` se deriva de las propiedades para que nunca se
 * queden desincronizados al editar el esquema.
 */
function objeto(propiedades, descripcion) {
  const nodo = {
    type: 'object',
    properties: propiedades,
    additionalProperties: false,
    required: Object.keys(propiedades),
  };
  if (descripcion) nodo.description = descripcion;
  return nodo;
}

/**
 * Esquema JSON del brief creativo, listo para pedírselo a Claude como formato
 * de salida estructurada.
 *
 * Se construye en cada llamada para que quien lo reciba pueda modificarlo (o
 * envolverlo) sin corromper una constante compartida.
 */
function creativeBriefJsonSchema() {
  return objeto({
    title: texto('Título corto y evocador del cortometraje, sin comillas. Máx. 78 caracteres.'),
    logline: texto('Una sola frase que resume el corto.'),
    emotionalIntent: texto('Qué debe sentir el espectador.'),
    emotionalArc: texto('Cómo evoluciona la emoción de principio a fin.'),
    mood: listaDeTextos('De 2 a 5 adjetivos de atmósfera.'),
    palette: listaDeTextos('De 2 a 4 colores dominantes.'),
    timeOfDay: texto('Momento del día y calidad de la luz.'),
    character: objeto({
      summary: texto('Quién es el intérprete, en una frase.'),
      face: texto(
        'Rasgos faciales concretos y repetibles: forma del rostro, cejas, ojos, nariz, boca.',
      ),
      hair: texto('Color, longitud y peinado exactos.'),
      wardrobe: texto('Prendas, tejidos y colores exactos.'),
      build: texto('Complexión y postura.'),
      apparentAge: texto('Franja de edad aparente.'),
      accessories: listaDeTextos('Accesorios visibles, puede ir vacío.'),
    }),
    environment: objeto({
      location: texto('Descripción del lugar concreto.'),
      primaryElements: listaDeTextos('De 2 a 6 elementos que deben aparecer siempre.'),
      secondaryElements: listaDeTextos('Elementos de apoyo, puede ir vacío.'),
      atmosphere: texto('Aire, partículas, temperatura, sensación.'),
    }),
    lighting: objeto({
      direction: texto('De dónde viene la luz principal.'),
      intensity: texto('Contraste y rango dinámico.'),
      atmosphere: texto('Niebla, haces visibles, dominante de color.'),
    }),
    instrumentAppearance: texto(
      'Material, acabado y detalles del instrumento, para que sea siempre el mismo ejemplar.',
    ),
    continuityRules: listaDeTextos(
      'De 3 a 10 reglas que toda toma debe respetar para mantener la continuidad.',
    ),
    shots: {
      type: 'array',
      description: 'Una entrada por cada toma de la lista proporcionada, en el mismo orden.',
      items: objeto({
        index: { type: 'number', description: 'Número de la toma, empezando en 1.' },
        purpose: texto('Función narrativa de la toma.'),
        description: texto('Qué se ve: encuadre, acción concreta del intérprete, entorno visible.'),
      }),
    },
    music: objeto({
      style: texto(),
      mood: texto(),
      tempoBpm: { type: 'number', description: 'Entre 40 y 200.' },
      key: texto('Tonalidad, por ejemplo "Re menor".'),
      scale: texto('Escala o modo.'),
      structure: texto('Estructura por secciones con marcas de tiempo.'),
    }),
    ambient: objeto({
      layers: listaDeTextos('Capas de sonido ambiental, sin voces.'),
      description: texto('Cómo debe sonar el lecho ambiental.'),
    }),
    delivery: objeto({
      description: texto('Descripción corta para publicar.'),
      hashtags: listaDeTextos('De 5 a 10 hashtags, cada uno empezando por #.'),
    }),
    notes: objeto({
      director: texto(),
      producer: texto(),
      artDirector: texto(),
      cinematographer: texto(),
      screenwriter: texto(),
      editor: texto(),
    }),
  });
}

/** Recorta una cadena a `max` caracteres; si no hay texto usable, usa el respaldo. */
function clamp(value, max, fallback) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return fallback;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Igual que `clamp` pero para listas: filtra basura y limita el número de elementos. */
function clampList(value, maxItems, maxLength, fallback) {
  if (!Array.isArray(value)) return fallback;
  const out = value
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .map((v) => clamp(v, maxLength, ''))
    .filter(Boolean)
    .slice(0, maxItems);
  return out.length > 0 ? out : fallback;
}

/**
 * Lleva un brief cualquiera (posiblemente escrito por un modelo) a la forma que
 * espera el resto de la tubería: longitudes recortadas, huecos rellenados desde
 * un brief conocido y bueno, y exactamente una entrada por cada toma planificada.
 *
 * Su razón de ser es que un brief escrito por un modelo NUNCA pueda tumbar la
 * creación del proyecto por un fallo de validación.
 */
function normalizeCreativeBrief(candidate, fallback, shotCount) {
  const raw = candidate ?? {};
  const rawCharacter = raw.character ?? {};
  const rawEnvironment = raw.environment ?? {};
  const rawLighting = raw.lighting ?? {};
  const rawMusic = raw.music ?? {};
  const rawAmbient = raw.ambient ?? {};
  const rawDelivery = raw.delivery ?? {};
  const rawNotes = raw.notes ?? {};

  // Se indexa por número de toma en lugar de fiarse del orden: el modelo puede
  // saltarse una toma, repetirla o devolverlas desordenadas.
  const byIndex = new Map();
  if (Array.isArray(raw.shots)) {
    for (const shot of raw.shots) {
      if (!shot || typeof shot !== 'object') continue;
      const index = Number(shot.index);
      if (!Number.isFinite(index)) continue;
      byIndex.set(index, {
        purpose: clamp(shot.purpose, 190, ''),
        description: clamp(shot.description, 580, ''),
      });
    }
  }

  const shots = Array.from({ length: shotCount }, (_, i) => {
    const index = i + 1;
    const fromModel = byIndex.get(index);
    const fromFallback = fallback.shots[i] ?? {
      index,
      purpose: 'Sostener la continuidad narrativa del corto',
      description: 'Plano del intérprete tocando en el escenario definido.',
    };
    return {
      index,
      purpose: fromModel?.purpose || fromFallback.purpose,
      description: fromModel?.description || fromFallback.description,
    };
  });

  const tempo = Number(rawMusic.tempoBpm);

  return {
    title: clamp(raw.title, 78, fallback.title),
    logline: clamp(raw.logline, 390, fallback.logline),
    emotionalIntent: clamp(raw.emotionalIntent, 290, fallback.emotionalIntent),
    emotionalArc: clamp(raw.emotionalArc, 480, fallback.emotionalArc),
    mood: clampList(raw.mood, 5, 40, fallback.mood),
    palette: clampList(raw.palette, 4, 40, fallback.palette),
    timeOfDay: clamp(raw.timeOfDay, 60, fallback.timeOfDay),
    character: {
      summary: clamp(rawCharacter.summary, 380, fallback.character.summary),
      face: clamp(rawCharacter.face, 290, fallback.character.face),
      hair: clamp(rawCharacter.hair, 190, fallback.character.hair),
      wardrobe: clamp(rawCharacter.wardrobe, 290, fallback.character.wardrobe),
      build: clamp(rawCharacter.build, 190, fallback.character.build),
      apparentAge: clamp(rawCharacter.apparentAge, 60, fallback.character.apparentAge),
      // Las listas que pueden ir legítimamente vacías se distinguen de las que
      // faltan: si el modelo mandó un array, se respeta aunque quede vacío.
      accessories: Array.isArray(rawCharacter.accessories)
        ? clampList(rawCharacter.accessories, 6, 60, [])
        : fallback.character.accessories,
    },
    environment: {
      location: clamp(rawEnvironment.location, 290, fallback.environment.location),
      primaryElements: clampList(
        rawEnvironment.primaryElements,
        6,
        80,
        fallback.environment.primaryElements,
      ),
      secondaryElements: Array.isArray(rawEnvironment.secondaryElements)
        ? clampList(rawEnvironment.secondaryElements, 6, 80, [])
        : fallback.environment.secondaryElements,
      atmosphere: clamp(rawEnvironment.atmosphere, 290, fallback.environment.atmosphere),
    },
    lighting: {
      direction: clamp(rawLighting.direction, 190, fallback.lighting.direction),
      intensity: clamp(rawLighting.intensity, 190, fallback.lighting.intensity),
      atmosphere: clamp(rawLighting.atmosphere, 190, fallback.lighting.atmosphere),
    },
    instrumentAppearance: clamp(raw.instrumentAppearance, 390, fallback.instrumentAppearance),
    continuityRules: clampList(raw.continuityRules, 10, 200, fallback.continuityRules),
    shots,
    music: {
      style: clamp(rawMusic.style, 190, fallback.music.style),
      mood: clamp(rawMusic.mood, 190, fallback.music.mood),
      tempoBpm:
        Number.isFinite(tempo) && tempo >= 40 && tempo <= 200
          ? Math.round(tempo)
          : fallback.music.tempoBpm,
      key: clamp(rawMusic.key, 40, fallback.music.key),
      scale: clamp(rawMusic.scale, 60, fallback.music.scale),
      structure: clamp(rawMusic.structure, 390, fallback.music.structure),
    },
    ambient: {
      layers: clampList(rawAmbient.layers, 6, 60, fallback.ambient.layers),
      description: clamp(rawAmbient.description, 390, fallback.ambient.description),
    },
    delivery: {
      description: clamp(rawDelivery.description, 390, fallback.delivery.description),
      hashtags: clampList(rawDelivery.hashtags, 10, 40, fallback.delivery.hashtags).map((tag) =>
        tag.startsWith('#') ? tag : `#${tag.replace(/^#+/, '')}`,
      ),
    },
    notes: {
      director: clamp(rawNotes.director, 580, fallback.notes.director),
      producer: clamp(rawNotes.producer, 580, fallback.notes.producer),
      artDirector: clamp(rawNotes.artDirector, 580, fallback.notes.artDirector),
      cinematographer: clamp(rawNotes.cinematographer, 580, fallback.notes.cinematographer),
      screenwriter: clamp(rawNotes.screenwriter, 580, fallback.notes.screenwriter),
      editor: clamp(rawNotes.editor, 580, fallback.notes.editor),
    },
  };
}

module.exports = {
  creativeBriefJsonSchema,
  normalizeCreativeBrief,
};
