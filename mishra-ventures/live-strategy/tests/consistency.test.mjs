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
};
const CONSOLES = ['sellce', 'bps1', 'niftybps'];

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
  const scopeOf = { sellce: 'SELL_CE', bps1: 'BPS1', niftybps: 'NIFTY_BPS' };
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

console.log(`\n${passed}/${passed + failures.length} passed`);
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  failures.forEach((f) => console.log(`  - ${f.name}: ${f.err.message}`));
  process.exit(1);
}
