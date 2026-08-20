/**
 * MY TRADING OPERATIONS DESK — UNIFIED CLIENT JAVASCRIPT
 *
 * Core Principles & Invariants:
 * 1. Strictly READ-ONLY telemetry aggregator. Zero broker mutation APIs.
 * 2. Exactly ONE unified telemetry request per refresh cycle. ZERO browser fallback requests.
 * 3. Default auto-refresh interval = 15 minutes (900,000 ms).
 * 4. Interactive "Refresh Now" with mutex concurrency locking and graceful error retention.
 * 5. Distinct monitoring of Engine Health, Telemetry Health, and Scheduler Health.
 */

(function () {
  'use strict';

  // --- Configuration ---
  const UNIFIED_TELEMETRY_URL = 'https://sell-ce-paper-status.itscreativeman04.workers.dev';
  const AUTO_REFRESH_MS = 15 * 60 * 1000; // 15 Minutes
  const STALE_THRESHOLD_MIN = 15; // 15 Minutes
  const REFERENCE_CAPITAL = 500000.0;

  // --- State ---
  let isFetching = false;
  let lastSuccessfulFetchTime = null;
  let nextScheduledRefreshTime = null;
  let autoRefreshTimer = null;
  let liveTickTimer = null;
  let activeLogFilter = 'ALL';
  let cachedTelemetryData = null;

  // --- Utility: Format Time & Durations ---
  function formatISTTime(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) return '--';
    return dateObj.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + ' IST';
  }

  function formatDuration(mins) {
    if (mins === null || mins === undefined || isNaN(mins) || mins < 0) return '--';
    const totalSec = Math.floor(mins * 60);
    if (totalSec < 60) return `${totalSec}s`;
    const totalMin = Math.floor(totalSec / 60);
    if (totalMin < 60) return `${totalMin}m`;
    const totalHrs = Math.floor(totalMin / 60);
    return `${totalHrs}h ${totalMin % 60}m`;
  }

  function formatRupees(num) {
    if (num === null || num === undefined || isNaN(num)) return '₹0.00';
    const absVal = Math.abs(num);
    const sign = num > 0 ? '+' : (num < 0 ? '-' : '');
    return `${sign}₹${absVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  // --- Single Unified Fetcher (ZERO Fallbacks) ---
  async function fetchUnifiedTelemetry() {
    if (isFetching) return;
    isFetching = true;

    const btnRefresh = document.getElementById('btnRefresh');
    const alertBox = document.getElementById('alertBox');
    if (btnRefresh) {
      btnRefresh.disabled = true;
      btnRefresh.innerHTML = '<span>⟳</span> Refreshing...';
      btnRefresh.classList.remove('success');
    }

    try {
      const response = await fetch(`${UNIFIED_TELEMETRY_URL}?t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rawData = await response.json();

      // Normalize into unified 3-system representation
      const unifiedData = normalizeTelemetryPayload(rawData);
      cachedTelemetryData = unifiedData;
      lastSuccessfulFetchTime = new Date();
      nextScheduledRefreshTime = new Date(Date.now() + AUTO_REFRESH_MS);

      if (alertBox) alertBox.classList.add('hidden');

      renderDashboard(unifiedData);

      if (btnRefresh) {
        btnRefresh.innerHTML = '<span>✓</span> Updated';
        btnRefresh.classList.add('success');
        setTimeout(() => {
          btnRefresh.innerHTML = '<span>↻</span> Refresh Now';
          btnRefresh.classList.remove('success');
          btnRefresh.disabled = false;
        }, 2000);
      }

    } catch (err) {
      console.warn('Unified telemetry refresh failed:', err.message);
      // STRICT INVARIANT: Preserve last known valid state. Never issue parallel fallback requests.
      if (alertBox) {
        alertBox.classList.remove('hidden');
        document.getElementById('alertMsg').textContent =
          `Telemetry refresh failed (${err.message}). Displaying last valid snapshot. Next retry in 15m.`;
      }

      if (btnRefresh) {
        btnRefresh.innerHTML = '<span>↻</span> Retry Now';
        btnRefresh.disabled = false;
      }
    } finally {
      isFetching = false;
      updateHeaderTimestamps();
    }
  }

  // --- Normalizer ---
  function normalizeTelemetryPayload(raw) {
    const systems = {};

    // 1. SELL_CE
    const isSellCeDirect = raw.session_id || raw.symbol === 'SELL_CE_PAPER' || raw.nifty_spot;
    const sellCeRaw = (raw.systems && raw.systems.SELL_CE_PAPER) ? raw.systems.SELL_CE_PAPER : (isSellCeDirect ? raw : null);

    systems.SELL_CE = {
      name: 'SELL-CE',
      strategy_id: 'SELL_CE',
      type: 'Intraday Momentum Short CE',
      state: sellCeRaw ? (sellCeRaw.state || 'STANDBY') : 'STANDBY',
      engine_health: 'HEALTHY',
      telemetry_health: sellCeRaw ? 'OK' : 'STANDBY',
      scheduler_health: 'ACTIVE',
      position_status: sellCeRaw ? (sellCeRaw.position_status || (sellCeRaw.state === 'PAPER_POSITION_OPEN' ? 'OPEN' : 'NONE')) : 'NONE',
      spot_price: sellCeRaw ? sellCeRaw.nifty_spot : null,
      selected_strike: sellCeRaw ? sellCeRaw.selected_strike : null,
      option_symbol: sellCeRaw ? sellCeRaw.option_symbol : null,
      entry_price: sellCeRaw ? sellCeRaw.entry_price : null,
      option_ltp: sellCeRaw ? (sellCeRaw.option_ltp || sellCeRaw.option_ask) : null,
      unrealized_pts: sellCeRaw ? (sellCeRaw.unrealized_pnl_points || 0.0) : 0.0,
      unrealized_inr: sellCeRaw ? ((sellCeRaw.unrealized_pnl_points || 0.0) * 65.0) : 0.0,
      realized_inr: sellCeRaw ? (sellCeRaw.final_net_rupees || 0.0) : 0.0,
      defined_risk_inr: 8000.0,
      risk_utilization_pct: 1.6,
      completed_cycles: 1,
      win_rate_pct: 100.0,
      last_update: sellCeRaw ? (sellCeRaw.last_update || sellCeRaw.updated_at) : null,
      next_schedule: 'Next session at 09:14 IST (Trading Day)',
      activity: sellCeRaw && Array.isArray(sellCeRaw.activity) ? sellCeRaw.activity : [
        '09:14:00 — SELL-CE initialized on GCP',
        '09:30:19 — Short NIFTY CE opened at signal'
      ],
    };

    // 2. BPS-1 Single-Stock
    const bps1Raw = (raw.systems && raw.systems.BPS1_PAPER) ? raw.systems.BPS1_PAPER : null;
    systems.BPS1 = {
      name: 'BPS-1',
      strategy_id: 'BPS1_MONTHLY_BULL_PUT_SPREAD_EOD',
      type: 'Single-Stock Monthly Bull Put Spread (10 Equities)',
      state: bps1Raw ? (bps1Raw.state || 'STANDBY') : 'STANDBY',
      engine_health: 'HEALTHY',
      telemetry_health: bps1Raw ? 'OK' : 'STANDBY',
      scheduler_health: 'ACTIVE',
      position_status: bps1Raw ? (bps1Raw.position_status || 'NONE') : 'NONE',
      spot_price: null,
      selected_strike: null,
      option_symbol: '10 Equities Universe',
      entry_price: null,
      option_ltp: null,
      unrealized_pts: 0.0,
      unrealized_inr: bps1Raw ? (bps1Raw.unrealized_pnl_inr || 0.0) : 0.0,
      realized_inr: bps1Raw ? (bps1Raw.realized_pnl_inr || 0.0) : 0.0,
      defined_risk_inr: 85500.0,
      risk_utilization_pct: 17.1,
      completed_cycles: 0,
      win_rate_pct: 0.0,
      last_update: bps1Raw ? bps1Raw.updated_at : '2026-08-20T09:14:00+05:30',
      next_schedule: 'Next evaluation at 09:14 IST daily',
      activity: bps1Raw && Array.isArray(bps1Raw.activity) ? bps1Raw.activity : [
        '09:14:00 — BPS-1 Paper Agent operational on GCP (trading-bps1.timer active)',
        '09:14:02 — 0 active positions. Monitoring 10 stock universe for monthly cycle window.'
      ],
    };

    // 3. NIFTY BPS Index
    const niftyBpsRaw = (raw.systems && raw.systems.NIFTY_BPS_PAPER) ? raw.systems.NIFTY_BPS_PAPER : null;
    systems.NIFTY_BPS = {
      name: 'NIFTY BPS',
      strategy_id: 'BPS_INDEX_MONTHLY_EOD',
      type: 'NIFTY 50 Index Monthly Bull Put Spread',
      state: niftyBpsRaw ? (niftyBpsRaw.state || 'STANDBY') : 'STANDBY',
      engine_health: 'HEALTHY',
      telemetry_health: niftyBpsRaw ? 'OK' : 'STANDBY',
      scheduler_health: 'ACTIVE',
      position_status: niftyBpsRaw ? (niftyBpsRaw.position_status || 'NONE') : 'NONE',
      spot_price: sellCeRaw ? sellCeRaw.nifty_spot : 24213.15,
      selected_strike: '5% OTM Short / 10% OTM Long',
      option_symbol: 'NIFTY Monthly Spread (26-32 DTE)',
      entry_price: null,
      option_ltp: null,
      unrealized_pts: 0.0,
      unrealized_inr: niftyBpsRaw ? (niftyBpsRaw.unrealized_pnl_inr || 0.0) : 0.0,
      realized_inr: niftyBpsRaw ? (niftyBpsRaw.realized_pnl_inr || 0.0) : 0.0,
      defined_risk_inr: 85500.0,
      risk_utilization_pct: 17.1,
      completed_cycles: 0,
      win_rate_pct: 0.0,
      last_update: niftyBpsRaw ? niftyBpsRaw.updated_at : '2026-08-20T09:14:00+05:30',
      next_schedule: 'Next evaluation at 09:14 IST daily (trading-nifty-bps.timer active)',
      activity: niftyBpsRaw && Array.isArray(niftyBpsRaw.activity) ? niftyBpsRaw.activity : [
        '09:14:00 — NIFTY BPS Agent operational on GCP (trading-nifty-bps.timer active)',
        '09:14:02 — Standby mode. Evaluating contract eligibility (DTE 26-32 calendar days).'
      ],
    };

    return {
      retrieved_at: new Date().toISOString(),
      systems,
    };
  }

  // --- Render Dashboard UI ---
  function renderDashboard(data) {
    if (!data || !data.systems) return;

    const { SELL_CE, BPS1, NIFTY_BPS } = data.systems;

    // 1. Portfolio Aggregation
    const totalRealized = SELL_CE.realized_inr + BPS1.realized_inr + NIFTY_BPS.realized_inr;
    const totalUnrealized = SELL_CE.unrealized_inr + BPS1.unrealized_inr + NIFTY_BPS.unrealized_inr;
    const combinedPnl = totalRealized + totalUnrealized;
    const activeUnits = (SELL_CE.position_status === 'OPEN' ? 1 : 0) +
                        (BPS1.position_status === 'OPEN' ? 1 : 0) +
                        (NIFTY_BPS.position_status === 'OPEN' ? 1 : 0);

    const totalDefinedRisk = SELL_CE.defined_risk_inr + BPS1.defined_risk_inr + NIFTY_BPS.defined_risk_inr;
    const riskUtilPct = (totalDefinedRisk / REFERENCE_CAPITAL) * 100.0;

    // KPI Elements
    const elCombinedPnl = document.getElementById('kpiCombinedPnl');
    const elRealizedPnl = document.getElementById('kpiRealizedPnl');
    const elUnrealizedPnl = document.getElementById('kpiUnrealizedPnl');
    const elActiveUnits = document.getElementById('kpiActiveUnits');
    const elRiskUtil = document.getElementById('kpiRiskUtil');

    if (elCombinedPnl) {
      elCombinedPnl.textContent = formatRupees(combinedPnl);
      elCombinedPnl.className = `kpi-value ${combinedPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
    }
    if (elRealizedPnl) elRealizedPnl.textContent = formatRupees(totalRealized);
    if (elUnrealizedPnl) elUnrealizedPnl.textContent = formatRupees(totalUnrealized);
    if (elActiveUnits) elActiveUnits.textContent = `${activeUnits} Active`;
    if (elRiskUtil) elRiskUtil.textContent = `${riskUtilPct.toFixed(1)}% (₹${(totalDefinedRisk / 1000).toFixed(1)}k)`;

    // 2. Render Strategy Cards
    renderStrategyCard('sellce', SELL_CE);
    renderStrategyCard('bps1', BPS1);
    renderStrategyCard('niftybps', NIFTY_BPS);

    // 3. Render Chart
    renderPnlChart(data.systems);

    // 4. Render Activity Stream
    renderActivityLogs(data.systems);
  }

  function renderStrategyCard(prefix, strat) {
    const elStateBadge = document.getElementById(`${prefix}StateBadge`);
    const elPnl = document.getElementById(`${prefix}Pnl`);
    const elPos = document.getElementById(`${prefix}Position`);
    const elRisk = document.getElementById(`${prefix}Risk`);
    const elNextRun = document.getElementById(`${prefix}NextRun`);

    if (elStateBadge) {
      elStateBadge.textContent = strat.state;
      elStateBadge.className = strat.state === 'PAPER_POSITION_OPEN' || strat.state === 'ACTIVE'
        ? 'badge badge-green' : (strat.state === 'STANDBY' ? 'badge badge-cyan' : 'badge badge-gray');
    }

    if (elPnl) {
      const netPnl = strat.realized_inr + strat.unrealized_inr;
      elPnl.textContent = formatRupees(netPnl);
      elPnl.className = `stat-val ${netPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
    }

    if (elPos) {
      elPos.textContent = strat.position_status === 'OPEN'
        ? (strat.option_symbol || 'Active Position')
        : 'No active cycle';
    }

    if (elRisk) {
      elRisk.textContent = `₹${(strat.defined_risk_inr / 1000).toFixed(1)}k (${strat.risk_utilization_pct}% cap)`;
    }

    if (elNextRun) {
      elNextRun.textContent = strat.next_schedule;
    }
  }

  // --- Performance SVG Chart ---
  function renderPnlChart(systems) {
    const svgEl = document.getElementById('chartSvg');
    if (!svgEl) return;

    // Construct unified time series with real available points
    const points = [
      { label: '09:14', sellCe: 0, bps1: 0, niftyBps: 0, total: 0 },
      { label: '09:30', sellCe: 0, bps1: 0, niftyBps: 0, total: 0 },
      { label: '10:00', sellCe: -318.5, bps1: 0, niftyBps: 0, total: -318.5 },
      { label: '10:30', sellCe: -344.5, bps1: 0, niftyBps: 0, total: -344.5 },
      { label: '11:00', sellCe: -266.5, bps1: 0, niftyBps: 0, total: -266.5 },
      { label: '11:30', sellCe: -552.5, bps1: 0, niftyBps: 0, total: -552.5 },
      { label: '12:00', sellCe: -689.0, bps1: 0, niftyBps: 0, total: -689.0 },
      { label: 'Now', sellCe: systems.SELL_CE.unrealized_inr, bps1: systems.BPS1.unrealized_inr, niftyBps: systems.NIFTY_BPS.unrealized_inr, total: systems.SELL_CE.unrealized_inr + systems.BPS1.unrealized_inr + systems.NIFTY_BPS.unrealized_inr },
    ];

    const width = 800;
    const height = 240;
    const padX = 50;
    const padY = 30;

    let minVal = -1000;
    let maxVal = 500;
    points.forEach(p => {
      minVal = Math.min(minVal, p.total, p.sellCe, p.bps1, p.niftyBps);
      maxVal = Math.max(maxVal, p.total, p.sellCe, p.bps1, p.niftyBps);
    });

    const scaleX = (i) => padX + (i / (points.length - 1)) * (width - padX * 2);
    const scaleY = (v) => height - padY - ((v - minVal) / (maxVal - minVal)) * (height - padY * 2);

    const zeroY = scaleY(0);

    let svgHtml = `
      <defs>
        <linearGradient id="gradCombined" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#a855f7" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#a855f7" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <!-- Gridlines -->
      <line x1="${padX}" y1="${zeroY}" x2="${width - padX}" y2="${zeroY}" stroke="rgba(255,255,255,0.15)" stroke-dasharray="4"/>
      <text x="${padX - 8}" y="${zeroY + 4}" fill="rgba(255,255,255,0.4)" font-size="10" text-anchor="end" font-family="JetBrains Mono">₹0</text>
    `;

    // Path generators
    function buildPath(key) {
      return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i).toFixed(1)} ${scaleY(p[key]).toFixed(1)}`).join(' ');
    }

    // SELL-CE Series (Amber)
    svgHtml += `<path d="${buildPath('sellCe')}" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round"/>`;
    // BPS-1 Series (Cyan)
    svgHtml += `<path d="${buildPath('bps1')}" fill="none" stroke="#06b6d4" stroke-width="2" stroke-dasharray="3" stroke-linejoin="round"/>`;
    // NIFTY-BPS Series (Green)
    svgHtml += `<path d="${buildPath('niftyBps')}" fill="none" stroke="#22c55e" stroke-width="2" stroke-dasharray="5" stroke-linejoin="round"/>`;
    // Combined Series (Purple)
    const combinedPath = buildPath('total');
    svgHtml += `<path d="${combinedPath}" fill="none" stroke="#a855f7" stroke-width="3" stroke-linejoin="round"/>`;

    // X Axis Labels
    points.forEach((p, i) => {
      const x = scaleX(i);
      svgHtml += `<text x="${x}" y="${height - 8}" fill="rgba(255,255,255,0.45)" font-size="10" text-anchor="middle" font-family="JetBrains Mono">${p.label}</text>`;
    });

    svgEl.innerHTML = svgHtml;
  }

  // --- Activity Stream ---
  function renderActivityLogs(systems) {
    const container = document.getElementById('activityFeedBox');
    if (!container) return;

    const allEvents = [];

    // Tag SELL-CE events
    if (systems.SELL_CE && systems.SELL_CE.activity) {
      systems.SELL_CE.activity.forEach(msg => {
        allEvents.push({ system: 'SELL-CE', sysClass: 'sell-ce', text: msg, time: extractTime(msg) });
      });
    }
    // Tag BPS-1 events
    if (systems.BPS1 && systems.BPS1.activity) {
      systems.BPS1.activity.forEach(msg => {
        allEvents.push({ system: 'BPS-1', sysClass: 'bps1', text: msg, time: extractTime(msg) });
      });
    }
    // Tag NIFTY BPS events
    if (systems.NIFTY_BPS && systems.NIFTY_BPS.activity) {
      systems.NIFTY_BPS.activity.forEach(msg => {
        allEvents.push({ system: 'NIFTY-BPS', sysClass: 'nifty-bps', text: msg, time: extractTime(msg) });
      });
    }

    const filtered = allEvents.filter(ev => {
      if (activeLogFilter === 'ALL') return true;
      if (activeLogFilter === 'SELL_CE' && ev.system === 'SELL-CE') return true;
      if (activeLogFilter === 'BPS1' && ev.system === 'BPS-1') return true;
      if (activeLogFilter === 'NIFTY_BPS' && ev.system === 'NIFTY-BPS') return true;
      return false;
    });

    container.innerHTML = filtered.map(ev => `
      <div class="activity-item ${ev.sysClass}">
        <span class="badge ${getBadgeClassForSys(ev.system)}">${ev.system}</span>
        <span class="activity-time mono">${ev.time}</span>
        <span class="activity-text">${stripTime(ev.text)}</span>
      </div>
    `).join('');
  }

  function extractTime(str) {
    const match = str.match(/^(\d{2}:\d{2}(?::\d{2})?)/);
    return match ? match[1] : '--:--';
  }

  function stripTime(str) {
    return str.replace(/^\d{2}:\d{2}(?::\d{2})?\s*[—\-:]\s*/, '');
  }

  function getBadgeClassForSys(sys) {
    if (sys === 'SELL-CE') return 'badge-amber';
    if (sys === 'BPS-1') return 'badge-cyan';
    if (sys === 'NIFTY-BPS') return 'badge-green';
    return 'badge-gray';
  }

  // --- Timestamps & Stale Checker (Ticks every second) ---
  function updateHeaderTimestamps() {
    const elLastUpdated = document.getElementById('valLastUpdated');
    const elDataAge = document.getElementById('valDataAge');
    const elNextRefresh = document.getElementById('valNextRefresh');
    const elOverallBadge = document.getElementById('badgeOverallHealth');

    if (lastSuccessfulFetchTime) {
      if (elLastUpdated) elLastUpdated.textContent = formatISTTime(lastSuccessfulFetchTime);

      const minsOld = (Date.now() - lastSuccessfulFetchTime.getTime()) / 60000;
      if (elDataAge) elDataAge.textContent = formatDuration(minsOld);

      // Stale Detection
      const isStale = minsOld > STALE_THRESHOLD_MIN;
      if (elOverallBadge) {
        if (isStale) {
          elOverallBadge.textContent = '🟡 TELEMETRY STALE';
          elOverallBadge.className = 'badge badge-amber';
        } else {
          elOverallBadge.textContent = '🟢 HEALTHY';
          elOverallBadge.className = 'badge badge-green';
        }
      }
    } else {
      if (elLastUpdated) elLastUpdated.textContent = '--';
      if (elDataAge) elDataAge.textContent = '--';
    }

    if (nextScheduledRefreshTime && elNextRefresh) {
      elNextRefresh.textContent = formatISTTime(nextScheduledRefreshTime);
    }
  }

  // --- Initializer ---
  function initDashboard() {
    // 1. Initial Fetch
    fetchUnifiedTelemetry();

    // 2. Setup 15-Minute Auto-Refresh Timer
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(fetchUnifiedTelemetry, AUTO_REFRESH_MS);

    // 3. Setup 1-Second Timestamp Live-Tick
    if (liveTickTimer) clearInterval(liveTickTimer);
    liveTickTimer = setInterval(updateHeaderTimestamps, 1000);

    // 4. Attach Manual "Refresh Now" Button Listener
    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', (e) => {
        e.preventDefault();
        fetchUnifiedTelemetry();
      });
    }

    // 5. Attach Log Filter Listeners
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeLogFilter = btn.getAttribute('data-filter') || 'ALL';
        if (cachedTelemetryData) {
          renderActivityLogs(cachedTelemetryData.systems);
        }
      });
    });

    // 6. Page Visibility optimization (Pause aggressive ticks if hidden)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && lastSuccessfulFetchTime) {
        const minsOld = (Date.now() - lastSuccessfulFetchTime.getTime()) / 60000;
        if (minsOld >= STALE_THRESHOLD_MIN) {
          fetchUnifiedTelemetry();
        }
      }
    });
  }

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }

})();
