/* Playcase · utilidades de seguridad compartidas por las APIs de Vercel y el servidor local.
   No contiene secretos: solo lee variables de entorno y aplica límites. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '1';
const UA_STRING = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';
const UA = { headers: { 'User-Agent': UA_STRING } };

const IMAGE_MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const URL_MAX_LENGTH = 2048;
const ART_HOST_SUFFIXES = ['mzstatic.com', 'scdn.co', 'dzcdn.net', 'spotifycdn.com'];

const ADMIN_COOKIE = 'playcase_admin';
const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 horas
const SESSION_SECRET_MIN_LENGTH = 32; // longitud mínima en producción

/* ---------- entorno ---------- */
function isProduction() {
  return process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
}

function publicApiEnabled() {
  return String(process.env.PLAYCASE_PUBLIC_API || '').toLowerCase() === 'true';
}

function accessKey() {
  if (process.env.ACCESS_KEY) return String(process.env.ACCESS_KEY);
  try {
    return fs.readFileSync(path.join(__dirname, 'access-key.txt'), 'utf8').trim();
  } catch (e) {
    return '';
  }
}

/* La clave de administrador es ADMIN_KEY si existe; si no, se reutiliza ACCESS_KEY. */
function adminKey() {
  if (process.env.ADMIN_KEY) return String(process.env.ADMIN_KEY);
  return accessKey();
}

/* Secreto de firma de la cookie. En producción es obligatorio y distinto de la clave. */
function sessionSecret() {
  const secret = String(process.env.PLAYCASE_SESSION_SECRET || '');
  if (secret) return secret;
  if (isProduction()) return '';
  return adminKey();
}

/* En producción exigimos un secreto propio, largo y distinto de la clave de administrador.
   En local se permite usar la clave como secreto para no complicar las pruebas. */
function sessionSecretConfigured() {
  const secret = String(process.env.PLAYCASE_SESSION_SECRET || '');
  if (!secret) return !isProduction() && !!adminKey();
  if (!isProduction()) return true;
  if (secret.length < SESSION_SECRET_MIN_LENGTH) return false;
  const key = adminKey();
  return !key || !safeEqual(secret, key);
}

/* Sin clave o sin secreto de sesión válido no se habilitan sesiones administrativas. */
function adminAuthConfigured() {
  return !!adminKey() && sessionSecretConfigured();
}

/* Comparación en tiempo constante sobre hashes (no filtra la longitud). */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* La clave de las APIs solo se exige si la API no es pública. */
function keyRequired() {
  return !publicApiEnabled();
}

function providedKey(req) {
  return String((req.headers && req.headers['x-key']) || '');
}

function hasLegacyKey(req) {
  const expected = adminKey();
  if (!expected) return false;
  const given = providedKey(req);
  return !!given && safeEqual(given, expected);
}

function adminKeyValid(req) {
  const expected = adminKey();
  if (!expected) return false;
  const given = String((req.headers && req.headers['x-admin-key']) || '');
  return !!given && safeEqual(given, expected);
}

/* ---------- sesión de administrador (cookie firmada con HMAC) ---------- */
function readCookie(req, name) {
  const raw = String((req.headers && req.headers.cookie) || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    const value = part.slice(index + 1).trim();
    try { return decodeURIComponent(value); } catch (e) { return value; }
  }
  return '';
}

