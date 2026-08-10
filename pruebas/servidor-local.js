// ════════════════════════════════════════════════════════════════
// LA HERRAMIENTA ENTERA, EN TU MÁQUINA, SIN CUENTA DE GOOGLE
//
//   node pruebas/servidor-local.js      ->  http://localhost:8799
//
// Sirve index.html y enruta /api/* a los mismos archivos que va a
// ejecutar Vercel, pero contra el Google Cloud simulado. Sirve para
// ver y probar la interfaz completa —crear un proyecto, generar,
// revisar, aprobar, montar y exportar— sin credenciales y sin gastar
// un céntimo en Veo.
//
// Lo que se ve aquí no es lo que generará Google: las imágenes y los
// clips son de mentira. Lo que sí es real es el flujo, las reglas de
// aprobación y las pantallas.
// ════════════════════════════════════════════════════════════════
const http = require('http');
const fs = require('fs');
const path = require('path');
const { instalarGoogleSimulado, entornoDePrueba } = require('./google-simulado.js');

entornoDePrueba();
const { objetos } = instalarGoogleSimulado();

const RAIZ = path.join(__dirname, '..');
const PUERTO = Number(process.env.PORT || 8799);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.sh': 'text/x-shellscript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');

  // Vercel añade estos dos a `res`; los handlers los usan.
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(b));
    return res;
  };

  if (u.pathname.indexOf('/api/') === 0) {
    const nombre = u.pathname.slice(5).split('/')[0];
    const archivo = path.join(RAIZ, 'api', nombre + '.js');
    // Nada de rutas con .. : el nombre tiene que ser un endpoint de verdad.
    if (!/^[a-z-]+$/.test(nombre) || !fs.existsSync(archivo)) {
      return res.status(404).json({ error: 'No existe /api/' + nombre });
    }
    req.query = Object.fromEntries(u.searchParams);
    try {
      await require(archivo)(req, res);
    } catch (e) {
      console.error('[' + nombre + ']', e && e.stack);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
    return;
  }

  const rel = u.pathname === '/' ? '/index.html' : u.pathname;
  const destino = path.join(RAIZ, rel);
  if (destino.indexOf(RAIZ) !== 0 || !fs.existsSync(destino) || !fs.statSync(destino).isFile()) {
    res.statusCode = 404;
    return res.end('No encontrado');
  }
  res.setHeader('Content-Type', TIPOS[path.extname(destino)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.end(fs.readFileSync(destino));
});

servidor.listen(PUERTO, () => {
  console.log('');
  console.log('  AI Music Short Studio — http://localhost:' + PUERTO);
  console.log('');
  console.log('  Google Cloud está simulado: no hace falta credencial y no se');
  console.log('  gasta nada. Las imágenes y los clips son de mentira; el flujo');
  console.log('  de aprobación y las pantallas son los de verdad.');
  console.log('');
  console.log('  Objetos en el bucket simulado: ' + objetos.size);
  console.log('');
});
