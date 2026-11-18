/* Playcase · pruebas locales de seguridad (node --test) */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateImageUrl, detectImageType, cleanText, allowedOrigins, originAllowed,
  checkRequestOrigin, publicConfig, rateLimit, isArtHost, publicApiEnabled,
  createAdminSession, verifyAdminSessionToken, sessionCookie, clearSessionCookie,
  adminAuthConfigured, adminKey, keyRequired, requestOrigin, sessionSecretConfigured,
} = require('../lib-security');
const { resolveCovers } = require('../lib-covers');

const ORIGINAL_ENV = { ...process.env };

after(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
});

function resetEnv() {
  delete process.env.PLAYCASE_PUBLIC_API;
  delete process.env.PLAYCASE_ALLOWED_ORIGINS;
  delete process.env.ACCESS_KEY;
  delete process.env.ADMIN_KEY;
  delete process.env.PLAYCASE_SESSION_SECRET;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  process.env.NODE_ENV = 'test';
}

function mockRes() {
  return {
    headersSent: false,
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(chunk) { this.body = chunk == null ? '' : String(chunk); this.headersSent = true; },
  };
}

/* ---------- URLs de imagen ---------- */
test('validateImageUrl acepta solo HTTPS de los hosts permitidos', () => {
  assert.ok(validateImageUrl('https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg'));
  assert.ok(validateImageUrl('https://i.scdn.co/image/abc123'));
  assert.ok(validateImageUrl('https://e-cdns-images.dzcdn.net/images/cover/x/1000x1000-000000-80-0-0.jpg'));

  assert.equal(validateImageUrl('http://is1-ssl.mzstatic.com/image/x.jpg'), null);
  assert.equal(validateImageUrl('https://mzstatic.com.evil.example/x.jpg'), null);
  assert.equal(validateImageUrl('https://evilmzstatic.com/x.jpg'), null);
  assert.equal(validateImageUrl('https://user:pass@is1-ssl.mzstatic.com/x.jpg'), null);
  assert.equal(validateImageUrl('https://is1-ssl.mzstatic.com:8443/x.jpg'), null);
  assert.equal(validateImageUrl('https://127.0.0.1/x.jpg'), null);
  assert.equal(validateImageUrl('https://localhost/x.jpg'), null);
  assert.equal(validateImageUrl('file:///C:/secreto.jpg'), null);
  assert.equal(validateImageUrl('data:image/png;base64,AAAA'), null);
  assert.equal(validateImageUrl('https://is1-ssl.mzstatic.com/' + 'a'.repeat(2100)), null);
  assert.equal(validateImageUrl(''), null);
  assert.equal(validateImageUrl(null), null);
});

test('isArtHost usa la misma lista blanca', () => {
  assert.equal(isArtHost('https://i.scdn.co/image/abc'), true);
  assert.equal(isArtHost('http://i.scdn.co/image/abc'), false);
  assert.equal(isArtHost('https://scdn.co.evil.example/abc'), false);
});

/* ---------- tipo real de imagen ---------- */
test('detectImageType comprueba los magic bytes', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  const texto = Buffer.from('<html>no soy una imagen</html>');

  assert.equal(detectImageType(png), 'image/png');
  assert.equal(detectImageType(jpeg), 'image/jpeg');
  assert.equal(detectImageType(webp), 'image/webp');
  assert.equal(detectImageType(texto), null);
  assert.equal(detectImageType(Buffer.alloc(4)), null);
});

/* ---------- texto ---------- */
test('cleanText recorta, limpia controles y limita longitud', () => {
  assert.equal(cleanText('  La   Graciosa  ', 50), 'La Graciosa');
  assert.equal(cleanText('a\u0000b\u001fc', 50), 'a b c');
  assert.equal(cleanText('x'.repeat(200), 20), 'x'.repeat(20));
  assert.equal(cleanText(null, 20), '');
  assert.equal(cleanText(123, 20), '');
});

/* ---------- orígenes ---------- */
test('allowedOrigins lee la variable y añade localhost solo en desarrollo', () => {
  resetEnv();
  process.env.PLAYCASE_ALLOWED_ORIGINS = 'https://tienda.example.com, https://otra.example.com/';
  const dev = allowedOrigins();
  assert.ok(dev.includes('https://tienda.example.com'));
  assert.ok(dev.includes('https://otra.example.com'));
  assert.ok(dev.includes('http://localhost:4173'));

  process.env.NODE_ENV = 'production';
  process.env.PLAYCASE_ALLOWED_ORIGINS = 'http://inseguro.example.com, https://tienda.example.com';
  const prod = allowedOrigins();
  assert.ok(prod.includes('https://tienda.example.com'));
  assert.ok(!prod.includes('http://inseguro.example.com'));
  assert.ok(!prod.includes('http://localhost:4173'));
});

