/* Playcase · /api/admin/logout — borra la cookie de sesión de administrador. */
const {
  preflight, checkRequestOrigin, sendJson, methodNotAllowed, rateLimit,
  adminAuthConfigured, clearSessionCookie,
} = require('../../lib-security');

const METHODS = ['POST', 'OPTIONS'];

module.exports = async function handler(req, res) {
  if (preflight(req, res, METHODS)) return;

  const origin = checkRequestOrigin(req);
  if (!origin.ok) return sendJson(res, 403, { error: 'Origen no permitido.' });
  if (req.method !== 'POST') return methodNotAllowed(res, METHODS);

  if (!adminAuthConfigured()) {
    return sendJson(res, 503, {
      error: 'El acceso de administrador no está configurado.',
      disabled: true,
    });
  }

  if (!rateLimit(req, res, { name: 'admin-logout', limit: 30 })) {
    return sendJson(res, 429, { error: 'Demasiadas peticiones. Espera un minuto.' });
  }

  res.setHeader('Set-Cookie', clearSessionCookie());
  sendJson(res, 200, { ok: true });
};

module.exports.default = module.exports;
