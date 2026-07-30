# Market Map Levels — Chrome extension for Dhan DEXT

Puts your generated key levels **inside DEXT**, so you stop switching to
TradingView to read them.

## Why this is a side panel and not lines on the chart

Dhan's charts do not support custom Pine Scripts — their own support docs say
so, and there are open feature requests asking for it. DEXT embeds the
TradingView **Charting Library**, which has no Pine engine; Pine only exists on
tradingview.com. So `tomorrow_market_map_v4.pine` cannot be loaded into DEXT at
all.

Drawing real lines would mean reaching into Dext's chart widget and mapping
price to pixels. That breaks silently whenever Dext updates, and silent
breakage on a chart you trade from is the worst available failure. This overlay
never touches the canvas: worst case it sits in an awkward spot, it never shows
a wrong level.

## Install (30 seconds)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this folder.
3. Open **https://dext.dhan.co** — the card appears top-right.
4. Drag it by its header. `–` collapses, `⚙` opens settings.

Requires the **browser** version of DEXT (`dext.dhan.co`). The downloadable
desktop app can't be extended by Chrome.

## What it shows

- **The verdict** — same six states and colours as the website banner
  (MANAGE / GET READY / STAND ASIDE / NO NEW ENTRIES / LOOK FOR LONGS|SHORTS / WAIT).
- **Supply zones** above, **context** (PDH / equilibrium / PDL), **demand zones**
  below — the same vertical order as a chart.
- Each level's **signed distance from live price**, which is what decides
  whether it matters in the next few minutes. Anything within ~25 pts is
  highlighted.
- Zone **rating and lifecycle** (`A+ · Fresh`, `A · Tested ×2`).
- **Data age.** Over 5 minutes turns red — stale data is the one failure the
  numbers themselves can't reveal.

## Requirements

The live agent must be publishing (it sends a `levels` block with the zones,
PDH/PDL, equilibrium and invalidation). If the map hasn't been built the card
says so rather than showing an empty frame.

## Limits worth knowing

- Levels are **areas, not entry lines** — the card repeats this in its footer.
- It only ever *displays* the published snapshot; it never recomputes a level,
  so it cannot disagree with the website or the email brief.
- On a fetch failure it keeps the last good snapshot with an explicit age
  rather than blanking.
