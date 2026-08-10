# Preparar tu cuenta de Google Cloud

<walkthrough-tutorial-duration duration="6"></walkthrough-tutorial-duration>

Esto se hace **una sola vez**. Al terminar tendrás las tres variables que hay que
poner en Vercel, y la herramienta funcionará.

**No hay que teclear nada.** Cada bloque de comando lleva un botón que lo mete en
el terminal por ti; tú solo lo tocas y pulsas **Intro**.

## Elegir el proyecto

Primero, en qué cuenta de Google Cloud vas a trabajar.

<walkthrough-project-setup></walkthrough-project-setup>

Comprueba que el nombre que aparece es el correcto. Si tienes varias cuentas, ésta
es la que va a generar los vídeos y la que va a pagarlos.

Cuando lo tengas, pulsa **Siguiente**.

## Dejar la cuenta lista

Ahora se ejecuta el instalador. Toca el botón del recuadro para meter el comando en
el terminal, y luego pulsa **Intro**:

```bash
bash i.sh
```

Tarda uno o dos minutos. Por el camino:

- Enciende las APIs que hacen falta (Vertex AI, Cloud Storage, Cloud Build)
- **Reutiliza** el bucket que ya tengas — no crea ninguno nuevo
- **Reutiliza** la cuenta de servicio que ya tengas, y le añade los permisos
  que le falten
- Y si esa cuenta ya tiene una clave, **no crea otra**: te dice que conserves la
  que ya está puesta en Vercel

Solo propone crear algo cuando de verdad no hay nada que reutilizar, y
preguntando antes. Esta herramienta convive con tus otros proyectos en la misma
cuenta de Google y no va a llenarte el IAM de cuentas parecidas.

**Te va a preguntar tres o cuatro cosas**, y casi todas se contestan con una
letra:

- ¿Es el proyecto correcto? → **s**
- ¿Uso el bucket `creancion-de-contenido`? → **s**
- ¿Es correcta esta cuenta de servicio? → **s**
- ¿Creo una clave nueva? → **n** (ya tienes una funcionando)

Si algo falla, el propio script te dice qué y cómo se arregla. No se muere con un
número.

## Copiar las tres variables

Al terminar, el terminal te muestra un resumen con **tres variables**. Esa parte del
terminal **sí se puede seleccionar y copiar** con el dedo.

| Variable | De dónde sale |
| --- | --- |
| `GCP_SERVICE_ACCOUNT` | te la imprime el script |
| `GCS_OUTPUT_BUCKET` | te la imprime el script |
| `APP_KEY` | **la eliges tú**: tu contraseña para entrar en la app |

Sobre `APP_KEY`: piensa una contraseña que recuerdes y que puedas teclear cómodo en
el móvil, porque la vas a escribir cada vez que entres. No la genera el script — es
tuya.

## Pegarlas en Vercel

Abre <walkthrough-editor-open-file filePath="README.md">otra pestaña</walkthrough-editor-open-file>
con **vercel.com** y ve a tu proyecto:

**Settings → Environment Variables**

Crea las tres, una por una. En cada una: el nombre arriba, el valor abajo, y
**Save**.

Cuando estén las tres, ve a la pestaña **Deployments**, y en el despliegue de arriba
toca los tres puntos **⋯ → Redeploy**.

Esto último no es opcional: Vercel **no** aplica variables nuevas a un despliegue que
ya estaba construido.

## Comprobar que funciona

Abre tu aplicación y, sin entrar todavía, toca **«Comprobar el estado del servidor»**.

Esa pantalla te dice qué cuenta de Google está usando, si la credencial vale, si el
bucket se lee y si puede montar vídeo. Si falta algo, te dice **cuál** y **cómo se
arregla**.

Cuando esté todo en verde, entra con tu contraseña y ya puedes crear tu primer corto.

## Listo

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

Esto no hay que repetirlo.

El día que cambies de cuenta de Google Cloud, vuelves a ejecutar `bash i.sh` en la
cuenta nueva y cambias las **dos** primeras variables en Vercel. Tu contraseña se
queda como está.
