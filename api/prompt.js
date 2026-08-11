// ════════════════════════════════════════════════════════════════
// PROMPT — reescribir a mano el encargo de un elemento.
//
//   POST { id, activo, prompt?, negativePrompt?, restaurar? }
//     -> { proyecto, estado, campo }
//
// POR QUÉ EXISTE. Cuando Google rechaza una generación, el error dice «los
// filtros de contenido bloquearon esta imagen. Cambia la descripción de la toma
// y vuelve a generar». Y el usuario contestó lo evidente: «¿para qué sale ese
// mensaje si no puedo editarlo?». Tenía razón — el prompt se escribía al crear
// el corto y a partir de ahí era de sólo lectura, así que el único remedio que
// ofrecía la herramienta para un prompt bloqueado era empezar el corto de cero.
//
// Un filtro de contenido no se pelea, se rodea: se cambia la palabra que lo
// dispara y se vuelve a pedir. Para eso hace falta poder tocar el texto.
//
// TRES LÍMITES:
//
//   SE EDITA LO QUE SE ENVÍA, NO LO QUE SE ENSEÑA. La música tiene dos
//   encargos: el español, que es el que ve el usuario, y el inglés, que es el
//   único idioma que entiende Lyria. Dejar editar el español sería dejarle
//   corregir un texto que no llega a ninguna parte.
//
//   EL ORIGINAL NO SE PIERDE NUNCA. La primera edición guarda el texto del
//   Director aparte, así que «volver al original» funciona siempre, por muchas
//   veces que se haya editado encima.
//
//   NADA SE DESAPRUEBA. Lo aprobado sigue siendo lo oficial. Si el encargo
//   cambió por debajo, se marca como desactualizado y el usuario decide.
// ════════════════════════════════════════════════════════════════
const { empezar, cuerpo, requerido, fallo, ErrorPeticion } = require('./_lib/http.js');
const { modificarProyecto } = require('./_lib/almacen.js');
const { makeEventAndPush, getAsset } = require('./_lib/dominio.js');
const { computeProductionStatus } = require('./_lib/progreso.js');
const { cfg } = require('./_lib/gcp.js');
const { paraEnviar } = require('./_lib/respuesta.js');

/** Un prompt largo no cabe en un modelo, y uno vacío no encarga nada. */
const MAX_PROMPT = 12000;

/**
 * QUÉ CAMPO SE EDITA EN CADA TIPO DE ELEMENTO.
 *
 * El audio se pide en inglés y las imágenes y los vídeos en español, que es
 * como está escrito el resto del producto. Lo que se edita es siempre el que
 * viaja a Google, porque editar el otro no cambiaría nada de lo que se genera.
 */
const CAMPO_EN_INGLES = ['music', 'ambient'];

function campoDePrompt(activo) {
  return CAMPO_EN_INGLES.indexOf(activo.kind) !== -1 ? 'promptEn' : 'prompt';
}

/** Cómo se llama el campo donde se guarda el original de otro campo. */
function campoOriginal(campo) {
  return campo + 'Original';
}

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['POST'])) return;

  try {
    const datos = await cuerpo(req);
    const id = String(requerido(datos, 'id')).trim();
    const activoId = String(requerido(datos, 'activo')).trim();
    const restaurar = datos.restaurar === true;

    let campo = 'prompt';

    const { proyecto } = await modificarProyecto(id, (p) => {
      // `getAsset` ya lanza un 404 con su propio mensaje si no existe.
      const activo = getAsset(p, activoId);
      const spec = activo.spec || (activo.spec = {});
      campo = campoDePrompt(activo);

      if (restaurar) {
        const original = spec[campoOriginal(campo)];
        if (original === undefined && spec.negativePromptOriginal === undefined) {
          throw new ErrorPeticion(409, 'Este elemento no se ha editado a mano: no hay original al que volver.');
        }
        if (original !== undefined) {
          spec[campo] = original;
          delete spec[campoOriginal(campo)];
        }
        if (spec.negativePromptOriginal !== undefined) {
          spec.negativePrompt = spec.negativePromptOriginal;
          delete spec.negativePromptOriginal;
        }
        delete spec.promptEditado;
        makeEventAndPush(p, 'prompt_restored', `Prompt de «${activo.label}» devuelto al original del Director.`);
        marcarDesactualizado(p, activo);
        return;
      }

      let algoCambió = false;

      if (datos.prompt !== undefined) {
        const texto = String(datos.prompt).trim();
        if (!texto) throw new ErrorPeticion(400, 'El prompt no puede quedarse vacío: sin él no hay nada que encargar.');
        if (texto.length > MAX_PROMPT) {
          throw new ErrorPeticion(400, `El prompt no puede pasar de ${MAX_PROMPT} caracteres.`);
        }
        if (texto !== spec[campo]) {
          // Sólo la PRIMERA edición guarda el original. Las siguientes se
          // escriben encima, o «volver al original» devolvería a la edición
          // anterior en vez de a lo que escribió el Director.
          if (spec[campoOriginal(campo)] === undefined) spec[campoOriginal(campo)] = spec[campo] || '';
          spec[campo] = texto;
          algoCambió = true;
        }
      }

      if (datos.negativePrompt !== undefined) {
        // El negativo SÍ puede quedarse vacío: «no quiero excluir nada» es una
        // respuesta legítima, y a veces es justo lo que desatasca un bloqueo.
        const texto = String(datos.negativePrompt).trim().slice(0, MAX_PROMPT);
        if (texto !== (spec.negativePrompt || '')) {
          if (spec.negativePromptOriginal === undefined) spec.negativePromptOriginal = spec.negativePrompt || '';
          spec.negativePrompt = texto;
          algoCambió = true;
        }
      }

      if (!algoCambió) return;

      spec.promptEditado = true;
      makeEventAndPush(p, 'prompt_edited', `Prompt de «${activo.label}» reescrito a mano.`);
      marcarDesactualizado(p, activo);
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      proyecto: paraEnviar(proyecto),
      estado: computeProductionStatus(proyecto),
      campo,
    });
  } catch (e) {
    return fallo(res, e);
  }
};

/**
 * Avisar de que lo aprobado ya no se corresponde con el encargo.
 *
 * Es un AVISO, no una retirada: el archivo aprobado sigue siendo el oficial del
 * corto hasta que el usuario decida regenerarlo. Cambiarle el encargo por
 * debajo y desaprobarle el resultado serían dos decisiones, y sólo ha tomado
 * una.
 */
function marcarDesactualizado(p, activo) {
  if (!activo.approvedGenerationId || activo.stale) return;
  activo.stale = true;
  activo.staleReason =
    'Has cambiado el prompt de este elemento. Lo que ya aprobaste sigue siendo lo oficial; ' +
    'regenéralo sólo si quieres el resultado con el prompt nuevo.';
}

// `cfg` se lee al arrancar para que un despliegue sin credenciales falle aquí y
// no a mitad de la petición, igual que en el resto de los puntos de entrada.
void cfg;
