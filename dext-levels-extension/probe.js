/* Chart-API probe — answers one question: can we draw REAL lines on Dext's
 * chart, or is a side panel the ceiling?
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM content.js
 * Chrome runs content scripts in an ISOLATED world by default: content.js can
 * see the DOM but NOT the page's own JavaScript globals. The TradingView widget
 * object lives in the page's world, so an isolated script would always report
 * "not found" — a false negative that would have made me tell you plotting is
 * impossible when it might not be. This file is registered with
 * `world: "MAIN"` so it sees what the page sees.
 *
 * It is READ-ONLY. It inspects and reports; it never calls a chart method or
 * draws anything. Results are written to a data attribute on <html> so the
 * isolated content script can read them and show them in the card.
 *
 * Dext's chart may initialise seconds after page load, so this retries rather
 * than reporting a one-shot miss as a definitive "no".
 */
(() => {
  'use strict';
  const NAMES = ['tvWidget', 'widget', 'chartWidget', 'tvChart', 'chart',
                 '__tv', 'tvw', 'TradingView', 'tradingView', 'chartApi'];

  function looksLikeWidget(v) {
    if (!v || (typeof v !== 'object' && typeof v !== 'function')) return false;
    // The Charting Library's widget exposes one of these. `createShape` on an
    // active chart is the specific capability we would need to draw levels.
    return typeof v.activeChart === 'function' ||
           typeof v.chart === 'function' ||
           typeof v.onChartReady === 'function';
  }

  function canDraw(v) {
    try {
      const c = typeof v.activeChart === 'function' ? v.activeChart()
              : typeof v.chart === 'function' ? v.chart() : null;
      if (!c) return false;
      return typeof c.createShape === 'function' ||
             typeof c.createMultipointShape === 'function';
    } catch (e) { return false; }
  }

  function scan() {
    const out = { found: [], drawable: false, iframes: [], canvases: 0, note: '' };
    out.canvases = document.querySelectorAll('canvas').length;

    for (const n of NAMES) {
      try {
        if (window[n] && looksLikeWidget(window[n])) {
          out.found.push(n);
          if (canDraw(window[n])) out.drawable = true;
        } else if (window[n]) {
          out.found.push(n + '(present, not a widget)');
        }
      } catch (e) { /* cross-origin / getter throws */ }
    }
    // Brute scan for a widget held under a name we didn't guess.
    if (!out.drawable) {
      let keys = [];
      try { keys = Object.keys(window); } catch (e) { keys = []; }
      for (const k of keys) {
        if (NAMES.includes(k)) continue;
        try {
          if (looksLikeWidget(window[k])) {
            out.found.push(k + '(scanned)');
            if (canDraw(window[k])) { out.drawable = true; break; }
          }
        } catch (e) { /* ignore */ }
      }
    }
    // An iframe-hosted chart on a different origin is unreachable no matter
    // what — worth distinguishing from "just not exposed".
    document.querySelectorAll('iframe').forEach((f) => {
      let src = '(no src)';
      try { src = f.src || '(no src)'; } catch (e) { src = '(unreadable)'; }
      let same = null;
      try { same = !!f.contentDocument; } catch (e) { same = false; }
      out.iframes.push({ src: String(src).slice(0, 120), sameOrigin: same });
    });
    if (!out.found.length && out.iframes.some(i => i.sameOrigin === false)) {
      out.note = 'chart is likely in a cross-origin iframe — unreachable';
    } else if (!out.found.length) {
      out.note = 'no widget object exposed to the page';
    } else if (!out.drawable) {
      out.note = 'widget found but no createShape() — cannot draw';
    } else {
      out.note = 'DRAWABLE — real lines and zone boxes are possible';
    }
    return out;
  }

  let tries = 0;
  const t = setInterval(() => {
    tries++;
    const r = scan();
    r.tries = tries;
    document.documentElement.setAttribute('data-mm-probe', JSON.stringify(r));
    // Console output too, so it is visible without the card.
    console.log('[MarketMap probe]', r.note, r);
    if (r.drawable || tries >= 10) clearInterval(t);
  }, 2000);
})();
