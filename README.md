# AI Music Short Studio

Herramienta de producción de cortos musicales audiovisuales mediante IA, con
generación asistida y **aprobación manual del usuario en cada etapa**.

El usuario define el corto (instrumento, formación, intérprete, escenario,
estilo, duración y una dirección creativa en texto libre). Un equipo de
producción basado en IA prepara el concepto, la biblia visual, el plan de tomas
y todos los prompts. A partir de ahí la IA genera, pero **no aprueba nada**: el
usuario revisa cada imagen, cada clip, la música y el sonido ambiental, y decide
si lo conserva o lo regenera. Solo el material aprobado pasa a la siguiente
etapa y llega al montaje final en MP4.

> Implementación del PRD «AI Music Short Studio» v1.0. Las referencias `§` de
> este documento y de los comentarios del código apuntan a las secciones del PRD.

---

## Puesta en marcha

```bash
npm install
npm run dev          # API en :8787 y web en :5173
```

Abre <http://localhost:5173>.

**No hace falta ninguna credencial.** Sin configurar nada, el estudio funciona
completo con proveedores locales: genera imágenes procedurales identificables,
las anima a MP4 con el movimiento de cámara planificado, sintetiza una pieza
instrumental real y un lecho ambiental, y exporta el MP4 final. Es el modo
recomendado para probar el flujo de aprobación de principio a fin.

Requisito único del sistema: **ffmpeg** (con `ffprobe`) en el `PATH`, que se usa
para el vídeo y el montaje.

```bash
# Debian / Ubuntu
sudo apt-get install -y ffmpeg
# macOS
brew install ffmpeg
```

### Otros comandos

```bash
npm test             # 90 pruebas (dominio, plan, media y producción completa)
npm run typecheck    # comprobación de tipos de los tres paquetes
npm run build        # compila shared + server + web
npm start            # build y servidor único sirviendo la web en :8787
npm run demo         # produce un corto entero sin interfaz y exporta el MP4
```

`npm run demo -- --duration 120 --instrument guzheng --scenario lake` recorre
todo el pipeline aprobando cada activo a la primera; sirve para verificar la
instalación.

---

## Flujo del producto

```
CONFIGURACIÓN → EQUIPO DE PRODUCCIÓN IA → PLAN + PROMPTS
      → IMÁGENES  → revisar → regenerar / APROBAR
      → VÍDEOS    → revisar → regenerar / APROBAR
      → MÚSICA    → escuchar → regenerar / APROBAR
      → AMBIENTE  → escuchar → regenerar / APROBAR
      → MONTAJE   → PREVIEW FINAL → APROBACIÓN FINAL → MP4
```

Las etapas avanzan **en orden** (§5): la etapa de vídeos no se abre hasta que
todas las imágenes están aprobadas, la música hasta que lo están los clips, y así
sucesivamente. Dentro de una etapa cada activo es independiente: si solo falla el
Shot 04, se regenera únicamente el Shot 04 (§27, §47).

### Reglas que el sistema hace cumplir

| Regla del PRD | Dónde se aplica |
| --- | --- |
| Una generación técnicamente correcta **no** queda aprobada (§4, §46) | `domain/stateMachine.ts` — `completeGeneration` deja el activo en `review`; no existe ninguna ruta de código que apruebe sin acción del usuario |
| Solo el material aprobado pasa a la siguiente etapa (§22, §32) | `progress.ts` — `canGenerate`, `blockingDependencies`; el editor rechaza el montaje si falta algo |
| El activo aprobado queda bloqueado como versión oficial (§23, §38) | `locked: true`; regenerar exige un desbloqueo explícito |
| Cada generación se conserva como historial (§21, §30, §37) | Todas las generaciones quedan en disco y en `project.json`; solo cambia el puntero `approvedGenerationId` |
| Regenerar afecta únicamente al activo seleccionado (§47) | Las mutaciones son por activo; lo que dependía de una versión sustituida se marca `stale` en lugar de borrarse |
| Continuidad a partir de referencias aprobadas (§17) | `generationService.resolveReferences` — personaje → escenario → escena → toma, más la última toma aprobada |
| Reutilizar en vez de volver a generar (§15, §25, §33) | El Productor planifica la reutilización en la línea de tiempo; el montaje reproduce el mismo archivo aprobado |
| Solo música instrumental, sin voz (§3, §28) | Prompt y prompt negativo del brief musical; el sintetizador local no tiene voz por construcción |

---

## Arquitectura

```
packages/shared    Modelo de dominio, catálogos, esquemas y reglas de progreso
                   (lo usan servidor y web, para que no puedan discrepar)
packages/server    Equipo de producción IA, máquina de estados, proveedores,
                   editor ffmpeg, API REST + SSE
packages/web       Pantalla de configuración (§43) y Production Room (§44)
```

### El equipo de producción

Los roles del PRD (§13–§18) son responsabilidades dentro del proceso, no
servicios separados:

- **Productor** (`team/producer.ts`) — decide la estructura: número de tomas,
  duración de cada una, división en clips generables y **dónde reutilizar**
  material aprobado. Trabaja solo con números, así que la duración total siempre
  cuadra al segundo.
- **Director / Guionista / Director de arte** (`team/heuristicPlanner.ts` o
  `team/claudePlanner.ts`) — escriben la capa creativa: concepto, biblia visual
  y una descripción por toma.
