// functions/api/cyclecount.js
// Persists quick inventory cycle counts to Cloudflare Workers KV.

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
  'CDN-Cache-Control': 'no-store'
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function normalizeStoreNumber(value) {
  return typeof value === 'string' && /^\d{6}$/.test(value) ? value : null;
}

function normalizeDate(value) {
  if (typeof value !== 'string') return null;
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(value);
  return match ? value : null;
}

function normalizeItems(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const normalized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof key !== 'string' || !key.trim()) continue;
    const qty = Number.isFinite(value) ? value : Number.parseInt(value, 10);
    if (!Number.isFinite(qty) || qty < 0) continue;
    normalized[key] = Math.trunc(qty);
  }
  return normalized;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const storeNumber = normalizeStoreNumber(url.searchParams.get('store'));
  const dateKey = normalizeDate(url.searchParams.get('date'));

  if (!storeNumber) {
    return jsonResponse(400, { error: 'Missing or invalid store query parameter.' });
  }

  if (!dateKey) {
    return jsonResponse(400, { error: 'Missing or invalid date query parameter.' });
  }

  if (!env.cyclecount) {
    return jsonResponse(500, { error: 'KV namespace binding "cyclecount" is not configured.' });
  }

  const kvKey = `cycle:${storeNumber}:${dateKey}`;

  if (request.method === 'GET') {
    try {
      const record = await env.cyclecount.get(kvKey, { type: 'json' });
      if (!record) {
        return jsonResponse(200, { items: {}, updatedAt: null });
      }

      return jsonResponse(200, {
        items: record.items || {},
        updatedAt: record.updatedAt || null
      });
    } catch (err) {
      console.error('KV read failed', err);
      return jsonResponse(500, { error: 'Unable to read saved counts.' });
    }
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return jsonResponse(400, { error: 'Invalid JSON body.' });
    }

    const normalizedItems = normalizeItems(payload?.items);
    if (!normalizedItems) {
      return jsonResponse(400, { error: 'Body must include an items object.' });
    }

    const updatedAt = new Date().toISOString();
    const record = { items: normalizedItems, updatedAt };

    try {
      await env.cyclecount.put(kvKey, JSON.stringify(record), {
        metadata: { store: storeNumber, date: dateKey, updatedAt }
      });
      return jsonResponse(200, { ok: true, updatedAt });
    } catch (err) {
      console.error('KV write failed', err);
      return jsonResponse(500, { error: 'Unable to save counts right now.' });
    }
  }

  return jsonResponse(405, { error: 'Method not allowed.' });
}
