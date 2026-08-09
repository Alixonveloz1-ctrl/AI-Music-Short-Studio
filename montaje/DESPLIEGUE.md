# El montador de vídeo — instalación (se hace UNA sola vez)

El corto se monta con **ffmpeg**, un programa que junta los clips, les pone los
fundidos y les pega la música. En Vercel no existe ffmpeg y además una función
de Vercel se corta a los pocos segundos, y un corto de tres minutos tarda
varios. Por eso el montaje vive en un pequeño servicio dentro de **tu** cuenta
de Google Cloud.

Se instala una vez. Después la aplicación lo usa sola y no hay que volver aquí.

---

## Lo único que tienes que teclear

Entra en **console.cloud.google.com** y toca el botón **`>_`** de arriba a la
derecha. Se abre una ventana negra (se llama Cloud Shell). Escribe estas dos
líneas, una detrás de otra, pulsando Enter después de cada una:

```
git clone https://github.com/Alixonveloz1-ctrl/AI-Music-Short-Studio.git
```

```
bash AI-Music-Short-Studio/montaje/instalar.sh
```

Eso es todo lo que tienes que escribir. El resto lo hace el instalador.

> **¿Por qué dos líneas y no copiar y pegar un script?** Porque el terminal de
> Cloud Shell no deja pegar desde el móvil. Estas dos líneas son cortas y se
> pueden teclear; un script de doscientas, no.

---

## Qué te va a preguntar

Muy poco, y siempre cosas de una tecla:

1. **Te enseña el proyecto de Google Cloud donde va a instalar** y espera a que
   pulses **Enter**. Míralo bien: es el único momento en que puedes darte cuenta
   de que estás en la cuenta equivocada. Si no es el correcto, pulsa Ctrl+C y
   ejecuta `gcloud config set project EL-NOMBRE-DE-TU-PROYECTO`.

2. **El bucket.** Si en el proyecto solo hay uno, lo coge solo y te lo dice. Si
   hay varios, te los enseña numerados y solo tienes que escribir el **número**.

Después trabaja entre cinco y ocho minutos. No cierres la ventana.

---

## Qué te da al terminar

Al final imprime, en un recuadro grande, **dos variables** con su nombre y su
valor:

| Nombre | Qué es |
|---|---|
| `MONTAJE_URL` | la dirección del montador que acaba de crear |
| `MONTAJE_KEY` | la contraseña que la aplicación usa para hablar con él |

Ve a **vercel.com → tu proyecto → Settings → Environment Variables** y añade las
dos, con ese nombre exacto y ese valor exacto.

Después, y esto es importante: **Deployments → los tres puntos del último →
Redeploy**. Vercel no coge las variables nuevas hasta que se vuelve a desplegar.

El instalador también te recuerda el nombre del bucket para que compruebes que
`GCS_OUTPUT_BUCKET` está puesta con ese mismo valor.

---

## Volver a ejecutarlo (para actualizar)

Cuando el montador cambie, se actualiza con:

```
cd AI-Music-Short-Studio && git pull && cd ..
```

```
bash AI-Music-Short-Studio/montaje/instalar.sh
```

**Volver a ejecutarlo no rompe nada.** Reconoce el bucket y la clave que ya
estaban puestos y los conserva, así que lo que tengas en Vercel sigue siendo
válido y no hay que tocarlo. Te lo dice en pantalla.

---

## Si algo falla

Los errores del montaje **no se quedan escondidos** en los registros de Google.
Cada montaje escribe cómo va en un archivo dentro de tu bucket:

```
<carpeta del estudio>/montajes/<identificador>.json
```

Ese archivo dice `montando`, `listo` o `fallo`, y cuando dice `fallo` trae el
motivo escrito en español, en una frase. La aplicación lo lee y lo enseña en
pantalla: no hace falta entrar en Google Cloud para saber qué pasó.

Si el instalador se para a media instalación, léelo: la última línea que imprime
dice en qué paso estaba.

---

## Cuánto cuesta

Cloud Run cobra solo mientras trabaja. Un corto de tres minutos ocupa la máquina
unos pocos minutos; con un uso normal se queda dentro de la franja gratuita
mensual de Google o muy cerca de ella. Mientras no montas nada, el servicio está
apagado y no cuesta nada.

---

<br>

# Apéndice técnico

Esto no hace falta leerlo para usar el estudio.

## Lo que hay en esta carpeta

