// Money helpers. All amounts are integer cents. No floats, ever.

export const CURRENCIES = {
  usd: { symbol: '$', label: 'Dollars ($)' },
  eur: { symbol: '€', label: 'Euros (€)' },
  gbp: { symbol: '£', label: 'Pounds (£)' },
  chips: { symbol: '', label: 'Chips (no symbol)' },
};

const MAX_WHOLE_DIGITS = 9; // up to 999,999,999.99

/**
 * Parse user input into integer cents.
 * Accepts "20", "$20", "12.5", "12.50", "1,250", "1,250.75", "12,50" (decimal comma), "€ 20".
 * Returns null for anything invalid, negative, or with more than 2 decimals.
 */
export function parseMoney(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/[\s$€£ ]/g, '');
  if (s === '') return null;

  // Decimal comma: exactly one comma, no dot, 1–2 digits after it → treat as a decimal point.
  if (/^\d*,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.');
  } else if (s.includes(',')) {
    // Otherwise commas must be well-formed thousands separators.
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }

  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1];
  const frac = m[2] ?? '';
  if (whole === '' && frac === '') return null;
  const wholeTrim = whole.replace(/^0+(?=\d)/, '');
  if (wholeTrim.length > MAX_WHOLE_DIGITS) return null;

  return parseInt(wholeTrim || '0', 10) * 100 + parseInt(frac.padEnd(2, '0'), 10);
}

function groupThousands(digits) {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format integer cents for display.
 * Whole amounts drop the cents ("$20"); otherwise two decimals ("$12.50").
 * opts.sign: prefix "+" for positive amounts. Negative amounts always get "-" (U+2212 minus for display).
 */
export function formatMoney(cents, currency = 'usd', opts = {}) {
  if (!Number.isInteger(cents)) throw new TypeError('formatMoney expects integer cents, got ' + cents);
  const symbol = (CURRENCIES[currency] ?? CURRENCIES.usd).symbol;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  let body = groupThousands(String(whole));
  if (rest !== 0 || opts.forceCents) body += '.' + String(rest).padStart(2, '0');
  let sign = '';
  if (cents < 0) sign = opts.ascii ? '-' : '−';
  else if (cents > 0 && opts.sign) sign = '+';
  return sign + symbol + body;
}

/** Plain value for an input field: 2000 → "20", 1250 → "12.50". */
export function centsToInput(cents) {
  if (!Number.isInteger(cents)) return '';
  const whole = Math.floor(Math.abs(cents) / 100);
  const rest = Math.abs(cents) % 100;
  return (cents < 0 ? '-' : '') + whole + (rest ? '.' + String(rest).padStart(2, '0') : '');
}

/**
 * Who pays who, with few payments: repeatedly match the biggest debtor to the biggest winner.
 * entries: [{ id, name, net }] with net in integer cents (out − in). Nets must sum to 0.
 * Returns [{ from, to, amount }] using ids.
 */
export function settle(entries) {
  const total = entries.reduce((s, e) => s + e.net, 0);
  if (total !== 0) throw new Error('Nets must sum to zero (off by ' + total + ')');
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const debtors = entries.filter(e => e.net < 0).map(e => ({ ...e, left: -e.net }));
  const creditors = entries.filter(e => e.net > 0).map(e => ({ ...e, left: e.net }));
  const payments = [];
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.left - a.left || byName(a, b));
    creditors.sort((a, b) => b.left - a.left || byName(a, b));
    const d = debtors[0];
    const c = creditors[0];
    const amount = Math.min(d.left, c.left);
    payments.push({ from: d.id, to: c.id, amount });
    d.left -= amount;
    c.left -= amount;
    if (d.left === 0) debtors.shift();
    if (c.left === 0) creditors.shift();
  }
  return payments;
}
