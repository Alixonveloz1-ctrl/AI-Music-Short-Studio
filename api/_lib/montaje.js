// ════════════════════════════════════════════════════════════════
// MONTAJE DEL MP4 — con Cloud Build como ejecutor de ffmpeg.
//
// POR QUÉ CLOUD BUILD Y NO CLOUD RUN
//
// El montaje necesita ffmpeg, que no existe en Vercel, y necesita más
// de 60 segundos. La salida habitual es desplegar un contenedor en
// Cloud Run, pero eso obliga al usuario a desplegar algo, y este
// usuario trabaja solo desde un teléfono.
//
// Cloud Build no hay que desplegarlo: se enciende la API y ya está.
// Es un servicio que arranca una máquina temporal y ejecuta los pasos
// que le mandes, cada uno con la imagen de contenedor que le digas.
// Nada obliga a que esos pasos "construyan" nada. Así que la app le
// manda: baja estos archivos del bucket, corre este ffmpeg, sube el
// resultado. Google enciende la máquina, trabaja y la apaga.
//
// La función de Vercel solo manda un JSON y termina en dos segundos.
// Google regala 2.500 minutos al mes y un montaje gasta unos tres.
//
// NUNCA FALLA EN SILENCIO. El paso de ffmpeg lleva `allowFailure`, así
// que aunque reviente, el último paso se ejecuta igual y sube el
// error.txt al bucket. Desde un teléfono no hay forma cómoda de abrir
// los registros de Cloud Build, y "exit code 1" no le dice nada a
// nadie: el motivo real tiene que llegar a la interfaz.
// ════════════════════════════════════════════════════════════════
const { cfg, gcsUpload, gcsReadText } = require('./gcp');
const {
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  OUTPUT_FPS,
  AUDIO_SAMPLE_RATE,
  formato,
} = require('./constantes');

// Fundidos, en segundos. Los mismos que usaba el montaje local.
const FUNDIDO_ENTRADA = 1.2;
// EL CIERRE DE LA PELÍCULA.
//
// Eran 1,6 segundos y se quedaba corto. El usuario lo describió exacto: «la
// música termina de una forma suave, perfecta, pero los personajes siguen
// moviendo los instrumentos como si estuvieran tocando, y ya está en silencio».
// Lyria resuelve la pieza a lo largo de los últimos cinco o seis segundos, y la
// imagen seguía a pleno brillo hasta el penúltimo suspiro.
//
// Ahora el negro entra con la música, no después. Tres segundos y medio: lo
// bastante para que la imagen se apague al mismo ritmo que la última nota.
const FUNDIDO_SALIDA = 3.5;
// Un fundido a negro entre bloques narrativos es más corto que el de apertura:
// separa dos ideas, no abre la película.
const FUNDIDO_BLOQUE = 0.4;

// El encadenado con el que vuelve un plano ya visto.
//
// La mitad del corto se monta con material repetido. Por muy bien elegido que
// esté el plano, un corte seco delata que ya se había visto: el ojo reconoce el
// encuadre exacto. Medio segundo de superposición desdibuja esa costura y el
// material repetido pasa por material nuevo.
//
// Medio segundo y no más: por encima de un segundo deja de leerse como un
// corte y se convierte en un recurso de estilo, que es otra cosa.
const DISOLVENCIA = 0.5;

/**
 * El cruce de un corte normal.
 *
 * POR QUÉ NINGÚN CORTE VA YA A HUESO. El usuario montó el corto y lo primero
 * que notó fue esto: «donde se unen las imágenes, algunos no les puso ningún
 * efecto, se nota el salto, se nota muy brusco». Y tiene razón: dos planos
 * generados por separado no comparten ni el grano ni la luz exacta, así que un
 * corte a hueso entre ellos no se lee como montaje, se lee como un fallo.
 *
 * No es medio segundo, que es lo que tarda un plano en «volver» y hay que
 * disimular. Son dos décimas: lo justo para que el ojo no dé un respingo, sin
 * comerse el ritmo del montaje. Un corte sigue pareciendo un corte.
 */
const CORTE_SUAVE = 0.2;

/** Cuánto se solapan dos trozos según cómo entre el segundo. */
function cruceDe(transicion) {
  if (transicion === 'dissolve') return DISOLVENCIA;
  if (transicion === 'dip_to_black') return 0;   // el negro ya separa los planos
  if (transicion === 'fade_in') return 0;        // es el primero, no hay junta
  return CORTE_SUAVE;
}

