#!/bin/bash
# =============================================================
#  AI MUSIC SHORT STUDIO — INSTALADOR DE LA CUENTA DE GOOGLE
#
#  Se ejecuta en Cloud Shell con UNA sola linea:
#
#      curl -sL https://TU-DOMINIO.vercel.app/i.sh | bash
#
#  POR QUE ASI: el terminal de Cloud Shell en el movil no deja
#  pegar texto, y teclear un script a mano no es viable. Por eso
#  este archivo vive en la RAIZ del repositorio: Vercel sirve la
#  raiz como estatico y vercel.json ya le pone el Content-Type
#  de shell, asi que la URL de arriba devuelve el script tal cual.
#
#  QUE HACE Y QUE NO HACE
#  Este proyecto NO despliega ningun contenedor: el MP4 final lo
#  monta Cloud Build directamente (ver api/_lib/montaje.js). Asi
#  que aqui no se construye ni se sube nada. Este script solo
#  DEJA LA CUENTA LISTA: enciende APIs, prepara el bucket, crea
#  la cuenta de servicio con sus permisos y te entrega las tres
#  variables que hay que pegar en Vercel.
#
#  Es IDEMPOTENTE: volver a ejecutarlo no duplica ni rompe nada.
# =============================================================

# Nada de `set -e`: aqui cada paso se comprueba a mano para poder
# explicar EN ESPANOL que fallo y como se arregla. Un script que
# muere soltando "exit 1" no le sirve a nadie desde un movil.
set -u

# ─── Ajustes que casi nunca hay que tocar ───
# Se pueden forzar por entorno, p.ej.:  REGION=europe-west4 bash i.sh
REGION="${REGION:-us-central1}"
SA_ID="${SA_ID:-music-studio}"
SA_NOMBRE="AI Music Short Studio"

RAYA="=============================================="
LINEA="----------------------------------------------"

# ─── Utilidades de pantalla ───
# Lineas cortas a proposito: esto se lee en una pantalla estrecha.

titulo() {
  echo ""
  echo "$RAYA"
  echo "  $1"
  echo "$RAYA"
}

paso()  { echo ""; echo ">>> $1"; }
ok()    { echo "    OK  $1"; }
aviso() { echo "    !   $1"; }

# Un unico final para todos los fallos: QUE paso y QUE hacer.
morir() {
  echo ""
  echo "$RAYA"
  echo "  NO SE PUDO CONTINUAR"
  echo "$RAYA"
  echo ""
  echo "  Que fallo:"
  echo "    $1"
  echo ""
  if [ -n "${2:-}" ]; then
    echo "  Que hacer:"
    echo "    $2"
    echo ""
  fi
  echo "  Nada de lo hecho hasta aqui se ha roto:"
  echo "  puedes volver a lanzar el instalador cuando"
  echo "  lo hayas resuelto."
  echo ""
  exit 1
}

# ─── Preguntas ───
#
# ATENCION AL DETALLE QUE ROMPE ESTE TIPO DE SCRIPT: al lanzarlo
# como `curl ... | bash`, la entrada estandar ES EL PROPIO SCRIPT.
# Un `read` normal se comeria sus propias lineas y el instalador
# se saltaria las preguntas o haria cosas al azar. Por eso todas
# las respuestas se leen del terminal de verdad: /dev/tty.
RESP=""

pregunta() {
  RESP=""
  printf '%s' "$1"
  if ! read -r RESP < /dev/tty 2>/dev/null; then
    echo ""
    morir "No hay terminal para hacerte preguntas." \
      "Lanzalo asi, que conserva el teclado:
       bash <(curl -sL https://TU-DOMINIO/i.sh)"
  fi
}

# Confirmacion. Por defecto NO: en los pasos caros el silencio
# nunca puede significar "adelante".
confirmar() {
  pregunta "$1 [s/N]: "
  case "$RESP" in
    s|S|si|SI|Si|y|Y|yes) return 0 ;;
    *) return 1 ;;
  esac
}

titulo "AI MUSIC SHORT STUDIO — INSTALADOR"
cat <<'FIN'

  Deja tu cuenta de Google Cloud lista para la
  herramienta. NO despliega ningun servidor:
  el montaje del MP4 lo hace Cloud Build solo.

  Al final te da TRES datos para pegar en Vercel.
  Tarda entre 1 y 3 minutos.

FIN

# ─── Comprobaciones previas ───