| Archivo | Qué es |
|---|---|
| `index.js` | el servicio HTTP: recibe la línea de tiempo y ejecuta ffmpeg |
| `Dockerfile` | Node 20 + ffmpeg. Sin `npm install`: el servicio no usa ninguna dependencia |
| `instalar.sh` | lo que despliega todo lo anterior en la cuenta del usuario |

## El contrato del servicio

**`GET /`**

```json
{ "ok": true, "service": "ams-montaje", "version": "2026-08-09.1" }
```

**`POST /montar`** — cabecera obligatoria `x-montaje-key: <MONTAJE_KEY>`.

```json
{
  "bucket": "mi-bucket",
  "prefijo": "music-studio",
  "entradas": [
    {
      "objeto": "music-studio/proyectos/abc/clips/toma-01.mp4",
      "inicioSec": 0,
      "duracionSec": 5.5,
      "transicion": "cut"
    },
    {
      "objeto": "music-studio/proyectos/abc/clips/toma-02.mp4",
      "inicioSec": 1.2,
      "duracionSec": 4,
      "transicion": "dip_to_black"
    }
  ],
  "musica":   { "objeto": "music-studio/proyectos/abc/audio/musica.wav",   "volumen": 0.85 },
  "ambiente": { "objeto": "music-studio/proyectos/abc/audio/ambiente.wav", "volumen": 0.28 },
  "salida": "music-studio/proyectos/abc/final/pelicula.mp4",
  "ancho": 1920,
  "alto": 1080,
  "fps": 24
}
```

Responde **de inmediato**, sin esperar al montaje:

```json
{ "jobId": "mont-…", "estado": "music-studio/montajes/mont-….json" }
```

Detalles del cuerpo:

- `entradas` es la línea de tiempo **ya resuelta**, en orden. Un mismo `objeto`
  puede repetirse: el productor planifica la reutilización de tomas y el
  montador baja cada archivo una sola vez.
- `inicioSec` es el segundo **dentro del clip** por el que empieza el recorte.
- `duracionSec` es lo que esa toma dura **en la película**. Es exacta: este
  servicio no estira ni ajusta nada, porque el corto es instrumental y no hay
  ninguna voz con la que cuadrar.
- `transicion` es `"cut"` o `"dip_to_black"`. Cualquier otra cosa se monta como
  corte seco.
- `ambiente` es opcional. `musica` no.
- `ancho`, `alto` y `fps` son opcionales (1920×1080 a 24).
- Todas las rutas tienen que estar dentro de `prefijo/`. El montador tiene
  permiso de escritura sobre todo el bucket, así que se niega a tocar nada que
  esté fuera de la carpeta del estudio.

## El estado, en el bucket

En `<prefijo>/montajes/<jobId>.json`. Se reescribe según avanza:

```json
{ "estado": "montando", "fase": "montando la toma 7 de 23", "progreso": 0.33 }
{ "estado": "listo", "objeto": "…/pelicula.mp4", "duracion": 180.0, "bytes": 1, "avisos": [] }
{ "estado": "fallo", "fase": "…", "error": "frase en español" }
```

`avisos` recoge lo que salió raro pero no impidió terminar (por ejemplo, una
toma a la que le faltaba metraje y se cubrió congelando el último fotograma).

## La receta de ffmpeg

Es la misma que ya funcionaba en el montaje local, trasladada al contenedor:

- Cada toma se rinde por separado: `trim` → `setpts` → (`tpad` si falta
  metraje) → `scale`+`pad` sin deformar → `setsar=1` → `fps` → fundidos.
- Los segmentos se unen con el demuxer `concat` y `-c copy`, así que la imagen
  se codifica **una sola vez**.
- El sonido se pega en un último paso con `-c:v copy`: música y ambiente
  normalizados a estéreo, `apad` antes de `atrim` para que el final no se quede
  mudo, `amix=inputs=2:duration=first:normalize=0` (sin el `normalize=0` la
  música bajaría a la mitad sin avisar), fundidos de entrada y salida, y
  `alimiter` para que la suma no sature.

## Por qué se despliega con `--no-cpu-throttling`

Porque `/montar` contesta al instante y sigue trabajando en segundo plano. Sin
esa opción, Cloud Run le retira el procesador a la instancia en cuanto responde
la petición y el render se queda congelado a mitad, sin dar ningún error: el
estado en el bucket se quedaría para siempre en `montando`.
