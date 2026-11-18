/* Playcase · /api/search — búsqueda por canción y artista */
const { searchCovers } = require('../lib-covers');
const {
  preflight, checkRequestOrigin, sendJson, fail, methodNotAllowed,
  authorize, rateLimit, cleanText, hasValidKey,
} = require('../lib-security');

const METHODS = ['GET', 'OPTIONS'];

module.exports = async function handler(req, res) {
  if (preflight(req, res, METHODS)) return;

  const origin = checkRequestOrigin(req);
  if (!origin.ok) return sendJson(res, 403, { error: 'Origen no permitido.' });
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);
  if (!authorize(req, res)) return;

  const limit = hasValidKey(req) ? 90 : 30;
  if (!rateLimit(req, res, { name: 'search', limit })) {
    return sendJson(res, 429, { error: 'Demasiadas búsquedas. Espera un minuto.' });
  }

  const u = new URL(req.url, 'http://localhost');
  const song = cleanText(u.searchParams.get('song'), 120);
  const artist = cleanText(u.searchParams.get('artist'), 120);
  if (!song && !artist) return sendJson(res, 400, { error: 'Indica al menos la canción o el artista.' });

  try {
    const results = await searchCovers(song, artist);
    sendJson(res, 200, { results });
  } catch (e) {
    fail(res, e, 'No se pudo buscar la carátula.');
  }
};

module.exports.default = module.exports;
