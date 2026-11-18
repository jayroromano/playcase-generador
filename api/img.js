/* Playcase · /api/img — descarga la carátula por nosotros para que el PNG nunca salga bloqueado por CORS */
const {
  preflight, checkRequestOrigin, sendJson, fail, methodNotAllowed,
  authorize, rateLimit, validateImageUrl, fetchImage, hasValidKey,
} = require('../lib-security');

const METHODS = ['GET', 'OPTIONS'];

module.exports = async function handler(req, res) {
  if (preflight(req, res, METHODS)) return;

  const origin = checkRequestOrigin(req);
  if (!origin.ok) return sendJson(res, 403, { error: 'Origen no permitido.' });
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);
  if (!authorize(req, res)) return;

  const limit = hasValidKey(req) ? 180 : 60;
  if (!rateLimit(req, res, { name: 'img', limit })) {
    return sendJson(res, 429, { error: 'Demasiadas descargas. Espera un minuto.' });
  }

  const u = new URL(req.url, 'http://localhost');
  const target = u.searchParams.get('u') || '';
  if (!validateImageUrl(target)) return sendJson(res, 400, { error: 'URL de imagen no permitida.' });

  try {
    const image = await fetchImage(target);
    res.statusCode = 200;
    res.setHeader('Content-Type', image.mimeType);
    res.setHeader('Content-Length', String(image.buffer.length));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(image.buffer);
  } catch (e) {
    fail(res, e, 'No se pudo descargar la carátula.');
  }
};

module.exports.default = module.exports;
