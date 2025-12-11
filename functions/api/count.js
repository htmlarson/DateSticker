// functions/api/count.js
// Persists change drawer counts keyed by date using Cloudflare D1 (env.db).

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
  const storeNumber = url.searchParams.get('store');

  if (!dateKey) {
    return jsonResponse(400, { error: 'Missing date query parameter.' });
  }

  if (!storeNumber || !/^\d{6}$/.test(storeNumber)) {
    return jsonResponse(400, { error: 'Missing or invalid store query parameter.' });
  }

  if (!env.db) {
    return jsonResponse(500, { error: 'Database binding not configured.' });
  }

  const coinDenoms = ['q', 'd', 'n', 'p'];
  const billDenoms = ['1', '5', '10', '20', '50', '100', 'clip1'];

  if (request.method === 'GET') {
    try {
      const snapshot = await env.db
        .prepare(
          'SELECT id, updated_at FROM cash_snapshots WHERE store_id = ? AND snapshot_date = ?'
        )
        .bind(storeNumber, dateKey)
        .first();

      if (!snapshot) {
        return jsonResponse(200, null);
      }

      const lines = await env.db
        .prepare(
          'SELECT location, type, denomination, qty, rolled_qty FROM cash_snapshot_lines WHERE snapshot_id = ?'
        )
        .bind(snapshot.id)
        .all();

      const drawers = {};
      const safe = { coins: {}, bills: {} };

      for (const row of lines.results ?? []) {
        if (row.location.startsWith('drawer')) {
          const drawerNum = parseInt(row.location.replace('drawer', ''), 10);
          if (!drawers[drawerNum]) {
            drawers[drawerNum] = { coins: {}, bills: {} };
          }
          if (row.type === 'coin') {
            drawers[drawerNum].coins[row.denomination] = row.qty;
            drawers[drawerNum].coins[`${row.denomination}R`] = row.rolled_qty;
          } else if (row.type === 'bill') {
            drawers[drawerNum].bills[row.denomination] = row.qty;
          }
        } else if (row.location === 'safe') {
          if (row.type === 'coin') {
            safe.coins[row.denomination] = row.qty;
            safe.coins[`${row.denomination}R`] = row.rolled_qty;
          } else if (row.type === 'bill') {
            safe.bills[row.denomination] = row.qty;
          }
        }
      }

      return jsonResponse(200, {
        drawers,
        safe,
        updatedAt: snapshot.updated_at
      });
    } catch (err) {
      console.error('D1 read failed', err);
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

    if (!payload || typeof payload.drawers !== 'object' || typeof payload.safe !== 'object') {
      return jsonResponse(400, { error: 'Body must include drawers and safe objects.' });
    }

    let lastStep = 'parsing payload';
    let lastLineContext = null;

    try {
      const updatedAt = new Date().toISOString();
      lastStep = 'looking up existing snapshot';
      const existing = await env.db
        .prepare('SELECT id FROM cash_snapshots WHERE store_id = ? AND snapshot_date = ?')
        .bind(storeNumber, dateKey)
        .first();

      let snapshotId;
      if (existing?.id) {
        snapshotId = existing.id;
        lastStep = 'updating snapshot timestamp';
        await env.db
          .prepare('UPDATE cash_snapshots SET updated_at = ? WHERE id = ?')
          .bind(updatedAt, snapshotId)
          .run();

        lastStep = 'deleting existing snapshot lines';
        await env.db
          .prepare('DELETE FROM cash_snapshot_lines WHERE snapshot_id = ?')
          .bind(snapshotId)
          .run();
      } else {
        lastStep = 'inserting new snapshot row';
        const insertResult = await env.db
          .prepare('INSERT INTO cash_snapshots (store_id, snapshot_date, updated_at) VALUES (?, ?, ?)')
          .bind(storeNumber, dateKey, updatedAt)
          .run();
        snapshotId = insertResult.meta.last_row_id;
      }

      function asNonNegativeInt(value) {
        return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
      }

      async function addLine(location, type, denomination, qty, rolledQty) {
        const normalizedQty = asNonNegativeInt(qty);
        const normalizedRolled = asNonNegativeInt(rolledQty);
        try {
          lastStep = 'inserting snapshot line';
          lastLineContext = { location, type, denomination, normalizedQty, normalizedRolled };
          await env.db
            .prepare(
              'INSERT INTO cash_snapshot_lines (snapshot_id, location, type, denomination, qty, rolled_qty) VALUES (?, ?, ?, ?, ?, ?)'
            )
            .bind(snapshotId, location, type, denomination, normalizedQty, normalizedRolled)
            .run();
        } catch (err) {
          console.error('Failed to insert snapshot line', {
            location,
            type,
            denomination,
            normalizedQty,
            normalizedRolled,
            snapshotId,
            message: err?.message,
            stack: err?.stack
          });
          throw err;
        }
      }

      for (const drawerKey of Object.keys(payload.drawers)) {
        const drawer = payload.drawers[drawerKey] || {};
        const coins = drawer.coins || drawer;
        const bills = drawer.bills || drawer;
        const location = `drawer${drawerKey}`;

        for (const k of coinDenoms) {
          const qty = typeof coins[k] === 'number' ? coins[k] : 0;
          const rolled = typeof coins[`${k}R`] === 'number' ? coins[`${k}R`] : 0;
          await addLine(location, 'coin', k, qty, rolled);
        }

        for (const k of billDenoms) {
          const qty = typeof bills[k] === 'number' ? bills[k] : 0;
          await addLine(location, 'bill', k, qty, 0);
        }
      }

      const safeCoins = payload.safe?.coins || {};
      const safeBills = payload.safe?.bills || {};

      for (const k of coinDenoms) {
        const qty = typeof safeCoins[k] === 'number' ? safeCoins[k] : 0;
        const rolled = typeof safeCoins[`${k}R`] === 'number' ? safeCoins[`${k}R`] : 0;
        await addLine('safe', 'coin', k, qty, rolled);
      }

      for (const k of billDenoms) {
        const qty = typeof safeBills[k] === 'number' ? safeBills[k] : 0;
        await addLine('safe', 'bill', k, qty, 0);
      }
      return jsonResponse(200, { ok: true, updatedAt });
    } catch (err) {
      console.error('D1 write failed', { lastStep, lastLineContext, message: err?.message, stack: err?.stack });
      return jsonResponse(500, {
        error: 'Unable to save counts.',
        detail: lastStep,
        line: lastLineContext,
        message: err?.message
      });
    }
  }

  return new Response('Method Not Allowed', {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: 'GET, PUT, POST' }
  });
}