// Hasta dónde se puede estirar o encoger un clip para que encaje en su hueco.
//
// Un clip nunca se recorta ni se congela: se RETIMA. Si sobra o falta metraje
// se cambia la velocidad, que conserva el plano entero y solo altera el ritmo.
// Recortar tira el final —justo el fotograma que hace invisible el corte con la
// toma siguiente— y congelar canta muchísimo.
//
// Los topes son de oficio: más allá de la mitad o el doble ya no se lee como
// una toma con otro ritmo, se lee como cámara lenta o como un acelerón. Y no se
// puede bajar de 0.25 sin que el movimiento se vuelva un borrón.
const VELOCIDAD_MAX = 2;    // hasta el doble de lento
const VELOCIDAD_MIN = 0.25; // hasta cuatro veces más rápido

// La música manda y el ambiente acompaña. Con las dos al mismo volumen el
// ambiente se come el instrumento, que es justo lo que el corto viene a enseñar.
const GANANCIA_MUSICA = 0.85;
const GANANCIA_AMBIENTE = 0.28;

/** Imagen que trae ffmpeg. Sobreescribible por si alguna vez desaparece. */
function imagenFfmpeg() {
  return (process.env.FFMPEG_IMAGE || 'alpine:3.20').trim();
}

/** Imagen del SDK de Google, la que sabe hablar con el bucket. */
const IMAGEN_SDK = 'gcr.io/google.com/cloudsdktool/cloud-sdk:slim';

const n3 = (x) => Number(x).toFixed(3);

/**
 * El script de ffmpeg que monta la película.
 *
 * `entradas` es la línea de tiempo ya resuelta: una por corte, en orden, cada
 * una con el archivo local de su clip, cuánto dura en la película y con qué
 * transición entra. Un mismo archivo puede aparecer varias veces — el productor
 * planifica la reutilización — y aquí eso no es un caso especial: se abre el
 * archivo tantas veces como haga falta.
 */
