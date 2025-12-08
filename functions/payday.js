// functions/payday.js

// Set this to the first Monday of your pay cycle.
// For "every other Monday starting today", set this once when you deploy.
const START_DATE_STRING = '2025-12-08'; // YYYY-MM-DD

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
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((b.getTime() - a.getTime()) / msPerDay);
}

// Cloudflare Pages Function entrypoint
export async function onRequest(context) {
  const now = new Date();
  const today = toMidnightUtc(now);
  const startDate = parseDateYmd(START_DATE_STRING);

  const diffDaysFromStart = daysBetween(startDate, today);
  const isOnOrAfterStart = diffDaysFromStart >= 0;

  const isEveryOtherMonday =
    diffDaysFromStart % 14 === 0 &&
    today.getUTCDay() === 1; // Monday = 1

  const isPayDay = isOnOrAfterStart && isEveryOtherMonday;

  let nextPayDate;
  if (!isOnOrAfterStart) {
    nextPayDate = startDate;
  } else {
    const remainder = diffDaysFromStart % 14;
    const daysUntilNext = remainder === 0 ? 0 : 14 - remainder;
    nextPayDate = new Date(
      today.getTime() + daysUntilNext * 24 * 60 * 60 * 1000
    );
  }

  const payload = [
    {
      today: formatDateYmd(today),
      nextPayDate: formatDateYmd(nextPayDate),
      isPayDay
    }
  ];

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });
}