test('checkRequestOrigin permite misma origen y bloquea orígenes desconocidos', () => {
  resetEnv();
  process.env.PLAYCASE_ALLOWED_ORIGINS = 'https://tienda.example.com';

  assert.equal(checkRequestOrigin({ headers: {} }).ok, true);
  assert.equal(checkRequestOrigin({ headers: { origin: 'https://tienda.example.com' } }).ok, true);
  assert.equal(checkRequestOrigin({ headers: { origin: 'https://malo.example.com' } }).ok, false);
  assert.equal(originAllowed('https://tienda.example.com'), true);
  assert.equal(originAllowed('https://malo.example.com'), false);
  assert.equal(originAllowed(null), false);
});

/* ---------- configuración pública ---------- */
test('publicConfig no expone secretos y calcula requiresKey', () => {
  resetEnv();
  process.env.ACCESS_KEY = 'clave-interna-de-prueba';
  process.env.PLAYCASE_ALLOWED_ORIGINS = 'https://tienda.example.com';

  process.env.PLAYCASE_PUBLIC_API = 'true';
  assert.equal(publicApiEnabled(), true);
  const abierta = publicConfig();
  assert.equal(abierta.publicApi, true);
  assert.equal(abierta.requiresKey, false);
  assert.equal(abierta.adminAuth, true);
  assert.ok(abierta.allowedOrigins.includes('https://tienda.example.com'));
  assert.ok(!JSON.stringify(abierta).includes('clave-interna-de-prueba'));

  delete process.env.PLAYCASE_PUBLIC_API;
  const cerrada = publicConfig();
  assert.equal(cerrada.publicApi, false);
  assert.equal(cerrada.requiresKey, true);
  assert.equal(cerrada.adminAuth, true);
  assert.ok(!JSON.stringify(cerrada).includes('clave-interna-de-prueba'));
});

test('sin clave de administrador el acceso admin queda deshabilitado, no abierto', () => {
  resetEnv();
  assert.equal(adminAuthConfigured(), false);
  assert.equal(keyRequired(), true);
  assert.equal(publicConfig().adminAuth, false);
});

test('ADMIN_KEY tiene prioridad sobre ACCESS_KEY', () => {
  resetEnv();
  process.env.ACCESS_KEY = 'clave-heredada';
  process.env.ADMIN_KEY = 'clave-nueva';
  assert.equal(adminKey(), 'clave-nueva');
});

/* ---------- secreto de sesión obligatorio en producción ---------- */
const SECRETO_VALIDO = 'secreto-de-sesion-largo-y-aleatorio-0123456789';

test('en producción sin PLAYCASE_SESSION_SECRET no se habilitan sesiones admin', async () => {
  resetEnv();
  process.env.NODE_ENV = 'production';
  process.env.ADMIN_KEY = 'clave-admin-de-prueba';

  assert.equal(sessionSecretConfigured(), false);
  assert.equal(adminAuthConfigured(), false);
  assert.equal(publicConfig().adminAuth, false);
  assert.equal(createAdminSession(), null);
  assert.equal(verifyAdminSessionToken('cualquier.cosa'), null);

  const login = require('../api/admin/login');
  const session = require('../api/admin/session');

  const entrada = mockRes();
  await login({
    method: 'POST',
    url: '/api/admin/login',
    headers: { 'x-forwarded-for': '203.0.113.50', 'x-admin-key': 'clave-admin-de-prueba' },
    socket: {},
  }, entrada);
  assert.equal(entrada.statusCode, 503);
  assert.equal(JSON.parse(entrada.body).disabled, true);
  assert.equal(entrada.headers['set-cookie'], undefined);

  const consulta = mockRes();
  await session({
    method: 'GET',
    url: '/api/admin/session',
    headers: { 'x-forwarded-for': '203.0.113.51' },
    socket: {},
  }, consulta);
  assert.equal(consulta.statusCode, 503);
});

