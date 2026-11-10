/* Playcase · /api/resolve — resolución exacta por enlace (Apple Music / Spotify) */
const { resolveCovers, checkKey } = require('../lib-covers');

module.exports = async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  if (!checkKey(req, u)) { res.status(401).json({ error: 'Contraseña incorrecta' }); return; }
  const url = u.searchParams.get('url') || '';
  try {
    res.status(200).json(await resolveCovers(url));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
module.exports.default = module.exports;
