import { CURRENCIES, parseMoney, formatMoney, centsToInput, settle } from './money.js';
import { computeStats, sortSessions, sessionNet, parseDuration, formatDuration, durationToInput } from './bankroll.js';

/* =========================================================
   Storage (localStorage, never throws)
   ========================================================= */
const STORAGE_KEY = 'stack.v1';

function emptyState() {
  return { version: 1, games: [], settings: { autoFirstBuyIn: true, lastBuyIn: 2000, lastCurrency: 'usd' }, bankroll: emptyBankroll() };
}

function emptyBankroll(currency = 'usd') {
  return { start: 0, currency, sessions: [], pin: null };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw)) ?? emptyState();
  } catch (e) {
    console.warn('Could not load saved data', e);
    return emptyState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save', e);
    toast('Couldn’t save on this device (storage full or blocked).');
  }
}

const isCents = v => Number.isInteger(v) && v >= 0;

/** Validate & clean a state object (used for load and restore). Returns null if unusable. */
function normalizeState(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.games)) return null;
  const base = emptyState();
  const s = input.settings && typeof input.settings === 'object' ? input.settings : {};
  const settings = {
    autoFirstBuyIn: s.autoFirstBuyIn !== false,
    lastBuyIn: isCents(s.lastBuyIn) && s.lastBuyIn > 0 ? s.lastBuyIn : base.settings.lastBuyIn,
    lastCurrency: CURRENCIES[s.lastCurrency] ? s.lastCurrency : 'usd',
  };
  const games = [];
  for (const g of input.games) {
    if (!g || typeof g !== 'object' || typeof g.id !== 'string') continue;
    const players = [];
    for (const p of Array.isArray(g.players) ? g.players : []) {
      if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') continue;
      players.push({
        id: p.id,
        name: p.name.slice(0, 40),
        buyIns: (Array.isArray(p.buyIns) ? p.buyIns : [])
          .filter(b => b && typeof b.id === 'string' && isCents(b.amount) && b.amount > 0)
          .map(b => ({ id: b.id, amount: b.amount, at: Number(b.at) || Date.now() })),
        cashOut: isCents(p.cashOut) ? p.cashOut : null,
      });
    }
    games.push({
      id: g.id,
      name: typeof g.name === 'string' && g.name.trim() ? g.name.slice(0, 60) : 'Game',
      buyIn: isCents(g.buyIn) && g.buyIn > 0 ? g.buyIn : 2000,
      currency: CURRENCIES[g.currency] ? g.currency : 'usd',
      createdAt: Number(g.createdAt) || Date.now(),
      finishedAt: Number(g.finishedAt) || null,
      status: g.status === 'done' ? 'done' : 'live',
      settleMode: g.settleMode === 'p2p' ? 'p2p' : 'bank',
      players,
    });
  }
  return { version: 1, games, settings, bankroll: normalizeBankroll(input.bankroll, settings.lastCurrency) };
}

const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function normalizeBankroll(b, fallbackCurrency = 'usd') {
  if (!b || typeof b !== 'object') return emptyBankroll(fallbackCurrency);
  const pin = b.pin && typeof b.pin.salt === 'string' && typeof b.pin.hash === 'string' ? { salt: b.pin.salt, hash: b.pin.hash } : null;
  return {
    start: isCents(b.start) ? b.start : 0,
    currency: CURRENCIES[b.currency] ? b.currency : fallbackCurrency,
    pin,
    sessions: (Array.isArray(b.sessions) ? b.sessions : [])
      .filter(x => x && typeof x.id === 'string' && isDay(x.date) && isCents(x.buyIn) && isCents(x.cashOut))
      .map(x => ({
        id: x.id,
        date: x.date,
        createdAt: Number(x.createdAt) || 0,
        buyIn: x.buyIn,
        cashOut: x.cashOut,
        minutes: Number.isInteger(x.minutes) && x.minutes > 0 ? x.minutes : null,
        where: typeof x.where === 'string' ? x.where.slice(0, 60) : '',
        notes: typeof x.notes === 'string' ? x.notes.slice(0, 500) : '',
        gameId: typeof x.gameId === 'string' ? x.gameId : null,
      })),
  };
}

let state = loadState();

/* =========================================================
   Helpers
   ========================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sumBuyIns = p => p.buyIns.reduce((s, b) => s + b.amount, 0);
const potOf = g => g.players.reduce((s, p) => s + sumBuyIns(p), 0);
const buyInCount = g => g.players.reduce((s, p) => s + p.buyIns.length, 0);
const money = (g, cents, opts) => formatMoney(cents, g.currency, opts);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const initial = name => (name.trim()[0] || '?').toUpperCase();
const getGame = id => state.games.find(g => g.id === id);
const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = ts => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const defaultGameName = () => 'Game night · ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const normName = s => s.trim().replace(/\s+/g, ' ');
const nameTaken = (g, name, exceptId) => g.players.some(p => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase());
const haptic = () => { try { navigator.vibrate && navigator.vibrate(10); } catch (e) { /* ignore */ } };

const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  chip: '<svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="27" stroke="#e8c37e" stroke-width="5" stroke-dasharray="10.6 6.4"/><circle cx="32" cy="32" r="19" stroke="#e8c37e" stroke-opacity=".45" stroke-width="1.5"/></svg>',
};

/* =========================================================
   Mutations with undo
   ========================================================= */
function commit(mutator, undoMessage) {
  const snapshot = JSON.stringify(state);
  mutator();
  saveState();
  render();
  refreshSheet();
  if (undoMessage) {
    toast(undoMessage, () => {
      state = normalizeState(JSON.parse(snapshot)) ?? state;
      saveState();
      render();
      refreshSheet();
    });
  }
}

function addBuyIn(game, player, amount) {
  commit(() => {
    player.buyIns.push({ id: uid(), amount, at: Date.now() });
  }, `${money(game, amount)} buy-in for ${player.name}`);
  haptic();
}

/* =========================================================
   Router (hash based so the Android back button works)
   ========================================================= */
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'g' && parts[1]) return { name: parts[2] === 'cash' ? 'cash' : 'game', id: parts[1] };
  if (parts[0] === 'me') return { name: 'me' };
  return { name: 'home' };
}
function go(hash) {
  if (location.hash === hash || (hash === '#' && !location.hash)) render();
  else location.hash = hash;
}
window.addEventListener('hashchange', () => {
  closeSheet(true);
  render();
  window.scrollTo(0, 0);
});

/* =========================================================
   Rendering
   ========================================================= */
const view = $('#view');

function render() {
  const r = route();
  if (r.name === 'me') return renderBankroll();
  const game = r.id ? getGame(r.id) : null;
  if (r.name !== 'home' && !game) {
    history.replaceState(null, '', location.pathname + location.search);
    return renderHome();
  }
  if (r.name === 'game') return renderGame(game);
  if (r.name === 'cash') return renderCash(game);
  return renderHome();
}

function actionbar(html) {
  return `<div class="actionbar"><div class="inner">${html}</div></div>`;
}

/* ---------- Home ---------- */
function renderHome() {
  document.title = 'Stack';
  const live = state.games.filter(g => g.status === 'live').sort((a, b) => b.createdAt - a.createdAt);
  const past = state.games.filter(g => g.status === 'done').sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt));
  const row = g => `
    <div class="card game-row">
      <button class="main" data-open="${esc(g.id)}">
        <div class="name">${g.status === 'live' ? '<span class="live-dot"></span>' : ''}${esc(g.name)}</div>
        <div class="meta">${esc(fmtDate(g.createdAt))} · ${plural(g.players.length, 'player')}</div>
      </button>
      <span class="pot money">${esc(money(g, potOf(g)))}</span>
      <button class="icon-btn" data-game-menu="${esc(g.id)}" aria-label="More options for ${esc(g.name)}">${ICON.more}</button>
    </div>`;

  view.innerHTML = `
    <header class="brand">
      <span class="chip-mark">${ICON.chip}</span>
      <h1>Stack</h1>
      <button class="icon-btn" id="open-settings" aria-label="Settings">${ICON.gear}</button>
    </header>
    ${bankrollCard()}
    ${state.games.length === 0 ? `
      <div class="empty">
        <div class="art">${ICON.chip}</div>
        <h3>No games yet</h3>
        <p>Start a game, add your players, and tap to log every buy-in. Stack does the math at the end.</p>
      </div>` : ''}
    ${live.length ? `<div class="section-h"><h2>Live</h2><span>${live.length}</span></div><div class="list">${live.map(row).join('')}</div>` : ''}
    ${past.length ? `<div class="section-h"><h2>Past games</h2><span>${past.length}</span></div><div class="list">${past.map(row).join('')}</div>` : ''}
    ${actionbar(`<button class="btn btn-primary" id="new-game">${ICON.plus} New game</button>`)}
  `;

  $('#new-game').onclick = () => openNewGameSheet();
  $('#open-settings').onclick = () => openSettingsSheet();
  $('#open-me').onclick = () => go('#/me');
  view.querySelectorAll('[data-open]').forEach(b => {
    b.onclick = () => {
      const g = getGame(b.dataset.open);
      go(g.status === 'done' ? `#/g/${g.id}/cash` : `#/g/${g.id}`);
    };
  });
  view.querySelectorAll('[data-game-menu]').forEach(b => (b.onclick = () => openGameMenu(getGame(b.dataset.gameMenu))));
}

