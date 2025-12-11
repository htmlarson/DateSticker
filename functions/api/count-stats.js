// functions/api/count-stats.js
// Aggregates coin stats across snapshots for a store and date window.

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

function parseIsoDate(value) {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}$/);
  if (!match) return null;
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : value;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function clampDays(raw) {
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 30;
  return Math.min(parsed, 90);
}

const coinDenoms = ['q', 'd', 'n', 'p'];
const denomValueC = { q: 25, d: 10, n: 5, p: 1 };
const rollValueC = { q: 1000, d: 500, n: 200, p: 50 };

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.db) {
    return jsonResponse(500, { error: 'Database binding not configured.' });
  }

  const url = new URL(request.url);
  const storeNumber = url.searchParams.get('store');
  const daysParam = url.searchParams.get('days');
  const endParam = url.searchParams.get('end');

  if (!storeNumber || !/^\d{6}$/.test(storeNumber)) {
    return jsonResponse(400, { error: 'Missing or invalid store query parameter.' });
  }

  const endDateKey = parseIsoDate(endParam) || formatDate(new Date());
  const days = clampDays(daysParam);
  const start = new Date(endDateKey);
  start.setDate(start.getDate() - (days - 1));
  const startDateKey = formatDate(start);

  try {
    const availableRows = await env.db
      .prepare('SELECT snapshot_date FROM cash_snapshots WHERE store_id = ? ORDER BY snapshot_date')
      .bind(storeNumber)
      .all();
    const availableDates = availableRows.results?.map((row) => row.snapshot_date) || [];

    const statsRows = await env.db
      .prepare(
        `SELECT cs.snapshot_date as snapshot_date, l.denomination, SUM(l.qty) as loose_qty, SUM(l.rolled_qty) as rolled_qty
         FROM cash_snapshots cs
         JOIN cash_snapshot_lines l ON cs.id = l.snapshot_id
         WHERE cs.store_id = ?
           AND cs.snapshot_date BETWEEN ? AND ?
           AND l.type = 'coin'
           AND l.denomination IN ('q','d','n','p')
         GROUP BY cs.snapshot_date, l.denomination
         ORDER BY cs.snapshot_date`
      )
      .bind(storeNumber, startDateKey, endDateKey)
      .all();

    const byDate = {};
    for (const row of statsRows.results || []) {
      const loose = typeof row.loose_qty === 'number' ? row.loose_qty : 0;
      const rolled = typeof row.rolled_qty === 'number' ? row.rolled_qty : 0;
      const denom = row.denomination;
      const totalC = loose * denomValueC[denom] + rolled * rollValueC[denom];
      const coinsPerRoll = rollValueC[denom] / denomValueC[denom];
      const totalCoins = loose + rolled * coinsPerRoll;

      if (!byDate[row.snapshot_date]) {
        byDate[row.snapshot_date] = {};
      }
      byDate[row.snapshot_date][denom] = {
        coins: totalCoins,
        valueC: totalC
      };
    }

    const dateRange = [];
    const cursor = new Date(startDateKey);
    const endDate = new Date(endDateKey);
    while (cursor <= endDate) {
      dateRange.push(formatDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const timeseries = dateRange.map((date) => ({
      date,
      values: coinDenoms.reduce((acc, denom) => {
        const fallback = { coins: 0, valueC: 0 };
        acc[denom] = byDate[date]?.[denom] || fallback;
        return acc;
      }, {})
    }));

    const totals = coinDenoms.reduce((acc, denom) => {
      let coins = 0;
      let valueC = 0;
      timeseries.forEach((row) => {
        coins += row.values[denom].coins;
        valueC += row.values[denom].valueC;
      });
      acc[denom] = { coins, valueC };
      return acc;
    }, {});

    const averages = coinDenoms.reduce((acc, denom) => {
      let delta = 0;
      for (let i = 1; i < timeseries.length; i += 1) {
        delta += timeseries[i].values[denom].valueC - timeseries[i - 1].values[denom].valueC;
      }
      const avg = timeseries.length > 1 ? delta / (timeseries.length - 1) : 0;
      acc[denom] = { dailyChangeC: avg };
      return acc;
    }, {});

    return jsonResponse(200, {
      range: { start: startDateKey, end: endDateKey, days },
      availableDates,
      totals,
      timeseries,
      averages
    });
  } catch (err) {
    console.error('D1 stats query failed', err);
    return jsonResponse(500, { error: 'Unable to load stats.' });
  }
}