function signSession(body) {
  const secret = sessionSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function createAdminSession(now = Date.now()) {
  if (!sessionSecretConfigured()) return null;
  const issued = Math.floor(now / 1000);
  const payload = { v: 1, iat: issued, exp: issued + ADMIN_SESSION_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return body + '.' + signSession(body);
}

function verifyAdminSessionToken(token) {
  if (!sessionSecretConfigured()) return null;
  if (typeof token !== 'string' || !token || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts;
  if (!safeEqual(signature, signSession(body))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
  if (!payload || payload.v !== 1) return null;
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return null;
  return payload;
}

function verifyAdminSession(req) {
  return verifyAdminSessionToken(readCookie(req, ADMIN_COOKIE));
}

function sessionCookie(token) {
  const parts = [
    ADMIN_COOKIE + '=' + encodeURIComponent(token),
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=' + ADMIN_SESSION_TTL_SECONDS,
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie() {
  const parts = [
    ADMIN_COOKIE + '=',
    'Path=/api',
    'HttpOnly',
    'SameSite=Strict',
    'Max-Age=0',
  ];
  if (isProduction()) parts.push('Secure');
  return parts.join('; ');
}

/* Las APIs aceptan la cookie de admin (o la cabecera heredada x-key) cuando están cerradas. */
function hasValidKey(req) {
  if (hasLegacyKey(req)) return true;
  return adminAuthConfigured() && !!verifyAdminSession(req);
}

/* Endpoints exclusivos de administrador: solo cookie de sesión válida. */
function requireAdmin(req, res) {
  if (!adminAuthConfigured()) {
    sendJson(res, 503, { error: 'El acceso de administrador no está configurado.', disabled: true });
    return false;
  }
  if (!verifyAdminSession(req)) {
    sendJson(res, 401, { error: 'Sesión de administrador no válida.' });
    return false;
  }
  return true;
}

/* ---------- orígenes y CORS ---------- */
function allowedOrigins() {
  const out = new Set();
  const raw = String(process.env.PLAYCASE_ALLOWED_ORIGINS || '');
  for (const part of raw.split(',')) {
    const value = part.trim();
    if (!value) continue;
    try {
      const u = new URL(value);
      if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !isProduction())) continue;
      if (u.username || u.password) continue;
      out.add(u.origin);
    } catch (e) { /* valor ignorado */ }
  }
  if (!isProduction()) {
    out.add('http://localhost:4173');
    out.add('http://127.0.0.1:4173');
  }
  return [...out];
}

function originAllowed(origin) {
  if (!origin || origin === 'null') return false;
  return allowedOrigins().includes(origin);
}

/* Origen propio de la petición (para permitir el panel de administración en su mismo dominio). */
function requestOrigin(req) {
  const headers = req.headers || {};
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  if (!host) return null;
  const proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim()
    || (isProduction() ? 'https' : 'http');
  try {
    return new URL(proto + '://' + host).origin;
  } catch (e) {
    return null;
  }
}

/* Sin cabecera Origin (misma origen, curl, server-to-server) se permite.
   Con Origin, debe ser el propio dominio o estar en la lista configurada. */
function checkRequestOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return { ok: true, origin: null };
  if (origin === 'null') return { ok: !isProduction(), origin };
  if (origin === requestOrigin(req)) return { ok: true, origin, sameOrigin: true };
  return { ok: originAllowed(origin), origin };
}

function applyCors(req, res, methods) {
  const origin = req.headers && req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && originAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Key');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

/* Devuelve true si ya respondió (preflight). */
function preflight(req, res, methods) {
  applyCors(req, res, methods);
  if (req.method !== 'OPTIONS') return false;
  const check = checkRequestOrigin(req);
  res.statusCode = check.ok ? 204 : 403;
  res.end();
  return true;
}

/* ---------- respuestas ---------- */
function sendJson(res, status, body) {
  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  res.end(JSON.stringify(body));
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/* Errores controlados: mensaje público corto, detalle solo en el log del servidor. */
function fail(res, error, fallback = 'No se pudo completar la operación.') {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : fallback;
  if (status >= 500) console.error('[playcase]', error && error.stack ? error.stack : error);
  sendJson(res, status, { error: message });
}

function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  sendJson(res, 405, { error: 'Método no permitido.' });
}

/* ---------- autenticación ---------- */
function authorize(req, res) {
  if (!keyRequired()) return true;
  if (hasValidKey(req)) return true;
  sendJson(res, 401, { error: 'Acceso no autorizado.' });
  return false;
}

/* ---------- rate limiting (en memoria, best-effort en Vercel) ---------- */
const buckets = new Map();

function clientIp(req) {
  const forwarded = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return forwarded || (req.socket && req.socket.remoteAddress) || 'desconocido';
}

function rateLimit(req, res, options) {
  const name = options.name || 'general';
  const limit = options.limit || 30;
  const windowMs = options.windowMs || 60000;
  const now = Date.now();
  const id = name + ':' + clientIp(req);

  let bucket = buckets.get(id);
  if (!bucket || bucket.reset <= now) {
    bucket = { count: 0, reset: now + windowMs };
    buckets.set(id, bucket);
  }
  bucket.count += 1;

  const remaining = Math.max(0, limit - bucket.count);
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.reset / 1000)));

  if (bucket.count > limit) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.reset - now) / 1000))));
    return false;
  }

  if (buckets.size > 5000) {
    for (const [key, value] of buckets) {
      if (value.reset <= now) buckets.delete(key);
    }
  }
  return true;
}