/* ---------- Game ---------- */
function renderGame(game) {
  document.title = game.name + ' · Stack';
  const pot = potOf(game);
  const players = game.players;
  view.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back" aria-label="Back to games">${ICON.back}</button>
      <div class="title">${esc(game.name)}</div>
      <button class="icon-btn" id="game-menu" aria-label="Game options">${ICON.more}</button>
    </div>
    <div class="hero">
      <div class="label">Total pot</div>
      <div class="big" id="pot">${esc(money(game, pot))}</div>
    </div>
    <div class="stats">
      <div class="stat"><b id="stat-players">${players.length}</b><span>${players.length === 1 ? 'player' : 'players'}</span></div>
      <div class="stat"><b id="stat-buyins">${buyInCount(game)}</b><span>buy-ins</span></div>
      <div class="stat"><b class="money">${esc(money(game, game.buyIn))}</b><span>buy-in</span></div>
    </div>
    ${players.length === 0 ? `
      <div class="empty">
        <h3>Who’s playing?</h3>
        <p>Add everyone at the table. Each player gets a big button for rebuys.</p>
      </div>` : `
      <div class="section-h"><h2>Players</h2><span>Tap a name for details</span></div>
      <div class="list">
        ${players.map(p => {
          const total = sumBuyIns(p);
          return `
          <div class="card player-row" data-player-row="${esc(p.id)}">
            <button class="main" data-player="${esc(p.id)}">
              <span class="avatar">${esc(initial(p.name))}</span>
              <span style="min-width:0">
                <div class="name">${esc(p.name)}</div>
                <div class="meta money">${esc(money(game, total))} · ${plural(p.buyIns.length, 'buy-in')}</div>
              </span>
            </button>
            <button class="rebuy" data-rebuy="${esc(p.id)}" aria-label="Add ${esc(money(game, game.buyIn))} for ${esc(p.name)}">+${esc(money(game, game.buyIn))}</button>
          </div>`;
        }).join('')}
      </div>`}
    ${actionbar(`
      <button class="btn btn-secondary" id="add-player">${ICON.plus} Player</button>
      <button class="btn btn-primary" id="cash-out" ${players.length ? '' : 'disabled'}>Cash out</button>`)}
  `;
  $('#back').onclick = () => go('#');
  $('#game-menu').onclick = () => openGameMenu(game);
  $('#add-player').onclick = () => openAddPlayerSheet(game);
  $('#cash-out').onclick = () => go(`#/g/${game.id}/cash`);
  view.querySelectorAll('[data-rebuy]').forEach(b => {
    b.onclick = () => addBuyIn(game, game.players.find(p => p.id === b.dataset.rebuy), game.buyIn);
  });
  view.querySelectorAll('[data-player]').forEach(b => {
    b.onclick = () => openPlayerSheet(game, b.dataset.player);
  });
}

/* ---------- Cash out ---------- */
function cashStatus(game) {
  const pot = potOf(game);
  const left = game.players.filter(p => p.cashOut === null).length;
  const out = game.players.reduce((s, p) => s + (p.cashOut ?? 0), 0);
  if (left > 0) return { kind: 'left', left, out, pot };
  if (out !== pot) return { kind: 'off', diff: out - pot, out, pot };
  return { kind: 'ok', out, pot };
}

function netsOf(game) {
  return game.players.map(p => ({ id: p.id, name: p.name, net: (p.cashOut ?? 0) - sumBuyIns(p) }));
}

function renderCash(game) {
  document.title = 'Cash out · ' + game.name;
  const sym = CURRENCIES[game.currency].symbol;
  const done = game.status === 'done';
  view.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button>
      <div class="title">${done ? 'Results' : 'Cash out'}</div>
      <button class="icon-btn" id="game-menu" aria-label="Game options">${ICON.more}</button>
    </div>
    <div class="hero" style="padding-bottom:12px">
      <div class="label">${esc(game.name)}</div>
      <div class="big">${esc(money(game, potOf(game)))}</div>
      <div class="label" style="text-transform:none;letter-spacing:0;font-weight:600">in the pot</div>
    </div>
    <div id="cash-status"></div>
    <div class="section-h"><h2>Final chips</h2><span>Bought in · Net</span></div>
    <div class="list">
      ${game.players.map(p => `
        <div class="card cash-row">
          <div class="who">
            <div class="name">${esc(p.name)}</div>
            <div class="meta money">in ${esc(money(game, sumBuyIns(p)))} · <span class="net" data-net="${esc(p.id)}"></span></div>
          </div>
          <label class="money-input ${sym ? '' : 'nosym'}">
            ${sym ? `<span class="sym">${esc(sym)}</span>` : ''}
            <input inputmode="decimal" autocomplete="off" enterkeyhint="next" placeholder="0" aria-label="Final chips for ${esc(p.name)}"
              data-cash="${esc(p.id)}" value="${p.cashOut === null ? '' : esc(centsToInput(p.cashOut))}">
          </label>
        </div>`).join('')}
    </div>
    <div id="payments"></div>
    <p class="footnote">Stack never moves money. It only does the math — settle up however your group pays.</p>
    ${actionbar(done
      ? `<button class="btn btn-secondary" id="reopen">Reopen</button><button class="btn btn-primary" id="share">${ICON.share} Share</button>`
      : `<button class="btn btn-secondary narrow" id="share" aria-label="Share summary">${ICON.share}</button><button class="btn btn-primary" id="finish">Finish game</button>`)}
  `;

  $('#back').onclick = () => go(done ? '#' : `#/g/${game.id}`);
  $('#game-menu').onclick = () => openGameMenu(game);
  $('#share').onclick = () => shareSummary(game);
  if (done) {
    $('#reopen').onclick = () => {
      commit(() => { game.status = 'live'; game.finishedAt = null; });
      go(`#/g/${game.id}`);
    };
  } else {
    $('#finish').onclick = () => {
      if (cashStatus(game).kind !== 'ok') return;
      commit(() => { game.status = 'done'; game.finishedAt = Date.now(); });
      toast('Game finished and saved to past games.');
      render();
    };
  }

  const inputs = [...view.querySelectorAll('[data-cash]')];
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      const p = game.players.find(x => x.id === inp.dataset.cash);
      const raw = inp.value.trim();
      const v = raw === '' ? null : parseMoney(raw);
      inp.setAttribute('aria-invalid', raw !== '' && v === null ? 'true' : 'false');
      inp.style.borderColor = raw !== '' && v === null ? 'var(--coral)' : '';
      p.cashOut = v;
      saveState();
      updateCashDerived(game);
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (inputs[i + 1]) inputs[i + 1].focus(); else inp.blur();
      }
    });
    inp.addEventListener('focus', () => inp.select());
  });
  updateCashDerived(game);
}