function construirScript(entradas, musicaLocal, ambienteLocal, salidaLocal, formatoId) {
  const total = entradas.reduce((suma, e) => suma + e.durationSec, 0);

  // El lienzo lo decide el formato del proyecto: vertical para redes, apaisado
  // para pantalla grande. Los clips vienen ya en esa proporción, pero el
  // scale+pad los encaja igualmente por si alguno llegara distinto.
  const f = formatoId ? formato(formatoId) : { ancho: OUTPUT_WIDTH, alto: OUTPUT_HEIGHT };
  const ANCHO = f.ancho;
  const ALTO = f.alto;

  const inputs = [];
  const filtros = [];

  // Un plano que vuelve entra ENCADENADO: se superpone medio segundo con lo
  // anterior. Eso significa que su trozo tiene que durar medio segundo MÁS que
  // su hueco, porque esa media se comparte con el corte de al lado. Sin este
  // ajuste, cada encadenado le robaría medio segundo a la película y un corto
  // de tres minutos acabaría durando varios segundos menos de lo planificado.
  // Cuánto se solapa cada trozo con el anterior. El primero nunca se solapa.
  const cruces = entradas.map((entrada, i) => (i === 0 ? 0 : cruceDe(entrada.transitionIn)));
  const largos = entradas.map(
    (entrada, i) => entrada.durationSec + cruces[i],
  );

  // La duración REAL de cada clip solo se sabe en el momento del montaje: Veo
  // no siempre devuelve los segundos que se le pidieron. Así que se mide con
  // ffprobe dentro del propio script y la velocidad se calcula ahí.
  const medidas = [];
  const yaMedido = new Map();
  entradas.forEach((entrada, i) => {
    inputs.push('-i ' + comilla(entrada.local));
    let variable = yaMedido.get(entrada.local);
    if (!variable) {
      variable = 'C' + yaMedido.size;
      yaMedido.set(entrada.local, variable);
      medidas.push(variable + '=$(duracion ' + comilla(entrada.local) + ')');
    }
    // R = lo que tiene que durar / lo que dura de verdad. Mayor que 1 lo
    // ralentiza; menor, lo acelera. Acotado para que no se lea como cámara
    // lenta ni como un acelerón.
    // El programa de awk va en comillas SIMPLES y los valores entran con -v.
    // Escribirlo entre comillas dobles obliga a escapar las del printf, y ese
    // escapado se pierde con solo mirarlo: el shell se comía las comillas y awk
    // recibía un programa roto.
    medidas.push(
      // r = largo del hueco / duración real del clip.
      //
      // Si el clip SOBRA (r < 1) no se toca la velocidad: r se deja en 1 y más
      // abajo el `trim` se queda con los primeros segundos. Recortar es gratis
      // y no se nota; ralentizar un plano al 50 % para meterlo en un hueco de
      // cuatro segundos se ve a la legua. Desde que todos los clips se piden de
      // ocho segundos, este es el caso normal.
      //
      // Si el clip FALTA (r > 1) sí se retima: no hay fotogramas que recortar,
      // y estirar el movimiento es mejor que congelar el último fotograma.
      'R' + i + '=$(awk -v L=' + n3(largos[i]) + ' -v C="$' + variable + '" ' +
        "'BEGIN{if(C<=0)C=L; r=L/C;" +
        ' if(r<1)r=1;' +
        ' if(r>' + VELOCIDAD_MAX + ')r=' + VELOCIDAD_MAX + ';' +
        ' printf "%.6f", r}\')',
    );
  });

  entradas.forEach((entrada, i) => {
    const primera = i === 0;
    const ultima = i === entradas.length - 1;
    const siguiente = entradas[i + 1];
    const largo = largos[i];

    const cadena = [
      // Encajar sin deformar: se reduce hasta caber y se rellena con negro. Un
      // scale a pelo estiraría la imagen si el clip viniera con otra relación.
      'scale=' + ANCHO + ':' + ALTO + ':force_original_aspect_ratio=decrease',
      'pad=' + ANCHO + ':' + ALTO + ':(ow-iw)/2:(oh-ih)/2',
      'setsar=1',
      // Estira el plano si le faltaban segundos. Cuando le sobran, R vale 1 y
      // esto no hace nada: del sobrante se encarga el `trim` de abajo.
      'setpts=PTS*${R' + i + '}',
      'fps=' + OUTPUT_FPS,
      // Red de seguridad, no el plan: si el clip fuera tan corto que ni al
      // doble de lento llega, se sostiene el último fotograma lo que falte.
      // Con todos los clips pedidos a ocho segundos y huecos de ocho como
      // mucho, esto no debería entrar nunca.
      'tpad=stop_mode=clone:stop_duration=' + n3(largo),
      // Y la duración queda clavada, venga el clip como venga. Es también
      // donde se descarta lo que sobra de un clip de ocho segundos metido en
      // un hueco más corto.
      'trim=duration=' + n3(largo),
      'setpts=PTS-STARTPTS',
      // Todos los trozos con la MISMA base de tiempo. `concat` cambia la del
      // resultado, y `xfade` se niega a mezclar dos entradas con bases
      // distintas: sin esto, la primera vez que un encadenado viene detrás de
      // un corte, ffmpeg muere con "timebase do not match".
      'settb=AVTB',
    ];

    if (primera) {
      cadena.push('fade=t=in:st=0:d=' + FUNDIDO_ENTRADA);
    } else if (entrada.transitionIn === 'dip_to_black') {
      cadena.push('fade=t=in:st=0:d=' + FUNDIDO_BLOQUE);
    }

    if (ultima) {
      cadena.push('fade=t=out:st=' + n3(Math.max(0, largo - FUNDIDO_SALIDA)) + ':d=' + FUNDIDO_SALIDA);
    } else if (siguiente && siguiente.transitionIn === 'dip_to_black') {
      cadena.push('fade=t=out:st=' + n3(Math.max(0, largo - FUNDIDO_BLOQUE)) + ':d=' + FUNDIDO_BLOQUE);
    }

    filtros.push('[' + i + ':v]' + cadena.join(',') + '[v' + i + ']');
  });

  // Se van pegando de dos en dos, no todos de golpe con `concat`: un
  // encadenado necesita que los dos trozos se SOLAPEN, y concat solo sabe
  // ponerlos uno detrás de otro. Encadenando por parejas se puede mezclar
  // corte y encadenado en la misma película.
  let acumulado = '[v0]';
  let largoAcumulado = entradas[0].durationSec;

  for (let i = 1; i < entradas.length; i += 1) {
    const salida = '[x' + i + ']';
    const cruce = cruces[i];
    if (cruce > 0) {
      // El desplazamiento se mide sobre la película montada hasta aquí: el
      // trozo nuevo empieza justo ese cruce ANTES de que termine la anterior.
      const desplazamiento = Math.max(0, largoAcumulado - cruce);
      filtros.push(
        acumulado + '[v' + i + ']xfade=transition=fade:duration=' + n3(cruce) +
          ':offset=' + n3(desplazamiento) + ',settb=AVTB' + salida,
      );
    } else {
      // Sólo el paso a negro va pegado: ahí la separación la hace el negro.
      filtros.push(acumulado + '[v' + i + ']concat=n=2:v=1:a=0,settb=AVTB' + salida);
    }
    // En los dos casos la película crece exactamente lo que dura el hueco: en
    // el encadenado, porque el trozo trae ya el medio segundo de más que se
    // solapa.
    largoAcumulado += entradas[i].durationSec;
    acumulado = salida;
  }

  filtros.push(acumulado + 'null[vout]');

  const iMusica = entradas.length;
  const iAmbiente = entradas.length + 1;
  inputs.push('-i ' + comilla(musicaLocal));
  inputs.push('-i ' + comilla(ambienteLocal));

  // apad antes de atrim: si la pista es más corta que la película se alarga con
  // silencio en vez de cortar el vídeo. amix con `duration=first` terminaría la
  // mezcla al acabarse la primera entrada, y sin el apad eso deja el final mudo.
  filtros.push(
    '[' + iMusica + ':a]apad,atrim=0:' + n3(total) +
      ',asetpts=PTS-STARTPTS,volume=' + GANANCIA_MUSICA + '[amus]',
  );
  filtros.push(
    '[' + iAmbiente + ':a]apad,atrim=0:' + n3(total) +
      ',asetpts=PTS-STARTPTS,volume=' + GANANCIA_AMBIENTE + '[aamb]',
  );
  // normalize=0 es obligatorio: por defecto amix divide cada entrada entre el
  // número de entradas, así que mezclar dos pistas bajaría la música a la mitad
  // sin que nada lo indique. El alimiter final evita que la suma sature.
  filtros.push(
    '[amus][aamb]amix=inputs=2:duration=first:normalize=0,' +
      'afade=t=in:st=0:d=' + FUNDIDO_ENTRADA + ',' +
      'afade=t=out:st=' + n3(Math.max(0, total - FUNDIDO_SALIDA)) + ':d=' + FUNDIDO_SALIDA + ',' +
      'alimiter=limit=0.95[aout]',
  );

  const orden = [
    'ffmpeg -y -hide_banner -loglevel error',
    inputs.join(' '),
    // Comillas DOBLES, no simples: el filtro lleva dentro las variables ${R0},
    // ${R1}... con la velocidad que se acaba de medir, y entre comillas simples
    // el shell no las sustituiría. No hay ninguna comilla doble ni ninguna
    // barra invertida dentro del filtro, así que es seguro.
    '-filter_complex "' + filtros.join(';') + '"',
    '-map "[vout]" -map "[aout]"',
    '-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -r ' + OUTPUT_FPS,
    '-c:a aac -b:a 192k -ar ' + AUDIO_SAMPLE_RATE,
    '-movflags +faststart',
    comilla(salidaLocal),
  ].join(' \\\n  ');

  return [
    '#!/bin/sh',
    '# Cualquier queja de ffmpeg se guarda para que la lea la aplicacion: desde',
    '# un telefono no hay forma comoda de abrir el registro de Cloud Build.',
    '#',
    '# La redireccion va ANTES de set -e, y no hay ningun `cd`: el script corre',
    '# donde esten los archivos (en Cloud Build, /workspace). Con un `cd` fijo',
    '# delante, un fallo al entrar en el directorio mataba el script sin llegar',
    '# a crear error.txt — justo el caso en el que mas falta hace.',
    'exec 2>error.txt',
    'set -eu',
    '',
    '# Cuanto dura DE VERDAD cada clip. Veo no siempre devuelve los segundos',
    '# que se le pidieron, y un plano reutilizado ocupa a veces un hueco mas',
    '# largo que aquel para el que se genero. De aqui sale la velocidad a la',
    '# que hay que reproducir cada uno para que encaje.',
    'duracion() {',
    '  ffprobe -v error -show_entries format=duration \\',
    '    -of default=noprint_wrappers=1:nokey=1 "$1"',
    '}',
    '',
    medidas.join('\n'),
    '',
    orden,
    '',
    'echo listo',
    '',
  ].join('\n');
}