test('en producción el secreto debe ser distinto de ADMIN_KEY y suficientemente largo', () => {
  resetEnv();
  process.env.NODE_ENV = 'production';
  process.env.ADMIN_KEY = 'clave-admin-de-prueba';

  process.env.PLAYCASE_SESSION_SECRET = 'clave-admin-de-prueba';
  assert.equal(sessionSecretConfigured(), false);
  assert.equal(adminAuthConfigured(), false);
  assert.equal(createAdminSession(), null);

  process.env.PLAYCASE_SESSION_SECRET = 'corto';
  assert.equal(sessionSecretConfigured(), false);
  assert.equal(adminAuthConfigured(), false);
  assert.equal(createAdminSession(), null);

  process.env.PLAYCASE_SESSION_SECRET = SECRETO_VALIDO;
  assert.equal(sessionSecretConfigured(), true);
  assert.equal(adminAuthConfigured(), true);
});

test('en producción con secreto propio el login admin emite cookie segura', async () => {
  resetEnv();
  process.env.NODE_ENV = 'production';
  process.env.ADMIN_KEY = 'clave-admin-de-prueba';
  process.env.PLAYCASE_SESSION_SECRET = SECRETO_VALIDO;

  assert.equal(adminAuthConfigured(), true);
  const token = createAdminSession();
  assert.ok(token);
  assert.ok(verifyAdminSessionToken(token));

  const login = require('../api/admin/login');
  const session = require('../api/admin/session');

  const entrada = mockRes();
  await login({
    method: 'POST',
    url: '/api/admin/login',
    headers: { 'x-forwarded-for': '203.0.113.52', 'x-admin-key': 'clave-admin-de-prueba' },
    socket: {},
  }, entrada);
  assert.equal(entrada.statusCode, 200);
  const cookie = entrada.headers['set-cookie'];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /; Secure/);

  const consulta = mockRes();
  await session({
    method: 'GET',
    url: '/api/admin/session',
    headers: { cookie: cookie.split(';')[0], 'x-forwarded-for': '203.0.113.53' },
    socket: {},
  }, consulta);
  assert.equal(consulta.statusCode, 200);
  assert.equal(JSON.parse(consulta.body).authenticated, true);
});

test('en local se permite firmar con la clave si no hay secreto', () => {
  resetEnv();
  process.env.ACCESS_KEY = 'clave-admin-de-prueba';
  assert.equal(sessionSecretConfigured(), true);
  const token = createAdminSession();
  assert.ok(token);
  assert.ok(verifyAdminSessionToken(token));
});

/* ---------- rate limiting ---------- */
test('rateLimit bloquea al superar el límite y envía Retry-After', () => {
  const res = mockRes();
  const req = { headers: { 'x-forwarded-for': '203.0.113.77' }, socket: {} };
  const options = { name: 'prueba-' + Date.now(), limit: 2, windowMs: 60000 };

  assert.equal(rateLimit(req, res, options), true);
  assert.equal(rateLimit(req, res, options), true);
  assert.equal(rateLimit(req, res, options), false);
  assert.equal(res.headers['x-ratelimit-limit'], '2');
  assert.equal(res.headers['x-ratelimit-remaining'], '0');
  assert.ok(Number(res.headers['retry-after']) >= 1);
});

/* ---------- resolución de enlaces ---------- */
test('resolveCovers rechaza esquemas y hosts no autorizados sin salir a la red', async () => {
  const http = await resolveCovers('http://open.spotify.com/track/abc');
  assert.match(http.error, /https/);

  const esquema = await resolveCovers('spotify:track:abc');
  assert.match(esquema.error, /https/);

  const host = await resolveCovers('https://open.spotify.com.evil.example/track/abc');
  assert.match(host.error, /soportados/);

  const corto = await resolveCovers('https://open.spotify.com/track/abc');
  assert.match(corto.error, /enlace de canción/);

  const album = await resolveCovers('https://music.apple.com/es/album/disco/123456');
  assert.match(album.error, /álbum/);

  const vacio = await resolveCovers('');
  assert.match(vacio.error, /no válido/i);
});

