/* Playcase · /api/admin/login — inicia sesión de administrador con la cabecera x-admin-key.
   La clave nunca se acepta por URL ni se guarda en el navegador. */
const {
  preflight, checkRequestOrigin, sendJson, methodNotAllowed, rateLimit,
  adminAuthConfigured, adminKeyValid, createAdminSession, sessionCookie,
  ADMIN_SESSION_TTL_SECONDS,
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

  /* Límite estricto: 8 intentos por IP cada 15 minutos (best-effort en Vercel). */
  if (!rateLimit(req, res, { name: 'admin-login', limit: 8, windowMs: 15 * 60 * 1000 })) {
    return sendJson(res, 429, { error: 'Demasiados intentos. Espera unos minutos.' });
  }

  if (!adminKeyValid(req)) {
    return sendJson(res, 401, { error: 'Contraseña de administrador incorrecta.' });
  }

  const token = createAdminSession();
  if (!token) {
    return sendJson(res, 503, {
      error: 'El acceso de administrador no está configurado.',
      disabled: true,
    });
  }

  res.setHeader('Set-Cookie', sessionCookie(token));
  sendJson(res, 200, { ok: true, expiresIn: ADMIN_SESSION_TTL_SECONDS });
};

module.exports.default = module.exports;