/** Entrecomillado para /bin/sh: la única forma de escapar dentro de '' es '\''. */
function comilla(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

/**
 * Prepara el encargo y lanza el trabajo en Cloud Build.
 *
 * Devuelve el identificador del build, que es con lo que se pregunta después.
 * No espera a que termine: la función de Vercel tiene 60 segundos y el montaje
 * tarda minutos.
 */
async function lanzarMontaje(opciones) {
  const { token, projectId, bucket, carpeta, entradas, musica, ambiente, salida, formatoId } = opciones;

  if (!entradas || !entradas.length) {
    throw new Error('No hay ninguna toma aprobada que montar.');
  }

  // Un mismo clip puede salir varias veces en la película. Se baja UNA vez y se
  // referencia tantas como haga falta: bajar veinte veces el mismo archivo
  // costaría más que el propio montaje.
  const porObjeto = new Map();
  const descargas = [];
  const entradasLocales = entradas.map((e) => {
    let local = porObjeto.get(e.objeto);
    if (!local) {
      local = 'clip_' + String(porObjeto.size).padStart(3, '0') + extension(e.objeto, '.mp4');
      porObjeto.set(e.objeto, local);
      descargas.push({ objeto: e.objeto, local });
    }
    return { local, durationSec: e.durationSec, transitionIn: e.transitionIn };
  });

  const musicaLocal = 'musica' + extension(musica, '.wav');
  const ambienteLocal = 'ambiente' + extension(ambiente, '.wav');
  descargas.push({ objeto: musica, local: musicaLocal });
  descargas.push({ objeto: ambiente, local: ambienteLocal });

  const salidaLocal = 'pelicula.mp4';
  const script = construirScript(entradasLocales, musicaLocal, ambienteLocal, salidaLocal, formatoId);

  // El encargo queda escrito en el bucket: el script que se ejecutó y la hoja
  // con lo que se pidió. Si algo sale raro, se puede mirar exactamente qué se
  // mandó en vez de reconstruirlo de memoria.
  const manifiesto = {
    creado: new Date().toISOString(),
    salida,
    total: entradasLocales.reduce((s, e) => s + e.durationSec, 0),
    entradas: entradasLocales,
    descargas,
  };
  await gcsUpload(token, bucket, carpeta + '/montar.sh', Buffer.from(script), 'text/x-shellscript');
  await gcsUpload(
    token, bucket, carpeta + '/hoja.json',
    Buffer.from(JSON.stringify(manifiesto, null, 2)), 'application/json',
  );
  // Se vacía la queja anterior, para que un fallo sin nota no herede la del
  // intento pasado y mande a buscar un problema que ya no existe.
  await gcsUpload(token, bucket, carpeta + '/error.txt', Buffer.from(''), 'text/plain');

  const gs = (o) => 'gs://' + bucket + '/' + o;

  const bajar = [
    'set -e',
    'cd /workspace',
    'gcloud storage cp ' + comilla(gs(carpeta + '/montar.sh')) + ' montar.sh',
  ]
    .concat(
      // En paralelo: son decenas de archivos y de uno en uno se va el tiempo en
      // ida y vuelta, no en transferencia.
      descargas.map(
        (d) => 'gcloud storage cp ' + comilla(gs(d.objeto)) + ' ' + comilla(d.local) + ' &',
      ),
    )
    .concat(['wait', 'ls -la'])
    .join('\n');

  const subir = [
    'cd /workspace',
    // El error se sube SIEMPRE, haya MP4 o no. Es lo único que la aplicación
    // puede enseñar cuando el montaje falla.
    'if [ -s error.txt ]; then gcloud storage cp error.txt ' + comilla(gs(carpeta + '/error.txt')) + '; fi',
    'if [ ! -f pelicula.mp4 ]; then',
    '  echo "El montaje terminó sin producir el MP4." >&2',
    '  exit 1',
    'fi',
    'gcloud storage cp pelicula.mp4 ' + comilla(gs(salida)),
    'echo "subido a ' + gs(salida) + '"',
  ].join('\n');

  const build = {
    steps: [
      { name: IMAGEN_SDK, id: 'bajar', entrypoint: 'bash', args: ['-c', bajar] },
      {
        name: imagenFfmpeg(),
        id: 'montar',
        entrypoint: 'sh',
        args: ['-c', 'apk add --no-cache ffmpeg >/dev/null 2>&1 && sh montar.sh'],
        // Si ffmpeg falla, el build sigue para que el paso de subida deje el
        // error.txt en el bucket. Sin esto el build muere aquí y el motivo real
        // se queda dentro de una máquina que ya no existe.
        allowFailure: true,
      },
      { name: IMAGEN_SDK, id: 'subir', entrypoint: 'bash', args: ['-c', subir] },
    ],
    timeout: '1800s',
    options: {
      machineType: 'E2_HIGHCPU_8',
      // Sin esto, un build lanzado por una cuenta de servicio propia se rechaza
      // antes de empezar porque no tiene dónde escribir el registro.
      logging: 'CLOUD_LOGGING_ONLY',
    },
    tags: ['ams-montaje'],
  };

  const r = await fetch('https://cloudbuild.googleapis.com/v1/projects/' + projectId + '/builds', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(build),
  });
  const texto = await r.text();

  if (!r.ok) {
    throw new Error('No se pudo lanzar el montaje: ' + explicar(r.status, texto));
  }

  let d = {};
  try { d = JSON.parse(texto); } catch (e) { /* respuesta no-JSON */ }
  const buildId = (d.metadata && d.metadata.build && d.metadata.build.id) || '';
  if (!buildId) throw new Error('Cloud Build aceptó el trabajo pero no devolvió su identificador.');
  return { buildId, carpeta, salida };
}