function updateCashDerived(game) {
  const st = cashStatus(game);
  const box = $('#cash-status');
  if (!box) return;
  if (st.kind === 'left') {
    box.innerHTML = `<div class="status" role="status">${plural(st.left, 'player')} left to count</div>`;
  } else if (st.kind === 'off') {
    box.innerHTML = `<div class="status off" role="status">Off by ${esc(money(game, Math.abs(st.diff)))}
      <small>· ${st.diff > 0 ? 'too many chips counted' : 'chips missing'}</small></div>`;
  } else {
    box.innerHTML = `<div class="status ok" role="status">✓ Balanced</div>`;
  }

  for (const n of netsOf(game)) {
    const el = view.querySelector(`[data-net="${CSS.escape(n.id)}"]`);
    if (!el) continue;
    const p = game.players.find(x => x.id === n.id);
    if (p.cashOut === null) { el.textContent = '—'; el.className = 'net zero'; continue; }
    el.textContent = n.net === 0 ? 'even' : money(game, n.net, { sign: true });
    el.className = 'net ' + (n.net > 0 ? 'pos' : n.net < 0 ? 'neg' : 'zero');
  }

  const pay = $('#payments');
  const finish = $('#finish');
  if (finish) finish.disabled = st.kind !== 'ok';
  if (st.kind !== 'ok') { pay.innerHTML = ''; return; }
  const mode = game.settleMode === 'p2p' ? 'p2p' : 'bank';
  const modeToggle = `
    <div class="seg seg-2" role="group" aria-label="How to settle" style="margin-top:22px">
      <button type="button" data-mode="bank" aria-pressed="${mode === 'bank'}">Bank pays out</button>
      <button type="button" data-mode="p2p" aria-pressed="${mode === 'p2p'}">Player to player</button>
    </div>`;
  const wireToggle = () => pay.querySelectorAll('[data-mode]').forEach(b => {
    b.onclick = () => { game.settleMode = b.dataset.mode; saveState(); updateCashDerived(game); };
  });
  if (mode === 'bank') {
    const payouts = bankPayouts(game);
    pay.innerHTML = `${modeToggle}
      <div class="section-h"><h2>Bank pays out</h2><span>${esc(money(game, st.out))} total</span></div>
      ${payouts.length === 0 ? `<div class="card pay-row"><div class="names">Nobody has chips left. The bank keeps the pot.</div></div>` : `
      <div class="list">${payouts.map(p => {
        const net = p.cashOut - sumBuyIns(p);
        return `
        <div class="card pay-row">
          <div class="names">${esc(p.name)}
            <div class="meta money" style="font-weight:600;font-size:14px;color:var(--muted)">in ${esc(money(game, sumBuyIns(p)))} · <span class="net ${net > 0 ? 'pos' : net < 0 ? 'neg' : 'zero'}">${net === 0 ? 'even' : esc(money(game, net, { sign: true }))}</span></div>
          </div>
          <div class="amt">${esc(money(game, p.cashOut))}</div>
        </div>`;
      }).join('')}</div>`}
      ${game.players.some(p => p.cashOut === 0) ? `<p class="hint" style="text-align:center;margin-top:10px">Players with no chips left get nothing back.</p>` : ''}`;
    wireToggle();
    return;
  }
  const payments = settle(netsOf(game));
  const name = id => game.players.find(p => p.id === id)?.name ?? '?';
  pay.innerHTML = `${modeToggle}
    <div class="section-h"><h2>Who pays who</h2><span>${plural(payments.length, 'payment')}</span></div>
    ${payments.length === 0 ? `<div class="card pay-row"><div class="names">Everyone broke even. No payments needed.</div></div>` : `
    <div class="list">${payments.map(x => `
      <div class="card pay-row">
        <div class="names"><span class="neg">${esc(name(x.from))}</span><span class="arrow">pays</span><span class="pos">${esc(name(x.to))}</span></div>
        <div class="amt">${esc(money(game, x.amount))}</div>
      </div>`).join('')}
    </div>`}`;
  wireToggle();
}

/** Bank model: everyone paid the banker up front; at the end the bank pays each player their chips. */
function bankPayouts(game) {
  return game.players
    .filter(p => (p.cashOut ?? 0) > 0)
    .sort((a, b) => b.cashOut - a.cashOut || a.name.localeCompare(b.name));
}

/* ---------- Share ---------- */
function summaryText(game) {
  const ascii = { ascii: true };
  const lines = [game.name, `Pot: ${money(game, potOf(game), ascii)} · ${plural(game.players.length, 'player')} · ${plural(buyInCount(game), 'buy-in')}`, ''];
  const nets = netsOf(game).sort((a, b) => b.net - a.net);
  for (const n of nets) {
    const p = game.players.find(x => x.id === n.id);
    const outStr = p.cashOut === null ? '?' : money(game, p.cashOut, ascii);
    const netStr = p.cashOut === null ? '?' : n.net === 0 ? 'even' : money(game, n.net, { sign: true, ascii: true });
    lines.push(`${p.name}: in ${money(game, sumBuyIns(p), ascii)}, out ${outStr}, net ${netStr}`);
  }
  const st = cashStatus(game);
  lines.push('');
  if (st.kind === 'ok' && game.settleMode !== 'p2p') {
    const payouts = bankPayouts(game);
    if (payouts.length) {
      lines.push('Bank pays out:');
      for (const p of payouts) lines.push(`${p.name}: ${money(game, p.cashOut, ascii)}`);
    } else lines.push('Nobody has chips left. The bank keeps the pot.');
  } else if (st.kind === 'ok') {
    const payments = settle(netsOf(game));
    const name = id => game.players.find(p => p.id === id).name;
    if (payments.length) {
      lines.push('Payments:');
      for (const x of payments) lines.push(`${name(x.from)} → ${name(x.to)}: ${money(game, x.amount, ascii)}`);
    } else lines.push('Everyone broke even.');
  } else if (st.kind === 'off') {
    lines.push(`Not balanced yet (off by ${money(game, Math.abs(st.diff), ascii)}).`);
  } else {
    lines.push(`Not balanced yet (${plural(st.left, 'player')} left to count).`);
  }
  lines.push('', 'Tracked with Stack. It only calculates; no money was moved.');
  return lines.join('\n');
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

async function shareSummary(game) {
  const text = summaryText(game);
  if (navigator.share) {
    try {
      await navigator.share({ title: game.name, text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user closed the share sheet
    }
  }
  if (await copyText(text)) toast('Summary copied to clipboard');
  else openTextSheet('Summary', 'Copy this and paste it into your group chat.', text);
}

/* =========================================================
   Sheets
   ========================================================= */
let currentSheet = null; // { el, backdrop, render }

function openSheet(renderFn) {
  closeSheet(true);
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const el = document.createElement('div');
  el.className = 'sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const root = $('#sheet-root');
  root.append(backdrop, el);
  currentSheet = { el, backdrop, render: renderFn };
  backdrop.onclick = () => closeSheet();
  renderFn(el);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.classList.add('open');
    backdrop.classList.add('open');
  }));
  return el;
}

function closeSheet(immediate = false) {
  if (!currentSheet) return;
  const { el, backdrop } = currentSheet;
  currentSheet = null;
  document.body.classList.remove('sheet-open');
  if (immediate) { el.remove(); backdrop.remove(); return; }
  el.classList.remove('open');
  backdrop.classList.remove('open');
  setTimeout(() => { el.remove(); backdrop.remove(); }, 280);
}

