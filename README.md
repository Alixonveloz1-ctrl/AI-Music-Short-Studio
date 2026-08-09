# AI Music Short Studio

Hace **cortometrajes musicales instrumentales** de 1, 2 o 3 minutos.

Tú eliges el instrumento, quién lo toca, dónde y con qué estilo.
La IA prepara el plan, genera las imágenes con **Imagen**, las
anima en clips con **Veo** y compone la música con **Lyria**.
Nunca hay voz cantada: el producto es instrumental por diseño.

## La regla del producto

> **La IA propone y genera. El usuario aprueba.**

Una generación que sale técnicamente bien **no queda aprobada
sola**: aterriza en revisión y espera. Solo lo que tú apruebas
pasa a la etapa siguiente y llega al montaje final.

Esa regla no es un consejo, está escrita en el código
(`api/_lib/dominio.js`) y hay pruebas que vigilan que no se
rompa.

---

## Puesta en marcha (3 pasos)

### 1. Sube el repositorio a Vercel

No hay que compilar nada ni instalar nada. Vercel detecta las
funciones de `api/` y sirve `index.html`.

### 2. Prepara tu cuenta de Google Cloud

Abre **Cloud Shell** en `console.cloud.google.com` (el botón
`>_` de arriba a la derecha) y teclea esta línea:

```
curl -sL https://TU-DOMINIO.vercel.app/i.sh | bash
```

(Cambia `TU-DOMINIO` por el dominio que te dio Vercel.)

El instalador te pregunta en qué proyecto va a trabajar, lo
deja todo listo y **al final te imprime los tres datos** que
tienes que pegar en Vercel.

### 3. Pon las variables en Vercel

`Settings` → `Environment Variables`:

| Variable | Qué es | ¿Obligatoria? |
|---|---|---|
| `GCP_SERVICE_ACCOUNT` | El JSON de la cuenta de servicio, en una línea | **Sí** |
| `GCS_OUTPUT_BUCKET` | El nombre del bucket, sin `gs://` | **Sí** |
| `APP_KEY` | La contraseña de la app | Muy recomendable |

Después: `Deployments` → los tres puntos del último →
**Redeploy**. Sin redesplegar, las variables nuevas no llegan.

Para comprobar que todo está bien, abre
`https://TU-DOMINIO/api/salud`: dice qué falta y cómo se
arregla, y se puede ver sin contraseña.

### Sobre `APP_KEY`

Es la puerta de la herramienta. Sin ella, cualquiera que
encuentre tu URL puede generar vídeo con **tu** crédito de
Google. Un corto son decenas de llamadas a Veo.

Si `APP_KEY` no está puesta, la API se cierra sola en
producción: prefiere no funcionar antes que costarte dinero.

### Cambiar de cuenta de Google Cloud

Se cambian esas variables y se vuelve a desplegar. **Ya está.**

En el código no hay escrito ningún identificador de proyecto ni
ningún nombre de bucket: el proyecto sale del `project_id` de la
propia credencial.

---

## Qué hace el instalador (`i.sh`)

Vive en la raíz del repositorio porque Vercel sirve la raíz como
estático, y `vercel.json` le pone el tipo de archivo correcto.
Así se puede lanzar con una línea corta desde el móvil, donde el
terminal de Cloud Shell no deja pegar texto.

1. Dice en qué proyecto va a trabajar y **pide confirmación**
   antes de tocar nada.
2. Enciende las APIs que hacen falta.
3. Busca el bucket o lo crea. Si tienes varios, los lista y
   eliges por número.
4. Busca o crea la cuenta de servicio `music-studio`.
5. Le da los permisos.
6. Da permiso sobre el bucket a la identidad con la que Cloud
   Build monta el MP4.
7. Ajusta el CORS del bucket para que el navegador pueda ver el
   material.
8. Crea la clave JSON y te la imprime en una sola línea.

**No despliega ningún servidor** y **se puede volver a lanzar**
las veces que quieras: no duplica ni rompe nada.

### APIs que enciende

| API | Para qué |
|---|---|
| `aiplatform.googleapis.com` | Imagen, Veo y Lyria |
| `storage.googleapis.com` | guardar proyectos y material |
| `cloudbuild.googleapis.com` | montar el MP4 final |
| `serviceusage.googleapis.com` | la pantalla de diagnóstico |

### Roles que da a la cuenta de servicio

| Rol | Para qué |
|---|---|
| `roles/aiplatform.user` | llamar a Imagen, Veo y Lyria |
| `roles/storage.admin` | leer y escribir en el bucket |
| `roles/cloudbuild.builds.editor` | lanzar el montaje |
| `roles/iam.serviceAccountUser` | **el que más se olvida** |
| `roles/logging.logWriter` | que el montaje deje registro |

