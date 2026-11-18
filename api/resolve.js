/* Playcase · /api/resolve — resolución exacta por enlace (Apple Music / Spotify) */
const { resolveCovers } = require('../lib-covers');
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

  const limit = hasValidKey(req) ? 40 : 20;
  if (!rateLimit(req, res, { name: 'resolve', limit })) {
    return sendJson(res, 429, { error: 'Demasiadas peticiones. Espera un minuto.' });
  }

  const u = new URL(req.url, 'http://localhost');
  const url = cleanText(u.searchParams.get('url'), 2048);
  if (!url) return sendJson(res, 400, { error: 'Falta el enlace.' });

  try {
    const result = await resolveCovers(url);
    if (result && result.error && !result.needsSetup) return sendJson(res, 400, result);
    sendJson(res, 200, result);
  } catch (e) {
    fail(res, e, 'No se pudo resolver el enlace.');
  }
};

module.exports.default = module.exports;
