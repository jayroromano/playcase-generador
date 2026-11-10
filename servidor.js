/* Playcase · servidor local (mismas rutas que la versión web)
   Uso: node servidor.js  o doble clic en "Iniciar Playcase.bat"
   Si existe access-key.txt, pide esa contraseña en la web. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { UA, isArtHost, searchCovers, resolveCovers, checkKey } = require('./lib-covers');

const PORT = 4173;
const INDEX = path.join(__dirname, 'index.html');

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    if (!checkKey(req, u)) return json(res, 401, { error: 'Contraseña incorrecta' });

    if (u.pathname === '/api/search') {
      const results = await searchCovers(u.searchParams.get('song') || '', u.searchParams.get('artist') || '');
      return json(res, 200, { results });
    }
    if (u.pathname === '/api/resolve') {
      return json(res, 200, await resolveCovers(u.searchParams.get('url') || ''));
    }
    if (u.pathname === '/api/img') {
      const target = u.searchParams.get('u') || '';
      if (!isArtHost(target)) { res.writeHead(400); return res.end('Host no permitido'); }
      const r = await fetch(target, UA);
      if (!r.ok) { res.writeHead(r.status); return res.end('HTTP ' + r.status); }
      res.writeHead(200, {
        'Content-Type': r.headers.get('content-type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    // cualquier otra ruta → la página del generador
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(INDEX).pipe(res);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log('Playcase listo → http://localhost:' + PORT));