Sobre `iam.serviceAccountUser`: cuando falta, todo funciona
hasta el último paso y ahí el montaje devuelve un 403 hablando
de `actAs`, que no se parece en nada a «te falta un permiso».

También intenta dar `roles/serviceusage.serviceUsageConsumer`,
que es opcional y solo sirve para que la pantalla de
diagnóstico pueda mirar si las APIs están encendidas.

---

## Cómo está montado

```
index.html      toda la interfaz, en un solo archivo
api/            un archivo = un endpoint
api/_lib/       los módulos compartidos
i.sh            el instalador
vercel.json     duraciones máximas y cabeceras
pruebas/        pruebas de las reglas
```

- **JavaScript plano**, CommonJS (`require` / `module.exports`).
- **Cero dependencias de npm.** Solo Node 20 y `fetch`.
- **Sin compilación.** Lo que hay en el repositorio es
  exactamente lo que se ejecuta.
- Lo que está en `api/_lib/` no es un endpoint: Vercel ignora
  las carpetas que empiezan por `_`.

Esto es a propósito. Cuando algo falla y solo tienes un móvil
para arreglarlo, cada paso de compilación y cada dependencia es
un sitio más donde el fallo puede esconderse.

### Pruebas

```
node pruebas/reglas.js
```

Sin framework. Comprueban que nada se aprueba solo, que las
etapas van en orden, y que la interfaz y el servidor entienden
las reglas **exactamente igual** (la interfaz tiene su propia
copia porque no puede importar módulos del servidor).

---

## Los módulos de `api/_lib/`

| Módulo | Qué hace |
|---|---|
| `constantes.js` | Los números y estados de todo el producto. |
| `catalogo.js` | Instrumentos, formaciones, escenarios y estilos seleccionables. |
| `brief.js` | La forma del brief creativo y su normalización defensiva. |
| `planificador.js` | Director y guionista: escribe el brief, con Claude o con el planificador interno. |
| `productor.js` | Decide qué tomas existen, cuánto duran y qué material se reutiliza. |
| `arte.js` | La biblia visual y la redacción de cada prompt de imagen y de clip. |
| `plan.js` | Junta estructura y creatividad en el plan definitivo. |
| `dominio.js` | La máquina de estados de aprobación. Aquí vive la regla del producto. |
| `progreso.js` | Solo lee: qué etapa está abierta y qué se puede generar ahora. |
| `almacen.js` | Guarda y lee los proyectos en el bucket, sin pisarse entre peticiones. |
| `gcp.js` | Credenciales, tokens, URLs firmadas y acceso a Cloud Storage. |
| `http.js` | El preámbulo común: CORS, método, contraseña y errores. |
| `vertex.js` | Las llamadas a Imagen, Veo y Lyria. |
| `audio.js` | Síntesis del ambiente y unión de los fragmentos de música, en WAV. |
| `montaje.js` | Manda a Cloud Build el ffmpeg que arma la película. |

El planificador funciona **sin `ANTHROPIC_API_KEY`**: sin clave
usa el planificador interno determinista, que produce un plan
completo. Es un modo válido, no un fallo.

---

## Los endpoints

Todos van bajo `/api/` y hablan JSON. Todos piden la cabecera
`x-app-key` menos `salud`.

| Método y ruta | Qué hace |
|---|---|
| `GET catalogo` | Las listas para la pantalla de configuración. |
| `GET proyectos` | Tus cortos. |
| `POST proyectos` | Crea un corto a partir de la configuración. |
| `GET proyecto?id=` | Un corto entero, con el material listo para ver. |
| `POST generar` | Lanza la generación de un activo. |
| `GET generar?id=&activo=&gen=` | Pregunta si esa generación ya terminó. |
| `POST aprobar` | Aprueba una generación. Solo esto la da por buena. |
| `POST rechazar` | La descarta y deja el activo listo para reintentar. |
| `POST desbloquear` | Reabre un activo ya aprobado para cambiarlo. |
| `POST montar` | Lanza el montaje del MP4. |
| `GET montar?id=&job=` | Pregunta si el montaje terminó. |
| `POST entrega` | Guarda título, descripción y hashtags. |
| `GET salud` | Diagnóstico de la configuración. Sin contraseña. |

Los errores vienen como `{ "error": "texto en español" }`. Si
el problema es de configuración se añade `configError: true`,
para que la app pueda decir «esto se arregla en Vercel» en vez
de «vuelve a intentarlo», que sería el consejo equivocado.

### Por qué todo se pregunta después

Una función de Vercel tiene **60 segundos**. Un clip de Veo
tarda varios minutos. Así que nada se espera: se lanza el
trabajo, se devuelve un identificador y la interfaz va
preguntando si ya está.

### Las URLs del material

El bucket no es público. El servidor añade una **URL firmada**
a cada archivo antes de devolver el proyecto, para que el
navegador pueda pintar las imágenes, los vídeos y el audio. En
las respuestas no viaja ninguna ruta `gs://`.