command -v gcloud >/dev/null 2>&1 || morir \
  "No encuentro el comando 'gcloud'." \
  "Abre Cloud Shell desde console.cloud.google.com
       (el boton >_ arriba a la derecha) y lanza
       el instalador ahi: alli gcloud ya viene puesto."

CUENTA="$(gcloud config get-value account 2>/dev/null)"
if [ -z "$CUENTA" ] || [ "$CUENTA" = "(unset)" ]; then
  morir "No hay ninguna cuenta de Google conectada." \
    "Ejecuta:  gcloud auth login
       y vuelve a lanzar el instalador."
fi

# =============================================================
# PASO 1 — EL PROYECTO
#
# Es la unica pregunta que NO se puede dar por supuesta: tocar la
# cuenta equivocada es el error caro de todo esto (permisos y
# claves creados donde no tocaba). Por eso se confirma antes de
# escribir nada.
# =============================================================
titulo "PASO 1 de 8 — PROYECTO"

PROYECTO="${PROYECTO:-$(gcloud config get-value project 2>/dev/null)}"
[ "$PROYECTO" = "(unset)" ] && PROYECTO=""

if [ -z "$PROYECTO" ]; then
  echo ""
  echo "  No hay proyecto activo. Estos son los tuyos:"
  echo ""
  PROYECTOS="$(gcloud projects list --format='value(projectId)' 2>/dev/null)"
  [ -z "$PROYECTOS" ] && morir \
    "Tu cuenta no tiene ningun proyecto de Google Cloud." \
    "Crea uno en console.cloud.google.com (menu de
       arriba, 'Proyecto nuevo') y vuelve a lanzarlo."

  i=0
  while IFS= read -r p; do
    i=$((i + 1))
    echo "    $i) $p"
  done <<< "$PROYECTOS"
  echo ""
  pregunta "  Escribe el numero: "
  PROYECTO="$(echo "$PROYECTOS" | sed -n "${RESP}p" 2>/dev/null)"
  [ -z "$PROYECTO" ] && morir \
    "Ese numero no corresponde a ningun proyecto." \
    "Vuelve a lanzarlo y escribe solo el numero
       que aparece a la izquierda del nombre."
fi

echo ""
echo "  Cuenta:   $CUENTA"
echo "  Proyecto: $PROYECTO"
echo "  Region:   $REGION"
echo ""
echo "  Voy a modificar ESE proyecto: encender APIs,"
echo "  crear una cuenta de servicio y darle permisos."
echo ""

if ! confirmar "  Es el proyecto correcto?"; then
  echo ""
  echo "  Cancelado. No se ha tocado nada."
  echo ""
  echo "  Para usar otro proyecto:"
  echo "    gcloud config set project EL-QUE-QUIERAS"
  echo "  y vuelve a lanzar el instalador."
  echo ""
  exit 0
fi

gcloud config set project "$PROYECTO" >/dev/null 2>&1

NUMERO_PROYECTO="$(gcloud projects describe "$PROYECTO" \
  --format='value(projectNumber)' 2>/dev/null)"
[ -z "$NUMERO_PROYECTO" ] && morir \
  "No puedo leer el proyecto '$PROYECTO'." \
  "O el nombre esta mal escrito, o tu cuenta no
       tiene permiso sobre el. Comprueba en
       console.cloud.google.com que aparece en la lista."

ok "proyecto $PROYECTO (numero $NUMERO_PROYECTO)"

# =============================================================
# PASO 2 — LAS APIs
#
# serviceusage es la unica que no se usa para producir: sirve
# para que la pantalla de diagnostico de la app pueda decir
# "esta API esta apagada" en vez de "algo fallo".
# =============================================================
titulo "PASO 2 de 8 — ENCENDER LAS APIs"

APIS="aiplatform.googleapis.com storage.googleapis.com cloudbuild.googleapis.com serviceusage.googleapis.com"

paso "Encendiendo (tarda ~1 minuto la primera vez)..."
# Encenderlas de golpe es mas rapido y es idempotente: las que ya
# esten encendidas simplemente no cambian.
if ! gcloud services enable $APIS --project="$PROYECTO" --quiet 2>/tmp/ams_err; then
  morir "No se pudieron encender las APIs.
       Google dijo: $(tail -2 /tmp/ams_err | tr '\n' ' ')" \
    "Lo mas habitual es que el proyecto no tenga
       facturacion activada. Entra en
       console.cloud.google.com/billing y asocia
       el proyecto a una cuenta de facturacion
       (el credito gratuito de Google sirve)."
