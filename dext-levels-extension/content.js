/* Market Map Levels — floating card inside Dhan DEXT.
 *
 * WHY AN OVERLAY AND NOT LINES ON THE CANDLES
 * Dhan's charts do not support custom Pine Scripts (their own support docs and
 * open feature requests confirm it), and the embedded TradingView *Charting
 * Library* has no Pine engine — Pine only exists on tradingview.com. Drawing
 * real lines would mean reaching into Dext's chart widget and mapping price to
 * pixels, which breaks silently on any Dext update. Silent breakage on a chart
 * you trade from is the worst possible failure, so this deliberately stays a
 * DOM overlay: it never touches the canvas, and if Dext changes, the worst case
 * is the card sits in an awkward position rather than showing wrong levels.
 *
 * Everything it displays comes from the same Cloudflare Worker snapshot the
 * live-market website reads, so the numbers cannot drift from the website.
 */
(() => {
  'use strict';
  if (window.__mmLevelsLoaded) return;      // survive SPA re-navigation
  window.__mmLevelsLoaded = true;

  const DEFAULTS = {
    statusUrl: 'https://live-market-status.itscreativeman04.workers.dev',
    // Which instrument's map to show. Two agents now publish (futures for
    // entries, spot for levels), so this must be EXPLICIT — relying on the
    // Worker's default would silently show whichever agent happened to be the
    // default, and the two are ~40-70 pts apart. Set it to match the symbol on
    // your Dext chart: 'NIFTY' for the NIFTY 50 spot chart.
    symbol: 'NIFTY',
    refreshMs: 30000,
    pos: { right: 18, top: 96 },
    collapsed: false,
  };

  let cfg = { ...DEFAULTS };
  let timer = null;
  let lastGood = null;

  // ---------------------------------------------------------------- helpers
  const fmt = (v, d = 0) =>
    v == null || !isFinite(v) ? '–' : Number(v).toLocaleString('en-IN',
      { minimumFractionDigits: d, maximumFractionDigits: d });

  // Signed distance from live price. This is the number that actually decides
  // whether a level matters right now, so it is never hidden behind a hover.
  const dist = (level, price) =>
    (level == null || price == null) ? '' :
      `${level - price >= 0 ? '+' : ''}${Math.round(level - price)}`;

  const ageMin = (iso) =>
    !iso ? null : Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);

  function verdictClass(focus) {
    const f = String(focus || '').toUpperCase();
    if (f.startsWith('MANAGE')) return 'mm-manage';
    if (f.startsWith('LOOK FOR LONG')) return 'mm-long';
    if (f.startsWith('LOOK FOR SHORT')) return 'mm-short';
    if (f.startsWith('GET READY')) return 'mm-ready';
    if (f.startsWith('STAND ASIDE') || f.startsWith('NO NEW')) return 'mm-stop';
    return 'mm-wait';
  }

  // ------------------------------------------------------------------ shell
  const card = document.createElement('div');
  card.id = 'mm-levels-card';
  card.innerHTML = `
    <div class="mm-head" id="mm-drag">
      <span class="mm-title">MARKET MAP</span>
      <span class="mm-sym" id="mm-sym"></span>
      <span class="mm-spacer"></span>
      <button class="mm-btn" id="mm-collapse" title="Collapse / expand">–</button>
      <button class="mm-btn" id="mm-gear" title="Settings">⚙</button>
    </div>
    <div class="mm-body" id="mm-body">
      <div class="mm-verdict mm-wait" id="mm-verdict">
        <span class="mm-verb" id="mm-verb">…</span>
        <span class="mm-reason" id="mm-reason">Connecting…</span>
      </div>
      <div class="mm-price"><span id="mm-price">–</span>
        <span class="mm-age" id="mm-age"></span></div>
      <div id="mm-levels"></div>
      <div class="mm-probe" id="mm-probe"></div>
      <div class="mm-foot" id="mm-foot"></div>
    </div>`;
  document.documentElement.appendChild(card);

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- render
  function levelRow(label, price, price_now, cls, note) {
    const d = dist(price, price_now);
    const near = d !== '' && Math.abs(price - price_now) <= 25;
    return `<div class="mm-row ${cls}${near ? ' mm-near' : ''}">
      <span class="mm-lab">${label}</span>
      <span class="mm-val">${fmt(price, 0)}</span>
      <span class="mm-d">${d}</span>
      <span class="mm-note">${note || ''}</span></div>`;
  }

  function render(d) {
    const price = d.current_price;
    $('mm-sym').textContent = d.symbol || '';
    $('mm-price').textContent = fmt(price, 2);

    const a = ageMin(d.updated_at);
    const ageEl = $('mm-age');
    ageEl.textContent = a == null ? '' : (a < 1 ? 'live' : `${Math.round(a)}m old`);
    // Stale data is the one failure the numbers themselves cannot show you.
    ageEl.className = 'mm-age' + (a != null && a > 5 ? ' mm-stale' : '');

    const v = $('mm-verdict');
    v.className = 'mm-verdict ' + verdictClass(d.decision_focus);
    $('mm-verb').textContent = (d.decision_focus || 'WAIT').toUpperCase();
    $('mm-reason').textContent = d.decision_reason || '';

    const L = d.levels || {};
    const dz = (L.demand_zones || []).slice().sort((x, y) => y.top - x.top);
    const sz = (L.supply_zones || []).slice().sort((x, y) => y.top - x.top);
    const parts = [];

    // Supply above, demand below, price in between — same vertical order as a
    // chart, so the card reads like the thing it is standing in for.
    if (sz.length) {
      parts.push('<div class="mm-grp">SUPPLY / RESISTANCE</div>');
      sz.forEach(z => parts.push(levelRow(
        `${fmt(z.bottom)}–${fmt(z.top)}`, z.bottom, price, 'mm-sup',
        `${z.rating || ''}${z.state && z.state !== 'Untested'
          ? ` · ${z.state}${z.tests ? ' ×' + z.tests : ''}` : ' · Fresh'}`)));
    }
    const ctxRows = [];
    if (L.pdh != null) ctxRows.push(levelRow('PDH', L.pdh, price, 'mm-ctx', ''));
    if (L.equilibrium != null) ctxRows.push(levelRow('Equilibrium', L.equilibrium, price, 'mm-ctx',
      price != null && price > L.equilibrium ? 'premium' : 'discount'));
    if (L.pdl != null) ctxRows.push(levelRow('PDL', L.pdl, price, 'mm-ctx', ''));
    if (ctxRows.length) {
      parts.push('<div class="mm-grp">CONTEXT</div>');
      parts.push(ctxRows.join(''));
    }
    if (dz.length) {
      parts.push('<div class="mm-grp">DEMAND / SUPPORT</div>');
      dz.forEach(z => parts.push(levelRow(
        `${fmt(z.bottom)}–${fmt(z.top)}`, z.top, price, 'mm-dem',
        `${z.rating || ''}${z.state && z.state !== 'Untested'
          ? ` · ${z.state}${z.tests ? ' ×' + z.tests : ''}` : ' · Fresh'}`)));
    }
    if (L.invalidation) {
      parts.push('<div class="mm-grp">THESIS STOP</div>');
      parts.push(levelRow('Invalidation', L.invalidation, price, 'mm-inv', ''));
    }
    if (!parts.length) {
      // Describe what was OBSERVED, don't guess the cause. The first version
      // said "the map builds after the close", which was wrong in the common
      // case: the map existed and the PUBLISHER simply sent no levels (an agent
      // running code older than the levels block). That sent debugging in the
      // wrong direction entirely.
      const hasLevelsKey = d.levels && typeof d.levels === 'object';
      parts.push(
        `<div class="mm-empty">This snapshot carried <strong>no levels</strong>` +
        (hasLevelsKey
          ? ' — the <code>levels</code> block is present but empty.'
          : ' — the snapshot has no <code>levels</code> block at all, so the agent' +
            ' that published it is running older code.') +
        `<br>Levels appear once an agent publishes with them. Nothing is wrong` +
        ` with this card.</div>`);
    }
    $('mm-levels').innerHTML = parts.join('');

    const s = L.session_date ? `map for ${L.session_date}` : '';
    const bits = [s, 'levels are areas, not entry lines'];
    // Frame guard: showing another instrument's levels on this chart is wrong
    // by the basis on every entry and stop, so it must be impossible to miss.
    if (cfg.symbol && d.symbol && d.symbol !== cfg.symbol) {
      bits.unshift(`⚠ asked for ${cfg.symbol} but got ${d.symbol} — WRONG FRAME`);
    }
    // Spot has no volume, so this feed can never produce a trap entry.
    if (/^NIFTY$/i.test(String(d.symbol || ''))) {
      bits.push('spot frame: levels only, entries come from the futures agent');
    }
    // FUTURES-ON-SPOT-CHART GUARD (2026-07-30). The existing guard compares the
    // symbol ASKED FOR against the symbol RECEIVED, which cannot catch the real
    // mistake: a correctly-fetched FUTURES snapshot read against a NIFTY 50
    // (spot) chart. Seen live with the card at 24355 and the chart at 24296.60
    // -- a ~58 pt basis silently applied to every zone, entry and stop. The
    // extension cannot read Dext's chart symbol, so it states the frame plainly
    // and lets the trader check, rather than staying quiet and being wrong.
    if (/FUT$/i.test(String(d.symbol || ''))) {
      bits.push('FUTURES frame — only valid on a futures chart; ~40-70 pts above spot');
    }
    $('mm-foot').textContent = bits.filter(Boolean).join(' · ');
  }

  function renderError(msg) {
    // Never blank the card on a transient failure: showing the last good
    // snapshot with an explicit age beats showing nothing.
    if (lastGood) {
      render(lastGood);
      $('mm-foot').textContent = `⚠ ${msg} — showing last good snapshot`;
    } else {
      $('mm-verb').textContent = 'OFFLINE';
      $('mm-reason').textContent = msg;
    }
  }

  async function tick() {
    try {
      const url = cfg.symbol
        ? `${cfg.statusUrl}?symbol=${encodeURIComponent(cfg.symbol)}`
        : cfg.statusUrl;
      const res = await fetch(url, { cache: 'no-store' });
      // A 404 means this symbol has never published — say which one, rather
      // than showing a market that looks merely quiet.
      if (res.status === 404) throw new Error(`no feed for symbol "${cfg.symbol}"`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      lastGood = data;
      render(data);
    } catch (e) {
      renderError(String(e.message || e));
    }
  }

  // ---------------------------------------------------------------- probe
  // probe.js runs in the page's MAIN world and writes its findings to a data
  // attribute; this reads them so the answer to "can we draw real lines?"
  // shows up in the card instead of requiring DevTools.
  function readProbe() {
    let raw = null;
    try { raw = document.documentElement.getAttribute('data-mm-probe'); } catch (e) { /* ignore */ }
    const el = $('mm-probe');
    if (!raw) { el.textContent = 'chart API: probing…'; el.className = 'mm-probe'; return; }
    let r;
    try { r = JSON.parse(raw); } catch (e) { el.textContent = 'chart API: unreadable'; return; }
    if (r.drawable) {
      el.className = 'mm-probe mm-probe-yes';
      el.textContent = `chart API: DRAWABLE via ${r.found[0]} — real lines are possible`;
    } else {
      el.className = 'mm-probe mm-probe-no';
      el.textContent = `chart API: ${r.note} (found: ${r.found.length ? r.found.join(', ') : 'none'}` +
        `; ${r.iframes.length} iframe(s), ${r.canvases} canvas)`;
    }
  }
  setInterval(readProbe, 2500);
  readProbe();

  // ------------------------------------------------------------ interaction
  function applyPos() {
    card.style.right = cfg.pos.right + 'px';
    card.style.top = cfg.pos.top + 'px';
    card.classList.toggle('mm-collapsed', !!cfg.collapsed);
    $('mm-collapse').textContent = cfg.collapsed ? '+' : '–';
  }
  function save() { try { chrome.storage.sync.set({ mmCfg: cfg }); } catch (e) { /* ignore */ } }

  $('mm-collapse').addEventListener('click', () => {
    cfg.collapsed = !cfg.collapsed; applyPos(); save();
  });
  $('mm-gear').addEventListener('click', () => {
    try { chrome.runtime.openOptionsPage(); } catch (e) { /* ignore */ }
  });

  // Drag by the header. Clamped to the viewport so the card can never be
  // dragged off-screen and lost behind Dext's chrome.
  (function drag() {
    const h = $('mm-drag');
    let sx, sy, sr, st, on = false;
    h.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('mm-btn')) return;
      on = true; sx = e.clientX; sy = e.clientY;
      sr = cfg.pos.right; st = cfg.pos.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!on) return;
      const maxR = Math.max(0, window.innerWidth - 80);
      const maxT = Math.max(0, window.innerHeight - 60);
      cfg.pos.right = Math.min(maxR, Math.max(0, sr - (e.clientX - sx)));
      cfg.pos.top = Math.min(maxT, Math.max(0, st + (e.clientY - sy)));
      applyPos();
    });
    window.addEventListener('mouseup', () => { if (on) { on = false; save(); } });
  })();

  // ------------------------------------------------------------------ boot
  try {
    chrome.storage.sync.get({ mmCfg: null }, (r) => {
      if (r && r.mmCfg) cfg = { ...DEFAULTS, ...r.mmCfg, pos: { ...DEFAULTS.pos, ...(r.mmCfg.pos || {}) } };
      applyPos();
      tick();
      timer = setInterval(tick, cfg.refreshMs);
    });
  } catch (e) {
    applyPos(); tick(); timer = setInterval(tick, cfg.refreshMs);
  }

  // Pause polling while the tab is hidden — no reason to hammer the Worker
  // when the window isn't visible, and it refreshes immediately on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearInterval(timer); timer = null; }
    else if (!timer) { tick(); timer = setInterval(tick, cfg.refreshMs); }
  });
})();
