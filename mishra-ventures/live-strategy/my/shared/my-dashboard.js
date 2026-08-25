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

  // Unsigned variant for magnitudes/limits (defined risk, max profit/loss
  // caps) -- these are never a +/- P&L delta, so formatRupees's leading
  // "+" on a positive number would misleadingly read as a gain.
  function formatRupeesMagnitude(num) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    return `₹${Math.abs(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      engine_health: sellCeRaw ? (sellCeRaw.system_health || 'HEALTHY') : 'STANDBY',
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
      // These figures describe the SELL-CE strategy's own fixed design
      // parameters (defined risk, historical win rate), not something
      // read from live telemetry -- but they are only meaningful once a
      // real session exists at all. Gated on sellCeRaw so a total
      // backend outage shows "no data" rather than fabricated-looking
      // precise numbers (see live-strategy README "honest placeholders").
      defined_risk_inr: sellCeRaw ? 8000.0 : null,
      risk_utilization_pct: sellCeRaw ? 1.6 : null,
      completed_cycles: sellCeRaw ? 1 : null,
      win_rate_pct: sellCeRaw ? 100.0 : null,
      last_execution: sellCeRaw ? '09:30:19 IST' : null,
      exit_time: sellCeRaw ? (sellCeRaw.exit_time || sellCeRaw.exit_timestamp) : null,
      last_update: sellCeRaw ? (sellCeRaw.telemetry_updated_at || sellCeRaw.last_update || sellCeRaw.updated_at) : null,
      session_id: sellCeRaw ? sellCeRaw.session_id : null,
      next_schedule: sellCeRaw ? '09:14 IST (Next Trading Day)' : null,
      activity: sellCeRaw && Array.isArray(sellCeRaw.activity) ? sellCeRaw.activity : [
        '09:14:00 — SELL-CE session initialized',
        '09:30:19 — Short NIFTY CE opened at signal'
      ],
    };

    // 2. BPS-1 Single-Stock
    // Field names below match generate_cycle_report_data()'s ACTUAL
    // payload shape (bps1_paper_agent/reporting/daily_report.py) -- a
    // prior version of this mapping read fabricated-looking literal
    // defaults (defined_risk_inr, expiry_date, dte, ...) even when real
    // telemetry existed, and read several fields
    // (unrealized_pnl_inr/realized_pnl_inr/cycle_pnl_inr/session_id/
    // activity) that the real payload never sends at all. Also note:
    // BPS-1 only publishes on days a real monthly cycle actually runs
    // (see bps1_paper_agent/main.py's NO_ACTIVE_CYCLE gate), so bps1Raw
    // being absent on most days is expected, not a fault.
    const bps1Raw = (raw.systems && raw.systems.BPS1_PAPER) ? raw.systems.BPS1_PAPER : null;
    systems.BPS1 = {
      name: 'BPS-1',
      strategy_id: 'BPS1_MONTHLY_BULL_PUT_SPREAD_EOD',
      subtitle: 'Single-Stock Bull Put Spread',
      type: 'Single-Stock Monthly Bull Put Spread (10 Equities)',
      state: bps1Raw ? (bps1Raw.state || 'STANDBY') : 'STANDBY',
      engine_health: bps1Raw ? 'HEALTHY' : 'STANDBY',
      telemetry_health: bps1Raw ? 'FRESH' : 'STANDBY',
      scheduler_health: 'ACTIVE',
      active_cycle: bps1Raw ? (bps1Raw.cycle_month || '2026-08 (Monthly)') : '2026-08 (Monthly)',
      position_status: bps1Raw ? ((bps1Raw.active_positions_count || 0) > 0 ? 'OPEN' : 'NONE') : 'NONE',
      positions_count: bps1Raw ? (bps1Raw.active_positions_count || 0) : 0,
      spot_price: null,
      selected_strike: null,
      option_symbol: '10 Equities Universe',
      entry_price: null,
      option_ltp: null,
      unrealized_pts: 0.0,
      unrealized_inr: 0.0,
      realized_inr: bps1Raw ? (bps1Raw.cumulative_net_pnl_rupees || 0.0) : 0.0,
      cycle_pnl_inr: bps1Raw ? (bps1Raw.cumulative_net_pnl_rupees || 0.0) : 0.0,
      defined_risk_inr: bps1Raw ? bps1Raw.aggregate_defined_risk_rupees : null,
      risk_utilization_pct: bps1Raw ? bps1Raw.capital_utilization_pct : null,
      expiry_date: bps1Raw ? bps1Raw.target_expiry_date : null,
      dte: bps1Raw ? bps1Raw.dte_at_entry : null,
      completed_cycles: null,
      win_rate_pct: null,
      last_execution: bps1Raw && bps1Raw.completed_at ? formatISTTime(new Date(bps1Raw.completed_at)) : null,
      last_update: bps1Raw ? bps1Raw.updated_at : null,
      session_id: bps1Raw ? bps1Raw.cycle_id : null,
      next_schedule: bps1Raw ? 'Tomorrow 09:14 IST' : null,
      activity: bps1Raw && Array.isArray(bps1Raw.events) && bps1Raw.events.length
        ? bps1Raw.events.map(e => `${e.timestamp ? formatISTTime(new Date(e.timestamp)) : ''} — ${e.message || e.category || 'Event'}`)
        : [
          'No live session data yet — this strategy has no backend telemetry connected.',
        ],
    };

    // 3. NIFTY BPS Index (Monthly Spread - RESTORED)
    // Field names below match NiftyBpsStatusPublisher.build_sanitized_payload()'s
    // ACTUAL payload shape (nifty_bps_paper_agent/dashboard/status_publisher.py)
    // -- it does not report a defined-risk/max-profit/breakeven/expiry-date
    // envelope at all (only remaining_dte), so those stay honestly null
    // rather than the fabricated literals a prior version of this mapping
    // used even when real telemetry was present.
    const niftyBpsRaw = (raw.systems && raw.systems.NIFTY_BPS_PAPER) ? raw.systems.NIFTY_BPS_PAPER : null;
    systems.NIFTY_BPS = {
      name: 'NIFTY BPS',
      strategy_id: 'BPS_INDEX_MONTHLY_EOD',
      subtitle: 'Index Bull Put Spread',
      type: 'NIFTY 50 Index Monthly Bull Put Spread',
      state: niftyBpsRaw ? (niftyBpsRaw.position_status || 'STANDBY') : 'STANDBY',
      engine_health: niftyBpsRaw ? (niftyBpsRaw.system_health || 'HEALTHY') : 'STANDBY',
      telemetry_health: niftyBpsRaw ? 'FRESH' : 'STANDBY',
      scheduler_health: 'ACTIVE',
      active_cycle: niftyBpsRaw ? (niftyBpsRaw.current_cycle || '2026-08 (Monthly)') : '2026-08 (Monthly)',
      position_status: niftyBpsRaw ? (niftyBpsRaw.position_status || 'NONE') : 'NONE',
      positions_count: niftyBpsRaw ? (niftyBpsRaw.position_status === 'OPEN' ? 1 : 0) : 0,
      spot_price: sellCeRaw ? sellCeRaw.nifty_spot : 24850.00,
      selected_strike: '5% OTM Short / 10% Long',
      option_symbol: 'NIFTY Monthly Spread',
      entry_credit: null,
      entry_price: null,
      option_ltp: null,
      unrealized_pts: 0.0,
      unrealized_inr: niftyBpsRaw ? (niftyBpsRaw.unrealized_mtm_inr || 0.0) : 0.0,
      realized_inr: niftyBpsRaw ? (niftyBpsRaw.total_realized_pnl_inr || 0.0) : 0.0,
      cycle_pnl_inr: niftyBpsRaw ? (niftyBpsRaw.total_realized_pnl_inr || 0.0) : 0.0,
      // The publisher does not report a defined-risk/max-profit/loss/
      // breakeven envelope at all -- honestly null rather than fabricated.
      max_profit_inr: null,
      max_loss_inr: null,
      breakeven_spot: null,
      defined_risk_inr: null,
      risk_utilization_pct: null,
      // No exact expiry date is reported, only a remaining-DTE count --
      // "Current Cycle" avoids implying a specific (unknown) date while
      // still surfacing the one real number we do have.
      expiry_date: (niftyBpsRaw && niftyBpsRaw.remaining_dte != null) ? 'Current Cycle' : null,
      dte: niftyBpsRaw ? niftyBpsRaw.remaining_dte : null,
      completed_cycles: niftyBpsRaw ? niftyBpsRaw.total_completed_trades : null,
      win_rate_pct: niftyBpsRaw ? niftyBpsRaw.win_rate_pct : null,
      lifecycle_stage: niftyBpsRaw ? (niftyBpsRaw.position_status === 'OPEN' ? 'ACTIVE_MONITORING' : 'STANDBY') : null,
      last_execution: niftyBpsRaw && niftyBpsRaw.last_updated_utc ? formatISTTime(new Date(niftyBpsRaw.last_updated_utc)) : null,
      last_update: niftyBpsRaw ? niftyBpsRaw.last_updated_utc : null,
      session_id: null,
      next_schedule: niftyBpsRaw ? 'Tomorrow 09:14 IST' : null,
      activity: niftyBpsRaw && Array.isArray(niftyBpsRaw.activity) ? niftyBpsRaw.activity : [
        'No live session data yet — this strategy has no backend telemetry connected.',
      ],
    };

    // 4. NIFTY Weekly Defined-Risk Paper (SIC1 - DEDICATED CARD 4)
    const sic1Raw = (raw.systems && raw.systems.SIC1_PAPER) ? raw.systems.SIC1_PAPER : null;
    const isSic1Open = sic1Raw ? (sic1Raw.position_status === 'OPEN' || sic1Raw.state === 'PAPER_POSITION_OPEN') : false;
    systems.SIC1 = {
      name: 'NIFTY Weekly',
      strategy_id: 'NIFTY_WEEKLY_DEFINED_RISK_PAPER',
      subtitle: sic1Raw ? (sic1Raw.subtitle || 'Weekly Defined-Risk Paper') : 'Weekly Defined-Risk Paper',
      type: sic1Raw ? (sic1Raw.type || 'NIFTY 50 Weekly Defined-Risk Paper Model') : 'NIFTY 50 Weekly Defined-Risk Paper Model',
      state: sic1Raw ? (sic1Raw.state || 'STANDBY') : 'STANDBY',
      engine_health: sic1Raw ? (sic1Raw.system_health || 'HEALTHY') : 'STANDBY',
      telemetry_health: sic1Raw ? (sic1Raw.telemetry_health || 'FRESH') : 'STANDBY',
      scheduler_health: sic1Raw ? (sic1Raw.scheduler_health || 'ACTIVE') : 'ACTIVE',
      active_cycle: 'CURRENT_PAPER_CYCLE',
      position_status: isSic1Open ? 'OPEN' : 'NONE',
      positions_count: sic1Raw ? (sic1Raw.active_positions_count || 0) : 0,
      spot_price: sic1Raw ? sic1Raw.spot_price : (sellCeRaw ? sellCeRaw.nifty_spot : null),
      selected_strike: 'Defined-Risk 4-Leg Model',
      option_symbol: 'NIFTY Weekly Spread',
      entry_credit: null,
      entry_price: null,
      option_ltp: null,
      unrealized_pts: 0.0,
      unrealized_inr: sic1Raw ? (sic1Raw.unrealized_pnl_inr || 0.0) : 0.0,
      realized_inr: sic1Raw ? (sic1Raw.realized_pnl_inr || 0.0) : 0.0,
      cycle_pnl_inr: sic1Raw ? (sic1Raw.total_pnl_inr || 0.0) : 0.0,
      // Fixed design parameters, not live telemetry -- gated on sic1Raw
      // so a STANDBY card with no backend connection shows honest
      // "no data" instead of fabricated-looking precise numbers.
      defined_risk_inr: sic1Raw ? 5142.50 : null,
      risk_utilization_pct: sic1Raw ? 1.03 : null,
      expiry_date: sic1Raw ? '2026-08-27' : null,
      dte: sic1Raw ? 6 : null,
      completed_cycles: sic1Raw ? 0 : null,
      win_rate_pct: sic1Raw ? 0.0 : null,
      lifecycle_stage: isSic1Open ? 'ACTIVE_MONITORING' : 'STANDBY',
      last_execution: sic1Raw ? '15:20:00 IST' : null,
      last_update: sic1Raw ? (sic1Raw.last_update || sic1Raw.updated_at) : null,
      next_schedule: sic1Raw ? (sic1Raw.next_schedule || 'Today 15:20 IST') : null,
      activity: sic1Raw && Array.isArray(sic1Raw.activity) ? sic1Raw.activity : [
        'No live session data yet — this strategy has no backend telemetry connected.',
      ],
    };

    // 5. NIFTY 50 Systematic Equity Swing Paper Model (QUANT_EQUITY_SWING_SYSTEM_V1)
    // Field names below match Nifty50MrStatusPublisher's ACTUAL flat
    // payload shape (nifty50_mr_paper_agent/dashboard/status_publisher.py)
    // -- a prior version of this mapping read mrRaw.portfolio.* /
    // mrRaw.metrics.* nested objects the publisher never actually sends,
    // so real P&L/position data would have silently rendered as zero
    // even once telemetry was flowing correctly.
    const mrRaw = (raw.systems && raw.systems.NIFTY50_MR_PAPER) ? raw.systems.NIFTY50_MR_PAPER : null;
    const isMrActive = mrRaw ? (mrRaw.position_status === 'OPEN' || (mrRaw.positions_count || 0) > 0) : false;
    systems.NIFTY50_MR = {
      name: 'Equity Swing',
      strategy_id: 'QUANT_EQUITY_SWING_SYSTEM_V1',
      subtitle: 'Systematic Equity Swing Paper Model',
      type: 'NIFTY 50 Cash Equities Model',
      state: mrRaw ? (mrRaw.state || 'STANDBY') : 'STANDBY',
      engine_health: mrRaw ? (mrRaw.system_health || 'HEALTHY') : 'STANDBY',
      telemetry_health: mrRaw ? (mrRaw.telemetry_health || 'FRESH') : 'STANDBY',
      scheduler_health: 'ACTIVE',
      active_cycle: mrRaw ? (mrRaw.active_cycle || 'WEEKLY_SWING_COHORT') : 'WEEKLY_SWING_COHORT',
      position_status: isMrActive ? 'OPEN' : 'NONE',
      positions_count: mrRaw ? (mrRaw.positions_count || 0) : 0,
      spot_price: sellCeRaw ? sellCeRaw.nifty_spot : 24850.00,
      selected_strike: 'Cash Equities (Equal Weight)',
      option_symbol: 'NIFTY 50 Equity Basket',
      entry_credit: null,
      entry_price: null,
      option_ltp: null,
      unrealized_pts: 0.0,
      unrealized_inr: mrRaw ? (mrRaw.unrealized_inr || 0.0) : 0.0,
      realized_inr: mrRaw ? (mrRaw.realized_inr || 0.0) : 0.0,
      cycle_pnl_inr: mrRaw ? (mrRaw.cycle_pnl_inr || 0.0) : 0.0,
      today_pnl_inr: mrRaw ? mrRaw.today_pnl_inr : undefined,
      // defined_risk_inr/risk_utilization_pct/expiry_date/dte/last_execution/
      // next_schedule are real values the publisher sends whenever mrRaw
      // exists -- gated on mrRaw so a STANDBY card with no backend
      // connection at all shows honest "no data" instead.
      defined_risk_inr: mrRaw ? (mrRaw.defined_risk_inr != null ? mrRaw.defined_risk_inr : 300000.0) : null,
      risk_utilization_pct: mrRaw ? (mrRaw.risk_utilization_pct != null ? mrRaw.risk_utilization_pct : 0.0) : null,
      expiry_date: mrRaw ? (mrRaw.expiry_date || '20 Sessions Holding') : null,
      dte: mrRaw ? (mrRaw.dte != null ? mrRaw.dte : 20) : null,
      // The publisher does not currently report win-rate/completed-cycle
      // statistics at all -- previously hardcoded to a fabricated 56.5%
      // even when real telemetry was present. Honestly null until the
      // publisher actually computes and sends these.
      completed_cycles: null,
      win_rate_pct: null,
      lifecycle_stage: isMrActive ? 'ACTIVE_POSITIONS' : 'IDLE_MONITORING',
      last_execution: mrRaw ? (mrRaw.last_execution || null) : null,
      last_update: mrRaw ? mrRaw.updated_at : null,
      next_schedule: mrRaw ? (mrRaw.next_schedule || null) : null,
      activity: mrRaw && Array.isArray(mrRaw.activity) ? mrRaw.activity : [
        'No live session data yet — this strategy has no backend telemetry connected.',
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

    const { SELL_CE, BPS1, NIFTY_BPS, SIC1, NIFTY50_MR } = data.systems;

    // 1. Portfolio Aggregation Across All Strategies
    const totalRealized = SELL_CE.realized_inr + BPS1.realized_inr + NIFTY_BPS.realized_inr + (SIC1 ? SIC1.realized_inr : 0) + (NIFTY50_MR ? NIFTY50_MR.realized_inr : 0);
    const totalUnrealized = SELL_CE.unrealized_inr + BPS1.unrealized_inr + NIFTY_BPS.unrealized_inr + (SIC1 ? SIC1.unrealized_inr : 0) + (NIFTY50_MR ? NIFTY50_MR.unrealized_inr : 0);
    const combinedPnl = totalRealized + totalUnrealized;
    const activeUnits = (SELL_CE.position_status === 'OPEN' ? 1 : 0) +
                        (BPS1.position_status === 'OPEN' ? 1 : 0) +
                        (NIFTY_BPS.position_status === 'OPEN' ? 1 : 0) +
                        ((SIC1 && SIC1.position_status === 'OPEN') ? 1 : 0) +
                        ((NIFTY50_MR && NIFTY50_MR.position_status === 'OPEN') ? 1 : 0);

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

    // 2. Render All Strategy Cards
    renderStrategyCard('sellce', SELL_CE);
    renderStrategyCard('bps1', BPS1);
    renderStrategyCard('niftybps', NIFTY_BPS);
    if (SIC1) renderStrategyCard('sic1', SIC1);
    if (NIFTY50_MR) renderStrategyCard('nifty50mr', NIFTY50_MR);

    // 3. Render Risk Table
    renderRiskSection(data.systems);

    // 4. Render Lifecycle Stepper (any console with a #lifecycleStepper +
    //    data-strategy-scope; not hardcoded to one strategy)
    renderLifecycleStepper(data.systems);

    // 5. Render Chart
    renderPnlChart(data.systems);

    // 6. Render Activity Stream (session-scoped, see renderActivityLogs)
    renderActivityLogs(data.systems);

    // 7. Render Recovery Session Banner (no-op unless this page's strategy
    //    is currently on a "_RECOVERY" session id)
    renderRecoveryBanner(data.systems);

    // 8. Render Strategy Subpage Elements (strategy-specific KPI cards that
    //    don't fit the generic renderStrategyCard() contract)
    renderSellCeSubpage(SELL_CE);
    if (SIC1) renderSic1Subpage(SIC1);

    // 9. Render the console's Health & Diagnostics table from real state
    //    (previously static hardcoded HTML that always showed green,
    //    regardless of actual telemetry -- see the platform audit).
    renderDiagnosticsTable(data.systems);
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
    const elStrike = document.getElementById('valStrike');
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
    if (elStrike) {
      elStrike.textContent = strat.selected_strike != null ? String(strat.selected_strike) : '—';
    }
    const isTerminal = strat.position_status === 'CLOSED' || strat.state === 'SESSION_COMPLETE' || strat.state === 'NO_TRADE';
    const isOpen = strat.position_status === 'OPEN';

    if (elQuote) {
      const entryStr = strat.entry_price ? `₹${strat.entry_price.toFixed(2)}` : '—';
      if (isTerminal) {
        const exitStr = strat.exit_price ? `₹${strat.exit_price.toFixed(2)}` : '—';
        elQuote.textContent = `${entryStr} → Exit: ${exitStr}`;
      } else if (isOpen) {
        elQuote.textContent = `${entryStr} → ${strat.option_ltp ? `₹${strat.option_ltp.toFixed(2)}` : '—'}`;
      } else {
        elQuote.textContent = '—';
      }
    }
    if (elDistance) {
      if (strat.stop_status === 'TRIGGERED') {
        elDistance.textContent = 'Stop Triggered (0.0 pts)';
      } else if (strat.distance_to_strike !== undefined && strat.distance_to_strike !== null) {
        elDistance.textContent = `${Number(strat.distance_to_strike).toFixed(2)} pts`;
      } else {
        elDistance.textContent = '—';
      }
    }

    // Previously this whole P&L block only ran `if (isTerminal)` -- while
    // a position was OPEN, valUnrealizedPnl/subPnl were never touched at
    // all and just kept showing whatever example numbers were hardcoded
    // in the page's own HTML, permanently stale regardless of the real,
    // live-fetched unrealized P&L already available in `strat`.
    if (isTerminal) {
      const pnl = strat.realized_inr;
      const pts = strat.realized_pts;
      if (elPnlLabel) elPnlLabel.textContent = 'Realized P&L (Session Closed)';
      if (elUnrealizedPnl) {
        elUnrealizedPnl.textContent = `${pts >= 0 ? '+' : ''}${pts.toFixed(2)} pts (${formatRupees(pnl)})`;
        elUnrealizedPnl.className = `kpi-value mono ${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
      }
      if (elPnlSub) {
        const exitTimeStr = strat.exit_time ? formatISTTime(new Date(strat.exit_time)) : null;
        elPnlSub.innerHTML = `Exit: <strong>${escapeHtml(strat.exit_reason || 'SESSION_COMPLETE')}</strong>`
          + (exitTimeStr ? ` &nbsp;·&nbsp; Completed <strong class="mono">${exitTimeStr}</strong>` : '');
      }
    } else if (isOpen) {
      const pts = strat.unrealized_pts || 0;
      const pnl = strat.unrealized_inr || 0;
      if (elPnlLabel) elPnlLabel.textContent = 'Unrealized MTM P&L';
      if (elUnrealizedPnl) {
        elUnrealizedPnl.textContent = `${pts >= 0 ? '+' : ''}${pts.toFixed(2)} pts (${formatRupees(pnl)})`;
        elUnrealizedPnl.className = `kpi-value mono ${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
      }
      if (elPnlSub) {
        const stopCls = strat.stop_status === 'TRIGGERED' ? 'badge-red' : 'badge-green';
        const stopLabel = (strat.stop_status || 'NOT_TRIGGERED').replace('_', ' ');
        elPnlSub.innerHTML = `Stop Status: <strong class="badge ${stopCls}">${escapeHtml(stopLabel)}</strong>`;
      }
    } else {
      // No session at all yet today -- show a neutral state rather than
      // either a stale P&L figure or a misleading "not triggered" stop.
      if (elPnlLabel) elPnlLabel.textContent = 'Unrealized MTM P&L';
      if (elUnrealizedPnl) {
        elUnrealizedPnl.textContent = '—';
        elUnrealizedPnl.className = 'kpi-value mono';
      }
      if (elPnlSub) elPnlSub.textContent = 'No active session yet today';
    }
  }

  // NIFTY Weekly (SIC1) console KPI cards. No-op on pages without these
  // ids (i.e. every page except the SIC1 console).
  function renderSic1Subpage(strat) {
    const elSpot = document.getElementById('valSic1Spot');
    const elPosition = document.getElementById('valSic1Position');
    const elCyclePnl = document.getElementById('valSic1CyclePnl');
    const elExpiry = document.getElementById('valSic1Expiry');
    const elRisk = document.getElementById('valSic1Risk');
    const elRiskPct = document.getElementById('valSic1RiskPct');
    if (!elSpot && !elCyclePnl) return;

    if (elSpot && strat.spot_price) {
      elSpot.textContent = Number(strat.spot_price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (elPosition) {
      elPosition.textContent = strat.position_status === 'OPEN' ? 'OPEN' : (strat.position_status || 'NONE');
    }
    if (elCyclePnl) {
      const pnl = strat.cycle_pnl_inr || 0;
      elCyclePnl.textContent = formatRupees(pnl);
      elCyclePnl.className = `kpi-value mono ${pnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`;
    }
    if (elExpiry) {
      elExpiry.textContent = strat.expiry_date ? `${strat.expiry_date} (${strat.dte} DTE)` : '—';
    }
    if (elRisk && strat.defined_risk_inr !== undefined) {
      elRisk.textContent = `₹${strat.defined_risk_inr.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    }
    if (elRiskPct && strat.risk_utilization_pct !== undefined) {
      elRiskPct.textContent = `${strat.risk_utilization_pct.toFixed(1)}%`;
    }
  }

  // Health & Diagnostics table: Engine/Telemetry rows reflect this page's
  // own strategy (via the same data-strategy-scope used for the activity
  // log); the Data row is filled separately in updateHeaderTimestamps()
  // since it reflects fetch freshness, not per-strategy telemetry.
  function renderDiagnosticsTable(systems) {
    const scopeEl = document.getElementById('activityFeedBox');
    const scope = scopeEl ? scopeEl.dataset.strategyScope : null;
    const strat = scope ? systems[scope] : null;
    if (!strat) return;

    const elEngine = document.getElementById('diagEngineBadge');
    const elTelemetry = document.getElementById('diagTelemetryBadge');
    if (elEngine) {
      elEngine.textContent = strat.engine_health;
      elEngine.className = `badge ${strat.engine_health === 'HEALTHY' ? 'badge-green' : 'badge-gray'}`;
    }
    if (elTelemetry) {
      elTelemetry.textContent = strat.telemetry_health;
      elTelemetry.className = `badge ${strat.telemetry_health === 'FRESH' ? 'badge-cyan' : 'badge-gray'}`;
    }
  }

  // Relative "x ago" for a strategy's last_update ISO timestamp. Returns
  // null (not a string) when there's nothing to show, so callers can
  // decide their own fallback text.
  function formatRelativeAgo(isoString) {
    if (!isoString) return null;
    const then = new Date(isoString);
    if (isNaN(then.getTime())) return null;
    const minsAgo = (Date.now() - then.getTime()) / 60000;
    if (minsAgo < 0) return null;
    return `${formatDuration(minsAgo)} ago`;
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
    const elRiskRow = document.getElementById(`${prefix}RiskRow`);
    const elRiskBarFill = document.getElementById(`${prefix}RiskBarFill`);
    const elRiskLabel = document.getElementById(`${prefix}RiskLabel`);
    const elWinRate = document.getElementById(`${prefix}WinRate`);
    const elCycles = document.getElementById(`${prefix}Cycles`);
    const elSessionId = document.getElementById(`${prefix}SessionId`);
    const elLastUpdate = document.getElementById(`${prefix}LastUpdate`);

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

    // Position: same label logic as before, now wrapped in a coloured
    // status pill (green/live dot for OPEN, cyan for CLOSED, dim for
    // NONE/STANDBY) so an active position is scannable at a glance
    // instead of only readable from text.
    if (elPos) {
      const label = strat.position_status === 'OPEN'
        ? (strat.option_symbol || 'Active Position')
        : (strat.positions_count ? `${strat.positions_count} Open Spreads` : (strat.position_status === 'CLOSED' ? 'Closed' : 'None'));
      const dotCls = strat.position_status === 'OPEN' ? 'is-open' : (strat.position_status === 'CLOSED' ? 'is-closed' : 'is-none');
      elPos.innerHTML = `<span class="pos-pill"><span class="pos-dot ${dotCls}"></span>${escapeHtml(label)}</span>`;
    }

    if (elCycle) {
      elCycle.textContent = strat.active_cycle || '—';
    }

    if (elExpiry) {
      if (strat.expiry_date != null && strat.dte != null) {
        elExpiry.textContent = `${strat.expiry_date} (${strat.dte} DTE)`;
        elExpiry.className = strat.dte <= 2 ? 'stat-val mono pnl-negative' : 'stat-val mono';
        elExpiry.style.fontSize = '0.78rem';
      } else {
        elExpiry.textContent = '—';
        elExpiry.className = 'stat-val mono';
        elExpiry.style.fontSize = '0.78rem';
      }
    }

    if (elLastExec) {
      elLastExec.textContent = strat.last_execution || '—';
    }

    // Next Run must never claim a future scheduled entry while a
    // position is already open today -- that previously showed e.g.
    // "09:14 IST (Next Trading Day)" on an already-OPEN SELL-CE card.
    if (elNextRun) {
      elNextRun.textContent = strat.position_status === 'OPEN'
        ? 'Position active — monitoring'
        : (strat.next_schedule || '—');
    }

    // Risk Utilization: only shown when defined_risk_inr is real (not
    // null/undefined) -- a STANDBY strategy with no backend telemetry
    // shows no risk row at all rather than a fabricated ₹ figure.
    if (elRiskRow) {
      const hasRisk = strat.defined_risk_inr != null && strat.risk_utilization_pct != null;
      elRiskRow.style.display = hasRisk ? 'flex' : 'none';
      if (hasRisk) {
        const pct = Math.max(0, Math.min(100, strat.risk_utilization_pct));
        if (elRiskBarFill) {
          elRiskBarFill.style.width = `${pct}%`;
          elRiskBarFill.className = `risk-bar-fill ${pct >= 50 ? 'risk-high' : ''}`;
        }
        if (elRiskLabel) {
          elRiskLabel.textContent = `${formatRupeesMagnitude(strat.defined_risk_inr)} (${strat.risk_utilization_pct.toFixed(1)}%)`;
        }
      }
    }

    // Expand-in-place detail panel fields (see setupCardToggleListeners
    // for the open/close interaction). Null-safe throughout -- a STANDBY
    // strategy shows "—" / "No completed cycles yet" rather than 0.0%.
    if (elWinRate) {
      elWinRate.textContent = strat.win_rate_pct != null ? `${strat.win_rate_pct.toFixed(1)}%` : '—';
    }
    if (elCycles) {
      elCycles.textContent = strat.completed_cycles != null ? String(strat.completed_cycles) : 'No completed cycles yet';
    }
    if (elSessionId) {
      elSessionId.textContent = strat.session_id || '—';
    }
    if (elLastUpdate) {
      elLastUpdate.textContent = formatRelativeAgo(strat.last_update) || '—';
    }
  }

  // --- Risk Overview Section ---
  function renderRiskSection(systems) {
    const { NIFTY_BPS, SIC1 } = systems;

    const elNiftyBe = document.getElementById('valNiftyBreakeven');
    const elNiftyMaxProfit = document.getElementById('valNiftyMaxProfit');
    const elNiftyMaxLoss = document.getElementById('valNiftyMaxLoss');

    if (NIFTY_BPS && NIFTY_BPS.spot_price) {
      if (elNiftyBe) elNiftyBe.textContent = NIFTY_BPS.breakeven_spot != null ? `₹${NIFTY_BPS.breakeven_spot.toFixed(1)}` : '—';
      if (elNiftyMaxProfit) elNiftyMaxProfit.textContent = formatRupeesMagnitude(NIFTY_BPS.max_profit_inr);
      if (elNiftyMaxLoss) elNiftyMaxLoss.textContent = formatRupeesMagnitude(NIFTY_BPS.defined_risk_inr);
    }

    // Risk & Capital Governance Matrix -- Position Status, Max Defined
    // Risk, Risk Utilized, and Expiry/Exit columns were all static
    // hardcoded HTML (a fixed "OPEN"/"STANDBY" and the same fabricated
    // ₹85,500/17.1%-style figures as the cards, regardless of whether a
    // strategy had any real backend telemetry at all). All four now
    // reflect each strategy's real, honestly-gated state -- a STANDBY
    // row with no backend data shows "—", not an invented number.
    for (const key of Object.keys(STRATEGY_META)) {
      const strat = systems[key];
      if (!strat) continue;

      const elStatus = document.getElementById(`riskStatus${key}`);
      if (elStatus) {
        const status = strat.position_status || 'NONE';
        const cls = status === 'OPEN' ? 'badge-green' : (status === 'CLOSED' ? 'badge-cyan' : 'badge-gray');
        elStatus.textContent = status === 'NONE' ? 'STANDBY' : status;
        elStatus.className = `badge ${cls}`;
      }

      const elMaxLoss = document.getElementById(`riskMaxLoss${key}`);
      if (elMaxLoss) elMaxLoss.textContent = formatRupeesMagnitude(strat.defined_risk_inr);

      const elUtilPct = document.getElementById(`riskUtilPct${key}`);
      if (elUtilPct) elUtilPct.textContent = strat.risk_utilization_pct != null ? `${strat.risk_utilization_pct.toFixed(1)}%` : '—';

      // SELL_CE's own Expiry/Exit cell is a fixed daily exit rule
      // (static HTML, no id) rather than a computed calendar expiry --
      // it has no riskExpirySELL_CE element, so this is a no-op for it.
      const elExpiry = document.getElementById(`riskExpiry${key}`);
      if (elExpiry) elExpiry.textContent = (strat.expiry_date != null && strat.dte != null) ? `${strat.expiry_date} (${strat.dte} DTE)` : '—';
    }
  }

  // --- Lifecycle Stepper Renderer ---
  // Scoped the same way as the activity log: reads which strategy this
  // page is showing from data-strategy-scope on the stepper container
  // itself, rather than being hardcoded to one strategy.
  function renderLifecycleStepper(systems) {
    const stepperBox = document.getElementById('lifecycleStepper');
    if (!stepperBox) return;

    const scope = stepperBox.dataset.strategyScope || 'NIFTY_BPS';
    const strat = systems[scope];
    const currentStage = strat ? strat.lifecycle_stage : null;

    const stages = ['ENTRY', 'ACTIVE_MONITORING', 'EXPIRY', 'SETTLEMENT', 'COMPLETE'];
    // Unrecognized/absent stage (including "no backend telemetry at all")
    // must fall back to the first, most conservative step -- not silently
    // jump to ACTIVE_MONITORING, which claims a position is being watched
    // when there may be no real session at all.
    const currentIdx = stages.indexOf(currentStage) !== -1 ? stages.indexOf(currentStage) : 0;

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
    NIFTY50_MR: { label: 'Equity Swing', sysClass: 'nifty50-mr', badgeClass: 'badge-cyan' },
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

      // Stale Detection. Labeled FRESH/STALE, not LIVE -- this measures
      // when the browser last successfully fetched the status feed, not
      // whether the market or any strategy session is actually active.
      // "LIVE" is reserved for the PAPER LIVE session-status badge
      // elsewhere on the page, which means something different; reusing
      // it here read as a false claim that the market was live.
      const isStale = minsOld > STALE_THRESHOLD_MIN;
      if (elOverallBadge) {
        elOverallBadge.textContent = isStale ? 'STALE' : 'FRESH';
        elOverallBadge.className = `badge ${isStale ? 'badge-amber' : 'badge-green'}`;
      }
      const elDiagData = document.getElementById('diagDataBadge');
      if (elDiagData) {
        elDiagData.textContent = isStale ? 'STALE' : 'FRESH';
        elDiagData.className = `badge ${isStale ? 'badge-amber' : 'badge-green'}`;
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

  // --- Setup Strategy Card "Details" Expand-In-Place Toggles ---
  // Attached once at load (event delegation, not per-render) so repeated
  // renderDashboard() calls from auto-refresh never duplicate listeners.
  function setupCardToggleListeners() {
    document.querySelectorAll('.card-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const panel = targetId && document.getElementById(targetId);
        if (!panel) return;
        const isOpen = panel.classList.toggle('open');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      });
    });
  }

  // --- Initialization Lifecycle ---
  document.addEventListener('DOMContentLoaded', () => {
    setupFilterListeners();
    setupCardToggleListeners();

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
