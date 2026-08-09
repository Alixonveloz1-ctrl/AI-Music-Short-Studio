#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
#  INSTALADOR DEL MONTADOR — AI Music Short Studio
#
#  Se ejecuta en Cloud Shell, con estas dos líneas y nada más:
#
#      git clone https://github.com/Alixonveloz1-ctrl/AI-Music-Short-Studio.git
#      bash AI-Music-Short-Studio/montaje/instalar.sh
#
#  POR QUÉ ASÍ Y NO PEGANDO UN SCRIPT: el terminal de Cloud Shell no deja pegar
#  desde el móvil, y teclear un script largo a mano no es viable. Esas dos
#  líneas son cortas y el repositorio es público, así que el instalador se trae
#  con git y a partir de ahí hace TODO lo demás solo.
#
#  AQUÍ NO HAY ESCRITO NINGÚN DATO DE NINGUNA CUENTA: ni proyecto, ni bucket, ni
#  cuenta de servicio. El proyecto se lee del que esté activo y el bucket se
#  detecta o se pregunta. Por eso el script no puede apuntar a la cuenta
#  equivocada: no hay ninguna cuenta a la que apuntar.
#
#  ES IDEMPOTENTE: volver a ejecutarlo actualiza el servicio y CONSERVA la clave
#  que ya estaba puesta, así que lo que hay en Vercel sigue siendo válido y no
#  hay que tocar nada.
# ══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# La carpeta de este mismo archivo es la que se despliega (aquí están el
# Dockerfile y el index.js). Se resuelve así y no con "." porque el usuario
# lanza el script desde su directorio personal, no desde dentro de la carpeta.
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SERVICIO="${SERVICIO:-ams-montaje}"
REGION="${REGION:-us-central1}"

linea() { printf '%s\n' "──────────────────────────────────────────────────────"; }
aviso() { printf '\n>>> %s\n' "$*"; }
morir() { printf '\n*** %s\n\n' "$*" >&2; exit 1; }

command -v gcloud >/dev/null 2>&1 || morir "Esto hay que ejecutarlo dentro de Cloud Shell (el botón >_ de console.cloud.google.com)."
[ -f "$AQUI/Dockerfile" ] || morir "No encuentro $AQUI/Dockerfile. ¿Se clonó el repositorio entero?"
[ -f "$AQUI/index.js" ]   || morir "No encuentro $AQUI/index.js. ¿Se clonó el repositorio entero?"

# ── 1. El proyecto ────────────────────────────────────────────────────────────
# Se avisa de cuál es ANTES de tocar nada: desplegar en el proyecto equivocado
# es el error caro de todo esto.
PROY="$(gcloud config get-value project 2>/dev/null || true)"
if [ -z "$PROY" ] || [ "$PROY" = "(unset)" ]; then
  morir "No hay ningún proyecto de Google Cloud activo. Ejecuta:  gcloud config set project EL-NOMBRE-DE-TU-PROYECTO"
fi

echo ""
linea
echo "  PROYECTO DE GOOGLE CLOUD:  $PROY"
echo "  REGIÓN:                    $REGION"
echo "  SERVICIO:                  $SERVICIO"
linea
printf '  ¿Es ese el proyecto correcto? Pulsa Enter para seguir (Ctrl+C para salir): '
read -r _ || true
echo ""

NUM="$(gcloud projects describe "$PROY" --format='value(projectNumber)')"
SA_COMPUTE="${NUM}-compute@developer.gserviceaccount.com"

# ── 2. Las APIs ───────────────────────────────────────────────────────────────
aviso "Activando los servicios de Google que hacen falta (tarda un minuto)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  --project "$PROY" --quiet

# En los proyectos creados de un tiempo a esta parte, Cloud Build construye con
# la cuenta de Compute Engine, y si no tiene el rol de constructor el primer
# despliegue falla con un error sobre registros que no explica nada. Se concede
# en silencio y sin drama: si ya lo tiene, no pasa nada.
gcloud projects add-iam-policy-binding "$PROY" \
  --member="serviceAccount:$SA_COMPUTE" \
  --role="roles/cloudbuild.builds.builder" \
  --quiet >/dev/null 2>&1 || true

# ── 3. Lo que ya estuviera desplegado ─────────────────────────────────────────
# Si el servicio ya existe se reutilizan su bucket y su clave. Eso es lo que
# hace que volver a ejecutar el instalador no rompa el Vercel que ya funciona:
# generar una clave nueva dejaría la aplicación dando "clave incorrecta" hasta
# que alguien se diera cuenta.
leer_variable() {
  # $1 = nombre de la variable de entorno del servicio ya desplegado
  command -v python3 >/dev/null 2>&1 || return 0
  gcloud run services describe "$SERVICIO" --project "$PROY" --region "$REGION" --format=json 2>/dev/null \
    | QUIERO="$1" python3 -c '
import json, os, sys
try:
    d = json.load(sys.stdin)
    for c in d["spec"]["template"]["spec"]["containers"]:
        for e in c.get("env", []):
            if e.get("name") == os.environ["QUIERO"]:
                print(e.get("value", ""))
                sys.exit(0)
except Exception:
    pass
' 2>/dev/null || true
}

