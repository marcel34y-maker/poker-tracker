import { CURRENCIES, parseMoney, formatMoney, centsToInput, settle } from './money.js';

/* =========================================================
   Storage (localStorage, never throws)
   ========================================================= */
const STORAGE_KEY = 'stack.v1';

function emptyState() {
  return { version: 1, games: [], settings: { autoFirstBuyIn: true, lastBuyIn: 2000, lastCurrency: 'usd' } };
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
      players,
    });
  }
  return { version: 1, games, settings };
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
  const payments = settle(netsOf(game));
  const name = id => game.players.find(p => p.id === id)?.name ?? '?';
  pay.innerHTML = `
    <div class="section-h"><h2>Who pays who</h2><span>${plural(payments.length, 'payment')}</span></div>
    ${payments.length === 0 ? `<div class="card pay-row"><div class="names">Everyone broke even. No payments needed.</div></div>` : `
    <div class="list">${payments.map(x => `
      <div class="card pay-row">
        <div class="names"><span class="neg">${esc(name(x.from))}</span><span class="arrow">pays</span><span class="pos">${esc(name(x.to))}</span></div>
        <div class="amt">${esc(money(game, x.amount))}</div>
      </div>`).join('')}
    </div>`}`;
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
  if (st.kind === 'ok') {
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
    const game = { id: uid(), name, buyIn, currency, createdAt: Date.now(), finishedAt: null, status: 'live', players: [] };
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
        ${game.status === 'done' ? `<button class="menu-item" id="m-reopen">${ICON.restore}<span>Reopen game<small>Move back to live games</small></span></button>` : ''}
        <button class="menu-item danger" id="m-delete">${ICON.trash}<span>Delete game</span></button>
      </div>`;
    wireClose(el);
    const mOpen = $('#m-open', el);
    if (mOpen) mOpen.onclick = () => { closeSheet(true); go(game.status === 'done' ? `#/g/${game.id}/cash` : `#/g/${game.id}`); };
    $('#m-edit', el).onclick = () => openEditGameSheet(game);
    $('#m-share', el).onclick = () => { closeSheet(); shareSummary(game); };
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
        <button class="menu-item" id="s-backup">${ICON.copy}<span>Copy backup<small>Copies all games as JSON text</small></span></button>
        <button class="menu-item" id="s-restore">${ICON.restore}<span>Restore from backup<small>Paste backup text to replace data</small></span></button>
        <button class="menu-item danger" id="s-delete">${ICON.trash}<span>Delete all data</span></button>
      </div>
      <p class="footnote">Stack · ${plural(state.games.length, 'game')} saved · works offline</p>`;
    wireClose(el);
    $('#s-backup', el).onclick = async () => {
      const json = JSON.stringify(state, null, 2);
      if (await copyText(json)) toast('Backup copied. Paste it somewhere safe.');
      else openTextSheet('Backup', 'Copy this text and keep it somewhere safe.', json);
    };
    $('#s-restore', el).onclick = () => openRestoreSheet();
    $('#s-delete', el).onclick = () => confirmSheet({
      title: 'Delete all data?',
      body: `This deletes ${plural(state.games.length, 'game')} from this phone. Copy a backup first if you might want them.`,
      confirm: 'Delete everything',
      onConfirm: () => {
        go('#');
        commit(() => { state = emptyState(); }, 'All data deleted');
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
      try { parsed = normalizeState(JSON.parse($('#r-text', el).value)); } catch (e) { parsed = null; }
      if (!parsed) { $('#r-err', el).textContent = 'That doesn’t look like a Stack backup.'; return; }
      confirmSheet({
        title: 'Replace all data?',
        body: `Restore ${plural(parsed.games.length, 'game')} from the backup. Your current ${plural(state.games.length, 'game')} will be replaced.`,
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