/**
 * Traduce los rechazos de Cloud Build a algo accionable.
 *
 * Los mensajes de Google aquí nombran permisos internos que no significan nada
 * para quien solo quiere montar un vídeo, y el que más se olvida
 * (`iam.serviceAccountUser`) produce un texto especialmente críptico.
 */
function explicar(status, texto) {
  const t = String(texto);
  if (status === 403 && /serviceAccounts?\.actAs|act as|serviceAccountUser/i.test(t)) {
    return 'a la cuenta de servicio le falta el rol "Usuario de cuenta de servicio" ' +
      '(roles/iam.serviceAccountUser). Se añade en IAM, en la misma pantalla que los demás.';
  }
  if (status === 403 && /cloudbuild\.builds\.create|permission/i.test(t)) {
    return 'a la cuenta de servicio le falta el rol "Editor de Cloud Build" ' +
      '(roles/cloudbuild.builds.editor).';
  }
  if (status === 403 && /has not been used|disabled|SERVICE_DISABLED/i.test(t)) {
    return 'la API de Cloud Build no está habilitada en este proyecto ' +
      '(cloudbuild.googleapis.com).';
  }
  if (status === 404) return 'no se encuentra el proyecto de Google Cloud.';
  return status + ' — ' + t.slice(0, 300);
}

