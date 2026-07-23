/**
 * Shared client for the live market status feed. Used by both the homepage
 * ticker and the live-market dashboard page, so the fetch/staleness/format
 * logic lives in exactly one place instead of being copy-pasted per page.
 *
 * Cloudflare Worker + KV, not jsDelivr: jsDelivr's purge API silently
 * rate-limits at this feed's ~60-70s update frequency, leaving the site
 * stuck on stale data for 20+ minutes at a time once throttled --
 * fundamentally the wrong tool for near-real-time updates. The Worker
 * (see Trading Research Platform's cloudflare/live_status_worker.js)
 * serves straight from KV with Cache-Control: no-store, so there's no
 * CDN caching layer to fight with at all.
 */
const LIVE_STATUS_URL = 'https://live-market-status.itscreativeman04.workers.dev';
const LIVE_STATUS_STALE_AFTER_MIN = 5;

/**
 * Fetches the current status payload. Adds `_isStale` and `_minsOld` to the
 * parsed object based on `updated_at`. Throws on network failure or a
 * missing/empty status file -- callers should catch and show an
 * offline/no-data state.
 */
async function fetchLiveStatus() {
  const res = await fetch(LIVE_STATUS_URL, { cache: 'no-store' });
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
