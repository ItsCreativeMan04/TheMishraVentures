/* Settings are stored, not hardcoded: the Worker URL is deployment-specific and
   baking it into the source would make the extension unusable if it ever moves. */
const DEFAULTS = {
  statusUrl: 'https://live-market-status.itscreativeman04.workers.dev',
  symbol: 'NIFTY',
  refreshMs: 30000,
};

chrome.storage.sync.get({ mmCfg: null }, (r) => {
  const c = { ...DEFAULTS, ...(r.mmCfg || {}) };
  document.getElementById('url').value = c.statusUrl;
  document.getElementById('sym').value = c.symbol || '';
  document.getElementById('ms').value = Math.round((c.refreshMs || 30000) / 1000);
});

document.getElementById('save').addEventListener('click', () => {
  const url = document.getElementById('url').value.trim();
  const sym = document.getElementById('sym').value.trim();
  const secs = Math.min(300, Math.max(10, parseInt(document.getElementById('ms').value, 10) || 30));
  chrome.storage.sync.get({ mmCfg: null }, (r) => {
    const next = { ...DEFAULTS, ...(r.mmCfg || {}), statusUrl: url, symbol: sym, refreshMs: secs * 1000 };
    chrome.storage.sync.set({ mmCfg: next }, () => {
      const ok = document.getElementById('ok');
      ok.textContent = 'Saved — reload your DEXT tab';
      setTimeout(() => { ok.textContent = ''; }, 3500);
    });
  });
});
