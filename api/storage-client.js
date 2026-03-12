'use strict';
// ═══════════════════════════════════════════════════════════════
// storage-client.js
// Bridges Vercel → Phone storage server via tor2web gateway
//
// Your phone's .onion:  http://abc123.onion  (in db_link.txt)
// Tor2web gateway:      https://abc123.onion.ws
//
// How to set up:
//   1. Run setup-tor.sh on phone → get .onion URL
//   2. In Vercel dashboard → Settings → Environment Variables:
//      STORAGE_URL  = http://abc123.onion   (from db_link.txt)
//      WRITE_SECRET = same value as phone's .env WRITE_SECRET
// ═══════════════════════════════════════════════════════════════

const BASE   = (process.env.STORAGE_URL  || '').replace(/\/$/, '');
const SECRET = process.env.WRITE_SECRET  || '';

if (!BASE) console.warn('[Storage] STORAGE_URL not set');

// http://abc123.onion/path  →  https://abc123.onion.ws/path
function tor2web(url) {
  return url.replace(/^http:\/\/([^/]+\.onion)/, 'https://$1.ws');
}

// Build a full tor2web URL for a storage path
function makeUrl(path) {
  return tor2web(BASE + path);
}

async function go(url, opts = {}, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

async function getJSON(url) {
  const r = await go(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ── Exported functions ────────────────────────────────────────

function getHealth()           { return getJSON(makeUrl('/health')); }
function getChunks(chunks)     { return getJSON(makeUrl(`/news/chunks?chunks=${chunks}`)); }
function getSubs(subs)         { return getJSON(makeUrl(`/news/subs?subs=${subs}`)); }
function getFeed(lat, lon)     { return getJSON(makeUrl(`/feed?lat=${lat}&lon=${lon}`)); }

async function getNews(id) {
  const r = await go(makeUrl(`/news/${id}`));
  if (!r.ok) return null;
  return r.json();
}

async function register(username, password) {
  const r = await go(makeUrl('/auth/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return r.json();
}

async function login(username, password) {
  const r = await go(makeUrl('/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return r.json();
}

async function deleteNews(id, token) {
  const r = await go(makeUrl(`/news/${id}`), {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return r.json();
}

async function castVote(body, token) {
  const r = await go(makeUrl('/vote'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return r.json();
}

// Rewrite /files/... image paths to full tor2web URLs
// so images load in the browser without Tor
function rewriteImageUrls(obj) {
  if (!obj) return obj;
  const rw = u => (u && u.startsWith('/files/')) ? tor2web(BASE + u) : u;
  if (obj.thumb)              obj.thumb  = rw(obj.thumb);
  if (Array.isArray(obj.images)) obj.images = obj.images.map(rw);
  return obj;
}
function rewriteMany(arr) {
  return Array.isArray(arr) ? arr.map(rewriteImageUrls) : arr;
}

module.exports = {
  makeUrl, tor2web,
  getHealth, getChunks, getSubs, getFeed, getNews,
  register, login, deleteNews, castVote,
  rewriteImageUrls, rewriteMany,
};
