/* Playcase · lógica de búsqueda de carátulas (compartida por el servidor local y las funciones de Vercel) */
const fs = require('fs');
const path = require('path');
const { isArtHost, fetchUpstream, fetchJson, HttpError } = require('./lib-security');

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s*\(.*?\)\s*/g, ' ').trim();
}
const art1200 = u => u.replace('100x100bb', '1200x1200bb');

/* Solo devolvemos carátulas HTTPS de los hosts permitidos. */
function safeArt(raw, upscale) {
  if (!isArtHost(raw)) return null;
  const candidate = upscale ? art1200(raw) : raw;
  return isArtHost(candidate) ? candidate : null;
}

/* ---- búsqueda por nombre de canción y artista ---- */
async function itunesSearch(song, artist) {
  const term = [song, artist].filter(Boolean).join(' ');
  if (!term) return [];
  const j = await fetchJson('https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=song&limit=10&country=ES');
  const songs = (j.results || []).filter(it => it.wrapperType === 'track' && (!it.kind || it.kind === 'song'));
  const ns = norm(song);
  songs.sort((a, b) => {                      // primero coincidencia exacta de título, luego parcial, luego resto
    const ea = ns ? (norm(a.trackName) === ns ? 0 : norm(a.trackName).includes(ns) ? 1 : 2) : 2;
    const eb = ns ? (norm(b.trackName) === ns ? 0 : norm(b.trackName).includes(ns) ? 1 : 2) : 2;
    return ea - eb;
  });
  return songs.map(it => ({
    title: it.trackName, artist: it.artistName, album: it.collectionName || '',
    url: it.trackViewUrl, art: safeArt(it.artworkUrl100, true),
    durationSeconds: it.trackTimeMillis ? Math.round(it.trackTimeMillis / 1000) : null,
  })).filter(it => it.art);
}

async function deezerSearch(song, artist) {
  const q = [song, artist].filter(Boolean).join(' ');
  if (!q) return [];
  const j = await fetchJson('https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=8');
  return (j.data || []).filter(d => d.album && d.album.cover_xl).map(d => ({
    title: d.title, artist: d.artist && d.artist.name, album: d.album.title || '',
    url: d.link, art: safeArt(d.album.cover_xl, false), durationSeconds: Number(d.duration) || null,
  })).filter(it => it.art);
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
  const r = await fetchUpstream('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(creds.client_id + ':' + creds.client_secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new HttpError(502, 'Spotify no respondió.');
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
  if (!trackId || !/^\d{1,20}$/.test(trackId)) {
    return { error: 'Ese enlace es de un álbum. Pega el enlace de la canción concreta (termina en ?i=…) o busca por nombre.' };
  }
  const j = await fetchJson('https://itunes.apple.com/lookup?id=' + encodeURIComponent(trackId));
  const it = (j.results || []).find(x => x.wrapperType === 'track');
  if (!it) return { error: 'Apple no devolvió esa canción.' };
  const art = safeArt(it.artworkUrl100, true);
  if (!art) return { error: 'Apple no devolvió una carátula válida.' };
  return {
    title: it.trackName, artist: it.artistName, album: it.collectionName || '', art,
    durationSeconds: it.trackTimeMillis ? Math.round(it.trackTimeMillis / 1000) : null,
  };
}

async function resolveSpotify(u) {
  const m = u.pathname.match(/\/track\/([A-Za-z0-9]{10,40})/) || u.pathname.match(/embed\/track\/([A-Za-z0-9]{10,40})/) || [];
  if (!m[1]) return { error: 'No parece un enlace de canción de Spotify.' };
  const creds = await spotifyCreds();
  if (!creds) return {
    needsSetup: true,
    error: 'Para leer enlaces de Spotify hay que dar de alta (una sola vez, gratis) una app en developer.spotify.com y poner sus claves. Mientras tanto: busca por nombre o pega un enlace de Apple Music.',
  };
  const t = await spotifyToken(creds);
  const r = await fetchUpstream('https://api.spotify.com/v1/tracks/' + m[1], { headers: { Authorization: 'Bearer ' + t } });
  if (!r.ok) return { error: 'Spotify no devolvió esa canción.' };
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
    art = imgs.map(x => safeArt(x && x.url, false)).find(Boolean) || null;
  }
  return {
    title, artist, album: (j.album || {}).name || '', art,
    durationSeconds: j.duration_ms ? Math.round(j.duration_ms / 1000) : null,
  };
}

async function resolveCovers(url) {
  if (typeof url !== 'string' || !url || url.length > 2048) return { error: 'Enlace no válido.' };
  let u;
  try { u = new URL(url); } catch (e) { return { error: 'Enlace no válido.' }; }
  if (u.protocol !== 'https:') return { error: 'El enlace debe empezar por https://.' };
  if (u.username || u.password) return { error: 'Enlace no válido.' };
  const host = u.hostname.toLowerCase();
  if (host === 'music.apple.com' || host.endsWith('.music.apple.com')) return resolveApple(u);
  if (host === 'open.spotify.com' || host === 'embed.spotify.com' || host === 'play.spotify.com') return resolveSpotify(u);
  return { error: 'Enlaces soportados: Spotify y Apple Music.' };
}

module.exports = { norm, searchCovers, resolveCovers, spotifyCreds };
