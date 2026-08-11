// ════════════════════════════════════════════════════════════════
// ACTUALIZAR — reescribir las instrucciones de un corto ya empezado.
//
//   POST { id }  ->  { proyecto, estado, cambiados, avisos }
//
// POR QUÉ EXISTE. Los prompts se escriben UNA VEZ, cuando se crea el corto, y
// se guardan dentro de él. Eso es correcto: si cambiaran solos, la toma 12 que
// se genera hoy no encajaría con las once que el usuario aprobó ayer.
//
// Pero tiene un precio que se pagó caro. El usuario montó un corto de un zombie
// tocando la batería y la música le salió sin batería; se arregló el Director,
// se le dijo «regenera la música» — y siguió saliendo igual, porque SU corto
// llevaba dentro las instrucciones viejas. Ninguna mejora del equipo de
// dirección llegaba a un proyecto ya creado. Cada arreglo servía sólo para
// cortos nuevos, y eso convierte cada mejora en «empieza de cero».
//
// Esto lo arregla, y con dos límites que no se negocian:
//
//   LA ESTRUCTURA NO SE TOCA. Ni una toma más, ni una menos, ni un segundo
//   distinto. El usuario aprobó esa lista de planos y no se le puede cambiar
//   por debajo. Sólo se reescribe el TEXTO de cada encargo.
//
//   NADA SE DESAPRUEBA. Lo aprobado sigue aprobado y el MP4 sigue siendo el
//   suyo. Lo que cambió de instrucciones se marca como DESACTUALIZADO —el mismo
//   aviso de siempre— para que él decida si lo regenera o lo deja.
// ════════════════════════════════════════════════════════════════
const { empezar, cuerpo, requerido, fallo, ErrorPeticion } = require('./_lib/http.js');
const { modificarProyecto } = require('./_lib/almacen.js');
const { makeEventAndPush } = require('./_lib/dominio.js');
const { computeProductionStatus } = require('./_lib/progreso.js');
const { construirPlan } = require('./_lib/plan.js');
const { createProject } = require('./_lib/dominio.js');
const { cfg } = require('./_lib/gcp.js');
const { paraEnviar } = require('./_lib/respuesta.js');

module.exports = async function handler(req, res) {
  if (empezar(req, res, ['POST'])) return;

  try {
    const datos = await cuerpo(req);
    const id = String(requerido(datos, 'id')).trim();

    // El plan nuevo se arma FUERA del candado: construirPlan puede llamar a
    // Claude y tardar, y mientras tanto el proyecto tiene que seguir usable.
    const almacen = require('./_lib/almacen.js');
    const previo = await almacen.leerProyecto(id);
    if (!previo) throw new ErrorPeticion(404, `No existe ningún proyecto con el identificador "${id}"`);

    const { plan: planNuevo, avisos } = await construirPlan(previo.proyecto.config);

    // Se construye un proyecto de mentira con la configuración de siempre, sólo
    // para que escriba los encargos con el Director de hoy. De él se copian los
    // textos; no se toca nada más suyo.
    const modelo = createProject(previo.proyecto.config, planNuevo);
    const nuevosPorId = new Map(modelo.assets.map((a) => [a.id, a.spec || {}]));

    const cambiados = [];

    const { proyecto } = await modificarProyecto(id, (p) => {
      for (const activo of p.assets) {
        const nuevo = nuevosPorId.get(activo.id);
        // Un activo que el Director de hoy ya no crearía —porque el reparto de
        // planos cambió— se queda EXACTAMENTE como está. Cambiarle el encargo
        // por el de otro plano sería peor que dejarlo viejo.
        if (!nuevo) continue;

        const antes = activo.spec || {};
        const distinto =
          antes.prompt !== nuevo.prompt ||
          (antes.promptEn || '') !== (nuevo.promptEn || '') ||
          antes.negativePrompt !== nuevo.negativePrompt;
        if (!distinto) continue;

        activo.spec = Object.assign({}, antes, {
          prompt: nuevo.prompt,
          negativePrompt: nuevo.negativePrompt,
          continuityNotes: nuevo.continuityNotes || antes.continuityNotes,
        });
        if (nuevo.promptEn) activo.spec.promptEn = nuevo.promptEn;
        cambiados.push(activo.label);

        // Si ya estaba aprobado, se avisa. No se desaprueba: la versión oficial
        // sigue siendo la suya hasta que él decida otra cosa.
        if (activo.approvedGenerationId && !activo.stale) {
          activo.stale = true;
          activo.staleReason =
            'Las instrucciones de este elemento se han actualizado. Lo que ya aprobaste sigue ' +
            'siendo lo oficial; regenéralo sólo si quieres el resultado con las nuevas.';
        }
      }

      // Los encargos de música y ambiente viven también en el plan, que es de
      // donde los lee la generación.
      if (p.plan) {
        p.plan.music = planNuevo.music;
        p.plan.ambient = planNuevo.ambient;
      }

      makeEventAndPush(
        p,
        'plan_updated',
        cambiados.length
          ? `Instrucciones actualizadas en ${cambiados.length} elemento(s) del corto.`
          : 'Instrucciones revisadas: ya estaban al día.',
      );
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      proyecto: paraEnviar(proyecto),
      estado: computeProductionStatus(proyecto),
      cambiados,
      avisos: avisos || [],
    });
  } catch (e) {
    return fallo(res, e);
  }
};

// `cfg` se lee al arrancar para que un despliegue sin credenciales falle aquí y
// no a mitad de la petición, igual que en el resto de los puntos de entrada.
void cfg;
