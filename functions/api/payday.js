// functions/api/payday.js

// Set this to the first Monday of your pay cycle.
// For "every other Monday starting today", set this once when you deploy.
const START_DATE_STRING = '2025-12-08'; // YYYY-MM-DD
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toMidnightUtc(date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
}

function parseDateYmd(ymd) {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateYmd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

export async function onRequest(context) {
  const now = new Date();
  const today = toMidnightUtc(now);
  const startDate = parseDateYmd(START_DATE_STRING);

  const diffDaysFromStart = daysBetween(startDate, today);
  const isOnOrAfterStart = diffDaysFromStart >= 0;

  let dateOfPayday;   // nearest payday, may be today
  let paydayAfter;    // the payday after that
  let isPayDay = false;

  if (!isOnOrAfterStart) {
    // Before schedule starts
    dateOfPayday = startDate;
    paydayAfter = new Date(startDate.getTime() + 14 * MS_PER_DAY);
  } else {
    // How many full 14-day cycles have passed since start
    const cyclesFromStart = Math.floor(diffDaysFromStart / 14);
    const currentCycleDate = new Date(
      startDate.getTime() + cyclesFromStart * 14 * MS_PER_DAY
    );

    // Today is exactly on a pay cycle if diffDaysFromStart is a multiple of 14
    const isCycleDay = diffDaysFromStart % 14 === 0;

    // Guarded by weekday in case you ever adjust START_DATE_STRING incorrectly
    isPayDay = isCycleDay && today.getUTCDay() === 1; // Monday

    if (isPayDay) {
      // Inclusive payday (may be today)
      dateOfPayday = today;
      // "Payday after" is the one 14 days later
      paydayAfter = new Date(today.getTime() + 14 * MS_PER_DAY);
    } else {
      // Next upcoming payday (strictly after today)
      dateOfPayday = new Date(
        currentCycleDate.getTime() + 14 * MS_PER_DAY
      );
      paydayAfter = new Date(
        dateOfPayday.getTime() + 14 * MS_PER_DAY
      );
    }
  }

  const payload = [
    {
      today: formatDateYmd(today),
      dateOfPayday: formatDateYmd(dateOfPayday), // may equal today
      paydayAfter: formatDateYmd(paydayAfter),   // always after dateOfPayday
      isPayDay
    }
  ];

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      // Browser cache control
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',

      // Hint to Cloudflare / intermediary caches
      'CDN-Cache-Control': 'no-store',

      'content-type': 'application/json; charset=utf-8'
    }
  });
}