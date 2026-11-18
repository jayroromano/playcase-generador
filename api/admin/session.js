/* Playcase · /api/admin/session — comprueba la cookie de sesión de administrador. */
const {
  preflight, checkRequestOrigin, sendJson, methodNotAllowed, rateLimit,
  requireAdmin, verifyAdminSession,
} = require('../../lib-security');

const METHODS = ['GET', 'OPTIONS'];

module.exports = async function handler(req, res) {
  if (preflight(req, res, METHODS)) return;

  const origin = checkRequestOrigin(req);
  if (!origin.ok) return sendJson(res, 403, { error: 'Origen no permitido.' });
  if (req.method !== 'GET') return methodNotAllowed(res, METHODS);

  if (!rateLimit(req, res, { name: 'admin-session', limit: 60 })) {
    return sendJson(res, 429, { error: 'Demasiadas peticiones. Espera un minuto.' });
  }

  if (!requireAdmin(req, res)) return;

  const session = verifyAdminSession(req);
  if (!session) return sendJson(res, 401, { error: 'Sesión de administrador no válida.' });
  sendJson(res, 200, { authenticated: true, expiresAt: session.exp * 1000 });
};

module.exports.default = module.exports;