/* ---------- handlers ---------- */
test('/api/config responde JSON público por GET', async () => {
  resetEnv();
  process.env.PLAYCASE_PUBLIC_API = 'true';
  const handler = require('../api/config');
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/config', headers: { 'x-forwarded-for': '203.0.113.10' }, socket: {} }, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.publicApi, true);
  assert.equal(body.requiresKey, false);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('/api/search rechaza métodos distintos de GET', async () => {
  resetEnv();
  const handler = require('../api/search');
  const res = mockRes();
  await handler({ method: 'POST', url: '/api/search', headers: { 'x-forwarded-for': '203.0.113.11' }, socket: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, OPTIONS');
});

test('/api/img rechaza URLs no permitidas', async () => {
  resetEnv();
  process.env.PLAYCASE_PUBLIC_API = 'true';
  const handler = require('../api/img');
  const res = mockRes();
  await handler({
    method: 'GET',
    url: '/api/img?u=' + encodeURIComponent('http://127.0.0.1/secreto.png'),
    headers: { 'x-forwarded-for': '203.0.113.12' },
    socket: {},
  }, res);
  assert.equal(res.statusCode, 400);
  assert.match(JSON.parse(res.body).error, /no permitida/i);
});

test('las APIs exigen clave cuando la API no es pública', async () => {
  resetEnv();
  process.env.ACCESS_KEY = 'clave-interna-de-prueba';
  const handler = require('../api/search');
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/search?song=x', headers: { 'x-forwarded-for': '203.0.113.13' }, socket: {} }, res);
  assert.equal(res.statusCode, 401);

  const res2 = mockRes();
  await handler({
    method: 'GET',
    url: '/api/search?song=x',
    headers: { 'x-forwarded-for': '203.0.113.14', 'x-key': 'clave-interna-de-prueba' },
    socket: {},
  }, res2);
  assert.notEqual(res2.statusCode, 401);
});

/* ---------- sesión de administrador ---------- */
test('checkRequestOrigin permite el propio dominio del panel en producción', () => {
  resetEnv();
  process.env.NODE_ENV = 'production';
  const propio = { headers: { origin: 'https://playcase.vercel.app', host: 'playcase.vercel.app', 'x-forwarded-proto': 'https' } };
  assert.equal(requestOrigin(propio), 'https://playcase.vercel.app');
  assert.equal(checkRequestOrigin(propio).ok, true);

  const ajeno = { headers: { origin: 'https://malo.example.com', host: 'playcase.vercel.app', 'x-forwarded-proto': 'https' } };
  assert.equal(checkRequestOrigin(ajeno).ok, false);
});

test('la sesión de administrador se firma, caduca y detecta manipulación', () => {
  resetEnv();
  process.env.ACCESS_KEY = 'clave-admin-de-prueba';

  const token = createAdminSession();
  const payload = verifyAdminSessionToken(token);
  assert.ok(payload);
  assert.equal(payload.v, 1);
  assert.ok(payload.exp > payload.iat);

  const [body, firma] = token.split('.');
  assert.equal(verifyAdminSessionToken(body + '.' + firma.slice(0, -1) + 'x'), null);
  assert.equal(verifyAdminSessionToken(body + '.'), null);
  assert.equal(verifyAdminSessionToken(''), null);
  assert.equal(verifyAdminSessionToken(createAdminSession(Date.now() - 9 * 60 * 60 * 1000)), null);

  const cookie = sessionCookie(token);
  assert.match(cookie, /^playcase_admin=/);
  assert.match(cookie, /Path=\/api/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=28800/);
  assert.ok(!/Secure/.test(cookie));

  process.env.NODE_ENV = 'production';
  assert.match(sessionCookie(token), /; Secure/);
  assert.match(clearSessionCookie(), /Max-Age=0/);
  assert.match(clearSessionCookie(), /; Secure/);

  process.env.NODE_ENV = 'test';
  process.env.PLAYCASE_SESSION_SECRET = 'secreto-de-firma';
  const conSecreto = createAdminSession();
  assert.ok(verifyAdminSessionToken(conSecreto));
  process.env.PLAYCASE_SESSION_SECRET = 'otro-secreto';
  assert.equal(verifyAdminSessionToken(conSecreto), null);
});

test('/api/admin/login solo acepta la clave por cabecera y emite cookie segura', async () => {
  resetEnv();
  process.env.ACCESS_KEY = 'clave-admin-de-prueba';
  process.env.PLAYCASE_PUBLIC_API = 'true';
  const handler = require('../api/admin/login');

  const porUrl = mockRes();
  await handler({
    method: 'POST',
    url: '/api/admin/login?key=clave-admin-de-prueba',
    headers: { 'x-forwarded-for': '203.0.113.30' },
    socket: {},
  }, porUrl);
  assert.equal(porUrl.statusCode, 401);

  const incorrecta = mockRes();
  await handler({
    method: 'POST',
    url: '/api/admin/login',
    headers: { 'x-forwarded-for': '203.0.113.31', 'x-admin-key': 'otra-clave' },
    socket: {},
  }, incorrecta);
  assert.equal(incorrecta.statusCode, 401);

  const correcta = mockRes();
  await handler({
    method: 'POST',
    url: '/api/admin/login',
    headers: { 'x-forwarded-for': '203.0.113.32', 'x-admin-key': 'clave-admin-de-prueba' },
    socket: {},
  }, correcta);
  assert.equal(correcta.statusCode, 200);
  assert.equal(JSON.parse(correcta.body).ok, true);
  const cookie = correcta.headers['set-cookie'];
  assert.match(cookie, /playcase_admin=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api/);
});

test('un usuario público no accede al panel admin aunque la API sea pública', async () => {
  resetEnv();
  process.env.ACCESS_KEY = 'clave-admin-de-prueba';
  process.env.PLAYCASE_PUBLIC_API = 'true';

  const login = require('../api/admin/login');
  const session = require('../api/admin/session');
  const logout = require('../api/admin/logout');

  const sinSesion = mockRes();
  await session({
    method: 'GET',
    url: '/api/admin/session',
    headers: { 'x-forwarded-for': '203.0.113.40' },
    socket: {},
  }, sinSesion);
  assert.equal(sinSesion.statusCode, 401);

  const entrada = mockRes();
  await login({
    method: 'POST',
    url: '/api/admin/login',
    headers: { 'x-forwarded-for': '203.0.113.41', 'x-admin-key': 'clave-admin-de-prueba' },
    socket: {},
  }, entrada);
  assert.equal(entrada.statusCode, 200);
  const cookie = entrada.headers['set-cookie'].split(';')[0];

  const conSesion = mockRes();
  await session({
    method: 'GET',
    url: '/api/admin/session',
    headers: { cookie, 'x-forwarded-for': '203.0.113.42' },
    socket: {},
  }, conSesion);
  assert.equal(conSesion.statusCode, 200);
  const datos = JSON.parse(conSesion.body);
  assert.equal(datos.authenticated, true);
  assert.ok(datos.expiresAt > Date.now());

  const token = cookie.slice('playcase_admin='.length);
  const manipulado = 'playcase_admin=' + token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  const conCookieMala = mockRes();
  await session({
    method: 'GET',
    url: '/api/admin/session',
    headers: { cookie: manipulado, 'x-forwarded-for': '203.0.113.43' },
    socket: {},
  }, conCookieMala);
  assert.equal(conCookieMala.statusCode, 401);

  const salida = mockRes();
  await logout({
    method: 'POST',
    url: '/api/admin/logout',
    headers: { cookie, 'x-forwarded-for': '203.0.113.44' },
    socket: {},
  }, salida);
  assert.equal(salida.statusCode, 200);
  assert.match(salida.headers['set-cookie'], /Max-Age=0/);
});

test('sin clave configurada el login admin responde 503 (no queda abierto)', async () => {
  resetEnv();
  process.env.PLAYCASE_PUBLIC_API = 'true';
  const handler = require('../api/admin/login');
  const res = mockRes();
  await handler({
    method: 'POST',
    url: '/api/admin/login',
    headers: { 'x-forwarded-for': '203.0.113.45', 'x-admin-key': 'cualquiera' },
    socket: {},
  }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).disabled, true);
});

test('con API pública las APIs responden sin clave ni sesión', async () => {
  resetEnv();
  process.env.ACCESS_KEY = 'clave-admin-de-prueba';
  process.env.PLAYCASE_PUBLIC_API = 'true';

  const search = require('../api/search');
  const busqueda = mockRes();
  await search({
    method: 'GET',
    url: '/api/search?song=',
    headers: { 'x-forwarded-for': '203.0.113.46' },
    socket: {},
  }, busqueda);
  assert.equal(busqueda.statusCode, 400);
  assert.notEqual(busqueda.statusCode, 401);

  const img = require('../api/img');
  const imagen = mockRes();
  await img({
    method: 'GET',
    url: '/api/img?u=' + encodeURIComponent('http://127.0.0.1/secreto.png'),
    headers: { 'x-forwarded-for': '203.0.113.47' },
    socket: {},
  }, imagen);
  assert.equal(imagen.statusCode, 400);
  assert.notEqual(imagen.statusCode, 401);
});