CLAVE_VIEJA="$(leer_variable MONTAJE_KEY)"
BUCKET_VIEJO="$(leer_variable BUCKET)"

# ── 4. El bucket ──────────────────────────────────────────────────────────────
BUCKET="${BUCKET:-}"
if [ -z "$BUCKET" ] && [ -n "$BUCKET_VIEJO" ]; then
  BUCKET="$BUCKET_VIEJO"
  aviso "Reutilizando el bucket del despliegue anterior: $BUCKET"
fi

if [ -z "$BUCKET" ]; then
  # Se descartan los buckets que crean solos Cloud Build y Cloud Run. Sin este
  # filtro, la SEGUNDA vez que se ejecuta el instalador ya hay dos buckets y la
  # detección automática deja de funcionar justo cuando debería ser más fácil.
  LISTA="$(gcloud storage ls --project "$PROY" 2>/dev/null \
    | sed -e 's#^gs://##' -e 's#/$##' \
    | grep -v -e '^$' -e '_cloudbuild$' -e '^gcf-' -e '^run-sources-' -e '^gcf-v2-' -e '^cloud-ai-platform-' \
    || true)"
  CUANTOS="$(printf '%s\n' "$LISTA" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [ "$CUANTOS" = "0" ]; then
    morir "No hay ningún bucket en este proyecto. Crea uno con:
    gcloud storage buckets create gs://EL-NOMBRE-QUE-QUIERAS --location=$REGION
y vuelve a ejecutar este instalador."
  elif [ "$CUANTOS" = "1" ]; then
    BUCKET="$(printf '%s\n' "$LISTA" | sed '/^$/d')"
    aviso "Solo hay un bucket en el proyecto, así que se usa ese: $BUCKET"
  else
    echo ""
    echo "  Hay varios buckets en este proyecto:"
    i=0
    while IFS= read -r b; do
      [ -z "$b" ] && continue
      i=$((i + 1))
      echo "    $i) $b"
    done <<< "$LISTA"
    echo ""
    printf '  Escribe el NÚMERO del bucket del estudio y pulsa Enter: '
    read -r RESP
    if printf '%s' "$RESP" | grep -q '^[0-9][0-9]*$'; then
      BUCKET="$(printf '%s\n' "$LISTA" | sed '/^$/d' | sed -n "${RESP}p")"
    else
      # También se acepta el nombre escrito, pero solo si está en la lista: así
      # una errata no crea un despliegue que apunta a un bucket inexistente.
      BUCKET="$(printf '%s\n' "$LISTA" | sed '/^$/d' | grep -x -- "$RESP" || true)"
    fi
    [ -n "$BUCKET" ] || morir "No entendí cuál es el bucket. Vuelve a ejecutar el instalador."
  fi
fi

# ── 5. La clave ───────────────────────────────────────────────────────────────
# La genera el instalador: el usuario no tiene que inventarla ni teclearla.
if [ -n "$CLAVE_VIEJA" ]; then
  CLAVE="$CLAVE_VIEJA"
  CLAVE_ES_NUEVA="no"
else
  CLAVE="$(openssl rand -hex 24)"
  CLAVE_ES_NUEVA="sí"
fi

echo ""
linea
echo "  Bucket:  $BUCKET"
echo "  Clave:   $([ "$CLAVE_ES_NUEVA" = "sí" ] && echo 'nueva (habrá que ponerla en Vercel)' || echo 'la misma de antes (Vercel no se toca)')"
linea

# ── 6. El despliegue ──────────────────────────────────────────────────────────
#
# --no-cpu-throttling NO ES OPCIONAL. El servicio contesta la petición al
# instante con el identificador del trabajo y sigue montando en segundo plano.
# Sin esta opción, Google le retira el procesador a la instancia en cuanto
# responde, y el render se queda congelado a mitad sin dar ningún error: el
# estado en el bucket se quedaría para siempre en "montando".
#
# El servicio se despliega SIN autenticación de Google y se protege con la clave
# de la cabecera x-montaje-key. Es lo mismo que hace el otro servicio del
# usuario, y es lo que permite llamarlo desde Vercel sin firmar cada petición.
aviso "Construyendo y desplegando el montador (5-8 minutos, no cierres la ventana)..."
gcloud run deploy "$SERVICIO" \
  --source "$AQUI" \
  --project "$PROY" \
  --region "$REGION" \
  --no-allow-unauthenticated \
  --memory 4Gi \
  --cpu 4 \
  --timeout 900 \
  --no-cpu-throttling \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "BUCKET=$BUCKET,MONTAJE_KEY=$CLAVE" \
  --quiet

URL="$(gcloud run services describe "$SERVICIO" --project "$PROY" --region "$REGION" --format='value(status.url)')"
[ -n "$URL" ] || morir "El servicio se desplegó pero Google no devolvió su dirección. Mira Cloud Run en la consola."

# ── 7. Permisos ───────────────────────────────────────────────────────────────

