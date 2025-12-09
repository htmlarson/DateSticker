// functions/api/sticker.js
// Returns sticker punch guidance as JSON based on the "last Sunday" logic
// used by the main sticker UI.

function getLastSunday(date) {
  const cloned = new Date(date.getTime());
  const day = cloned.getDay();
  cloned.setHours(0, 0, 0, 0);
  cloned.setDate(cloned.getDate() - day);
  return cloned;
}

function getFirstSundayOfMonth(year, month) {
  const d = new Date(year, month, 1);
  d.setHours(0, 0, 0, 0);
  while (d.getDay() !== 0) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function parseDateParam(url) {
  const params = new URL(url).searchParams;
  const dateParam = params.get('date');
  if (!dateParam) return null;

  const [y, m, d] = dateParam.split('-').map(Number);
  if ([y, m, d].some(Number.isNaN)) return null;

  const parsed = new Date(y, m - 1, d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function computeStickerInfo(effectiveDate) {
  const lastSunday = getLastSunday(effectiveDate);
  const monthIndex = lastSunday.getMonth();
  const year = lastSunday.getFullYear();

  const firstSunday = getFirstSundayOfMonth(year, monthIndex);
  const dayDiff = Math.max(0, lastSunday.getDate() - firstSunday.getDate());
  const rawWeek = Math.floor(dayDiff / 7);
  const week = Math.min(Math.max(rawWeek + 1, 1), 5);

  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ];

  const monthLetters = 'JFMAMJJASOND';

  return {
    month: monthNames[monthIndex],
    monthNumber: monthIndex + 1,
    monthLetter: monthLetters[monthIndex],
    year,
    week,
    lastSunday: formatYmd(lastSunday),
    evaluatedDate: formatYmd(effectiveDate)
  };
}

export async function onRequest(context) {
  const effectiveDate = parseDateParam(context.request.url) || new Date();
  const payload = computeStickerInfo(effectiveDate);

  const responseBody = {
    answer: [payload.monthLetter, payload.week],
    factors: payload
  };

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'CDN-Cache-Control': 'no-store',
      'content-type': 'application/json; charset=utf-8'
    }
  });
}
