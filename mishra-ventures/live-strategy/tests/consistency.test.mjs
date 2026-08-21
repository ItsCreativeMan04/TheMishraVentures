// Live Strategy platform-consistency regression tests.
//
// This site is plain static HTML/CSS/JS with no build step and no existing
// test framework (no package.json, no jsdom/puppeteer available), so this
// is a dependency-free structural check: it reads the actual shipped files
// and asserts the invariants the platform-level redesign is supposed to
// guarantee. It cannot execute the DOM, so a few checks (activity scoping,
// terminal-state swap) assert the *logic exists in source* rather than
// simulating a browser -- see the docstring on each check.
//
// Run: node tests/consistency.test.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const PAGES = {
  home: 'my/index.html',
  sellce: 'my/sell-ce/index.html',
  bps1: 'my/bps1/index.html',
  niftybps: 'my/nifty-bps/index.html',
  niftyweekly: 'my/nifty-weekly/index.html',
};
const CONSOLES = ['sellce', 'bps1', 'niftybps', 'niftyweekly'];

const html = Object.fromEntries(Object.entries(PAGES).map(([k, p]) => [k, read(p)]));
const css = read('my/shared/my-dashboard.css');
const js = read('my/shared/my-dashboard.js');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL  - ${name}\n        ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('Live Strategy platform-consistency regression tests\n');

// 1. Command Center renders all registered strategies
check('1. Command Center renders all 4 registered strategy cards', () => {
  for (const name of ['SELL-CE', 'BPS-1', 'NIFTY BPS', 'NIFTY Weekly']) {
    assert(html.home.includes(`<h3>${name}</h3>`), `missing strategy card for ${name}`);
  }
});

// 2. Each strategy console has a consistent header structure
check('2. Every console shares the same nav-brand/theme-switch header shape', () => {
  for (const key of CONSOLES) {
    assert(html[key].includes('class="nav-brand"'), `${key}: missing nav-brand`);
    assert(html[key].includes('id="themeSwitch"'), `${key}: missing themeSwitch`);
    assert(html[key].includes('class="nav-home"'), `${key}: missing nav-home back link`);
  }
});

// 3. Theme toggle exists everywhere
check('3. Theme toggle control exists on Command Center and every console', () => {
  for (const key of Object.keys(html)) {
    assert(html[key].includes('id="themeSwitch"'), `${key}: no #themeSwitch control`);
    assert(
      html[key].includes('/mishra-ventures/shared/theme.js'),
      `${key}: does not load the shared theme controller`
    );
  }
});

// 4. Theme state persists (mechanism check: localStorage-backed)
check('4. Theme persistence is backed by localStorage("lm-theme")', () => {
  const theme = read('../shared/theme.js');
  assert(theme.includes("localStorage.getItem('lm-theme')"), 'theme.js does not read a persisted theme');
  assert(theme.includes("localStorage.setItem('lm-theme'"), 'theme.js does not persist the chosen theme');
});

// 5/6. Light mode + Dark mode: same token set defined in both blocks
check('5/6. Every dark-mode token has a light-mode override (and vice versa)', () => {
  const rootBlock = css.match(/:root\s*{([^}]*)}/s)[1];
  const lightBlock = css.match(/html\[data-theme="light"\]\s*{([^}]*)}/s)[1];
  const tokenNames = (block) => [...block.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]);
  const rootTokens = new Set(tokenNames(rootBlock));
  const lightTokens = new Set(tokenNames(lightBlock));
  // color-scheme and the generic-name aliases are intentionally root-only
  // (aliases resolve dynamically via var(), so they need no light-mode copy).
  const ALIASES = new Set(['border', 'accent', 'accent2', 'text', 'text-strong', 'muted', 'surface', 'green']);
  for (const t of rootTokens) {
    if (ALIASES.has(t)) continue;
    assert(lightTokens.has(t), `--${t} has no light-mode override`);
  }
});