---

## El montaje del MP4

Lo hace **Cloud Build**, y no hay que desplegar nada.

El montaje necesita ffmpeg, que no existe en Vercel, y necesita
más de 60 segundos. La salida habitual sería desplegar un
contenedor en Cloud Run, pero eso obliga a desplegar y mantener
un servicio, y aquí se trabaja desde el móvil.

Cloud Build no se despliega: se enciende su API y ya está. Es
un servicio que arranca una máquina temporal y ejecuta los
pasos que le mandes, con la imagen de contenedor que le digas.
Nada obliga a que esos pasos «construyan» nada. Así que la app
le manda: *baja estos archivos del bucket, corre este ffmpeg,
sube el resultado.* Google enciende la máquina, trabaja y la
apaga.

La función de Vercel solo manda un JSON y termina en segundos.
Google regala 2.500 minutos de Cloud Build al mes y un montaje
gasta unos tres.

**No falla en silencio**: si ffmpeg revienta, el último paso se
ejecuta igual y sube un `error.txt` al bucket, y ese texto llega
a la pantalla. Desde un móvil no hay forma cómoda de abrir los
registros de Cloud Build, y «exit code 1» no le dice nada a
nadie.

---

## Variables opcionales

Ninguna hace falta. Existen por si un proyecto concreto no tiene
acceso a algún modelo, o para probar otro sin tocar el código.

| Variable | Por defecto | Para qué |
|---|---|---|
| `APP_KEY` | — | Contraseña de la app. Ponla. |
| `ANTHROPIC_API_KEY` | — | Que el brief lo escriba Claude. Sin ella se usa el planificador interno. |
| `ANTHROPIC_MODEL` | `claude-opus-4-5-20251101` | Qué modelo escribe el brief. |
| `GCP_LOCATION` | `us-central1` | Región por defecto de todo. |
| `IMAGE_MODEL` | `imagen-4.0-generate-001` | Modelo de imagen. |
| `VEO_MODEL` | `veo-3.1-lite-generate-001` | Modelo de vídeo. La versión *lite* por defecto porque Veo cobra por segundo generado y un corto son decenas de clips. |
| `MUSIC_MODEL` | `lyria-002` | Modelo de música instrumental. |
| `IMAGE_LOCATION`, `VEO_LOCATION`, `MUSIC_LOCATION` | la de `GCP_LOCATION` | Región de cada modelo, por si alguno solo está en otra. |
| `MONTAJE_REGION` | la de `GCP_LOCATION` | Dónde corre el montaje. |
| `GCS_PREFIX` | `music-studio` | Carpeta propia dentro del bucket, para poder compartirlo con otras cosas sin mezclar archivos. |
| `FFMPEG_IMAGE` | `alpine:3.20` | La imagen que trae ffmpeg al montaje. |

---

## Limitaciones (lo que conviene saber antes de empezar)

Esto es honesto, no una lista de disculpas.

**Lo que no se ha probado todavía contra la API real de
Google.** El proyecto se reescribió entero para funcionar en
Vercel y esa reescritura se ha verificado con las pruebas de
las reglas, que no llaman a ninguna API. Queda por confirmar
contra Google, con una cuenta real:

- Que la respuesta de **Imagen**, **Veo** y **Lyria** tiene la
  forma que espera `api/_lib/vertex.js`, y que los modelos por
  defecto están disponibles en tu proyecto y en tu región. Si
  alguno no lo está, se cambia con las variables de arriba.
- Que el **montaje en Cloud Build** termina y sube el MP4.
- Cuánto tarda de verdad cada cosa, y por tanto cuántas veces
  hay que preguntar antes de que esté lista.
- Los **costes reales**. Veo cobra por segundo generado y cada
  regeneración rechazada también se paga. Un corto de 3 minutos
  son muchos clips.

**Límites de diseño:**

- Cada endpoint tiene 60 segundos. Nada se espera dentro de una
  petición: si cierras la pestaña mientras algo se genera, el
  trabajo sigue en Google, pero la app se entera al volver a
  preguntar.
- El estado vive en el bucket, no en una base de datos. Dos
  pestañas trabajando sobre el mismo corto a la vez pueden
  chocar; las escrituras se reintentan solas, pero no está
  pensado para varias personas a la vez.
- Las URLs firmadas caducan. Si una pantalla lleva mucho rato
  abierta, recárgala.
- No hay usuarios ni sesiones: hay una sola contraseña
  (`APP_KEY`) para toda la herramienta.
- No hay voz, y no la habrá: el producto es instrumental por
  construcción.

**Si algo falla**, el primer sitio al que ir es
`https://TU-DOMINIO/api/salud`, y el segundo son los registros
de Vercel: todos los errores del servidor se escriben ahí
enteros, aunque en pantalla se vean recortados.
