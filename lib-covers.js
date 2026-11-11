/* Playcase · lógica de búsqueda de carátulas (compartida por el servidor local y las funciones de Vercel) */
const fs = require('fs');
const path = require('path');

const UA = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36' } };

/* hosts de los que SÍ permitimos descargar imágenes (lista blanca) */
const ART_HOSTS = /(\.mzstatic\.com|\.scdn\.co|\.dzcdn\.net|\.spotifycdn\.com)$/i;
function isArtHost(u) { try { return ART_HOSTS.test(new URL(u).hostname); } catch { return false; } }

function norm(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s*\(.*?\)\s*/g, ' ').trim(); }
const art1200 = u => u.replace('100x100bb', '1200x1200bb');

/* ---- búsqueda por nombre de canción y artista ---- */
async function itunesSearch(song, artist) {
  const term = [song, artist].filter(Boolean).join(' ');
  if (!term) return [];
  const r = await fetch('https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=song&limit=10&country=ES', UA);
  if (!r.ok) throw new Error('iTunes HTTP ' + r.status);
  const j = await r.json();
  const songs = (j.results || []).filter(it => it.wrapperType === 'track' && (!it.kind || it.kind === 'song'));
  const ns = norm(song);
  songs.sort((a, b) => {                      // primero coincidencia exacta de título, luego parcial, luego resto
    const ea = ns ? (norm(a.trackName) === ns ? 0 : norm(a.trackName).includes(ns) ? 1 : 2) : 2;
    const eb = ns ? (norm(b.trackName) === ns ? 0 : norm(b.trackName).includes(ns) ? 1 : 2) : 2;
    return ea - eb;
  });
  return songs.map(it => ({
    title: it.trackName, artist: it.artistName, album: it.collectionName || '',
    url: it.trackViewUrl, art: art1200(it.artworkUrl100),
    durationSeconds: it.trackTimeMillis ? Math.round(it.trackTimeMillis / 1000) : null,
  }));
}

async function deezerSearch(song, artist) {
  const q = [song, artist].filter(Boolean).join(' ');
  if (!q) return [];
  const r = await fetch('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=8', UA);
  const j = await r.json();
  return (j.data || []).filter(d => d.album && d.album.cover_xl).map(d => ({
    title: d.title, artist: d.artist && d.artist.name, album: d.album.title || '',
    url: d.link, art: d.album.cover_xl, durationSeconds: Number(d.duration) || null,
  }));
}

async function searchCovers(song, artist) {
  let results = [];
  try { results = await itunesSearch(song, artist); } catch (e) {}
  if (!results.length) { try { results = await deezerSearch(song, artist); } catch (e) {} }
  return results;
}

/* ---- credenciales de Spotify (opcionales, gratis) ---- */
async function spotifyCreds() {
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
    return { client_id: process.env.SPOTIFY_CLIENT_ID, client_secret: process.env.SPOTIFY_CLIENT_SECRET };
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'spotify-credentials.json'), 'utf8'));
    if (c.client_id && c.client_secret) return c;
  } catch (e) {}
  return null;
}

let spToken = null;
async function spotifyToken(creds) {
  if (spToken && spToken.exp > Date.now()) return spToken.t;
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(creds.client_id + ':' + creds.client_secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('Spotify token HTTP ' + r.status);
  const j = await r.json();
  spToken = { t: j.access_token, exp: Date.now() + ((j.expires_in || 3600) - 60) * 1000 };
  return spToken.t;
}

/* ---- resolución exacta por enlace ---- */
async function resolveApple(u) {
  const parts = u.pathname.split('/').filter(Boolean);   // [es, album|song, slug, id]
  let trackId = null;
  if (parts[1] === 'album') trackId = u.searchParams.get('i') || null;
  else if (parts[1] === 'song') trackId = parts[3] || null;
  if (!trackId) return { error: 'Ese enlace es de un álbum. Pega el enlace de la canción concreta (termina en ?i=…) o busca por nombre.' };
  const r = await fetch('https://itunes.apple.com/lookup?id=' + trackId, UA);
  const j = await r.json();
  const it = (j.results || []).find(x => x.wrapperType === 'track');
  if (!it) return { error: 'Apple no devolvió esa canción.' };
  return {
    title: it.trackName, artist: it.artistName, album: it.collectionName || '', art: art1200(it.artworkUrl100),
    durationSeconds: it.trackTimeMillis ? Math.round(it.trackTimeMillis / 1000) : null,
  };
}

async function resolveSpotify(u) {
  const m = u.pathname.match(/\/track\/([A-Za-z0-9]+)/) || u.pathname.match(/embed\/track\/([A-Za-z0-9]+)/) || [];
  if (!m[1]) return { error: 'No parece un enlace de canción de Spotify.' };
  const creds = await spotifyCreds();
  if (!creds) return {
    needsSetup: true,
    error: 'Para leer enlaces de Spotify hay que dar de alta (una sola vez, gratis) una app en developer.spotify.com y poner sus claves. Mientras tanto: busca por nombre o pega un enlace de Apple Music.',
  };
  const t = await spotifyToken(creds);
  const r = await fetch('https://api.spotify.com/v1/tracks/' + m[1], { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) return { error: 'Spotify HTTP ' + r.status };
  const j = await r.json();
  const title = j.name;
  const artist = (j.artists || []).map(a => a.name).join(', ');
  let art = null;
  try {                                            // preferimos la carátula a 1200px de iTunes
    const res = await itunesSearch(title, artist);
    const best = res.find(x => norm(x.title) === norm(title)) || res[0];
    if (best) art = best.art;
  } catch (e) {}
  if (!art) {                                      // si no, la de Spotify (640px ≈ 325 dpi, suficiente)
    const imgs = ((j.album || {}).images || []).sort((a, b) => (b.width || 0) - (a.width || 0));
    if (imgs[0]) art = imgs[0].url;
  }
  return {
    title, artist, album: (j.album || {}).name || '', art,
    durationSeconds: j.duration_ms ? Math.round(j.duration_ms / 1000) : null,
  };
}

async function resolveCovers(url) {
  let u;
  try { u = new URL(url); } catch { return { error: 'Enlace no válido.' }; }
  if (/music\.apple\.com$/i.test(u.hostname)) return resolveApple(u);
  if (/(open|embed)\.spotify\.com$/i.test(u.hostname) || u.protocol === 'spotify:') return resolveSpotify(u);
  return { error: 'Enlaces soportados: Spotify y Apple Music.' };
}

/* ---- control de acceso opcional (ACCESS_KEY) ---- */
function accessKey() {
  if (process.env.ACCESS_KEY) return process.env.ACCESS_KEY;
  try { return fs.readFileSync(path.join(__dirname, 'access-key.txt'), 'utf8').trim(); } catch (e) { return ''; }
}
function checkKey(req, url) {
  const key = accessKey();
  if (!key) return true;
  const given = (req.headers && req.headers['x-key']) || (url && url.searchParams.get('key')) || '';
  return given === key;
}

module.exports = { UA, isArtHost, norm, searchCovers, resolveCovers, spotifyCreds, checkKey, accessKey };