fi

ok "Vertex AI        (imagenes, video y musica)"
ok "Cloud Storage    (guarda proyectos y material)"
ok "Cloud Build      (monta el MP4 final)"
ok "Service Usage    (pantalla de diagnostico)"

# =============================================================
# PASO 3 — EL BUCKET
#
# Todo el material vive aqui. Si ya hay uno se reutiliza: la app
# guarda lo suyo bajo una carpeta propia (GCS_PREFIX), asi que
# compartir el bucket con otra cosa no mezcla archivos.
# =============================================================
titulo "PASO 3 de 8 — EL BUCKET"

BUCKET="${BUCKET:-}"
BUCKET="${BUCKET#gs://}"
BUCKET="${BUCKET%%/*}"

if [ -z "$BUCKET" ]; then
  BUCKETS="$(gcloud storage buckets list --project="$PROYECTO" \
    --format='value(name)' 2>/dev/null)"
  CUANTOS=0
  [ -n "$BUCKETS" ] && CUANTOS="$(echo "$BUCKETS" | wc -l | tr -d ' ')"

  if [ "$CUANTOS" = "0" ]; then
    echo ""
    echo "  Este proyecto no tiene ningun bucket."
    BUCKET="${PROYECTO}-music-studio"
    echo "  Propongo crear:  $BUCKET"
    echo ""
    if ! confirmar "  Lo creo?"; then
      pregunta "  Escribe el nombre que quieras: "
      BUCKET="$RESP"
    fi

  elif [ "$CUANTOS" = "1" ]; then
    BUCKET="$BUCKETS"
    echo ""
    echo "  El proyecto tiene un unico bucket:"
    echo "    $BUCKET"
    echo ""
    if ! confirmar "  Uso ese?"; then
      pregunta "  Nombre del bucket nuevo: "
      BUCKET="$RESP"
    fi

  else
    echo ""
    echo "  Tienes varios buckets. Elige uno:"
    echo ""
    i=0
    while IFS= read -r b; do
      i=$((i + 1))
      echo "    $i) $b"
    done <<< "$BUCKETS"
    echo "    0) crear uno nuevo"
    echo ""
    pregunta "  Escribe el numero: "
    if [ "$RESP" = "0" ]; then
      pregunta "  Nombre del bucket nuevo: "
      BUCKET="$RESP"
    else
      BUCKET="$(echo "$BUCKETS" | sed -n "${RESP}p" 2>/dev/null)"
    fi
  fi
fi

BUCKET="${BUCKET#gs://}"
BUCKET="${BUCKET%%/*}"
[ -z "$BUCKET" ] && morir \
  "Me he quedado sin nombre de bucket." \
  "Vuelve a lanzarlo y escribe un nombre, o pasalo
       ya hecho:  BUCKET=mi-bucket bash i.sh"

if gcloud storage buckets describe "gs://$BUCKET" \
     --project="$PROYECTO" >/dev/null 2>&1; then
  ok "el bucket $BUCKET ya existe, lo reutilizo"
else
  paso "Creando gs://$BUCKET en $REGION..."
  # Mismo sitio que Vertex y el montaje: el material no cruza
  # regiones, va mas rapido y no paga salida.
  # Acceso uniforme: hace que los permisos del paso 6 (los del
  # bucket) se apliquen de verdad; con ACL antiguas se ignoran.
  if ! gcloud storage buckets create "gs://$BUCKET" \
        --project="$PROYECTO" --location="$REGION" \
        --uniform-bucket-level-access 2>/tmp/ams_err; then
    morir "No se pudo crear el bucket '$BUCKET'.
       Google dijo: $(tail -2 /tmp/ams_err | tr '\n' ' ')" \
      "El nombre de un bucket es unico EN TODO GOOGLE,
       no solo en tu cuenta: si ya lo tiene otra
       persona, hay que elegir otro. Vuelve a
       lanzarlo y prueba con algo mas propio, por
       ejemplo  ${PROYECTO}-cortos-2026."
  fi
  ok "bucket $BUCKET creado"
fi

# =============================================================
# PASO 4 — LA CUENTA DE SERVICIO
#
# Es la identidad con la que Vercel habla con Google. Se llama
# siempre igual, asi que si ya existe se reutiliza y no se
# duplica al volver a ejecutar el instalador.
# =============================================================
titulo "PASO 4 de 8 — CUENTA DE SERVICIO"