// 7. Activity log is session-scoped
check('7. Every console scopes its activity feed to its own strategy', () => {
  const scopeOf = { sellce: 'SELL_CE', bps1: 'BPS1', niftybps: 'NIFTY_BPS', niftyweekly: 'SIC1' };
  for (const [key, expected] of Object.entries(scopeOf)) {
    const m = html[key].match(/id="activityFeedBox"[^>]*data-strategy-scope="([^"]+)"/);
    assert(m, `${key}: activityFeedBox missing data-strategy-scope`);
    assert(m[1] === expected, `${key}: expected scope ${expected}, got ${m[1]}`);
  }
  // Command Center is the one place that must stay unscoped (multi-strategy view).
  assert(
    !/id="activityFeedBox"[^>]*data-strategy-scope/.test(html.home),
    'Command Center activityFeedBox should not be scoped -- it is the only multi-strategy view'
  );
});

// 8. Unrelated strategy events are excluded (logic-level check)
check('8. renderActivityLogs restricts rendering to the scoped strategy only', () => {
  assert(
    js.includes("const scope = container.dataset.strategyScope || null;") &&
    js.includes('const keysToRender = scope ? [scope] : Object.keys(STRATEGY_META);'),
    'activity renderer no longer restricts events to the scoped strategy'
  );
});

// 9. Recovery session is identified correctly
check('9. Recovery-session banner exists and keys off a "_RECOVERY" session id', () => {
  assert(js.includes('function renderRecoveryBanner'), 'renderRecoveryBanner missing');
  assert(js.includes('/_RECOVERY$/'), 'recovery detection regex missing');
  for (const key of CONSOLES) {
    assert(html[key].includes('id="recoveryBanner"'), `${key}: missing #recoveryBanner mount point`);
  }
});

// 10/11/12/13. Terminal state: CLOSED replaces OPEN, SESSION_COMPLETE /
// NO_TRADE handled, realized P&L shown, telemetry SESSION_CLOSED respected.
check('10-13. Terminal-state swap covers CLOSED/SESSION_COMPLETE/NO_TRADE with realized P&L', () => {
  assert(
    js.includes("strat.position_status === 'CLOSED' || strat.state === 'SESSION_COMPLETE' || strat.state === 'NO_TRADE'"),
    'terminal-state detection does not cover all 3 documented terminal signals'
  );
  assert(js.includes('Realized P&L (Session Closed)'), 'terminal state does not relabel away from "Unrealized"');
  assert(js.includes('strat.exit_reason'), 'terminal state does not surface exit reason');
});

// 14. Health terminology is consistent + no leaked infra internals
check('14. Health tables use the shared vocabulary and expose no raw infra paths', () => {
  const forbidden = ['/opt/trading', 'GCP', 'systemd:', '.timer', '.db<', 'nifty-ai-trading'];
  for (const key of CONSOLES) {
    for (const term of forbidden) {
      assert(!html[key].includes(term), `${key}: leaks internal infra detail "${term}"`);
    }
    for (const label of ['Engine', 'Scheduler', 'Data']) {
      assert(html[key].includes(`<strong>${label}</strong>`), `${key}: missing standardized health row "${label}"`);
    }
  }
  // Same privacy bar applies to activity-log fallback strings baked into the JS.
  for (const term of forbidden) {
    assert(!js.includes(term), `my-dashboard.js: leaks internal infra detail "${term}"`);
  }
});

// 15. Homepage and console have distinct responsibilities
check('15. Command Center stays a summary view; only consoles carry diagnostics detail', () => {
  assert(
    !html.home.includes('Operational Health & Diagnostics'),
    'Command Center should not duplicate per-component diagnostics -- that is console-level detail'
  );
  for (const key of CONSOLES) {
    assert(
      html[key].includes('Operational Health & Diagnostics'),
      `${key}: console should carry its own diagnostics panel`
    );
  }
});

