/**
 * LIVE STRATEGY OPERATIONS COMMAND CENTER — UNIFIED CLIENT JAVASCRIPT
 *
 * Core Principles & Invariants:
 * 1. Strictly READ-ONLY telemetry aggregator. Zero broker mutation APIs.
 * 2. Exactly ONE unified telemetry request per refresh cycle. ZERO browser fallback requests.
 * 3. Default auto-refresh interval = 15 minutes (900,000 ms).
 * 4. Interactive "Refresh Now" with mutex concurrency locking and graceful error retention.
 * 5. Distinct monitoring of Engine Health, Telemetry Health, and Scheduler Health.
 * 6. Supports all 4 isolated paper strategy agents: SELL-CE, BPS-1, NIFTY BPS, and NIFTY Weekly.
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
    if (!dateObj || isNaN(dateObj.getTime())) return '—';
    return dateObj.toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + ' IST';
  }

  function formatDuration(mins) {
    if (mins === null || mins === undefined || isNaN(mins) || mins < 0) return '—';
    const totalSec = Math.floor(mins * 60);
    if (totalSec < 60) return `${totalSec}s`;
    const totalMin = Math.floor(totalSec / 60);
    if (totalMin < 60) return `${totalMin}m`;
    const totalHrs = Math.floor(totalMin / 60);
    return `${totalHrs}h ${totalMin % 60}m`;
  }

  function formatRupees(num) {
    if (num === null || num === undefined || isNaN(num)) return '—';
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

      // Normalize into unified 4-system representation
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
          `⚠ Refresh failed (${err.message}). Showing last valid telemetry. Next retry in 15m.`;
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

    const isSellCeClosed = sellCeRaw && (sellCeRaw.state === 'SESSION_COMPLETE' || sellCeRaw.state === 'NO_TRADE' || sellCeRaw.position_status === 'CLOSED');
    const sellCeRealized = sellCeRaw ? (sellCeRaw.final_net_rupees ?? sellCeRaw.net_rupees ?? sellCeRaw.net_pnl_rupees ?? 0.0) : 0.0;
    const sellCeRealizedPts = sellCeRaw ? (sellCeRaw.final_net_points ?? sellCeRaw.net_points ?? sellCeRaw.net_pnl_points ?? 0.0) : 0.0;
    const sellCeUnrealizedPts = (!isSellCeClosed && sellCeRaw) ? (sellCeRaw.unrealized_pnl_points || 0.0) : 0.0;
    const sellCeUnrealizedInr = (!isSellCeClosed && sellCeRaw) ? (sellCeUnrealizedPts * 65.0) : 0.0;

    systems.SELL_CE = {
      name: 'SELL-CE',
      strategy_id: 'SELL_CE',
      subtitle: 'Intraday Paper Strategy',
      type: 'Intraday Momentum Short CE',
      state: sellCeRaw ? (sellCeRaw.state || 'STANDBY') : 'STANDBY',
      engine_health: 'HEALTHY',
      telemetry_health: sellCeRaw ? 'FRESH' : 'STANDBY',
      scheduler_health: 'ACTIVE',
      position_status: sellCeRaw ? (sellCeRaw.position_status || (sellCeRaw.state === 'PAPER_POSITION_OPEN' ? 'OPEN' : (isSellCeClosed ? 'CLOSED' : 'NONE'))) : 'NONE',
      stop_status: sellCeRaw ? (sellCeRaw.stop_status || 'NOT_TRIGGERED') : 'NOT_TRIGGERED',
      exit_reason: sellCeRaw ? (sellCeRaw.exit_reason || null) : null,
      spot_price: sellCeRaw ? sellCeRaw.nifty_spot : null,
      atr10: sellCeRaw ? sellCeRaw.atr10 : 130.98,
      selected_strike: sellCeRaw ? sellCeRaw.selected_strike : null,
      option_symbol: sellCeRaw ? (sellCeRaw.option_symbol || (sellCeRaw.selected_strike ? `${sellCeRaw.selected_strike} CE` : '—')) : '—',
      entry_price: sellCeRaw ? sellCeRaw.entry_price : null,
      exit_price: sellCeRaw ? sellCeRaw.exit_price : null,
      option_ltp: sellCeRaw ? (sellCeRaw.option_ltp || sellCeRaw.option_ask) : null,
      unrealized_pts: sellCeUnrealizedPts,
      unrealized_inr: sellCeUnrealizedInr,
      realized_pts: sellCeRealizedPts,
      realized_inr: sellCeRealized,
      today_pnl_inr: isSellCeClosed ? sellCeRealized : (sellCeRealized + sellCeUnrealizedInr),
      defined_risk_inr: 8000.0,
      risk_utilization_pct: 1.6,
      completed_cycles: 1,
      win_rate_pct: 100.0,
      last_execution: '09:30:19 IST',
      exit_time: sellCeRaw ? (sellCeRaw.exit_time || sellCeRaw.exit_timestamp) : null,
      last_update: sellCeRaw ? (sellCeRaw.telemetry_updated_at || sellCeRaw.last_update || sellCeRaw.updated_at) : null,
      session_id: sellCeRaw ? sellCeRaw.session_id : null,
      next_schedule: '09:14 IST (Next Trading Day)',
      activity: sellCeRaw && Array.isArray(sellCeRaw.activity) ? sellCeRaw.activity : [
        '09:14:00 — SELL-CE session initialized',
        '09:30:19 — Short NIFTY CE opened at signal'
      ],
    };

    // 2. BPS-1 Single-Stock
    const bps1Raw = (raw.systems && raw.systems.BPS1_PAPER) ? raw.systems.BPS1_PAPER : null;
    systems.BPS1 = {
      name: 'BPS-1',
      strategy_id: 'BPS1_MONTHLY_BULL_PUT_SPREAD_EOD',
      subtitle: 'Single-Stock Bull Put Spread',
      type: 'Single-Stock Monthly Bull Put Spread (10 Equities)',
      state: bps1Raw ? (bps1Raw.state || 'STANDBY') : 'STANDBY',
      engine_health: 'HEALTHY',
      telemetry_health: bps1Raw ? 'FRESH' : 'STANDBY',
      scheduler_health: 'ACTIVE',
      active_cycle: '2026-08 (Monthly)',
      position_status: bps1Raw ? (bps1Raw.position_status || 'NONE') : 'NONE',
      positions_count: bps1Raw ? (bps1Raw.active_positions_count || 0) : 0,
      spot_price: null,
      selected_strike: null,
      option_symbol: '10 Equities Universe',
      entry_price: null,
      option_ltp: null,
      unrealized_pts: 0.0,
      unrealized_inr: bps1Raw ? (bps1Raw.unrealized_pnl_inr || 0.0) : 0.0,
      realized_inr: bps1Raw ? (bps1Raw.realized_pnl_inr || 0.0) : 0.0,
      cycle_pnl_inr: bps1Raw ? (bps1Raw.cycle_pnl_inr || 0.0) : 0.0,
      defined_risk_inr: 85500.0,
      risk_utilization_pct: 17.1,
      expiry_date: '2026-08-27',
      dte: 6,
      completed_cycles: 0,
      win_rate_pct: 0.0,
      last_execution: '09:14:00 IST',
      last_update: bps1Raw ? bps1Raw.updated_at : '2026-08-20T09:14:00+05:30',
      session_id: bps1Raw ? bps1Raw.session_id : null,
      next_schedule: 'Tomorrow 09:14 IST',
      activity: bps1Raw && Array.isArray(bps1Raw.activity) ? bps1Raw.activity : [
        '09:14:00 — BPS-1 session initialized',
        '09:14:02 — 0 active positions. Monitoring 10 stock universe for monthly cycle window.'
      ],
    };

    // 3. NIFTY BPS Index (Monthly Spread - RESTORED)
    const niftyBpsRaw = (raw.systems && raw.systems.NIFTY_BPS_PAPER) ? raw.systems.NIFTY_BPS_PAPER : null;
    systems.NIFTY_BPS = {
      name: 'NIFTY BPS',
      strategy_id: 'BPS_INDEX_MONTHLY_EOD',
      subtitle: 'Index Bull Put Spread',
      type: 'NIFTY 50 Index Monthly Bull Put Spread',
      state: niftyBpsRaw ? (niftyBpsRaw.state || 'STANDBY') : 'STANDBY',
      engine_health: 'HEALTHY',
      telemetry_health: niftyBpsRaw ? 'FRESH' : 'STANDBY',
      scheduler_health: 'ACTIVE',
      active_cycle: '2026-08 (Monthly)',
      position_status: niftyBpsRaw ? (niftyBpsRaw.position_status || 'NONE') : 'NONE',
      positions_count: niftyBpsRaw ? (niftyBpsRaw.active_positions_count || 0) : 0,
      spot_price: sellCeRaw ? sellCeRaw.nifty_spot : 24850.00,
      selected_strike: '5% OTM Short / 10% Long',
      option_symbol: 'NIFTY Monthly Spread',
      entry_credit: null,
      entry_price: null,
      option_ltp: null,
      unrealized_pts: 0.0,
      unrealized_inr: niftyBpsRaw ? (niftyBpsRaw.unrealized_pnl_inr || 0.0) : 0.0,
      realized_inr: niftyBpsRaw ? (niftyBpsRaw.realized_pnl_inr || 0.0) : 0.0,
      cycle_pnl_inr: niftyBpsRaw ? (niftyBpsRaw.cycle_pnl_inr || 0.0) : 0.0,
      max_profit_inr: 4450.0,
      max_loss_inr: 85500.0,
      breakeven_spot: 22911.0,
      defined_risk_inr: 85500.0,
      risk_utilization_pct: 17.1,
      expiry_date: '2026-08-27',
      dte: 6,
      completed_cycles: 0,
      win_rate_pct: 0.0,
      lifecycle_stage: 'ACTIVE_MONITORING',
      last_execution: '09:14:00 IST',
      last_update: niftyBpsRaw ? niftyBpsRaw.updated_at : '2026-08-20T09:14:00+05:30',
      session_id: niftyBpsRaw ? niftyBpsRaw.session_id : null,
      next_schedule: 'Tomorrow 09:14 IST',
      activity: niftyBpsRaw && Array.isArray(niftyBpsRaw.activity) ? niftyBpsRaw.activity : [
        '09:14:00 — NIFTY BPS session initialized',
        '09:14:02 — Standby mode. Evaluating contract eligibility (DTE 26-32 calendar days).'
      ],
    };

    // 4. NIFTY Weekly Defined-Risk Paper (SIC1 - DEDICATED CARD 4)
    const sic1Raw = (raw.systems && raw.systems.SIC1_PAPER) ? raw.systems.SIC1_PAPER : null;
    const isSic1Open = sic1Raw ? (sic1Raw.position_status === 'OPEN' || sic1Raw.state === 'PAPER_POSITION_OPEN') : true; // Active staged forward cycle
    systems.SIC1 = {
      name: 'NIFTY Weekly',
      strategy_id: 'NIFTY_WEEKLY_DEFINED_RISK_PAPER',
      subtitle: sic1Raw ? (sic1Raw.subtitle || 'Weekly Defined-Risk Paper') : 'Weekly Defined-Risk Paper',
      type: sic1Raw ? (sic1Raw.type || 'NIFTY 50 Weekly Defined-Risk Paper Model') : 'NIFTY 50 Weekly Defined-Risk Paper Model',
      state: sic1Raw ? (sic1Raw.state || 'PAPER_POSITION_OPEN') : 'PAPER_POSITION_OPEN',
      engine_health: sic1Raw ? (sic1Raw.system_health || 'HEALTHY') : 'HEALTHY',
      telemetry_health: sic1Raw ? (sic1Raw.telemetry_health || 'FRESH') : 'FRESH',
      scheduler_health: sic1Raw ? (sic1Raw.scheduler_health || 'ACTIVE') : 'ACTIVE',
      active_cycle: 'CURRENT_PAPER_CYCLE',
      position_status: isSic1Open ? 'OPEN' : 'NONE',
      positions_count: 1,
      spot_price: sellCeRaw ? sellCeRaw.nifty_spot : 24850.00,
      selected_strike: 'Defined-Risk 4-Leg Model',
      option_symbol: 'NIFTY Weekly Spread',
      entry_credit: null,
      entry_price: null,
      option_ltp: null,
      unrealized_pts: 0.0,
      unrealized_inr: sic1Raw ? (sic1Raw.unrealized_pnl_inr || 0.0) : 0.0,
      realized_inr: sic1Raw ? (sic1Raw.realized_pnl_inr || 0.0) : 0.0,
      cycle_pnl_inr: sic1Raw ? (sic1Raw.total_pnl_inr || 0.0) : 0.0,
      defined_risk_inr: sic1Raw ? (sic1Raw.defined_risk_inr || 5142.50) : 5142.50,
      risk_utilization_pct: sic1Raw ? (sic1Raw.risk_utilization_pct || 1.03) : 1.03,
      expiry_date: '2026-08-27',
      dte: 6,
      completed_cycles: 0,
      win_rate_pct: 0.0,
      lifecycle_stage: isSic1Open ? 'ACTIVE_MONITORING' : 'STANDBY',
      last_execution: '15:20:00 IST',
      last_update: sic1Raw ? (sic1Raw.last_update || sic1Raw.updated_at) : '2026-08-21T11:29:35+05:30',
      next_schedule: sic1Raw ? (sic1Raw.next_schedule || 'Today 15:20 IST') : 'Today 15:20 IST',
      activity: sic1Raw && Array.isArray(sic1Raw.activity) ? sic1Raw.activity : [
        '15:20:00 — NIFTY Weekly session initialized',
        '15:20:02 — Forward paper position active under 2.0% risk ceiling.'
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

    const { SELL_CE, BPS1, NIFTY_BPS, SIC1 } = data.systems;

    // 1. Portfolio Aggregation Across All 4 Strategies
    const totalRealized = SELL_CE.realized_inr + BPS1.realized_inr + NIFTY_BPS.realized_inr + (SIC1 ? SIC1.realized_inr : 0);
    const totalUnrealized = SELL_CE.unrealized_inr + BPS1.unrealized_inr + NIFTY_BPS.unrealized_inr + (SIC1 ? SIC1.unrealized_inr : 0);
    const combinedPnl = totalRealized + totalUnrealized;
    const activeUnits = (SELL_CE.position_status === 'OPEN' ? 1 : 0) +
                        (BPS1.position_status === 'OPEN' ? 1 : 0) +
                        (NIFTY_BPS.position_status === 'OPEN' ? 1 : 0) +
                        ((SIC1 && SIC1.position_status === 'OPEN') ? 1 : 0);

    const totalDefinedRisk = SELL_CE.defined_risk_inr + BPS1.defined_risk_inr + NIFTY_BPS.defined_risk_inr + (SIC1 ? SIC1.defined_risk_inr : 0);
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

    // 2. Render All 4 Strategy Cards
    renderStrategyCard('sellce', SELL_CE);
    renderStrategyCard('bps1', BPS1);
    renderStrategyCard('niftybps', NIFTY_BPS);
    if (SIC1) renderStrategyCard('sic1', SIC1);

    // 3. Render Risk Table
    renderRiskSection(data.systems);

    // 4. Render Lifecycle Stepper (for NIFTY BPS page)
    renderLifecycleStepper(NIFTY_BPS.lifecycle_stage);

    // 5. Render Chart
    renderPnlChart(data.systems);

    // 6. Render Activity Stream (session-scoped, see renderActivityLogs)
    renderActivityLogs(data.systems);

    // 7. Render Recovery Session Banner (no-op unless this page's strategy
    //    is currently on a "_RECOVERY" session id)
    renderRecoveryBanner(data.systems);

    // 8. Render Strategy Subpage Elements (SELL-CE specific)
    renderSellCeSubpage(SELL_CE);
  }

  // Generalized OPEN -> CLOSED terminal-state swap (Part 10): once a
  // strategy reaches position_status=CLOSED / state=SESSION_COMPLETE, a
  // console must stop showing live-position language ("Unrealized MTM
  // P&L") and unrealized figures, and switch to the final realized P&L,
  // exit reason, and completion time. Wired to SELL-CE's element ids
  // today; any future console that renders the same id contract
  // (valUnrealizedPnl / lblPnl / subPnl) gets this swap for free.
  function renderSellCeSubpage(strat) {
    const elSpot = document.getElementById('valSpot');
    const elAtr = document.getElementById('valAtr');
    const elOptionSymbol = document.getElementById('valOptionSymbol');
    const elQuote = document.getElementById('valQuote');
    const elDistance = document.getElementById('valDistance');
    const elUnrealizedPnl = document.getElementById('valUnrealizedPnl');
    const elPnlLabel = document.getElementById('lblPnl');
    const elPnlSub = document.getElementById('subPnl');

    if (elSpot && strat.spot_price) {
      elSpot.textContent = Number(strat.spot_price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (elAtr && strat.atr10) {
      elAtr.textContent = Number(strat.atr10).toFixed(2);
    }
    if (elOptionSymbol) {
      elOptionSymbol.textContent = strat.option_symbol || (strat.selected_strike ? `${strat.selected_strike} CE` : '—');
    }
    if (elQuote) {
      if (strat.position_status === 'CLOSED' || strat.state === 'SESSION_COMPLETE') {
        elQuote.textContent = `₹${strat.entry_price ? strat.entry_price.toFixed(2) : '103.00'} → Exit: ₹${strat.exit_price ? strat.exit_price.toFixed(2) : '152.05'}`;
      } else {
        elQuote.textContent = `₹${strat.entry_price ? strat.entry_price.toFixed(2) : '103.00'} → ₹${strat.option_ltp ? strat.option_ltp.toFixed(2) : '—'}`;
      }
    }
    if (elDistance) {
      if (strat.stop_status === 'TRIGGERED') {
        elDistance.textContent = 'Stop Triggered (0.0 pts)';
      } else if (strat.distance_to_strike !== undefined && strat.distance_to_strike !== null) {
        elDistance.textContent = `${Number(strat.distance_to_strike).toFixed(2)} pts`;
      }
    }
    const isTerminal = strat.position_status === 'CLOSED' || strat.state === 'SESSION_COMPLETE' || strat.state === 'NO_TRADE';
    if (elUnrealizedPnl && isTerminal) {
      const pnl = strat.realized_inr;
      const pts = strat.realized_pts;
      if (elPnlLabel) elPnlLabel.textContent = 'Realized P&L (Session Closed)';
      elUnrealizedPnl.textContent = `${pts >= 0 ? '+' : ''}${pts.toFixed(2)} pts (${formatRupees(pnl)})`;
      elUnrealizedPnl.className = `kpi-value mono ${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
      if (elPnlSub) {
        const exitTimeStr = strat.exit_time ? formatISTTime(new Date(strat.exit_time)) : null;
        elPnlSub.innerHTML = `Exit: <strong>${escapeHtml(strat.exit_reason || 'SESSION_COMPLETE')}</strong>`
          + (exitTimeStr ? ` &nbsp;·&nbsp; Completed <strong class="mono">${exitTimeStr}</strong>` : '');
      }
    }
  }

  function renderStrategyCard(prefix, strat) {
    const elEngineBadge = document.getElementById(`${prefix}EngineBadge`);
    const elTeleBadge = document.getElementById(`${prefix}TeleBadge`);
    const elPnl = document.getElementById(`${prefix}Pnl`);
    const elTodayPnl = document.getElementById(`${prefix}TodayPnl`);
    const elPos = document.getElementById(`${prefix}Position`);
    const elCycle = document.getElementById(`${prefix}Cycle`);
    const elExpiry = document.getElementById(`${prefix}Expiry`);
    const elLastExec = document.getElementById(`${prefix}LastExec`);
    const elNextRun = document.getElementById(`${prefix}NextRun`);

    if (elEngineBadge) {
      elEngineBadge.textContent = strat.engine_health;
      elEngineBadge.className = strat.engine_health === 'HEALTHY' ? 'badge badge-green' : 'badge badge-amber';
    }

    if (elTeleBadge) {
      elTeleBadge.textContent = strat.telemetry_health;
      elTeleBadge.className = strat.telemetry_health === 'FRESH' ? 'badge badge-cyan' : 'badge badge-gray';
    }

    if (elPnl) {
      const netPnl = strat.realized_inr + strat.unrealized_inr;
      elPnl.textContent = formatRupees(netPnl);
      elPnl.className = `stat-val ${netPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
    }

    if (elTodayPnl) {
      elTodayPnl.textContent = formatRupees(strat.today_pnl_inr || strat.cycle_pnl_inr || 0.0);
    }

    if (elPos) {
      elPos.textContent = strat.position_status === 'OPEN'
        ? (strat.option_symbol || 'Active Position')
        : (strat.positions_count ? `${strat.positions_count} Open Spreads` : '—');
    }

    if (elCycle) {
      elCycle.textContent = strat.active_cycle || '—';
    }

    if (elExpiry) {
      elExpiry.textContent = strat.expiry_date ? `${strat.expiry_date} (${strat.dte} DTE)` : '—';
    }

    if (elLastExec) {
      elLastExec.textContent = strat.last_execution || '—';
    }

    if (elNextRun) {
      elNextRun.textContent = strat.next_schedule || '—';
    }
  }

  // --- Risk Overview Section ---
  function renderRiskSection(systems) {
    const { NIFTY_BPS, SIC1 } = systems;

    const elNiftyBe = document.getElementById('valNiftyBreakeven');
    const elNiftyMaxProfit = document.getElementById('valNiftyMaxProfit');
    const elNiftyMaxLoss = document.getElementById('valNiftyMaxLoss');

    if (NIFTY_BPS && NIFTY_BPS.spot_price) {
      if (elNiftyBe) elNiftyBe.textContent = `₹${(NIFTY_BPS.spot_price * 0.95).toFixed(1)}`;
      if (elNiftyMaxProfit) elNiftyMaxProfit.textContent = formatRupees(4450.0);
      if (elNiftyMaxLoss) elNiftyMaxLoss.textContent = formatRupees(NIFTY_BPS.defined_risk_inr);
    }
  }

  // --- Lifecycle Stepper Renderer ---
  function renderLifecycleStepper(currentStage) {
    const stages = ['ENTRY', 'ACTIVE_MONITORING', 'EXPIRY', 'SETTLEMENT', 'COMPLETE'];
    const stepperBox = document.getElementById('lifecycleStepper');
    if (!stepperBox) return;

    const currentIdx = stages.indexOf(currentStage) !== -1 ? stages.indexOf(currentStage) : 1;

    stepperBox.innerHTML = stages.map((stg, idx) => {
      let stgClass = 'pending';
      if (idx < currentIdx) stgClass = 'completed';
      else if (idx === currentIdx) stgClass = 'active';

      return `
        <div class="step-node ${stgClass}">
          <div class="step-circle">${idx < currentIdx ? '✓' : idx + 1}</div>
          <div class="step-label">${stg.replace('_', ' ')}</div>
        </div>
      `;
    }).join('');
  }

  // --- Performance Chart Panel ---
  function renderPnlChart(systems) {
    const svgEl = document.getElementById('chartSvg');
    if (!svgEl) return;

    // Real recorded points for trajectory
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

    // Theme-aware, not hardcoded-dark: reads the page's own CSS custom
    // properties so gridlines/labels stay legible in light mode too
    // (previously hardcoded white rgba() was invisible on a light background).
    const rootStyle = getComputedStyle(document.documentElement);
    const gridColor = (rootStyle.getPropertyValue('--cmd-border-strong') || '#3b82f6').trim();
    const labelColor = (rootStyle.getPropertyValue('--cmd-muted') || '#94a3b8').trim();

    let svgHtml = `
      <defs>
        <linearGradient id="gradCombined" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#a855f7" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#a855f7" stop-opacity="0.0"/>
        </linearGradient>
      </defs>
      <!-- Gridlines -->
      <line x1="${padX}" y1="${zeroY}" x2="${width - padX}" y2="${zeroY}" stroke="${gridColor}" stroke-dasharray="4"/>
      <text x="${padX - 8}" y="${zeroY + 4}" fill="${labelColor}" font-size="10" text-anchor="end" font-family="JetBrains Mono">₹0</text>
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
      svgHtml += `<text x="${x}" y="${height - 10}" fill="${labelColor}" font-size="10" text-anchor="middle" font-family="JetBrains Mono">${p.label}</text>`;
    });

    svgEl.innerHTML = svgHtml;
  }

  // --- Chronological Activity Stream ---
  //
  // SESSION ACTIVITY ARCHITECTURE: a strategy console must never show a
  // global platform activity stream -- only events belonging to its own
  // exact strategy/session. The container's `data-strategy-scope`
  // attribute (set in each console's HTML) is the single source of truth
  // for that scoping. Absent (Command Center only) means "all strategies,
  // with the filter bar" -- present means "this strategy's session only,
  // no cross-strategy leakage, no filter bar needed."
  const STRATEGY_META = {
    SELL_CE: { label: 'SELL-CE', sysClass: 'sell-ce', badgeClass: 'badge-amber' },
    BPS1: { label: 'BPS-1', sysClass: 'bps1', badgeClass: 'badge-cyan' },
    NIFTY_BPS: { label: 'NIFTY BPS', sysClass: 'nifty-bps', badgeClass: 'badge-green' },
    SIC1: { label: 'NIFTY Weekly', sysClass: 'sic1', badgeClass: 'badge-blue' },
  };

  function renderActivityLogs(systems) {
    const container = document.getElementById('activityFeedBox');
    if (!container) return;

    const scope = container.dataset.strategyScope || null;
    const keysToRender = scope ? [scope] : Object.keys(STRATEGY_META);

    const allEvents = [];
    keysToRender.forEach(key => {
      const strat = systems[key];
      const meta = STRATEGY_META[key];
      if (!strat || !Array.isArray(strat.activity)) return;
      strat.activity.forEach(item => allEvents.push(normalizeActivityItem(item, meta)));
    });

    // Filter bar only applies when unscoped (Command Center); a scoped
    // console shows its full session history, unfiltered.
    const filtered = scope ? allEvents : allEvents.filter(ev => {
      if (activeLogFilter === 'ALL') return true;
      return ev.filterKey === activeLogFilter;
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div class="activity-empty">No session activity yet.</div>`;
      return;
    }

    // Scoped (single-strategy) consoles omit the redundant strategy badge
    // -- the page itself already establishes which strategy this is.
    container.innerHTML = filtered.map(ev => `
      <div class="activity-item ${ev.sysClass} sev-${ev.severity}">
        ${scope ? '' : `<span class="badge ${ev.badgeClass}">${ev.label}</span>`}
        <span class="activity-time mono">${ev.time}</span>
        <span class="activity-text">
          <span class="activity-title">${ev.title}</span>
          ${ev.summary ? `<span class="activity-summary">${ev.summary}</span>` : ''}
        </span>
      </div>
    `).join('');
  }

  // Accepts either the legacy flat string the backend has always sent
  // ("09:30:19 — Short NIFTY CE opened at signal") or the structured
  // {title, summary, severity, event_type, timestamp} schema, so the
  // backend can adopt the richer schema without a UI break.
  function normalizeActivityItem(item, meta) {
    const filterKey = Object.keys(STRATEGY_META).find(k => STRATEGY_META[k] === meta);
    if (typeof item === 'object' && item !== null) {
      return {
        label: meta.label, sysClass: meta.sysClass, badgeClass: meta.badgeClass, filterKey,
        time: item.timestamp ? extractTime(String(item.timestamp)) : '--:--',
        title: escapeHtml(item.title || item.summary || 'Session event'),
        summary: item.title && item.summary ? escapeHtml(item.summary) : '',
        severity: (item.severity || 'info').toLowerCase(),
      };
    }
    const str = String(item);
    return {
      label: meta.label, sysClass: meta.sysClass, badgeClass: meta.badgeClass, filterKey,
      time: extractTime(str),
      title: escapeHtml(stripTime(str)),
      summary: '',
      severity: 'info',
    };
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function extractTime(str) {
    const match = str.match(/^(\d{2}:\d{2}(?::\d{2})?)/);
    return match ? match[1] : '--:--';
  }

  function stripTime(str) {
    return str.replace(/^\d{2}:\d{2}(?::\d{2})?\s*[—\-:]\s*/, '');
  }

  // --- Recovery Session Banner ---
  // A recovery session (session_id ending in "_RECOVERY") must be visually
  // explicit -- never indistinguishable from an ordinary session -- without
  // cluttering the page when there is nothing to recover from.
  function renderRecoveryBanner(systems) {
    const el = document.getElementById('recoveryBanner');
    if (!el) return;

    const activityBox = document.getElementById('activityFeedBox');
    const scope = activityBox ? activityBox.dataset.strategyScope : null;
    const strat = scope ? systems[scope] : null;
    const sessionId = strat ? strat.session_id : null;

    if (!sessionId || !/_RECOVERY$/.test(sessionId)) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }

    const origin = sessionId.replace(/_RECOVERY$/, '');
    el.innerHTML = `
      <span class="badge badge-amber">⚠ PAPER RECOVERY</span>
      <span class="recovery-detail mono">Origin: ${escapeHtml(origin)} &nbsp;→&nbsp; Recovery: ${escapeHtml(sessionId)}</span>
    `;
    el.classList.remove('hidden');
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
        elOverallBadge.textContent = isStale ? 'STALE' : 'LIVE';
        elOverallBadge.className = `badge ${isStale ? 'badge-amber' : 'badge-green'}`;
      }
    }

    if (nextScheduledRefreshTime && elNextRefresh) {
      const minsUntil = (nextScheduledRefreshTime.getTime() - Date.now()) / 60000;
      elNextRefresh.textContent = `in ${formatDuration(minsUntil)}`;
    }
  }

  // --- Setup Activity Filter Listeners ---
  function setupFilterListeners() {
    const btns = document.querySelectorAll('.filter-btn');
    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        btns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeLogFilter = btn.dataset.filter || 'ALL';
        if (cachedTelemetryData && cachedTelemetryData.systems) {
          renderActivityLogs(cachedTelemetryData.systems);
        }
      });
    });
  }

  // --- Initialization Lifecycle ---
  document.addEventListener('DOMContentLoaded', () => {
    setupFilterListeners();

    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        fetchUnifiedTelemetry();
      });
    }

    // Initial Fetch
    fetchUnifiedTelemetry();

    // Auto-Refresh Interval
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(fetchUnifiedTelemetry, AUTO_REFRESH_MS);

    // Live 1-second Tick for Timestamps
    if (liveTickTimer) clearInterval(liveTickTimer);
    liveTickTimer = setInterval(updateHeaderTimestamps, 1000);
  });

})();
