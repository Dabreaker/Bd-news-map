'use strict';
// ═══════════════════════════════════════════════════════════════
// api/index.js — Vercel serverless handler
// All routes proxy to phone storage server via tor2web gateway
// ═══════════════════════════════════════════════════════════════

const storage = require('./storage-client');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Cache-Control', 'no-store');
}
function send(res, status, data) {
  cors(res);
  res.status(status).json(data);
}

// Parse raw body into string
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Parse raw body as Buffer (for multipart passthrough)
function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url  = new URL(req.url, `https://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  const ct   = req.headers['content-type'] || '';

  // Parse JSON body once for non-multipart POST
  let body = {};
  if (req.method === 'POST' && ct.includes('application/json')) {
    try { body = JSON.parse(await readBody(req)); } catch {}
  }

  const auth = req.headers.authorization || '';

  try {

    // ── Health ───────────────────────────────────────────────
    if (path === '/health' && req.method === 'GET') {
      try {
        const h = await storage.getHealth();
        return send(res, 200, { vercel: true, storage: h });
      } catch (e) {
        return send(res, 503, { vercel: true, storage: null, error: e.message });
      }
    }

    // ── Register ─────────────────────────────────────────────
    if (path === '/register' && req.method === 'POST') {
      const r = await storage.register(body.username, body.password);
      return send(res, r.error ? 400 : 200, r);
    }

    // ── Login ────────────────────────────────────────────────
    if (path === '/login' && req.method === 'POST') {
      const r = await storage.login(body.username, body.password);
      return send(res, r.error ? 401 : 200, r);
    }

    // ── Map chunks ───────────────────────────────────────────
    if (path === '/news/chunks' && req.method === 'GET') {
      const chunks = url.searchParams.get('chunks') || '';
      if (!chunks) return send(res, 200, []);
      const data = await storage.getChunks(chunks);
      return send(res, 200, storage.rewriteMany(data));
    }

    // ── Map sub-chunks ───────────────────────────────────────
    if (path === '/news/subs' && req.method === 'GET') {
      const subs = url.searchParams.get('subs') || '';
      if (!subs) return send(res, 200, []);
      const data = await storage.getSubs(subs);
      return send(res, 200, storage.rewriteMany(data));
    }

    // ── Feed ─────────────────────────────────────────────────
    if (path === '/feed' && req.method === 'GET') {
      const lat = url.searchParams.get('lat');
      const lon = url.searchParams.get('lon');
      if (!lat || !lon) return send(res, 400, { error: 'lat,lon required' });
      const data = await storage.getFeed(lat, lon);
      return send(res, 200, storage.rewriteMany(data));
    }

    // ── News detail ──────────────────────────────────────────
    if (path.match(/^\/news\/[\w]+$/) && req.method === 'GET') {
      const id = path.split('/').pop();
      const data = await storage.getNews(id);
      if (!data) return send(res, 404, { error: 'সংবাদ পাওয়া যায়নি' });
      return send(res, 200, storage.rewriteImageUrls(data));
    }

    // ── Create news (multipart — stream raw buffer to phone) ─
    if (path === '/news' && req.method === 'POST') {
      if (!auth.startsWith('Bearer '))
        return send(res, 401, { error: 'No token' });
      if (!ct.includes('multipart/form-data'))
        return send(res, 400, { error: 'multipart/form-data required' });

      // Read the full body buffer then forward to phone storage
      const rawBody = await readBodyBuffer(req);
      const storageUrl = storage.makeUrl('/news');
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 30000);
      try {
        const r = await fetch(storageUrl, {
          method: 'POST',
          headers: {
            'Authorization': auth,
            'Content-Type': ct, // preserve boundary
            'Content-Length': rawBody.length,
          },
          body: rawBody,
          signal: controller.signal,
        });
        clearTimeout(t);
        const data = await r.json();
        return send(res, r.status, storage.rewriteImageUrls(data));
      } catch(e) {
        clearTimeout(t);
        throw e;
      }
    }

    // ── Delete news ──────────────────────────────────────────
    if (path.match(/^\/news\/[\w]+$/) && req.method === 'DELETE') {
      if (!auth.startsWith('Bearer '))
        return send(res, 401, { error: 'No token' });
      const id = path.split('/').pop();
      const data = await storage.deleteNews(id, auth.replace('Bearer ',''));
      return send(res, 200, data);
    }

    // ── Vote ─────────────────────────────────────────────────
    if (path === '/vote' && req.method === 'POST') {
      if (!auth.startsWith('Bearer '))
        return send(res, 401, { error: 'No token' });
      const data = await storage.castVote(body, auth.replace('Bearer ',''));
      return send(res, 200, data);
    }

    return send(res, 404, { error: 'Not found' });

  } catch (e) {
    console.error('[API]', path, e.message);
    if (e.name === 'AbortError' || e.message?.includes('fetch')) {
      return send(res, 503, {
        error: 'স্টোরেজ সার্ভার পাওয়া যাচ্ছে না। ফোনটি চালু ও Tor সক্রিয় আছে কিনা দেখুন।',
        detail: e.message,
      });
    }
    return send(res, 500, { error: 'Server error', detail: e.message });
  }
};
