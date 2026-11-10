/* Playcase · /api/search — búsqueda por canción y artista */
const { searchCovers, checkKey } = require('../lib-covers');

module.exports = async function handler(req, res) {
  const u = new URL(req.url, 'http://x');
  if (!checkKey(req, u)) { res.status(401).json({ error: 'Contraseña incorrecta' }); return; }
  const song = u.searchParams.get('song') || '';
  const artist = u.searchParams.get('artist') || '';
  try {
    const results = await searchCovers(song, artist);
    res.status(200).json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message, results: [] });
  }
};
module.exports.default = module.exports;
