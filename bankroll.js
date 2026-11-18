// Personal bankroll math. Money is integer cents, durations are integer minutes.

export const sessionNet = s => s.cashOut - s.buyIn;

/** Oldest first: by date (YYYY-MM-DD), then by when it was logged. */
export function sortSessions(sessions) {
  return [...sessions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
}

/**
 * Parse a duration into whole minutes. Accepts "3", "3.5", "3,5", "3:30", "0:45".
 * Returns null for empty or invalid input. Max 99 hours.
 */
export function parseDuration(input) {
  const s = String(input ?? '').trim().replace(',', '.');
  if (s === '') return null;
  let m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  m = /^(\d{0,2})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m || (m[1] === '' && m[2] === undefined)) return null;
  const hundredths = parseInt(m[1] || '0', 10) * 100 + parseInt((m[2] ?? '').padEnd(2, '0'), 10);
  return Math.round((hundredths * 60) / 100);
}

/** 210 → "3h 30m", 45 → "45m", 120 → "2h". */
export function formatDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h ? h + 'h' : '') + (h && m ? ' ' : '') + (m ? m + 'm' : '');
}

/** 210 → "3:30" for an input field. */
export function durationToInput(minutes) {
  if (!Number.isInteger(minutes) || minutes <= 0) return '';
  return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2, '0');
}

/**
 * Stats for a list of sessions. Every money value is integer cents.
 * hourly is null unless at least one session has a duration; it only counts sessions with one.
 */
export function computeStats(sessions, startCents = 0) {
  const sorted = sortSessions(sessions);
  const nets = sorted.map(sessionNet);
  const count = sorted.length;
  const profit = nets.reduce((a, b) => a + b, 0);
  const wins = nets.filter(n => n > 0).length;
  const losses = nets.filter(n => n < 0).length;
  const timed = sorted.filter(s => Number.isInteger(s.minutes) && s.minutes > 0);
  const minutes = timed.reduce((a, s) => a + s.minutes, 0);
  const timedProfit = timed.reduce((a, s) => a + sessionNet(s), 0);

  let running = startCents;
  const series = sorted.map(s => {
    running += sessionNet(s);
    return { id: s.id, date: s.date, net: sessionNet(s), value: running };
  });

  return {
    count,
    profit,
    bankroll: startCents + profit,
    wins,
    losses,
    winRate: count ? Math.round((wins * 100) / count) : null,
    avg: count ? Math.round(profit / count) : null,
    minutes,
    hourly: minutes ? Math.round((timedProfit * 60) / minutes) : null,
    best: count ? Math.max(...nets) : null,
    worst: count ? Math.min(...nets) : null,
    series,
  };
}