/* ---------- validación de texto ---------- */
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/* ---------- validación de URLs de imagen (anti-SSRF) ---------- */
function validateImageUrl(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > URL_MAX_LENGTH) return null;
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  const host = u.hostname.toLowerCase();
  if (!host || host.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  const allowed = ART_HOST_SUFFIXES.some(suffix => host === suffix || host.endsWith('.' + suffix));
  if (!allowed) return null;
  return u;
}

function isArtHost(raw) {
  return !!validateImageUrl(raw);
}

/* Tipo real por magic bytes: nunca nos fiamos del Content-Type del origen. */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/* Descarga sin seguir redirecciones y con límite de tamaño y tiempo. */
async function fetchImage(rawUrl) {
  const url = validateImageUrl(rawUrl);
  if (!url) throw new HttpError(400, 'La URL de la imagen no es válida.');

  let response;
  try {
    response = await fetch(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { ...UA.headers, Accept: 'image/jpeg,image/png,image/webp' },
    });
  } catch (e) {
    throw new HttpError(502, 'No se pudo descargar la carátula.');
  }

  if (response.status !== 200) throw new HttpError(502, 'No se pudo descargar la carátula.');

  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > IMAGE_MAX_BYTES) throw new HttpError(413, 'La carátula es demasiado grande.');

  let buffer;
  try {
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > IMAGE_MAX_BYTES) {
          try { await reader.cancel(); } catch (e) {}
          throw new HttpError(413, 'La carátula es demasiado grande.');
        }
        chunks.push(Buffer.from(value));
      }
      buffer = Buffer.concat(chunks);
    } else {
      buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > IMAGE_MAX_BYTES) throw new HttpError(413, 'La carátula es demasiado grande.');
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, 'No se pudo descargar la carátula.');
  }

  const mimeType = detectImageType(buffer);
  if (!mimeType) throw new HttpError(415, 'El archivo no es una imagen válida.');

  return { buffer, mimeType };
}

/* ---------- llamadas a servicios externos ---------- */
async function fetchUpstream(url, options = {}, timeoutMs = 8000) {
  return fetch(url, {
    ...options,
    headers: { ...UA.headers, ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function fetchJson(url, options = {}, timeoutMs = 8000) {
  const response = await fetchUpstream(url, options, timeoutMs);
  if (!response.ok) throw new HttpError(502, 'El servicio externo no respondió.');
  return response.json();
}

/* ---------- configuración pública (nunca incluye secretos) ---------- */
function publicConfig() {
  return {
    version: VERSION,
    publicApi: publicApiEnabled(),
    requiresKey: keyRequired(),
    adminAuth: adminAuthConfigured(),
    allowedOrigins: allowedOrigins(),
  };
}

module.exports = {
  VERSION,
  UA,
  IMAGE_MAX_BYTES,
  URL_MAX_LENGTH,
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  HttpError,
  isProduction,
  publicApiEnabled,
  accessKey,
  adminKey,
  adminAuthConfigured,
  sessionSecret,
  sessionSecretConfigured,
  keyRequired,
  hasValidKey,
  adminKeyValid,
  createAdminSession,
  verifyAdminSession,
  verifyAdminSessionToken,
  sessionCookie,
  clearSessionCookie,
  requireAdmin,
  allowedOrigins,
  originAllowed,
  requestOrigin,
  checkRequestOrigin,
  applyCors,
  preflight,
  sendJson,
  fail,
  methodNotAllowed,
  authorize,
  rateLimit,
  cleanText,
  validateImageUrl,
  isArtHost,
  detectImageType,
  fetchImage,
  fetchUpstream,
  fetchJson,
  publicConfig,
};