SA_EMAIL="${SA_ID}@${PROYECTO}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SA_EMAIL" \
     --project="$PROYECTO" >/dev/null 2>&1; then
  ok "ya existe: $SA_EMAIL"
else
  paso "Creando $SA_EMAIL ..."
  if ! gcloud iam service-accounts create "$SA_ID" \
        --project="$PROYECTO" \
        --display-name="$SA_NOMBRE" 2>/tmp/ams_err; then
    morir "No se pudo crear la cuenta de servicio.
       Google dijo: $(tail -2 /tmp/ams_err | tr '\n' ' ')" \
      "Suele ser falta de permiso: tu usuario
       necesita ser Propietario o Editor del
       proyecto $PROYECTO."
  fi
  ok "creada"

  # Una cuenta recien creada tarda unos segundos en existir para
  # el resto de Google. Sin esta espera, el paso de los permisos
  # falla con "no existe" aunque acabe de crearse.
  paso "Esperando a que se propague..."
  for _ in 1 2 3 4 5 6; do
    gcloud iam service-accounts describe "$SA_EMAIL" \
      --project="$PROYECTO" >/dev/null 2>&1 && break
    sleep 3
  done
fi

# =============================================================
# PASO 5 — LOS PERMISOS
# =============================================================
titulo "PASO 5 de 8 — PERMISOS"

# add-iam-policy-binding es idempotente: repetir un rol que ya
# esta puesto no cambia nada. Y como la politica del proyecto es
# un solo documento, dos cambios a la vez chocan; por eso se
# reintenta en vez de rendirse.
dar_rol() {
  local rol="$1" para="$2" intento=1
  while [ "$intento" -le 4 ]; do
    if gcloud projects add-iam-policy-binding "$PROYECTO" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="$rol" --condition=None --quiet \
        >/dev/null 2>/tmp/ams_err; then
      ok "$rol"
      echo "        ($para)"
      return 0
    fi
    intento=$((intento + 1))
    sleep 4
  done
  morir "No se pudo dar el permiso $rol.
       Google dijo: $(tail -2 /tmp/ams_err | tr '\n' ' ')" \
    "Tu usuario necesita ser Propietario del
       proyecto para repartir permisos. Pideselo
       a quien administre la cuenta, o hazlo a mano
       en console.cloud.google.com/iam."
}

paso "Dando permisos a $SA_ID ..."
dar_rol roles/aiplatform.user          "llamar a Imagen, Veo y Lyria"
dar_rol roles/storage.admin            "leer y escribir en el bucket"
dar_rol roles/cloudbuild.builds.editor "lanzar el montaje del MP4"

# ESTE ES EL QUE MAS SE OLVIDA, y el que produce el error mas
# criptico cuando falta: al lanzar el montaje, Cloud Build
# responde un 403 hablando de "actAs" y de cuentas de servicio,
# que no se parece en nada a "te falta un permiso". Sin el, todo
# funciona hasta el ultimo paso y ahi se cae sin explicacion.
dar_rol roles/iam.serviceAccountUser   "IMPRESCINDIBLE para el montaje"

dar_rol roles/logging.logWriter        "que el montaje deje registro"

# Opcional: solo sirve para que la pantalla de diagnostico de la
# app pueda mirar si las APIs estan encendidas. Si falla, no pasa
# nada: la app lo detecta y lo dice.
if gcloud projects add-iam-policy-binding "$PROYECTO" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="roles/serviceusage.serviceUsageConsumer" \
    --condition=None --quiet >/dev/null 2>&1; then
  ok "roles/serviceusage.serviceUsageConsumer"
  echo "        (opcional: pantalla de diagnostico)"
else
  aviso "no se pudo dar el rol opcional de Service Usage"
  aviso "(la app funciona igual; solo afecta al diagnostico)"
fi

# =============================================================
# PASO 6 — PERMISO PARA QUIEN MONTA EL MP4
#
# El montaje no corre con la cuenta de arriba: lo ejecuta Cloud
# Build con SU propia identidad, y esa tiene que poder bajar los
# clips del bucket y subir la pelicula terminada. Si falta,
# el montaje arranca bien y muere a mitad diciendo "AccessDenied"
# sobre un archivo, que es de lo mas dificil de relacionar con un
# permiso que nadie recuerda haber tenido que dar.
# =============================================================
titulo "PASO 6 de 8 — PERMISO DEL MONTAJE"

