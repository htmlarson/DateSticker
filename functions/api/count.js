// functions/api/count.js
// Persists change drawer counts keyed by date using Cloudflare KV.

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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const dateKey = url.searchParams.get('date');

  if (!dateKey) {
    return jsonResponse(400, { error: 'Missing date query parameter.' });
  }

  if (!env.KV) {
    return jsonResponse(500, { error: 'KV binding not configured.' });
  }

  if (request.method === 'GET') {
    try {
      const stored = await env.KV.get(dateKey, { type: 'json' });
      return jsonResponse(200, stored || null);
    } catch (err) {
      console.error('KV get failed', err);
      return jsonResponse(500, { error: 'Unable to read saved counts.' });
    }
  }

  if (request.method === 'PUT') {
    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return jsonResponse(400, { error: 'Invalid JSON body.' });
    }

    if (!payload || typeof payload.drawers !== 'object' || typeof payload.safe !== 'object') {
      return jsonResponse(400, { error: 'Body must include drawers and safe objects.' });
    }

    try {
      const updatedAt = new Date().toISOString();
      await env.KV.put(dateKey, JSON.stringify({
        drawers: payload.drawers,
        safe: payload.safe,
        updatedAt
      }));
      return jsonResponse(200, { ok: true, updatedAt });
    } catch (err) {
      console.error('KV put failed', err);
      return jsonResponse(500, { error: 'Unable to save counts.' });
    }
  }

  return new Response('Method Not Allowed', {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'GET, PUT' }
  });
}
