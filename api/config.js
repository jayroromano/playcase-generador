/* Playcase · /api/config — configuración pública del generador (sin secretos) */
const {
  preflight, checkRequestOrigin, sendJson, methodNotAllowed,
  rateLimit, publicConfig,
} = require('../lib-security');

const METHODS = ['GET', 'OPTIONS'];

module.exports = async function handler(req, res) {
  if (preflight(req, res, METHODS)) return;

  const origin = checkRequestOrigin(req);
  if (!origin.ok) return sendJson(res, 403, { error: 'Origen no permitido.' });
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  if (!rateLimit(req, res, { name: 'config', limit: 60 })) {
    return sendJson(res, 429, { error: 'Demasiadas peticiones. Espera un minuto.' });
  }

  sendJson(res, 200, publicConfig());
};

module.exports.default = module.exports;
