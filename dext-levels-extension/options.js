/* Settings are stored, not hardcoded: the Worker URL is deployment-specific and
   baking it into the source would make the extension unusable if it ever moves. */
const DEFAULTS = {
  statusUrl: 'https://live-market-status.itscreativeman04.workers.dev',
  symbol: 'NIFTY',
  refreshMs: 30000,
  // Must match the Worker's READ_TOKEN, or every fetch here silently falls
  // back to the trimmed public payload (price/bias only — no zones), same as
  // the public website page gets. See cloudflare/live_status_worker.js.
  readToken: 'be69f6721a158dc73492425725a4f8bc047f84ef132e7111',
};

chrome.storage.sync.get({ mmCfg: null }, (r) => {
  const c = { ...DEFAULTS, ...(r.mmCfg || {}) };
  document.getElementById('url').value = c.statusUrl;
  document.getElementById('sym').value = c.symbol || '';
  document.getElementById('ms').value = Math.round((c.refreshMs || 30000) / 1000);
  document.getElementById('tok').value = c.readToken || '';
});

document.getElementById('save').addEventListener('click', () => {
  const url = document.getElementById('url').value.trim();
  const sym = document.getElementById('sym').value.trim();
  const secs = Math.min(300, Math.max(10, parseInt(document.getElementById('ms').value, 10) || 30));
  const tok = document.getElementById('tok').value.trim();
  chrome.storage.sync.get({ mmCfg: null }, (r) => {
    const next = { ...DEFAULTS, ...(r.mmCfg || {}), statusUrl: url, symbol: sym, refreshMs: secs * 1000, readToken: tok };
    chrome.storage.sync.set({ mmCfg: next }, () => {
      const ok = document.getElementById('ok');
      ok.textContent = 'Saved — reload your DEXT tab';
      setTimeout(() => { ok.textContent = ''; }, 3500);
    });
  });
});