# Segun la edad del proyecto, Cloud Build usa una identidad u
# otra. Se le da a las dos: la que no exista simplemente falla y
# se ignora, y asi el instalador vale para proyectos nuevos y
# viejos sin preguntar nada.
MONTADORES="${NUMERO_PROYECTO}@cloudbuild.gserviceaccount.com
${NUMERO_PROYECTO}-compute@developer.gserviceaccount.com"

DADO=0
while IFS= read -r m; do
  if gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
      --member="serviceAccount:$m" \
      --role="roles/storage.objectAdmin" \
      --quiet >/dev/null 2>&1; then
    ok "$m"
    DADO=$((DADO + 1))
  fi
done <<< "$MONTADORES"

if [ "$DADO" = "0" ]; then
  aviso "no se pudo preparar la identidad de Cloud Build."
  aviso "Si el montaje final falla diciendo que no puede"
  aviso "leer o escribir en el bucket, vuelve a lanzar"
  aviso "este instalador: para entonces ya existira."
fi

# =============================================================
# PASO 7 — CORS DEL BUCKET
#
# El navegador lee las imagenes, los videos y el audio del bucket
# con URLs firmadas, y sube material desde la propia pagina. Sin
# CORS el navegador lo bloquea y solo dice "Load failed", sin
# indicar que el problema esta en el bucket.
#
# Esta lista es la misma que aplica api/_lib/gcp.js: el ajuste
# REEMPLAZA la configuracion entera, asi que dos listas distintas
# se pisarian la una a la otra.
# =============================================================
titulo "PASO 7 de 8 — CORS DEL BUCKET"

CORS_FILE="$(mktemp)"
cat > "$CORS_FILE" <<'FIN'
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD", "PUT", "POST", "OPTIONS"],
    "responseHeader": [
      "Content-Type",
      "Content-Length",
      "Content-Range",
      "Content-Disposition",
      "ETag",
      "x-goog-resumable",
      "Authorization"
    ],
    "maxAgeSeconds": 3600
  }
]
FIN

if gcloud storage buckets update "gs://$BUCKET" \
    --cors-file="$CORS_FILE" --quiet >/dev/null 2>/tmp/ams_err; then
  ok "el navegador ya puede leer y subir material"
else
  aviso "no se pudo ajustar el CORS del bucket."
  aviso "Google dijo: $(tail -1 /tmp/ams_err)"
  aviso "La app lo reintenta sola al usarla, asi que"
  aviso "esto no bloquea la instalacion."
fi
rm -f "$CORS_FILE"

# =============================================================
# PASO 8 — LA CLAVE Y LAS VARIABLES
# =============================================================
titulo "PASO 8 de 8 — LA CLAVE"

CLAVES_YA="$(gcloud iam service-accounts keys list \
  --iam-account="$SA_EMAIL" --project="$PROYECTO" \
  --managed-by=user --format='value(name)' 2>/dev/null | wc -l | tr -d ' ')"

CREAR_CLAVE="si"
if [ "${CLAVES_YA:-0}" -gt 0 ] 2>/dev/null; then
  echo ""
  echo "  Esta cuenta ya tiene $CLAVES_YA clave(s) creada(s)."
  echo "  Una clave vieja no se puede volver a ver: si la"
  echo "  que pegaste en Vercel sigue funcionando, no hace"
  echo "  falta crear otra."
  echo ""
  confirmar "  Creo una clave NUEVA?" || CREAR_CLAVE="no"
fi

CLAVE_JSON=""
if [ "$CREAR_CLAVE" = "si" ]; then
  ARCHIVO_CLAVE="$(mktemp)"
  if ! gcloud iam service-accounts keys create "$ARCHIVO_CLAVE" \
        --iam-account="$SA_EMAIL" --project="$PROYECTO" \
        --quiet 2>/tmp/ams_err; then
    rm -f "$ARCHIVO_CLAVE"
    morir "No se pudo crear la clave JSON.
       Google dijo: $(tail -2 /tmp/ams_err | tr '\n' ' ')" \
      "Si dice algo de 'key limit' o 'quota', la
       cuenta ya tiene el maximo de 10 claves.
       Borra las viejas en console.cloud.google.com
       -> IAM -> Cuentas de servicio -> $SA_ID
       -> Claves, y vuelve a lanzar el instalador.
       Si dice 'constraint' o 'policy', tu
       organizacion prohibe crear claves y hay que
       pedir la excepcion al administrador."
  fi
  # Todo en una linea. Se puede quitar los saltos sin miedo: el
  # JSON no lleva saltos de linea dentro de los textos (la clave
  # privada los trae escritos como \n), asi que sigue siendo JSON
  # valido y cabe en un solo pegado en Vercel.
  CLAVE_JSON="$(tr -d '\r\n' < "$ARCHIVO_CLAVE")"
  # El archivo se borra ya: la carpeta de Cloud Shell se conserva
  # entre sesiones y una clave olvidada ahi es una clave filtrada.
  rm -f "$ARCHIVO_CLAVE"
  ok "clave creada"