- **Director de arte** (`team/artDirector.ts`) — convierte la biblia visual en el
  contrato de continuidad del que se compone **todo** prompt del proyecto.
- **Director de fotografía** — la gramática de planos y movimientos por bloque
  narrativo, dentro del Productor.
- **Editor** (`services/editorService.ts`) — monta los activos aprobados sobre la
  línea de tiempo planificada, mezcla música y ambiente y exporta.

La separación importa: el planificador creativo puede cambiar (Claude o el
interno) sin que cambien la duración, el número de tomas ni la cadena de
continuidad.

### Proveedores de generación

Cada tipo de activo tiene un proveedor intercambiable
(`AMS_*_PROVIDER`, ver `.env.example`):

| Activo | `mock` (por defecto) | Nube |
| --- | --- | --- |
| Imágenes | Render procedural: composición según el tipo de plano, paleta según la hora del día, etiqueta legible con la toma y el número de generación | **Vertex AI · Imagen** (`:predict`) |
| Vídeo | Anima la imagen aprobada con el movimiento de cámara planificado (Ken Burns con ffmpeg) | **Vertex AI · Veo** (`:predictLongRunning` + polling) |
| Música | Síntesis aditiva instrumental con arco intro → desarrollo → clímax → resolución, timbre según el instrumento y reverberación según la acústica del escenario | **Lyria** en Vertex AI (`:predict`, con costura de segmentos) |
| Ambiente | Capas sintetizadas a partir del escenario (viento, hojas, agua, pájaros, público, sala) | — |

Los proveedores locales no son un *stub*: escriben PNG, MP4 y WAV reales, para
que revisar, comparar generaciones y montar tengan sentido sin cuenta en la nube.

> El PRD llama «Lyra» al modelo de música; en Vertex AI el modelo instrumental se
> publica como **Lyria**, que es al que apunta el adaptador.

### Prompts

Los prompts se componen en español a partir de la biblia visual y son visibles
en la interfaz (§19), junto con el prompt negativo, las referencias aprobadas
utilizadas y las reglas de continuidad aplicadas.

---

## Configuración

Copia `.env.example` a `.env` y ajusta lo que necesites. Todo es opcional.

Para usar Google Cloud:

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=mi-proyecto
export AMS_IMAGE_PROVIDER=vertex
export AMS_VIDEO_PROVIDER=vertex
export AMS_MUSIC_PROVIDER=lyria
```

Para que el equipo creativo lo escriba Claude en lugar del planificador interno:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Si Claude no está disponible o falla, el proyecto se crea igualmente con el
planificador determinista y el aviso se devuelve en la respuesta de creación.

---

## Almacenamiento

Un proyecto es un directorio (`data/projects/<id>/`) con la estructura del §37:

```
project.json                    plan, activos, generaciones, historial
images/character/gen_001.png
images/environment/gen_001.png
images/scene/gen_001.png
images/shot_03/gen_001.png      cada intento se conserva
videos/shot_03_clip_a/gen_001.mp4
music/gen_003.wav
ambient/gen_001.wav
final/preview.mp4
final/project_final.mp4
final/project_final.json        título, descripción, hashtags y lista de cortes
```

---

## API

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `GET` | `/api/health` | Proveedores activos y disponibilidad de ffmpeg |
| `GET` | `/api/catalog` | Catálogos de la pantalla de configuración |
| `GET` | `/api/catalog/instruments?q=` | Buscador de instrumentos |
| `GET` | `/api/projects` | Lista de proyectos |
| `POST` | `/api/projects` | Crea el proyecto y ejecuta el equipo de producción |
| `GET` | `/api/projects/:id` | Proyecto + estado de producción |
| `POST` | `/api/projects/:id/assets/:assetId/generate` | Encola una generación (202) |
| `POST` | `/api/projects/:id/assets/:assetId/unlock` | Desbloquea un activo aprobado |
| `POST` | `.../generations/:generationId/approve` | Aprueba y bloquea esa versión |
| `POST` | `.../generations/:generationId/reject` | Descarta esa versión |
| `POST` | `/api/projects/:id/edit/assemble` | Monta la previsualización |
| `POST` | `/api/projects/:id/edit/approve` | Aprobación final del montaje |
| `POST` | `/api/projects/:id/edit/reopen` | Vuelve a edición |
| `POST` | `/api/projects/:id/export` | Exporta el MP4 y los metadatos |
| `PATCH` | `/api/projects/:id/delivery` | Edita título, descripción y hashtags |
| `GET` | `/api/projects/:id/stream` | SSE con el proyecto y los eventos |

La generación devuelve `202` y continúa en segundo plano: el resultado llega por
SSE. Así una toma que tarda minutos en Veo no bloquea la revisión del resto.

---

## Limitaciones conocidas

- Los proveedores de Vertex AI y Lyria están implementados pero **no se han
  ejecutado contra la API real** en este entorno (no hay credenciales). El modo
  offline sí está verificado de principio a fin.
- Las referencias visuales solo se envían a Imagen cuando el modelo configurado
  es de la familia *capability*; el resto de modelos reciben únicamente el
  prompt, que ya incluye el contrato de continuidad completo.
- Las transiciones que monta el editor son corte, fundido de entrada/salida y
  fundido a negro entre bloques. No hay encadenado real.
- No hay autenticación ni multiusuario: es una herramienta local.
