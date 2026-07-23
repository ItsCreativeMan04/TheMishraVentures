/**
 * Shared client for the live market status feed. Used by both the homepage
 * ticker and the live-market dashboard page, so the fetch/staleness/format
 * logic lives in exactly one place instead of being copy-pasted per page.
 *
 * jsDelivr, not raw.githubusercontent.com: GitHub's raw content CDN caches
 * ~5 minutes and largely ignores cache-busting query strings. jsDelivr
 * caches too, but the publisher (Trading Research Platform's
 * StatusPublisher) explicitly purges it after every push, so this stays
 * fresh within seconds instead of stalling on a fixed TTL.
 */
const LIVE_STATUS_URL = 'https://cdn.jsdelivr.net/gh/ItsCreativeMan04/live-market-status@main/status.json';
const LIVE_STATUS_STALE_AFTER_MIN = 5;

/**
 * Fetches the current status payload. Adds `_isStale` and `_minsOld` to the
 * parsed object based on `updated_at`. Throws on network failure or a
 * missing/empty status file -- callers should catch and show an
 * offline/no-data state.
 */
async function fetchLiveStatus() {
  const res = await fetch(`${LIVE_STATUS_URL}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('No status file yet');
  const data = await res.json();

  const minsOld = data.updated_at
    ? (Date.now() - new Date(data.updated_at).getTime()) / 60000
    : Infinity;
  data._minsOld = minsOld;
  data._isStale = minsOld > LIVE_STATUS_STALE_AFTER_MIN;
  return data;
}

function fmtLivePrice(v) {
  return (typeof v === 'number') ? '₹' + v.toFixed(2) : '–';
}

function fmtLiveAgo(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (isNaN(then)) return null;
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  return `${mins} minutes ago`;
}

function liveBiasClass(bias) {
  if (!bias) return 'neutral';
  const b = String(bias).toLowerCase();
  if (b.includes('bull')) return 'bullish';
  if (b.includes('bear')) return 'bearish';
  return 'neutral';
}