else
  ok "se conserva la clave que ya tenias"
fi

# APP_KEY: la contrasena de la herramienta. Sin ella, cualquiera que
# encuentre la direccion puede gastar tus creditos generando video.
#
# NO SE GENERA AQUI, A PROPOSITO. Antes este script proponia una de 48
# caracteres en hexadecimal, y eso esta mal por dos motivos: la
# contrasena es del duenno de la herramienta y la elige el, y ademas
# hay que TECLEARLA en el movil cada vez que se entra en la app. Una
# tirada de 48 caracteres al azar es justo lo que no se puede teclear
# en una pantalla pequenna.

# ─── El resumen: lo unico que hay que copiar ───

echo ""
echo ""
echo "$RAYA"
echo "  TODO LISTO EN GOOGLE CLOUD"
echo "$RAYA"
echo ""
echo "  Ahora abre  vercel.com  -> tu proyecto"
echo "  -> Settings -> Environment Variables"
echo "  y crea estas variables:"
echo ""

if [ "$CREAR_CLAVE" = "si" ]; then
  echo "$LINEA"
  echo "  VARIABLE 1 de 3"
  echo "  Nombre:  GCP_SERVICE_ACCOUNT"
  echo "  Valor:   (todo el bloque de abajo,"
  echo "            es UNA sola linea)"
  echo "$LINEA"
  echo ""
  echo "$CLAVE_JSON"
  echo ""
else
  echo "$LINEA"
  echo "  VARIABLE 1 de 3"
  echo "  Nombre:  GCP_SERVICE_ACCOUNT"
  echo "  Valor:   la clave que ya tenias puesta"
  echo "           (no se ha creado ninguna nueva)"
  echo "$LINEA"
  echo ""
fi

echo "$LINEA"
echo "  VARIABLE 2 de 3"
echo "  Nombre:  GCS_OUTPUT_BUCKET"
echo "$LINEA"
echo ""
echo "$BUCKET"
echo ""

echo "$LINEA"
echo "  VARIABLE 3 de 3"
echo "  Nombre:  APP_KEY"
echo "$LINEA"
echo ""
echo "  Esta la eliges TU. Es tu contrasena para"
echo "  entrar en la app, y no la genera nadie mas."
echo ""
echo "  Piensa una que recuerdes y puedas teclear"
echo "  comodamente en el movil: la vas a escribir"
echo "  cada vez que entres."
echo ""
echo "  Escribela en Vercel como valor de APP_KEY."
echo ""

echo "$RAYA"
echo "  DESPUES DE PEGARLAS"
echo "$RAYA"
echo ""
echo "  1. Vercel -> Deployments -> los tres puntos"
echo "     del ultimo -> Redeploy."
echo "     Sin redesplegar, las variables nuevas"
echo "     no llegan a la app."
echo ""
echo "  2. Abre  https://TU-DOMINIO/api/salud"
echo "     Te dice si falta algo y como arreglarlo."
echo ""
echo "$RAYA"
echo "  CUIDADO CON LA CLAVE"
echo "$RAYA"
echo ""
echo "  El bloque de la variable 1 es la LLAVE de tu"
echo "  cuenta de Google Cloud: quien la tenga puede"
echo "  gastar tu credito. No la mandes por chat ni"
echo "  la subas a ningun sitio. Si se te escapa,"
echo "  borrala en console.cloud.google.com -> IAM"
echo "  -> Cuentas de servicio -> $SA_ID -> Claves,"
echo "  y vuelve a lanzar este instalador."
echo ""
echo "  Puedes cerrar Cloud Shell cuando hayas"
echo "  copiado los tres datos."
echo ""

rm -f /tmp/ams_err
exit 0
