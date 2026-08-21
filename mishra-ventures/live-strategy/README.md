# Live Strategy — Private Operations Console

Operator documentation for `/mishra-ventures/live-strategy/my/`. Read-only,
`noindex`, gated at `.htaccess` level. Every page here is static HTML/CSS/JS
sharing one design system (`my/shared/my-dashboard.css` + `my-dashboard.js`)
plus the site-wide `shared/theme.js` for dark/light mode.

## Command Center vs. Strategy Console

- **Command Center** (`my/index.html`) answers *"what's happening across all
  strategies?"* — one card per strategy, portfolio-level P&L/risk KPIs, and a
  combined activity feed with a strategy filter. It never carries
  per-component diagnostics detail; that belongs on the console.
- **Strategy Console** (`my/<strategy>/index.html`) answers *"what exactly
  happened with THIS strategy/session?"* — session state, position/P&L,
  operational health, and that strategy's own activity log only.

Don't duplicate console-level diagnostics onto the Command Center, and don't
try to cram portfolio-wide KPIs onto a console.

## Shared shell

Every page loads, in this order: `/mishra-ventures/shared/global.css`,
`/mishra-ventures/shared/components.css` (nav, theme switch, generic tokens),
then `my/shared/my-dashboard.css` (this platform's palette + layout). The nav
markup (`nav > a.nav-brand` + `#themeSwitch` + `.nav-home`) is copy-identical
across every page — do not write a one-off header for a new strategy page.

`my-dashboard.css`'s `:root` defines `--cmd-*` tokens for its own palette, and
also aliases the generic `--accent`/`--border`/`--text`/`--muted`/etc. names
that `components.css`'s shared nav/theme-switch rules read. If you introduce a
new `--cmd-*` token that a shared component needs, alias it too — otherwise
the shared component silently renders unstyled.

## Theme system

One control: `.theme-switch#themeSwitch` (defined in `components.css`,
behavior in the site-root `shared/theme.js`, persisted to
`localStorage['lm-theme']`). Every page also carries a small inline
FOUC-prevention snippet in `<head>` that reads the same key before first
paint — that snippet only sets the initial `data-theme` attribute, it does
not replace `theme.js`; both must be present.

Never hardcode a color that should follow the theme. If you need a runtime
color in JS (e.g. for `<canvas>`/`<svg>` drawing), read it from
`getComputedStyle(document.documentElement)` rather than hardcoding a dark or
light literal — see `renderPnlChart()` in `my-dashboard.js`.

## Health model

Every console's "Operational Health & Diagnostics" table uses the same five
rows and the same vocabulary — no VM paths, database file paths, systemd unit
names, or vendor/product names in the visible details column (private page or
not, this is an operational summary, not a debug log):

| Component | Meaning |
|---|---|
| Engine | The strategy's own execution loop |
| Scheduler | The job that starts sessions on a timer |
| Data | Freshness of the session's own data store |
| Telemetry | Freshness of the published status feed |
| Broker / Market Feed | Connectivity to the read-only market data source |

## Terminology

Use these labels everywhere a status appears — do not introduce a synonym:

- **Session status**: `PAPER LIVE` (a session is running today)
- **Health values**: `HEALTHY`, `ACTIVE`, `FRESH`, `STANDBY`, `STALE`,
  `DEGRADED`, `WARNING`, `CRITICAL`
- **Position**: `POSITION OPEN`, `POSITION CLOSED`, `NO POSITION`
- **Session outcome**: `SESSION COMPLETE`, `NO TRADE`

## Session activity model

A console must only ever render events belonging to its own strategy/session
— never a global platform stream. This is enforced by a `data-strategy-scope`
attribute on each console's `#activityFeedBox` (e.g. `data-strategy-scope=
"SELL_CE"`); `renderActivityLogs()` in `my-dashboard.js` reads that attribute
and restricts rendering to just that strategy. The Command Center's
`#activityFeedBox` deliberately carries **no** scope attribute — it's the one
page allowed to show all strategies, with the filter bar.

Event shape (forward-compatible — the renderer accepts either):

```js
// legacy (current backend), still supported:
"09:30:19 — Short NIFTY CE opened at signal"

// structured (Part 8 schema), preferred going forward:
{ strategy_id, session_id, timestamp, event_type, title, summary, severity, lifecycle_state }
```

Lifecycle event types: `SESSION_STARTED`, `SIGNAL_READY`, `POSITION_OPENED`,
`MONITORING`, `WARNING`, `POSITION_CLOSED`, `SESSION_COMPLETE`, and for
recovery sessions `RECOVERY_STARTED` / `RECOVERY_HANDOFF`. Never put a
proprietary formula, internal threshold, or raw engineering stack trace into
an event's `title`/`summary` — put anything like that behind a diagnostics
surface, not the operator-facing log.

## Recovery sessions

A session whose `session_id` ends in `_RECOVERY` is a recovery of an earlier
failed/interrupted session, not an ordinary run. `renderRecoveryBanner()`
detects this from the strategy's own `session_id` field and renders a
`PAPER RECOVERY` banner with the origin and recovery session ids, mounted at
`#recoveryBanner` inside the strategy header. It stays hidden (default state)
for every ordinary session, so this never adds clutter to the common case.

## Terminal state (OPEN → CLOSED)

Once a strategy's telemetry reaches `position_status=CLOSED` /
`state=SESSION_COMPLETE` (or `NO_TRADE`), a console must stop describing an
open position: no more "Unrealized P&L", no live quote language. Swap to
final realized P&L, exit reason, and completion time. This is implemented
once, generically, in `my-dashboard.js` — see the terminal-state block in
`renderSellCeSubpage()` — and any future console that reuses the same
element-id contract (`valUnrealizedPnl` / `lblPnl` / `subPnl`) gets the swap
for free.

## Adding a new strategy console

1. Copy an existing console page (`my/sell-ce/index.html` is the fullest
   example) and swap the strategy-specific banner text, KPI cards, and risk
   table content.
2. Keep the nav, theme switch, and `.operator-banner` telemetry-status-box
   structure identical.
3. Add `data-strategy-scope="YOUR_STRATEGY_KEY"` to that page's
   `#activityFeedBox`.
4. Add a `STRATEGY_META` entry in `my-dashboard.js` and a normalized object
   in `normalizeTelemetryPayload()`.
5. Add the strategy's card to the Command Center (`my/index.html`) and link
   it to the new console.
6. Run `node tests/consistency.test.mjs` — it checks the shell, theme,
   activity scoping, health vocabulary, and terminal-state contract are all
   still consistent before you ship.