# 7a. El montador lee los clips y escribe la película en el bucket.
SA_RUN="$(gcloud run services describe "$SERVICIO" --project "$PROY" --region "$REGION" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
[ -n "$SA_RUN" ] || SA_RUN="$SA_COMPUTE"
aviso "Dando permiso al montador para usar el bucket ($SA_RUN)..."
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_RUN" \
  --role="roles/storage.objectAdmin" \
  --quiet >/dev/null

# 7b. Permiso para invocarlo.
#
# Primero se intenta abrirlo a cualquiera (protegido por la clave). En cuentas
# de empresa hay a menudo una política que prohíbe eso; si falla, no se deja al
# usuario a medias: se le da el permiso de invocación a las cuentas de servicio
# propias del proyecto, que es donde está la que usa la aplicación en Vercel.
PUBLICO="sí"
gcloud run services add-iam-policy-binding "$SERVICIO" \
  --project "$PROY" --region "$REGION" \
  --member="allUsers" --role="roles/run.invoker" \
  --quiet >/dev/null 2>&1 || PUBLICO="no"

CUENTAS="$(gcloud iam service-accounts list --project "$PROY" --format='value(email)' 2>/dev/null \
  | grep -v -e '-compute@developer\.gserviceaccount\.com$' -e '@cloudbuild\.gserviceaccount\.com$' -e '^$' \
  || true)"
if [ -n "$CUENTAS" ]; then
  aviso "Dando permiso de invocación a las cuentas de servicio del proyecto..."
  while IFS= read -r cuenta; do
    [ -z "$cuenta" ] && continue
    echo "    - $cuenta"
    gcloud run services add-iam-policy-binding "$SERVICIO" \
      --project "$PROY" --region "$REGION" \
      --member="serviceAccount:$cuenta" --role="roles/run.invoker" \
      --quiet >/dev/null 2>&1 || true
  done <<< "$CUENTAS"
fi

# ── 8. Comprobación ───────────────────────────────────────────────────────────
# Se pregunta al servicio recién desplegado quién es. Si contesta, está vivo de
# verdad y no solo "desplegado", que no es lo mismo.
aviso "Comprobando que el montador responde..."
SALUDO="$(curl -s --max-time 30 "$URL/" 2>/dev/null || true)"
if ! printf '%s' "$SALUDO" | grep -q 'ams-montaje'; then
  SALUDO="$(curl -s --max-time 30 -H "Authorization: Bearer $(gcloud auth print-identity-token 2>/dev/null)" "$URL/" 2>/dev/null || true)"
fi
if printf '%s' "$SALUDO" | grep -q 'ams-montaje'; then
  echo "    Responde: $SALUDO"
else
  echo "    No contestó al saludo. El servicio puede tardar unos segundos en arrancar la primera vez;"
  echo "    si la aplicación tampoco lo alcanza, mira Cloud Run -> $SERVICIO -> Registros."
fi

# ── 9. Lo único que el usuario tiene que hacer a mano ─────────────────────────
echo ""
echo ""
echo "██████████████████████████████████████████████████████████████"
echo "█                                                            █"
echo "█   LISTO. AHORA COPIA ESTO EN VERCEL                        █"
echo "█   (tu proyecto -> Settings -> Environment Variables)       █"
echo "█                                                            █"
echo "██████████████████████████████████████████████████████████████"
echo ""
echo "   ┌─ Variable 1 ──────────────────────────────────────────"
echo "   │  Nombre:  MONTAJE_URL"
echo "   │  Valor:   $URL"
echo "   └───────────────────────────────────────────────────────"
echo ""
echo "   ┌─ Variable 2 ──────────────────────────────────────────"
echo "   │  Nombre:  MONTAJE_KEY"
echo "   │  Valor:   $CLAVE"
echo "   └───────────────────────────────────────────────────────"
echo ""
if [ "$REGION" != "us-central1" ]; then
echo "   ┌─ Variable 3 (solo porque cambiaste la región) ────────"
echo "   │  Nombre:  MONTAJE_REGION"
echo "   │  Valor:   $REGION"
echo "   └───────────────────────────────────────────────────────"
echo ""
fi
echo "   Y comprueba que ya tienes puesta esta, que es la del bucket:"
echo ""
echo "   ┌───────────────────────────────────────────────────────"
echo "   │  Nombre:  GCS_OUTPUT_BUCKET"
echo "   │  Valor:   $BUCKET"
echo "   └───────────────────────────────────────────────────────"
echo ""
if [ "$CLAVE_ES_NUEVA" = "no" ]; then
echo "   NOTA: la clave es la MISMA que ya tenías. Si Vercel ya la"
echo "   tenía puesta, no hace falta cambiar nada."
echo ""
fi
if [ "$PUBLICO" = "no" ]; then
echo "   AVISO: este proyecto no permite servicios públicos, así que"
echo "   el montador solo acepta llamadas de las cuentas de servicio"
echo "   del proyecto. Si la aplicación dice que no lo alcanza, es"
echo "   por esto."
echo ""
fi
echo "   Último paso en Vercel: Deployments -> los tres puntos del"
echo "   último -> Redeploy. Sin eso no coge las variables nuevas."
echo ""
linea
echo ""