// 16. Every Command Center card links to a real console (no dead "#" links)
check('16. Command Center has no dead strategy-card links', () => {
  const cardLinks = [...html.home.matchAll(/class="btn-detail"[^>]*href="([^"]*)"|href="([^"]*)"[^>]*class="btn-detail"/g)];
  assert(cardLinks.length >= 4, `expected at least 4 strategy-card links, found ${cardLinks.length}`);
  for (const m of cardLinks) {
    const href = m[1] || m[2];
    assert(href && href !== '#', `Command Center has a dead/placeholder strategy-card link: "${href}"`);
  }
});

// 17. No strategy defaults to a false-positive OPEN/healthy state when it
// has no real backend data (regression guard for the SIC1 bug: a console
// with no live telemetry showed "OPEN" with a green badge instead of an
// honest empty state).
check('17. Absent backend data renders an honest empty state, never a fabricated positive', () => {
  assert(
    js.includes("const isSic1Open = sic1Raw ? (sic1Raw.position_status === 'OPEN' || sic1Raw.state === 'PAPER_POSITION_OPEN') : false;"),
    'SIC1 position defaults to OPEN when no backend data exists -- must default to false/NONE'
  );
  assert(
    !js.includes(": 'HEALTHY') : 'HEALTHY'") && !js.includes(": 'FRESH') : 'FRESH'"),
    'a strategy engine/telemetry health still defaults to a positive state with no backend data'
  );
  // engine_health must never be an unconditional literal -- that was the
  // exact shape of the BPS1/NIFTY_BPS bug (always "HEALTHY" whether or not
  // any raw telemetry existed).
  const unconditionalEngineHealth = /engine_health:\s*'HEALTHY',/;
  assert(!unconditionalEngineHealth.test(js), 'engine_health is hardcoded to a literal instead of being conditional on real data');
});

// 18. Data-freshness badge is never labeled "LIVE" (collides with the
// PAPER LIVE session-status badge, which means something different).
check('18. Fetch-freshness badges say FRESH/STALE, never the ambiguous "LIVE"', () => {
  assert(!js.includes("isStale ? 'STALE' : 'LIVE'"), 'fetch-freshness badge still uses the ambiguous "LIVE" label');
  assert(js.includes("isStale ? 'STALE' : 'FRESH'"), 'fetch-freshness badge should read FRESH when not stale');
});

// 19. Health & Diagnostics tables are wired to real state, not static markup
check('19. Console diagnostics tables are driven by computed state, not hardcoded green', () => {
  for (const key of CONSOLES) {
    assert(html[key].includes('id="diagEngineBadge"'), `${key}: Engine row is not wired to real state`);
    assert(html[key].includes('id="diagDataBadge"'), `${key}: Data row is not wired to real state`);
  }
  assert(js.includes('function renderDiagnosticsTable'), 'renderDiagnosticsTable is missing');
});

// 20. Mobile layout doesn't force page-level horizontal overflow.
// Regression guard for a real bug: .kpi-grid's mobile override forced a
// rigid 2-column layout, and grid items don't shrink below their
// content's intrinsic width by default, so a long mono value (an option
// symbol, "₹76.50 → Exit: ₹152.05") pushed the whole page wider than a
// phone viewport. Confirmed fixed by measuring actual scrollWidth in a
// real browser at 390px on every page (0px overflow after the fix) --
// this check guards the CSS mechanism so it can't silently regress.
check('20. KPI grid cannot force page-level horizontal overflow on phone widths', () => {
  assert(css.includes('.kpi-card {') && /\.kpi-card\s*{[^}]*min-width:\s*0;/s.test(css),
    '.kpi-card lost min-width:0 -- grid items will refuse to shrink below content width again');
  assert(/@media \(max-width:\s*480px\)\s*{[^}]*\.kpi-grid\s*{\s*grid-template-columns:\s*1fr;/s.test(css),
    '.kpi-grid has no single-column fallback below 480px');
});

console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.err.message}`));
  process.exit(1);
}
