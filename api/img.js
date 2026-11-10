/* Playcase · /api/img — descarga la carátula por nosotros para que el PNG nunca salga bloqueado por CORS */
const { UA, isArtHost, checkKey } = require('../lib-covers');

module.exports = async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  if (!checkKey(req, u)) { res.status(401).end('Contraseña incorrecta'); return; }
  const target = u.searchParams.get('u') || '';
  if (!isArtHost(target)) { res.status(400).end('Host no permitido'); return; }
  try {
    const r = await fetch(target, UA);
    if (!r.ok) { res.status(r.status).end('HTTP ' + r.status); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).end(buf);
  } catch (e) {
    res.status(500).end(e.message);
  }
};
module.exports.default = module.exports;