function refreshSheet() {
  if (currentSheet && currentSheet.render.refresh) currentSheet.render(currentSheet.el);
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function sheetHead(title) {
  return `<div class="grabber"></div><div class="sheet-head"><h2>${esc(title)}</h2>
    <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>`;
}
function wireClose(el) {
  el.querySelectorAll('[data-close]').forEach(b => (b.onclick = () => closeSheet()));
}

function moneyField(id, label, value, currency, hint = '') {
  const sym = CURRENCIES[currency].symbol;
  return `<label class="field"><span>${esc(label)}</span>
    <div class="money-input ${sym ? '' : 'nosym'}" style="width:100%">
      ${sym ? `<span class="sym">${esc(sym)}</span>` : ''}
      <input id="${id}" inputmode="decimal" autocomplete="off" value="${esc(value)}" placeholder="0">
    </div>
    ${hint ? `<div class="hint">${hint}</div>` : ''}
    <div class="error" id="${id}-err"></div></label>`;
}

/* ---------- Confirm ---------- */
function confirmSheet({ title, body, confirm = 'Delete', danger = true, onConfirm }) {
  openSheet(el => {
    el.innerHTML = `${sheetHead(title)}<p class="lead">${body}</p>
      <div class="stack">
        <button class="btn btn-block ${danger ? 'btn-danger' : 'btn-primary'}" id="confirm-yes">${esc(confirm)}</button>
        <button class="btn btn-block btn-secondary" data-close>Cancel</button>
      </div>`;
    wireClose(el);
    $('#confirm-yes', el).onclick = () => { closeSheet(true); onConfirm(); };
  });
}

/* ---------- Text (fallback copy) ---------- */
function openTextSheet(title, lead, text) {
  openSheet(el => {
    el.innerHTML = `${sheetHead(title)}<p class="lead">${esc(lead)}</p>
      <textarea class="input" readonly>${esc(text)}</textarea>
      <div class="stack" style="margin-top:12px"><button class="btn btn-block btn-secondary" data-close>Done</button></div>`;
    wireClose(el);
    const ta = $('textarea', el);
    ta.focus(); ta.select();
  });
}

/* ---------- New / edit game ---------- */
function gameForm(el, { title, name, buyIn, currency, submit }, onSubmit) {
  let cur = currency;
  el.innerHTML = `${sheetHead(title)}
    <form id="game-form" novalidate>
      <label class="field"><span>Name</span><input class="input" id="g-name" maxlength="60" value="${esc(name)}" autocomplete="off"></label>
      <div class="field"><span>Currency</span>
        <div class="seg" role="group" aria-label="Currency">
          ${Object.entries(CURRENCIES).map(([k, c]) => `<button type="button" data-cur="${k}" aria-pressed="${k === cur}" aria-label="${esc(c.label)}">${c.symbol || 'Chips'}</button>`).join('')}
        </div>
      </div>
      <div id="buyin-wrap">${moneyField('g-buyin', 'Standard buy-in', centsToInput(buyIn), cur)}</div>
      <div class="chips-quick" style="margin:-6px 0 18px">${[500, 1000, 2000, 5000, 10000].map(v => `<button type="button" data-quick="${v}">${esc(formatMoney(v, cur))}</button>`).join('')}</div>
      <button class="btn btn-primary btn-block" type="submit">${esc(submit)}</button>
    </form>`;
  wireClose(el);
  const redrawCur = () => {
    const val = $('#g-buyin', el).value;
    $('#buyin-wrap', el).innerHTML = moneyField('g-buyin', 'Standard buy-in', val, cur);
    el.querySelectorAll('[data-cur]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cur === cur)));
    el.querySelectorAll('[data-quick]').forEach(b => (b.textContent = formatMoney(Number(b.dataset.quick), cur)));
  };
  el.querySelectorAll('[data-cur]').forEach(b => (b.onclick = () => { cur = b.dataset.cur; redrawCur(); }));
  el.querySelectorAll('[data-quick]').forEach(b => (b.onclick = () => { $('#g-buyin', el).value = centsToInput(Number(b.dataset.quick)); }));
  $('#game-form', el).onsubmit = e => {
    e.preventDefault();
    const amount = parseMoney($('#g-buyin', el).value);
    if (amount === null || amount <= 0) {
      $('#g-buyin-err', el).textContent = 'Enter a buy-in amount, like 20 or 12.50.';
      $('#g-buyin', el).focus();
      return;
    }
    onSubmit({ name: normName($('#g-name', el).value) || defaultGameName(), buyIn: amount, currency: cur });
  };
}

function openNewGameSheet() {
  openSheet(el => gameForm(el, {
    title: 'New game', name: defaultGameName(), buyIn: state.settings.lastBuyIn, currency: state.settings.lastCurrency, submit: 'Start game',
  }, ({ name, buyIn, currency }) => {
    const game = { id: uid(), name, buyIn, currency, createdAt: Date.now(), finishedAt: null, status: 'live', settleMode: 'bank', players: [] };
    closeSheet(true);
    commit(() => {
      state.games.push(game);
      state.settings.lastBuyIn = buyIn;
      state.settings.lastCurrency = currency;
    });
    go(`#/g/${game.id}`);
    setTimeout(() => openAddPlayerSheet(game), 60);
  }));
}

function openEditGameSheet(game) {
  openSheet(el => gameForm(el, { title: 'Edit game', name: game.name, buyIn: game.buyIn, currency: game.currency, submit: 'Save' },
    ({ name, buyIn, currency }) => {
      closeSheet();
      commit(() => { game.name = name; game.buyIn = buyIn; game.currency = currency; });
    }));
}

function openGameMenu(game) {
  openSheet(el => {
    el.innerHTML = `${sheetHead(game.name)}
      <div class="stack">
        ${route().name === 'home' ? `<button class="menu-item" id="m-open">${ICON.open}<span>Open</span></button>` : ''}
        <button class="menu-item" id="m-edit">${ICON.edit}<span>Edit name, buy-in, currency</span></button>
        <button class="menu-item" id="m-share">${ICON.share}<span>Share summary</span></button>
        ${game.status === 'done' ? `<button class="menu-item" id="m-mine">${ICON.chart}<span>Add to my bankroll<small>Log your result from this game</small></span></button>` : ''}
        ${game.status === 'done' ? `<button class="menu-item" id="m-reopen">${ICON.restore}<span>Reopen game<small>Move back to live games</small></span></button>` : ''}
        <button class="menu-item danger" id="m-delete">${ICON.trash}<span>Delete game</span></button>
      </div>`;
    wireClose(el);
    const mOpen = $('#m-open', el);
    if (mOpen) mOpen.onclick = () => { closeSheet(true); go(game.status === 'done' ? `#/g/${game.id}/cash` : `#/g/${game.id}`); };
    $('#m-edit', el).onclick = () => openEditGameSheet(game);
    $('#m-share', el).onclick = () => { closeSheet(); shareSummary(game); };
    const mMine = $('#m-mine', el);
    if (mMine) mMine.onclick = () => withUnlock(() => openPickMeSheet(game));
    const mReopen = $('#m-reopen', el);
    if (mReopen) mReopen.onclick = () => {
      closeSheet(true);
      commit(() => { game.status = 'live'; game.finishedAt = null; });
      go(`#/g/${game.id}`);
    };
    $('#m-delete', el).onclick = () => confirmSheet({
      title: 'Delete game?',
      body: `“${esc(game.name)}” and all its buy-ins will be deleted.`,
      confirm: 'Delete game',
      onConfirm: () => {
        if (route().name !== 'home') go('#');
        commit(() => { state.games = state.games.filter(g => g.id !== game.id); }, `Deleted “${game.name}”`);
      },
    });
  });
}

/* ---------- Add player ---------- */
function openAddPlayerSheet(game) {
  openSheet(el => {
    el.innerHTML = `${sheetHead('Add player')}
      <form id="player-form" novalidate>
        <label class="field"><span>Name</span>
          <input class="input" id="p-name" maxlength="40" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="e.g. Sam">
          <div class="error" id="p-name-err"></div>
        </label>
        <label class="check"><input type="checkbox" id="p-auto" ${state.settings.autoFirstBuyIn ? 'checked' : ''}>
          <span>Give first buy-in (${esc(money(game, game.buyIn))})</span></label>
        <div class="stack" style="margin-top:12px">
          <button class="btn btn-primary btn-block" type="submit">Add player</button>
          <button class="btn btn-ghost btn-block" type="button" data-close>Done</button>
        </div>
        <div class="hint" id="p-added" style="text-align:center"></div>
      </form>`;
    wireClose(el);
    const input = $('#p-name', el);
    const err = $('#p-name-err', el);
    input.oninput = () => (err.textContent = '');
    $('#p-auto', el).onchange = e => { state.settings.autoFirstBuyIn = e.target.checked; saveState(); };
    $('#player-form', el).onsubmit = e => {
      e.preventDefault();
      const name = normName(input.value);
      if (!name) { err.textContent = 'Enter a name.'; input.focus(); return; }
      if (nameTaken(game, name)) { err.textContent = `“${name}” is already playing. Use a different name.`; input.focus(); return; }
      const auto = $('#p-auto', el).checked;
      const snapshot = JSON.stringify(state);
      game.players.push({ id: uid(), name, cashOut: null, buyIns: auto ? [{ id: uid(), amount: game.buyIn, at: Date.now() }] : [] });
      saveState();
      render();
      haptic();
      input.value = '';
      input.focus();
      $('#p-added', el).textContent = `Added ${name}${auto ? ` with ${money(game, game.buyIn)}` : ''}. Add another or tap Done.`;
      toast(`Added ${name}`, () => {
        state = normalizeState(JSON.parse(snapshot)) ?? state;
        saveState();
        render();
      });
    };
    setTimeout(() => input.focus(), 300);
  });
}

/* ---------- Player details ---------- */
function openPlayerSheet(game, playerId) {
  const draw = el => {
    const g = getGame(game.id);
    const p = g && g.players.find(x => x.id === playerId);
    if (!p) { closeSheet(); return; }
    const total = sumBuyIns(p);
    el.innerHTML = `${sheetHead(p.name)}
      <div class="player-total"><b>${esc(money(g, total))}</b><span>${plural(p.buyIns.length, 'buy-in')}</span></div>
      <div class="buyin-list">
        ${p.buyIns.length === 0 ? '<p class="hint">No buy-ins yet.</p>' : p.buyIns.map((b, i) => `
          <div class="buyin-item">
            <span class="amt">${esc(money(g, b.amount))}</span>
            <span class="when">#${i + 1} · ${esc(fmtTime(b.at))}</span>
            <button class="icon-btn" data-remove-buyin="${esc(b.id)}" aria-label="Remove ${esc(money(g, b.amount))} buy-in">${ICON.close}</button>
          </div>`).join('')}
      </div>
      <div class="divider"></div>
      <form id="custom-form" novalidate>
        <div class="row">
          <div class="grow">${moneyField('custom-amt', 'Custom buy-in', '', g.currency)}</div>
          <button class="btn btn-primary" type="submit" style="align-self:flex-start;margin-top:25px">Add</button>
        </div>
      </form>
      <button class="btn btn-secondary btn-block" id="quick-add">+${esc(money(g, g.buyIn))} standard buy-in</button>
      <div class="divider"></div>
      <form id="rename-form" novalidate>
        <div class="row">
          <label class="field grow"><span>Name</span><input class="input" id="rename" maxlength="40" value="${esc(p.name)}" autocomplete="off" autocapitalize="words">
          <div class="error" id="rename-err"></div></label>
          <button class="btn btn-secondary" type="submit" style="align-self:flex-start;margin-top:25px">Rename</button>
        </div>
      </form>
      <button class="btn btn-danger btn-block" id="remove-player">${ICON.trash} Remove ${esc(p.name)}</button>`;
    wireClose(el);

    el.querySelectorAll('[data-remove-buyin]').forEach(btn => {
      btn.onclick = () => {
        const b = p.buyIns.find(x => x.id === btn.dataset.removeBuyin);
        commit(() => { p.buyIns = p.buyIns.filter(x => x.id !== b.id); }, `Removed ${money(g, b.amount)} buy-in`);
      };
    });
    $('#custom-form', el).onsubmit = e => {
      e.preventDefault();
      const amt = parseMoney($('#custom-amt', el).value);
      if (amt === null || amt <= 0) { $('#custom-amt-err', el).textContent = 'Enter an amount, like 10 or 12.50.'; return; }
      addBuyIn(g, p, amt);
    };
    $('#quick-add', el).onclick = () => addBuyIn(g, p, g.buyIn);
    $('#rename-form', el).onsubmit = e => {
      e.preventDefault();
      const name = normName($('#rename', el).value);
      const errEl = $('#rename-err', el);
      if (!name) { errEl.textContent = 'Name can’t be empty.'; return; }
      if (nameTaken(g, name, p.id)) { errEl.textContent = `“${name}” is already playing.`; return; }
      if (name === p.name) return;
      commit(() => { p.name = name; });
      toast(`Renamed to ${name}`);
    };
    $('#remove-player', el).onclick = () => {
      const doRemove = () => commit(() => { g.players = g.players.filter(x => x.id !== p.id); }, `Removed ${p.name}`);
      confirmSheet({
        title: `Remove ${p.name}?`,
        body: total > 0 ? `Their ${plural(p.buyIns.length, 'buy-in')} (${esc(money(g, total))}) will come out of the pot.` : 'They’ll be removed from this game.',
        confirm: 'Remove player',
        onConfirm: doRemove,
      });
    };
  };
  draw.refresh = true;
  openSheet(draw);
}

/* ---------- Settings ---------- */
function openSettingsSheet() {
  openSheet(el => {
    el.innerHTML = `${sheetHead('Settings')}
      <p class="lead">Everything is stored only on this phone. Nothing is sent anywhere.</p>
      <div class="stack">
        <button class="menu-item" id="s-backup">${ICON.copy}<span>Copy backup<small>${isLocked() ? 'Games only. Unlock your bankroll to include it' : 'Copies all games and your bankroll as text'}</small></span></button>
        <button class="menu-item" id="s-restore">${ICON.restore}<span>Restore from backup<small>Paste backup text to replace data</small></span></button>
        <button class="menu-item danger" id="s-delete">${ICON.trash}<span>Delete all data</span></button>
      </div>
      <p class="footnote">Stack · ${plural(state.games.length, 'game')} saved · works offline</p>`;
    wireClose(el);
    $('#s-backup', el).onclick = async () => {
      const data = isLocked() ? { ...state, bankroll: undefined } : state;
      const json = JSON.stringify(data, null, 2);
      if (await copyText(json)) toast('Backup copied. Paste it somewhere safe.');
      else openTextSheet('Backup', 'Copy this text and keep it somewhere safe.', json);
    };
    $('#s-restore', el).onclick = () => openRestoreSheet();
    $('#s-delete', el).onclick = () => confirmSheet({
      title: 'Delete all data?',
      body: isLocked()
        ? `This deletes ${plural(state.games.length, 'game')} from this phone. Your PIN-locked bankroll is kept. To erase it, unlock it and use its settings.`
        : `This deletes ${plural(state.games.length, 'game')} and your bankroll (${plural(state.bankroll.sessions.length, 'session')}) from this phone. Copy a backup first if you might want them.`,
      confirm: 'Delete everything',
      onConfirm: () => {
        go('#');
        const keep = isLocked() ? state.bankroll : null;
        commit(() => { state = emptyState(); if (keep) state.bankroll = keep; }, 'All data deleted');
      },
    });
  });
}

function openRestoreSheet() {
  openSheet(el => {
    el.innerHTML = `${sheetHead('Restore')}
      <p class="lead">Paste a backup from Stack. It replaces all games on this phone.</p>
      <textarea class="input" id="r-text" placeholder='{"version":1,"games":[...]}' autocapitalize="off" autocorrect="off" spellcheck="false"></textarea>
      <div class="error" id="r-err"></div>
      <div class="stack" style="margin-top:12px">
        <button class="btn btn-primary btn-block" id="r-go">Restore</button>
        <button class="btn btn-secondary btn-block" data-close>Cancel</button>
      </div>`;
    wireClose(el);
    $('#r-go', el).onclick = () => {
      let parsed = null;
      let hasBankroll = false;
      try {
        const raw = JSON.parse($('#r-text', el).value);
        hasBankroll = !!(raw && raw.bankroll);
        parsed = normalizeState(raw);
      } catch (e) { parsed = null; }
      // A locked bankroll is never replaced; a backup without a bankroll keeps the current one.
      if (parsed && (isLocked() || !hasBankroll)) parsed.bankroll = state.bankroll;
      if (!parsed) { $('#r-err', el).textContent = 'That doesn’t look like a Stack backup.'; return; }
      confirmSheet({
        title: 'Replace all data?',
        body: `Restore ${plural(parsed.games.length, 'game')} from the backup. Your current ${plural(state.games.length, 'game')} will be replaced.${hasBankroll && !isLocked() ? ` Your bankroll will be replaced with the backup’s (${plural(parsed.bankroll.sessions.length, 'session')}).` : ''}`,
        confirm: 'Restore',
        onConfirm: () => {
          go('#');
          commit(() => { state = parsed; }, 'Backup restored');
        },
      });
    };
  });
}

/* =========================================================
   My bankroll (private to this phone, optional PIN)
   ========================================================= */
let unlocked = false; // in memory only: re-locks on reload or when the app goes to the background
const isLocked = () => !!state.bankroll.pin && !unlocked;
const bm = (cents, opts) => formatMoney(cents, state.bankroll.currency, opts);
const pad2 = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const dayStr = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function fmtDay(s, withYear) {
  const [y, m, d] = s.split('-').map(Number);
  const opts = { month: 'short', day: 'numeric' };
  if (withYear || y !== new Date().getFullYear()) opts.year = 'numeric';
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}
const netClass = n => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero');
const netText = n => (n === 0 ? 'even' : bm(n, { sign: true }));

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.bankroll.pin && unlocked) {
    unlocked = false;
    if (route().name === 'me') { closeSheet(true); render(); }
  }
});

