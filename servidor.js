/* Playcase · servidor local (mismas rutas y protecciones que la versión web)
   Uso: node servidor.js  o doble clic en "Iniciar Playcase.bat"
   Si existe access-key.txt, pide esa contraseña en la web. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 4173;
const INDEX = path.join(__dirname, 'index.html');
const PARENT_DEMO = path.join(__dirname, 'tests', 'parent-demo.html');

const routes = {
  '/api/config': require('./api/config'),
  '/api/search': require('./api/search'),
  '/api/resolve': require('./api/resolve'),
  '/api/img': require('./api/img'),
  '/api/admin/login': require('./api/admin/login'),
  '/api/admin/session': require('./api/admin/session'),
  '/api/admin/logout': require('./api/admin/logout'),
};

function sendFile(res, file, type) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');

    const route = routes[u.pathname];
    if (route) return await route(req, res);

    if (u.pathname === '/parent-demo') {
      return sendFile(res, PARENT_DEMO, 'text/html; charset=utf-8');
    }
    if (u.pathname === '/' || u.pathname === '/index.html') {
      return sendFile(res, INDEX, 'text/html; charset=utf-8');
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  } catch (e) {
    console.error('[playcase]', e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Error interno.' }));
  }
});

server.listen(PORT, () => console.log('Playcase listo → http://localhost:' + PORT));