/** Estado de un montaje ya lanzado. */
async function estadoMontaje(token, projectId, buildId, bucket, carpeta) {
  const r = await fetch(
    'https://cloudbuild.googleapis.com/v1/projects/' + projectId + '/builds/' + encodeURIComponent(buildId),
    { headers: { Authorization: 'Bearer ' + token } },
  );
  if (!r.ok) {
    return { estado: 'desconocido', error: 'No se pudo consultar el montaje: ' + r.status };
  }
  const d = await r.json();

  // QUEUED y WORKING son "sigue en marcha"; el resto son finales.
  const enMarcha = d.status === 'QUEUED' || d.status === 'WORKING' || d.status === 'PENDING';
  if (enMarcha) {
    return { estado: 'montando', fase: d.status === 'QUEUED' ? 'en cola' : 'montando' };
  }

  if (d.status === 'SUCCESS') return { estado: 'listo' };

  // Cloud Build solo sabe decir FAILURE. El motivo real lo escribió el propio
  // script en error.txt, que es lo único legible desde un teléfono.
  let motivo = '';
  if (bucket && carpeta) {
    const nota = await gcsReadText(token, bucket, carpeta + '/error.txt');
    if (nota && nota.texto && nota.texto.trim()) motivo = nota.texto.trim().slice(-700);
  }
  const porEstado = {
    TIMEOUT: 'el montaje tardó más de 30 minutos y se canceló.',
    CANCELLED: 'el montaje se canceló.',
    EXPIRED: 'el montaje caducó en la cola.',
    INTERNAL_ERROR: 'Cloud Build tuvo un error interno.',
  };
  return {
    estado: 'fallo',
    error: motivo || porEstado[d.status] || 'el montaje falló (' + d.status + ').',
  };
}

function extension(ruta, porDefecto) {
  const m = /(\.[a-z0-9]{2,4})$/i.exec(String(ruta || ''));
  return m ? m[1].toLowerCase() : porDefecto;
}

module.exports = {
  construirScript,
  lanzarMontaje,
  estadoMontaje,
  FUNDIDO_ENTRADA,
  FUNDIDO_SALIDA,
  GANANCIA_MUSICA,
  GANANCIA_AMBIENTE,
};
