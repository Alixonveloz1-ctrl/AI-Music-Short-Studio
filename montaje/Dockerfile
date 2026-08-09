# Contenedor del montador: Node 20 + ffmpeg. Nada más.
#
# Se fija bookworm (Debian 12) a propósito: trae ffmpeg 5.1 o superior, que es
# desde donde funcionan de verdad `amix=normalize=0`, `alimiter` y `tpad`, los
# tres filtros de los que depende la receta de montaje. Con una base más vieja
# el contenedor construye igual y el fallo aparece a mitad del primer render.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# No hay package.json ni `npm install`: el servicio no usa ninguna dependencia
# de npm. Habla con Cloud Storage por HTTP con el `fetch` que ya trae Node 20 y
# pide el permiso al servidor de metadatos de Cloud Run. Así la imagen se
# construye sin red de npm y no hay nada que se pueda romper en un `npm audit`.
COPY index.js ./

ENV NODE_ENV=production

# Cloud Run inyecta PORT; index.js lo lee y cae en 8080 si no está.
CMD ["node", "index.js"]