async function hashPin(pin, salt) {
  if (!(window.crypto && crypto.subtle)) throw new Error('no-crypto');
  const bytes = new TextEncoder().encode(salt + ':' + pin);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const newSalt = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
async function checkPin(pin) {
  const p = state.bankroll.pin;
  return !!p && (await hashPin(pin, p.salt)) === p.hash;
}

/** A 4-digit keypad. onComplete(pin) returns true to accept, or a string error to shake and clear. */
function mountPinPad(root, { title, subtitle, onComplete, extra = '' }) {
  let digits = '';
  let busy = false;
  root.innerHTML = `
    <div class="pinpad">
      <div class="pin-lock">${ICON.lock}</div>
      <h2 class="pin-title">${esc(title)}</h2>
      <p class="pin-sub" data-sub>${esc(subtitle)}</p>
      <div class="pin-dots" aria-hidden="true">${'<span></span>'.repeat(4)}</div>
      <div class="pin-keys">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <span></span><button type="button" data-k="0">0</button>
        <button type="button" data-k="del" aria-label="Delete">⌫</button>
      </div>
      <input class="pin-hidden" inputmode="numeric" autocomplete="one-time-code" aria-label="PIN" maxlength="4">
      ${extra}
    </div>`;
  const dots = root.querySelectorAll('.pin-dots span');
  const sub = root.querySelector('[data-sub]');
  const box = root.querySelector('.pinpad');
  const draw = () => dots.forEach((d, i) => d.classList.toggle('on', i < digits.length));
  const press = async k => {
    if (busy) return;
    if (k === 'del') digits = digits.slice(0, -1);
    else if (digits.length < 4) digits += k;
    draw();
    if (digits.length === 4) {
      busy = true;
      const res = await onComplete(digits);
      busy = false;
      if (res && res.next) { sub.textContent = res.next; digits = ''; draw(); return; }
      if (res !== true) {
        haptic();
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
        if (typeof res === 'string') sub.textContent = res;
        digits = ''; draw();
      }
    }
  };
  root.querySelectorAll('[data-k]').forEach(b => (b.onclick = () => press(b.dataset.k)));
  // Hardware/desktop keyboards.
  const hidden = root.querySelector('.pin-hidden');
  hidden.addEventListener('keydown', e => {
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
  });
  box.addEventListener('click', e => { if (!e.target.closest('button')) hidden.focus({ preventScroll: true }); });
  return { setSubtitle: t => (sub.textContent = t) };
}

function withUnlock(fn) {
  if (!isLocked()) return fn();
  openSheet(el => {
    el.innerHTML = `${sheetHead('Unlock')}<div data-pad></div>`;
    wireClose(el);
    mountPinPad($('[data-pad]', el), {
      title: 'Enter your PIN',
      subtitle: 'Your bankroll is locked.',
      onComplete: async pin => {
        if (!(await checkPin(pin))) return 'Wrong PIN. Try again.';
        unlocked = true;
        closeSheet(true);
        fn();
        return true;
      },
    });
  });
}

function bankrollCard() {
  const br = state.bankroll;
  const locked = isLocked();
  const stats = computeStats(br.sessions, br.start);
  const detail = locked
    ? 'Locked with a PIN'
    : br.sessions.length ? `${plural(br.sessions.length, 'session')} · <span class="${netClass(stats.profit)}">${esc(netText(stats.profit))}</span>` : 'Track your own results. Only you can see this.';
  return `
    <button class="card me-card" id="open-me">
      <span class="me-icon">${locked ? ICON.lock : ICON.chart}</span>
      <span class="grow">
        <span class="me-label">My bankroll</span>
        <span class="me-meta">${detail}</span>
      </span>
      ${!locked && (br.sessions.length || br.start) ? `<span class="me-value">${esc(bm(stats.bankroll))}</span>` : `<span class="me-chev">${ICON.open}</span>`}
    </button>`;
}

function renderBankroll() {
  document.title = 'My bankroll · Stack';
  const br = state.bankroll;
  if (isLocked()) {
    view.innerHTML = `
      <div class="topbar">
        <button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button>
        <div class="title">My bankroll</div><span class="icon-btn"></span>
      </div>
      <div data-pad style="padding-top:12px"></div>`;
    $('#back').onclick = () => go('#');
    mountPinPad($('[data-pad]'), {
      title: 'Enter your PIN',
      subtitle: 'Only you can see your bankroll.',
      extra: `<button type="button" class="btn btn-ghost" id="forgot" style="margin-top:8px">Forgot PIN?</button>`,
      onComplete: async pin => {
        if (!(await checkPin(pin))) return 'Wrong PIN. Try again.';
        unlocked = true;
        render();
        return true;
      },
    });
    $('#forgot').onclick = () => confirmSheet({
      title: 'Forgot your PIN?',
      body: 'There’s no way to recover it. Stack has no accounts or servers. You can erase your bankroll and PIN and start fresh. Your games are kept.',
      confirm: 'Erase bankroll & PIN',
      onConfirm: () => commit(() => { state.bankroll = emptyBankroll(state.bankroll.currency); }),
    });
    return;
  }

  const stats = computeStats(br.sessions, br.start);
  const sessions = sortSessions(br.sessions).reverse();
  const tile = (label, value, cls = '') => `<div class="stat"><b class="money ${cls}">${value}</b><span>${label}</span></div>`;
  view.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" id="back" aria-label="Back">${ICON.back}</button>
      <div class="title">My bankroll</div>
      ${br.pin ? `<button class="icon-btn" id="lock-now" aria-label="Lock">${ICON.lock}</button>` : ''}
      <button class="icon-btn" id="br-settings" aria-label="Bankroll settings">${ICON.gear}</button>
    </div>
    <div class="hero" style="padding-bottom:8px">
      <div class="label">Bankroll</div>
      <div class="big" id="br-total">${esc(bm(stats.bankroll))}</div>
      <div class="hero-sub">${br.sessions.length
        ? `<span class="net ${netClass(stats.profit)}">${esc(netText(stats.profit))}</span> all time${br.start ? ` · started at ${esc(bm(br.start))}` : ''}`
        : br.start ? `Starting bankroll` : `Set a starting amount in <button class="linkish" id="br-settings-2">settings</button>`}</div>
    </div>
    <div class="card chart-card" id="chart-card">
      <div class="chart-title">Bankroll over time</div>
      <div id="chart" class="chart"></div>
      <div class="chart-tip" id="chart-tip" hidden></div>
    </div>
    ${br.sessions.length ? `
    <div class="stats two">
      ${tile('Sessions', stats.count)}
      ${tile('Winning sessions', stats.winRate === null ? '—' : stats.winRate + '%')}
      ${tile('Avg per session', esc(netText(stats.avg)), netClass(stats.avg))}
      ${tile('Per hour', stats.hourly === null ? '—' : esc(netText(stats.hourly)), stats.hourly === null ? '' : netClass(stats.hourly))}
      ${tile('Best session', esc(netText(stats.best)), netClass(stats.best))}
      ${tile('Worst session', esc(netText(stats.worst)), netClass(stats.worst))}
    </div>` : ''}
    <div class="section-h"><h2>Sessions</h2><span>${br.sessions.length ? 'Tap to edit' : ''}</span></div>
    ${sessions.length ? `<div class="list">${sessions.map(s => {
      const n = sessionNet(s);
      return `
      <button class="card session-row" data-session="${esc(s.id)}">
        <span class="grow">
          <span class="name">${esc(s.where || 'Session')}</span>
          <span class="meta money">${esc(fmtDay(s.date))} · in ${esc(bm(s.buyIn))} · out ${esc(bm(s.cashOut))}${s.minutes ? ' · ' + esc(formatDuration(s.minutes)) : ''}</span>
        </span>
        <span class="session-net net ${netClass(n)}">${esc(netText(n))}</span>
      </button>`;
    }).join('')}</div>` : `
    <div class="empty" style="padding-top:20px">
      <h3>Your private record</h3>
      <p>Log what you bought in for and cashed out with each time you play. Stats stay on this phone only, and you can lock them with a PIN.</p>
    </div>`}
    <p class="footnote">Stored only on this phone. Nobody else, including the banker, can see it.${br.pin ? '' : ' Add a PIN in settings to lock it.'}</p>
    ${actionbar(`<button class="btn btn-primary" id="log-session">${ICON.plus} Log session</button>`)}
  `;
  $('#back').onclick = () => go('#');
  $('#br-settings').onclick = () => openBankrollSettings();
  const s2 = $('#br-settings-2'); if (s2) s2.onclick = () => openBankrollSettings();
  const lockBtn = $('#lock-now');
  if (lockBtn) lockBtn.onclick = () => { unlocked = false; render(); toast('Bankroll locked'); };
  $('#log-session').onclick = () => openSessionSheet();
  view.querySelectorAll('[data-session]').forEach(b => (b.onclick = () => openSessionSheet(br.sessions.find(s => s.id === b.dataset.session))));
  drawChart(stats, br.start);
}

/* ---------- Chart: one series, the running bankroll ---------- */
function drawChart(stats, start) {
  const host = $('#chart');
  const tip = $('#chart-tip');
  if (!host) return;
  const pts = [{ label: 'Start', value: start, net: null }, ...stats.series.map(p => {
    const s = state.bankroll.sessions.find(x => x.id === p.id);
    return { label: fmtDay(p.date) + (s && s.where ? ' · ' + s.where : ''), value: p.value, net: p.net };
  })];
  if (pts.length < 2) {
    host.innerHTML = `<div class="chart-empty">Your graph appears after your first session.</div>`;
    return;
  }
  const W = Math.max(240, Math.round(host.clientWidth || 320));
  const H = 170;
  const padL = 4, padR = 10, padT = 22, padB = 22;
  const vals = pts.map(p => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1000; hi += 1000; }
  const span = hi - lo;
  lo -= Math.round(span * 0.08); hi += Math.round(span * 0.08);
  const x = i => padL + (i * (W - padL - padR)) / (pts.length - 1);
  const y = v => padT + ((hi - v) * (H - padT - padB)) / (hi - lo);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${H - padB}L${x(0).toFixed(1)},${H - padB}Z`;
  const last = pts.length - 1;
  const maxV = Math.max(...vals), minV = Math.min(...vals);
  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Bankroll over ${plural(pts.length - 1, 'session')}, from ${esc(bm(start))} to ${esc(bm(pts[last].value))}">
      <defs><linearGradient id="g-area" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#e8c37e" stop-opacity=".22"/><stop offset="1" stop-color="#e8c37e" stop-opacity="0"/>
      </linearGradient></defs>
      <line x1="${padL}" x2="${W - padR}" y1="${y(maxV)}" y2="${y(maxV)}" class="grid"/>
      <line x1="${padL}" x2="${W - padR}" y1="${y(minV)}" y2="${y(minV)}" class="grid"/>
      <text x="${padL}" y="${y(maxV) - 6}" class="axis">${esc(bm(maxV))}</text>
      ${minV !== maxV ? `<text x="${padL}" y="${y(minV) + 14}" class="axis">${esc(bm(minV))}</text>` : ''}
      <line x1="${padL}" x2="${W - padR}" y1="${y(start)}" y2="${y(start)}" class="start-line"/>
      <path d="${area}" fill="url(#g-area)"/>
      <path d="${line}" fill="none" stroke="#e8c37e" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(last)}" cy="${y(pts[last].value)}" r="4.5" fill="#e8c37e" stroke="#14221b" stroke-width="2"/>
      <g id="hover" style="display:none">
        <line id="hv-line" y1="${padT - 8}" y2="${H - padB}" class="hover-line"/>
        <circle id="hv-dot" r="5" fill="#e8c37e" stroke="#14221b" stroke-width="2"/>
      </g>
      <text x="${padL}" y="${H - 6}" class="axis">Start</text>
      <text x="${W - padR}" y="${H - 6}" class="axis" text-anchor="end">${esc(plural(pts.length - 1, 'session'))}</text>
      <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" id="hit"/>
    </svg>`;
  const svg = $('svg', host);
  const hover = $('#hover', svg);
  const card = $('#chart-card');
  const show = clientX => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) * W) / r.width;
    const i = Math.max(0, Math.min(last, Math.round(((px - padL) * last) / (W - padL - padR))));
    const p = pts[i];
    hover.style.display = '';
    $('#hv-line', svg).setAttribute('x1', x(i)); $('#hv-line', svg).setAttribute('x2', x(i));
    $('#hv-dot', svg).setAttribute('cx', x(i)); $('#hv-dot', svg).setAttribute('cy', y(p.value));
    tip.hidden = false;
    tip.innerHTML = `<div class="tip-label">${esc(p.label)}</div>
      <div class="tip-val money">${esc(bm(p.value))}${p.net === null ? '' : ` <span class="net ${netClass(p.net)}">${esc(netText(p.net))}</span>`}</div>`;
    const cr = card.getBoundingClientRect();
    const left = r.left - cr.left + (x(i) * r.width) / W;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(cr.width - tw - 8, left - tw / 2)) + 'px';
  };
  const hide = () => { hover.style.display = 'none'; tip.hidden = true; };
  svg.addEventListener('pointerdown', e => show(e.clientX));
  svg.addEventListener('pointermove', e => show(e.clientX));
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('pointercancel', hide);
}

/* ---------- Log / edit a session ---------- */
function openSessionSheet(existing, prefill = {}) {
  const br = state.bankroll;
  const s = existing || { date: todayStr(), where: '', buyIn: null, cashOut: null, minutes: null, notes: '', ...prefill };
  openSheet(el => {
    el.innerHTML = `${sheetHead(existing ? 'Edit session' : 'Log session')}
      <form id="session-form" novalidate>
        <div class="row">
          <label class="field grow"><span>Date</span><input class="input" type="date" id="s-date" value="${esc(s.date)}" max="${todayStr()}"></label>
          <label class="field" style="width:42%"><span>Hours <em class="opt">optional</em></span>
            <input class="input" id="s-hours" inputmode="decimal" placeholder="3:30" value="${esc(durationToInput(s.minutes))}" autocomplete="off">
            <div class="error" id="s-hours-err"></div></label>
        </div>
        <label class="field"><span>Where / game <em class="opt">optional</em></span>
          <input class="input" id="s-where" maxlength="60" placeholder="Home game" value="${esc(s.where)}" autocomplete="off" autocapitalize="sentences"></label>
        <div class="row">
          <div class="grow">${moneyField('s-in', 'Bought in (total)', s.buyIn === null ? '' : centsToInput(s.buyIn), br.currency)}</div>
          <div class="grow">${moneyField('s-out', 'Cashed out', s.cashOut === null ? '' : centsToInput(s.cashOut), br.currency)}</div>
        </div>
        <div class="net-preview" id="s-net"></div>
        <label class="field"><span>Notes <em class="opt">optional</em></span>
          <textarea class="input notes" id="s-notes" maxlength="500" placeholder="Big hands, what went well…">${esc(s.notes || '')}</textarea></label>
        <div class="stack">
          <button class="btn btn-primary btn-block" type="submit">${existing ? 'Save' : 'Log session'}</button>
          ${existing ? `<button class="btn btn-danger btn-block" type="button" id="s-delete-session">${ICON.trash} Delete session</button>` : ''}
        </div>
      </form>`;
    wireClose(el);
    const preview = () => {
      const a = parseMoney($('#s-in', el).value), b = parseMoney($('#s-out', el).value);
      const box = $('#s-net', el);
      if (a === null || b === null) { box.innerHTML = ''; return; }
      const n = b - a;
      box.innerHTML = `Result: <span class="net ${netClass(n)}">${esc(netText(n))}</span>`;
    };
    $('#s-in', el).oninput = preview; $('#s-out', el).oninput = preview; preview();
    $('#session-form', el).onsubmit = e => {
      e.preventDefault();
      el.querySelectorAll('.error').forEach(x => (x.textContent = ''));
      const buyIn = parseMoney($('#s-in', el).value);
      const cashOut = parseMoney($('#s-out', el).value);
      const hoursRaw = $('#s-hours', el).value.trim();
      const minutes = hoursRaw === '' ? null : parseDuration(hoursRaw);
      let date = $('#s-date', el).value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = todayStr();
      let bad = false;
      if (buyIn === null) { $('#s-in-err', el).textContent = 'Enter what you bought in for.'; bad = true; }
      if (cashOut === null) { $('#s-out-err', el).textContent = 'Enter what you left with (0 if busted).'; bad = true; }
      if (hoursRaw !== '' && (minutes === null || minutes === 0)) { $('#s-hours-err', el).textContent = 'Like 3:30 or 3.5'; bad = true; }
      if (bad) return;
      const data = { date, buyIn, cashOut, minutes, where: normName($('#s-where', el).value), notes: $('#s-notes', el).value.trim() };
      closeSheet();
      if (existing) {
        commit(() => { Object.assign(br.sessions.find(x => x.id === existing.id), data); });
        toast('Session saved');
      } else {
        commit(() => { br.sessions.push({ id: uid(), createdAt: Date.now(), gameId: prefill.gameId || null, ...data }); },
          `Logged ${netText(cashOut - buyIn)}`);
      }
    };
    const del = $('#s-delete-session', el);
    if (del) del.onclick = () => confirmSheet({
      title: 'Delete session?',
      body: `${esc(fmtDay(existing.date, true))}${existing.where ? ' · ' + esc(existing.where) : ''} (${esc(netText(sessionNet(existing)))}) will be removed from your stats.`,
      confirm: 'Delete session',
      onConfirm: () => commit(() => { br.sessions = br.sessions.filter(x => x.id !== existing.id); }, 'Session deleted'),
    });
  });
}

/* ---------- From a finished game ---------- */
function openPickMeSheet(game) {
  const already = state.bankroll.sessions.find(s => s.gameId === game.id);
  openSheet(el => {
    el.innerHTML = `${sheetHead('Which one is you?')}
      <p class="lead">Your result goes into your private bankroll on this phone.${already ? ' You already logged this game. Picking again replaces it.' : ''}</p>
      <div class="stack">${game.players.map(p => {
        const n = (p.cashOut ?? 0) - sumBuyIns(p);
        return `<button class="menu-item" data-me="${esc(p.id)}"><span class="avatar">${esc(initial(p.name))}</span>
          <span class="grow">${esc(p.name)}<small class="money">in ${esc(money(game, sumBuyIns(p)))} · out ${esc(money(game, p.cashOut ?? 0))}</small></span>
          <span class="net ${netClass(n)}">${esc(money(game, n, { sign: true }))}</span></button>`;
      }).join('')}</div>`;
    wireClose(el);
    el.querySelectorAll('[data-me]').forEach(b => (b.onclick = () => {
      const p = game.players.find(x => x.id === b.dataset.me);
      const data = { date: dayStr(game.createdAt), buyIn: sumBuyIns(p), cashOut: p.cashOut ?? 0, where: game.name, gameId: game.id };
      closeSheet(true);
      commit(() => {
        const br = state.bankroll;
        br.sessions = br.sessions.filter(s => s.gameId !== game.id);
        br.sessions.push({ id: uid(), createdAt: Date.now(), minutes: null, notes: '', ...data });
      }, `Added ${data.cashOut - data.buyIn === 0 ? 'an even result' : netText(data.cashOut - data.buyIn)} to your bankroll`);
      go('#/me');
    }));
  });
}

/* ---------- Bankroll settings ---------- */
function openBankrollSettings() {
  const br = state.bankroll;
  openSheet(el => {
    let cur = br.currency;
    el.innerHTML = `${sheetHead('Bankroll settings')}
      <form id="br-form" novalidate>
        <div id="br-start-wrap">${moneyField('br-start', 'Starting bankroll', br.start ? centsToInput(br.start) : '', cur, 'What you had before your first logged session.')}</div>
        <div class="field"><span>Currency</span>
          <div class="seg" role="group" aria-label="Currency">
            ${Object.entries(CURRENCIES).map(([k, c]) => `<button type="button" data-cur="${k}" aria-pressed="${k === cur}" aria-label="${esc(c.label)}">${c.symbol || 'Chips'}</button>`).join('')}
          </div></div>
        <button class="btn btn-primary btn-block" type="submit">Save</button>
      </form>
      <div class="divider"></div>
      <div class="stack">
        ${br.pin
          ? `<button class="menu-item" id="pin-change">${ICON.lock}<span>Change PIN</span></button>
             <button class="menu-item" id="pin-remove">${ICON.lock}<span>Remove PIN</span></button>`
          : `<button class="menu-item" id="pin-set">${ICON.lock}<span>Lock with a PIN<small>Keeps your stats private if you hand your phone around</small></span></button>`}
        <button class="menu-item danger" id="br-erase">${ICON.trash}<span>Erase my bankroll</span></button>
      </div>
      <p class="footnote">The PIN keeps people out of this screen on this phone. Your data never leaves the phone. The PIN isn’t encryption, and it can’t be recovered if you forget it.</p>`;
    wireClose(el);
    el.querySelectorAll('[data-cur]').forEach(b => (b.onclick = () => {
      cur = b.dataset.cur;
      const v = $('#br-start', el).value;
      $('#br-start-wrap', el).innerHTML = moneyField('br-start', 'Starting bankroll', v, cur, 'What you had before your first logged session.');
      el.querySelectorAll('[data-cur]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.cur === cur)));
    }));
    $('#br-form', el).onsubmit = e => {
      e.preventDefault();
      const raw = $('#br-start', el).value.trim();
      const start = raw === '' ? 0 : parseMoney(raw);
      if (start === null) { $('#br-start-err', el).textContent = 'Enter an amount, like 500 or 250.50.'; return; }
      closeSheet();
      commit(() => { br.start = start; br.currency = cur; });
      toast('Bankroll settings saved');
    };
    const set = $('#pin-set', el) || $('#pin-change', el);
    if (set) set.onclick = () => openSetPinSheet();
    const rm = $('#pin-remove', el);
    if (rm) rm.onclick = () => confirmSheet({
      title: 'Remove PIN?', body: 'Anyone using this phone will be able to open your bankroll.', confirm: 'Remove PIN', danger: true,
      onConfirm: () => { commit(() => { br.pin = null; }); toast('PIN removed'); },
    });
    $('#br-erase', el).onclick = () => confirmSheet({
      title: 'Erase your bankroll?',
      body: `${plural(br.sessions.length, 'session')}, your starting amount and your PIN will be deleted from this phone. Your games are kept.`,
      confirm: 'Erase bankroll',
      onConfirm: () => commit(() => { state.bankroll = emptyBankroll(br.currency); }, 'Bankroll erased'),
    });
  });
}

function openSetPinSheet() {
  openSheet(el => {
    el.innerHTML = `${sheetHead('Set a PIN')}<div data-pad></div>`;
    wireClose(el);
    let first = null;
    mountPinPad($('[data-pad]', el), {
      title: 'Choose a 4-digit PIN',
      subtitle: 'You’ll need it to open your bankroll.',
      onComplete: async pin => {
        if (first === null) { first = pin; return { next: 'Enter it again to confirm.' }; }
        if (pin !== first) { first = null; return 'PINs didn’t match. Choose a PIN again.'; }
        try {
          const salt = newSalt();
          const hash = await hashPin(pin, salt);
          closeSheet(true);
          unlocked = true;
          commit(() => { state.bankroll.pin = { salt, hash }; });
          toast('PIN set. Your bankroll locks when you leave the app.');
          return true;
        } catch (e) {
          return 'This browser can’t set a PIN here.';
        }
      },
    });
  });
}

/* =========================================================
   Toast with optional undo
   ========================================================= */
let toastTimer = null;
function toast(message, undo) {
  const root = $('#toast-root');
  clearTimeout(toastTimer);
  root.innerHTML = `<div class="toast" role="status"><span class="msg">${esc(message)}</span>${undo ? '<button type="button">Undo</button>' : ''}</div>`;
  const btn = $('button', root);
  if (btn) btn.onclick = () => { clearTimeout(toastTimer); root.innerHTML = ''; undo(); };
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, undo ? 5000 : 2600);
}

/* =========================================================
   Boot
   ========================================================= */
window.addEventListener('storage', e => {
  if (e.key === STORAGE_KEY) { state = loadState(); render(); }
});
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW registration failed', err));
  });
}
