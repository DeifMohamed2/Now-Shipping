/**
 * dashboard-analytics.js
 * Drives the professional business analytics dashboard.
 * Requires: ApexCharts (loaded before this file)
 */

(function () {
  'use strict';

  /* ── i18n ──────────────────────────────────────────────────────────────── */
  let _i18n = {};
  try {
    const el = document.getElementById('ns-dashboard-i18n');
    if (el) _i18n = JSON.parse(el.textContent || '{}');
  } catch (_) {}

  const L  = _i18n.labels || {};
  const ST = L.statuses || {};
  const LANG     = _i18n.lang || 'en';
  const CURRENCY = _i18n.currency || 'EGP';
  const IS_RTL   = document.documentElement.dir === 'rtl';
  const LEGEND_ALIGN_TOP = IS_RTL ? 'left' : 'right';
  const FALLBACK_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAYS = (Array.isArray(_i18n.weekdays) && _i18n.weekdays.length === 7)
    ? _i18n.weekdays.map(String)
    : FALLBACK_WEEKDAYS;
  const ORDERS_SUFFIX = L.chartTooltipOrders || 'orders';

  /* ── Formatters ─────────────────────────────────────────────────────────── */
  const _fmtNum = new Intl.NumberFormat(LANG === 'ar' ? 'ar-EG' : 'en-US');
  const _fmtCur = new Intl.NumberFormat(LANG === 'ar' ? 'ar-EG' : 'en-US', {
    style: 'currency', currency: CURRENCY, maximumFractionDigits: 0
  });
  const _fmtDate = new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-EG' : 'en-US', {
    month: 'short', day: 'numeric'
  });
  const _fmtMonth = new Intl.DateTimeFormat(LANG === 'ar' ? 'ar-EG' : 'en-US', {
    month: 'short', year: '2-digit'
  });

  function fmtCurrency(v) { return _fmtCur.format(v || 0); }
  function fmtNum(v)      { return _fmtNum.format(v || 0); }
  function fmtDate(d)     { return _fmtDate.format(new Date(d)); }
  function fmtDateLong(d) { return new Date(d).toLocaleDateString(LANG === 'ar' ? 'ar-EG' : 'en-US', { day:'2-digit', month:'short', year:'numeric' }); }

  /* ── Palette ─────────────────────────────────────────────────────────────── */
  const P = {
    primary:  '#F39720',
    success:  '#0ab39c',
    danger:   '#f06548',
    warning:  '#f7b84b',
    info:     '#4b9fda',
    purple:   '#7c5cbf',
    muted:    '#adb5bd',
    grid:     'rgba(0,0,0,.05)',
    text:     '#555',
  };

  const APEX_BASE = {
    chart: { toolbar: { show: false }, fontFamily: 'inherit', animations: { enabled: true, speed: 600 } },
    grid: { borderColor: P.grid, strokeDashArray: 4 },
    xaxis: { labels: { style: { colors: P.text, fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: P.text, fontSize: '11px' } } },
    legend: { fontSize: '12px', fontWeight: 600 },
    tooltip: { theme: 'light', style: { fontSize: '12px' } },
  };

  /* ── Status colour map ───────────────────────────────────────────────────── */
  function statusBadge(s) {
    const map = {
      new:             ['db-badge-new',      L.statuses && L.statuses.new             || 'New'],
      inProgress:      ['db-badge-progress', L.statuses && L.statuses.inProgress      || 'In Progress'],
      headingToCustomer:['db-badge-progress',L.statuses && L.statuses.headingToCustomer|| 'Heading to Customer'],
      inStock:         ['db-badge-progress', L.statuses && L.statuses.inStock         || 'In Stock'],
      waitingAction:   ['db-badge-waiting',  L.statuses && L.statuses.waitingAction   || 'Awaiting Action'],
      returnToBusiness:['db-badge-waiting',  L.statuses && L.statuses.returnToBusiness|| 'Heading to You'],
      completed:       ['db-badge-completed',L.statuses && L.statuses.completed       || 'Completed'],
      returned:        ['db-badge-returned', L.statuses && L.statuses.returned        || 'Returned'],
      returnCompleted: ['db-badge-returned', L.statuses && L.statuses.returnCompleted || 'Return Completed'],
      canceled:        ['db-badge-canceled', L.statuses && L.statuses.canceled        || 'Canceled'],
      rejected:        ['db-badge-canceled', L.statuses && L.statuses.rejected        || 'Customer refused'],
      terminated:      ['db-badge-canceled', L.statuses && L.statuses.terminated      || 'Terminated'],
      deliveryFailed:  ['db-badge-canceled', L.statuses && L.statuses.deliveryFailed  || 'Delivery Failed'],
    };
    const [cls, label] = map[s] || ['db-badge-default', s];
    return `<span class="db-badge ${cls}">${label}</span>`;
  }

  /* ── State ───────────────────────────────────────────────────────────────── */
  let _range     = '30d';
  let _geoMode   = 'count';
  const _charts  = {};
  let _lastData  = null;
  let _fetching  = false;

  /* ── Toast ───────────────────────────────────────────────────────────────── */
  function toast(msg, type) {
    let container = document.getElementById('dbToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'dbToastContainer';
      container.className = 'db-toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `db-toast ${type === 'success' ? 'success' : ''}`;
    el.innerHTML = `<i class="${type === 'success' ? 'ri-checkbox-circle-line' : 'ri-error-warning-line'}" style="font-size:1.1rem;"></i><span>${msg}</span>`;
    container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 350); }, 4000);
  }

  /* ── Fetch ───────────────────────────────────────────────────────────────── */
  async function fetchData(range) {
    if (_fetching) return;
    _fetching = true;
    spinRefresh(true);
    try {
      const res = await fetch(`/business/dashboard-data?range=${range}`, { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.status !== 'success') throw new Error(json.message || 'API error');
      _lastData = json.dashboardData;
      render(_lastData);
    } catch (err) {
      console.error('[Dashboard]', err);
      toast(L.errorLoad || 'Failed to load data', 'error');
      showErrorState();
    } finally {
      _fetching = false;
      spinRefresh(false);
    }
  }

  function spinRefresh(on) {
    const btn = document.getElementById('dbRefreshBtn');
    if (btn) {
      const icon = btn.querySelector('i');
      if (icon) icon.classList.toggle('db-spin', on);
      btn.disabled = on;
    }
  }

  /* ── Master render ───────────────────────────────────────────────────────── */
  function render(d) {
    if (!d) return;
    renderKPI(d.kpi || {}, d.series || {});
    renderTrendChart(d.series || {});
    renderStatusDonut(d.series || {});
    renderCashFlow(d.series || {});
    renderRateTrend(d.series || {});
    renderTopGov(d.series || {});
    renderHeatmap(d.series || {});
    renderRecentOrders((d.recent || {}).recentOrders || []);
    renderRecentPickups((d.recent || {}).recentPickups || []);
  }

  /* ── Animated counter ────────────────────────────────────────────────────── */
  function countUp(el, endVal, type, duration) {
    if (!el || isNaN(endVal) || endVal <= 0) return;
    const start = performance.now();
    const fn = (timestamp) => {
      const elapsed = timestamp - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      const current = eased * endVal;
      el.textContent = type === 'currency' ? fmtCurrency(current) : fmtNum(Math.round(current));
      if (progress < 1) {
        requestAnimationFrame(fn);
      } else {
        el.textContent = type === 'currency' ? fmtCurrency(endVal) : fmtNum(endVal);
      }
    };
    requestAnimationFrame(fn);
  }

  function runCountUps(row) {
    row.querySelectorAll('.db-kpi-value[data-count-end]').forEach((el, i) => {
      const end  = parseFloat(el.dataset.countEnd || '0');
      const type = el.dataset.countType || 'num';
      setTimeout(() => countUp(el, end, type, 1300), i * 60);
    });
  }

  /* ── KPI ─────────────────────────────────────────────────────────────────── */
  function renderKPI(kpi, series) {
    const daily = series.daily || [];
    const revenueSparkData = daily.map(b => b.revenue || 0);
    const ordersSparkData  = daily.map(b => b.orders  || 0);

    const cards = [
      {
        cls: 'db-kpi-orders',
        icon: 'ri-shopping-bag-3-line',
        label: L.totalOrders   || 'Total Orders',
        value: fmtNum(kpi.totalOrders),
        rawNum: kpi.totalOrders || 0,
        countType: 'num',
        delta: kpi.delta && kpi.delta.totalOrders,
        spark: ordersSparkData,
        sparkColor: P.primary,
      },
      {
        cls: 'db-kpi-completed',
        icon: 'ri-checkbox-circle-line',
        label: L.completedOrders || 'Completed Orders',
        value: fmtNum(kpi.completedCount),
        rawNum: kpi.completedCount || 0,
        countType: 'num',
        delta: kpi.delta && kpi.delta.completedCount,
        spark: daily.map(b => b.completed || 0),
        sparkColor: P.success,
        sub: kpi.totalOrders > 0 ? `${kpi.successRate || 0}% ${L.kpiSuccessRateSuffix || 'success rate'}` : '',
      },
      {
        cls: 'db-kpi-active',
        icon: 'ri-truck-line',
        label: L.activeOrders || 'Active Orders',
        value: fmtNum(kpi.activeCount),
        rawNum: kpi.activeCount || 0,
        countType: 'num',
        delta: null,
        spark: [],
        sparkColor: P.info,
      },
      {
        cls: 'db-kpi-revenue',
        icon: 'ri-bar-chart-box-line',
        label: L.totalRevenue || 'Total Revenue',
        value: fmtCurrency(kpi.revenue),
        rawNum: kpi.revenue || 0,
        countType: 'currency',
        delta: kpi.delta && kpi.delta.revenue,
        spark: revenueSparkData,
        sparkColor: P.purple,
      },
      {
        cls: 'db-kpi-aov',
        icon: 'ri-price-tag-3-line',
        label: L.avgOrderValue || 'Avg Order Value',
        value: fmtCurrency(kpi.avgOrderValue),
        rawNum: kpi.avgOrderValue || 0,
        countType: 'currency',
        delta: null,
        spark: [],
        sparkColor: P.warning,
      },
      {
        cls: 'db-kpi-expected',
        icon: 'ri-hand-coin-line',
        label: L.expectedCash || 'Expected Cash',
        value: fmtCurrency(kpi.expectedCash),
        rawNum: kpi.expectedCash || 0,
        countType: 'currency',
        delta: null,
        spark: daily.map(b => b.codExpected || 0),
        sparkColor: P.primary,
        sub: L.kpiExpectedCashSub || 'Pending COD/CD',
      },
      {
        cls: 'db-kpi-collected',
        icon: 'ri-money-cny-circle-line',
        label: L.collectedCash || 'Collected Cash',
        value: fmtCurrency(kpi.collectedCash),
        rawNum: kpi.collectedCash || 0,
        countType: 'currency',
        delta: kpi.delta && kpi.delta.collectedCash,
        spark: daily.map(b => b.codCollected || 0),
        sparkColor: P.success,
      },
    ];

    const row = document.getElementById('dbKpiRow');
    if (!row) return;

    // Build new HTML with staggered animation delays
    row.innerHTML = cards.map((c, idx) => kpiCardHtml(c, idx)).join('');

    // Trigger count-up after a short paint delay
    setTimeout(() => runCountUps(row), 60);

    // Render sparklines with ApexCharts
    cards.forEach((c, idx) => {
      if (!c.spark || c.spark.length < 2) return;
      const el = document.getElementById(`dbSparkline${idx}`);
      if (!el) return;
      if (_charts[`spark${idx}`]) { try { _charts[`spark${idx}`].destroy(); } catch(_) {} }
      _charts[`spark${idx}`] = new ApexCharts(el, {
        chart: { type: 'line', height: 42, sparkline: { enabled: true }, animations: { enabled: false } },
        series: [{ data: c.spark }],
        stroke: { curve: 'smooth', width: 2 },
        colors: [c.sparkColor],
        tooltip: { enabled: false },
      });
      _charts[`spark${idx}`].render();
    });
  }

  function kpiCardHtml(c, idx) {
    const deltaHtml = buildDelta(c.delta, c.deltaInvert);
    const hasSpark  = c.spark && c.spark.length >= 2;
    const countAttr = c.rawNum != null
      ? `data-count-end="${c.rawNum}" data-count-type="${c.countType || 'num'}"`
      : '';

    return `
    <div class="col-6 col-md-4 col-xl-3 ns-kpi-col" style="--anim-delay:${idx * 65}ms">
      <div class="db-kpi-card ${c.cls} ns-fade-in-up">
        <div class="d-flex align-items-start justify-content-between mb-1">
          <div class="db-kpi-icon"><i class="${c.icon}"></i></div>
          ${hasSpark ? `<div id="dbSparkline${idx}" class="db-kpi-sparkline-el"></div>` : ''}
        </div>
        <div class="db-kpi-label">${c.label}</div>
        <div class="db-kpi-value" ${countAttr}>${c.value}</div>
        <div class="db-kpi-sub">
          ${deltaHtml}
          ${c.sub ? `<span class="text-muted">${c.sub}</span>` : ''}
        </div>
      </div>
    </div>`;
  }

  function buildDelta(pct, invert) {
    if (pct == null) {
      return '';
    }
    if (pct === 0) {
      return `<span class="db-delta flat"><i class="ri-subtract-line" style="font-size:.7rem;"></i>0%</span>`;
    }
    const absVal = Math.abs(pct).toFixed(1).replace(/\.0$/, '');
    let up = pct > 0;
    if (invert) up = !up;
    const cls  = up ? 'up' : 'down';
    const icon = pct > 0 ? 'ri-arrow-up-line' : 'ri-arrow-down-line';
    return `<span class="db-delta ${cls}"><i class="${icon}" style="font-size:.75rem;"></i>${absVal}%</span>
            <span class="text-muted" style="font-size:.68rem;">${L.vsLast || 'vs last period'}</span>`;
  }

  /* ── Revenue & Orders Trend ──────────────────────────────────────────────── */
  let _trendActiveSeries = 'revenue';

  function renderTrendChart(series) {
    const daily  = series.daily || [];
    const labels = daily.map(b => fmtDate(b.date));
    const revData = daily.map(b => parseFloat((b.revenue || 0).toFixed(2)));
    const ordData = daily.map(b => b.orders || 0);

    const subtitle = document.getElementById('dbTrendSubtitle');
    if (subtitle && daily.length > 0) {
      subtitle.textContent = `${fmtDate(daily[0].date)} – ${fmtDate(daily[daily.length-1].date)}`;
    }

    const el = document.getElementById('chartRevenueTrend');
    if (!el) return;
    el.classList.remove('db-chart-skeleton');

    if (_charts.trend) { try { _charts.trend.destroy(); } catch(_) {} }

    const showRev = _trendActiveSeries !== 'orders';
    const showOrd = _trendActiveSeries !== 'revenue';

    _charts.trend = new ApexCharts(el, {
      ...APEX_BASE,
      chart: { ...APEX_BASE.chart, type: 'line', height: 320 },
      series: [
        { name: L.totalRevenue || 'Revenue', type: 'area', data: revData },
        { name: L.totalOrders  || 'Orders',  type: 'bar',  data: ordData },
      ],
      stroke: { curve: 'smooth', width: [2.5, 0] },
      fill: {
        type: ['gradient', 'solid'],
        gradient: { shadeIntensity: 1, opacityFrom: .35, opacityTo: .02, stops: [0,100] },
      },
      colors: [P.purple, P.primary],
      xaxis: { ...APEX_BASE.xaxis, categories: labels },
      yaxis: [
        {
          seriesName: L.totalRevenue || 'Revenue',
          show: showRev,
          labels: { formatter: v => fmtCurrency(v), style: { colors: P.purple, fontSize:'11px' } },
        },
        {
          seriesName: L.totalOrders || 'Orders',
          opposite: true,
          show: showOrd,
          labels: { formatter: v => fmtNum(v), style: { colors: P.primary, fontSize:'11px' } },
        },
      ],
      tooltip: {
        ...APEX_BASE.tooltip,
        y: [
          { formatter: v => fmtCurrency(v) },
          { formatter: v => fmtNum(v) },
        ],
      },
      legend: { ...APEX_BASE.legend, position: 'top', horizontalAlign: LEGEND_ALIGN_TOP },
      dataLabels: { enabled: false },
      markers: { size: [3, 0] },
    });
    _charts.trend.render();
  }

  /* ── Status Donut ────────────────────────────────────────────────────────── */
  function renderStatusDonut(series) {
    const statusArr = series.status || [];
    if (!statusArr.length) return;

    const labels = statusArr.map(s => ST[s.status] || s.status);
    const vals   = statusArr.map(s => s.count);
    const colors = statusArr.map(s => statusColor(s.status));

    const el = document.getElementById('chartStatusDonut');
    if (!el) return;
    el.classList.remove('db-chart-skeleton');

    if (_charts.donut) { try { _charts.donut.destroy(); } catch(_) {} }

    _charts.donut = new ApexCharts(el, {
      ...APEX_BASE,
      chart: { ...APEX_BASE.chart, type: 'donut', height: 300 },
      series: vals,
      labels,
      colors,
      plotOptions: {
        pie: {
          donut: {
            size: '65%',
            labels: {
              show: true,
              total: {
                show: true,
                label: L.totalOrders || 'Total',
                fontSize: '13px',
                fontWeight: 700,
                color: '#333',
                formatter: w => fmtNum(w.globals.seriesTotals.reduce((a,b) => a+b, 0)),
              },
            },
          },
        },
      },
      legend: { ...APEX_BASE.legend, position: 'bottom', fontSize: '11px' },
      dataLabels: { enabled: false },
      tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => `${fmtNum(v)} ${ORDERS_SUFFIX}` } },
    });
    _charts.donut.render();
  }

  function statusColor(s) {
    const map = {
      new: P.primary, inProgress: P.info, headingToCustomer: P.info,
      inStock: P.info, waitingAction: P.purple, returnToBusiness: P.warning,
      completed: P.success, returned: P.warning, returnCompleted: P.warning,
      canceled: P.danger, rejected: P.danger, terminated: P.danger, deliveryFailed: P.danger,
    };
    return map[s] || P.muted;
  }

  /* ── COD Cash Flow ───────────────────────────────────────────────────────── */
  function renderCashFlow(series) {
    const daily  = series.daily || [];
    const labels = daily.map(b => fmtDate(b.date));

    const el = document.getElementById('chartCashFlow');
    if (!el) return;
    el.classList.remove('db-chart-skeleton');

    if (_charts.cashflow) { try { _charts.cashflow.destroy(); } catch(_) {} }

    _charts.cashflow = new ApexCharts(el, {
      ...APEX_BASE,
      chart: { ...APEX_BASE.chart, type: 'bar', height: 280, stacked: false },
      series: [
        { name: L.expected  || 'Expected',     data: daily.map(b => +(b.codExpected  || 0).toFixed(2)) },
        { name: L.collected || 'Collected',    data: daily.map(b => +(b.codCollected || 0).toFixed(2)) },
        { name: L.fees      || 'Shipping Fees',data: daily.map(b => +(b.shippingFees || 0).toFixed(2)) },
      ],
      colors: [P.primary, P.success, P.info],
      xaxis: { ...APEX_BASE.xaxis, categories: labels },
      yaxis: { labels: { formatter: v => fmtCurrency(v), style: { fontSize: '11px' } } },
      plotOptions: { bar: { columnWidth: '55%', borderRadius: 3 } },
      dataLabels: { enabled: false },
      tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => fmtCurrency(v) } },
      legend: { ...APEX_BASE.legend, position: 'top', horizontalAlign: LEGEND_ALIGN_TOP },
    });
    _charts.cashflow.render();
  }

  /* ── Rate Trend (success / return / cancel) ──────────────────────────────── */
  function renderRateTrend(series) {
    const daily  = series.daily || [];
    const labels = daily.map(b => fmtDate(b.date));

    function pct(num, denom) { return denom > 0 ? parseFloat(((num/denom)*100).toFixed(1)) : 0; }

    const successData = daily.map(b => pct(b.completed || 0, b.orders || 1));
    const returnData  = daily.map(b => pct(b.returned  || 0, b.orders || 1));
    const cancelData  = daily.map(b => pct(b.canceled  || 0, b.orders || 1));

    const el = document.getElementById('chartRateTrend');
    if (!el) return;
    el.classList.remove('db-chart-skeleton');

    if (_charts.rate) { try { _charts.rate.destroy(); } catch(_) {} }

    _charts.rate = new ApexCharts(el, {
      ...APEX_BASE,
      chart: { ...APEX_BASE.chart, type: 'line', height: 280 },
      series: [
        { name: L.successRate || 'Success', data: successData },
        { name: L.returnRate  || 'Return',  data: returnData },
        { name: L.cancelRate  || 'Cancel',  data: cancelData },
      ],
      colors: [P.success, P.warning, P.danger],
      stroke: { curve: 'smooth', width: 2.5 },
      xaxis: { ...APEX_BASE.xaxis, categories: labels },
      yaxis: { min: 0, max: 100, labels: { formatter: v => `${v}%`, style: { fontSize: '11px' } } },
      markers: { size: 3 },
      dataLabels: { enabled: false },
      tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => `${v}%` } },
      legend: { ...APEX_BASE.legend, position: 'top', horizontalAlign: LEGEND_ALIGN_TOP },
    });
    _charts.rate.render();
  }

  /* ── Top Governorates ────────────────────────────────────────────────────── */
  function renderTopGov(series) {
    const geo = (series.geo || []).filter(g => g.name && g.name !== 'Unknown' && g.name !== 'null');
    if (!geo.length) return;

    _renderTopGovWith(geo, _geoMode);
  }

  function _renderTopGovWith(geo, mode) {
    const sorted = [...geo].sort((a,b) => (b[mode] || 0) - (a[mode] || 0)).slice(0,10);
    const labels = sorted.map(g => g.name);
    const vals   = sorted.map(g => +(g[mode] || 0).toFixed(2));

    const el = document.getElementById('chartTopGov');
    if (!el) return;
    el.classList.remove('db-chart-skeleton');

    if (_charts.geo) { try { _charts.geo.destroy(); } catch(_) {} }

    _charts.geo = new ApexCharts(el, {
      ...APEX_BASE,
      chart: { ...APEX_BASE.chart, type: 'bar', height: 300 },
      plotOptions: { bar: { horizontal: true, borderRadius: 4, dataLabels: { position: 'top' } } },
      series: [{ name: mode === 'revenue' ? (L.totalRevenue || 'Revenue') : (L.totalOrders || 'Orders'), data: vals }],
      colors: [P.primary],
      xaxis: { ...APEX_BASE.xaxis, categories: labels },
      yaxis: { labels: { style: { fontSize: '11px' }, maxWidth: 140, trim: true } },
      dataLabels: {
        enabled: true,
        offsetX: IS_RTL ? -8 : 8,
        style: { fontSize: '11px', colors: ['#333'] },
        formatter: v => mode === 'revenue' ? fmtCurrency(v) : fmtNum(v),
      },
      tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => mode === 'revenue' ? fmtCurrency(v) : fmtNum(v) } },
      legend: { show: false },
    });
    _charts.geo.render();
  }

  /* ── Heatmap ─────────────────────────────────────────────────────────────── */
  function renderHeatmap(series) {
    const raw = series.heatmap || [];
    if (!raw.length) return;

    // dow: 1=Sun..7=Sat; hour: 0-23
    const HOUR_LABELS = Array.from({length:24}, (_,i) => `${i}:00`);

    // build a 7×24 matrix
    const matrix = Array.from({length:7}, () => new Array(24).fill(0));
    raw.forEach(h => {
      const d = (h.dow - 1 + 7) % 7;
      matrix[d][h.hour] = h.count;
    });

    const apexSeries = WEEKDAYS.map((dayLabel, di) => ({
      name: dayLabel,
      data: HOUR_LABELS.map((hourLabel, hi) => ({ x: hourLabel, y: matrix[di][hi] })),
    }));

    const el = document.getElementById('chartHeatmap');
    if (!el) return;
    el.classList.remove('db-chart-skeleton');

    if (_charts.heatmap) { try { _charts.heatmap.destroy(); } catch(_) {} }

    _charts.heatmap = new ApexCharts(el, {
      ...APEX_BASE,
      chart: { ...APEX_BASE.chart, type: 'heatmap', height: 300 },
      series: apexSeries,
      colors: [P.primary],
      dataLabels: { enabled: false },
      xaxis: { ...APEX_BASE.xaxis, tickAmount: 6 },
      plotOptions: {
        heatmap: {
          shadeIntensity: 0.65,
          radius: 2,
          useFillColorAsStroke: false,
          colorScale: {
            ranges: [
              { from: 0, to: 0,  color: '#f4f6f9', name: '0' },
              { from: 1, to: 5,  color: '#fde5c0', name: '1-5' },
              { from: 6, to: 15, color: '#f9b261', name: '6-15' },
              { from:16, to: 50, color: P.primary,  name: '16-50' },
              { from:51, to:9999,color: '#c4730a',  name: '50+' },
            ],
          },
        },
      },
      tooltip: { ...APEX_BASE.tooltip, y: { formatter: v => `${fmtNum(v)} ${ORDERS_SUFFIX}` } },
      legend: { show: false },
    });
    _charts.heatmap.render();
  }

  /* ── Recent Orders Table ─────────────────────────────────────────────────── */
  function renderRecentOrders(orders) {
    const el = document.getElementById('dbRecentOrdersTable');
    if (!el) return;
    if (!orders.length) {
      el.innerHTML = `<div class="db-empty-state"><i class="ri-file-list-3-line"></i><p>${L.noOrders || 'No recent orders'}</p></div>`;
      return;
    }
    el.innerHTML = `
    <table class="db-table">
      <thead><tr>
        <th>${L.orderNum || 'Order #'}</th>
        <th>${L.customer || 'Customer'}</th>
        <th>${L.status   || 'Status'}</th>
        <th>${L.date     || 'Date'}</th>
      </tr></thead>
      <tbody>
        ${orders.map(o => `
        <tr>
          <td><span class="db-order-num">#${o.orderNumber || ''}</span></td>
          <td>${escHtml((o.orderCustomer && o.orderCustomer.fullName) || '—')}</td>
          <td>${statusBadge(o.orderStatus)}</td>
          <td style="white-space:nowrap;font-size:.75rem;color:var(--db-text-muted);">${o.orderDate ? fmtDateLong(o.orderDate) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  /* ── Recent Pickups Table ────────────────────────────────────────────────── */
  function renderRecentPickups(pickups) {
    const el = document.getElementById('dbRecentPickupsTable');
    if (!el) return;
    if (!pickups.length) {
      el.innerHTML = `<div class="db-empty-state"><i class="ri-truck-line"></i><p>${L.noPickups || 'No recent pickups'}</p></div>`;
      return;
    }
    el.innerHTML = `
    <table class="db-table">
      <thead><tr>
        <th>${L.pickupNum || 'Pickup #'}</th>
        <th>${L.date      || 'Date'}</th>
        <th>${L.items     || 'Items'}</th>
        <th>${L.status    || 'Status'}</th>
      </tr></thead>
      <tbody>
        ${pickups.map(p => `
        <tr>
          <td><span class="db-order-num">#${p.pickupNumber || ''}</span></td>
          <td style="white-space:nowrap;font-size:.75rem;color:var(--db-text-muted);">${p.pickupDate ? fmtDateLong(p.pickupDate) : '—'}</td>
          <td>${p.numberOfOrders || 0}</td>
          <td>${pickupStatusBadge(p.picikupStatus)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  }

  function pickupStatusBadge(s) {
    if (!s) return '<span class="db-badge db-badge-default">—</span>';
    const lower = s.toLowerCase();
    if (lower === 'completed')   return `<span class="db-badge db-badge-completed">${s}</span>`;
    if (lower === 'in progress') return `<span class="db-badge db-badge-progress">${s}</span>`;
    if (lower === 'new')         return `<span class="db-badge db-badge-new">${s}</span>`;
    return `<span class="db-badge db-badge-default">${s}</span>`;
  }

  /* ── Error state ─────────────────────────────────────────────────────────── */
  function showErrorState() {
    const kpiRow = document.getElementById('dbKpiRow');
    if (kpiRow) {
      kpiRow.innerHTML = `
      <div class="col-12 text-center py-4">
        <i class="ri-error-warning-line text-danger" style="font-size:2.5rem;"></i>
        <p class="mt-2 text-muted">${L.errorLoad || 'Failed to load dashboard data'}</p>
        <button class="btn btn-sm" style="border:1px solid var(--db-primary);color:var(--db-primary);" onclick="window.__dbRefresh && window.__dbRefresh()">
          <i class="ri-refresh-line me-1"></i>${L.retry || 'Retry'}
        </button>
      </div>`;
    }
  }

  /* ── Utils ───────────────────────────────────────────────────────────────── */
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Event wiring ────────────────────────────────────────────────────────── */
  function initEvents() {
    // Range pills
    document.getElementById('dbRangePills') && document.getElementById('dbRangePills').addEventListener('click', e => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      document.querySelectorAll('.db-range-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      _range = btn.dataset.range;
      fetchData(_range);
    });

    // Refresh button
    document.getElementById('dbRefreshBtn') && document.getElementById('dbRefreshBtn').addEventListener('click', () => {
      fetchData(_range);
    });

    // Chart toggle buttons (trend series)
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-chart]');
      if (!btn) return;
      const chartId = btn.dataset.chart;
      const seriesId = btn.dataset.series;

      // update active pill within the same action group
      const group = btn.closest('.db-chart-actions');
      if (group) {
        group.querySelectorAll('.db-chart-toggle').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }

      if (chartId === 'trend' && _lastData) {
        _trendActiveSeries = seriesId;
        renderTrendChart(_lastData.series || {});
      }
      if (chartId === 'geo' && _lastData) {
        _geoMode = seriesId;
        renderTopGov(_lastData.series || {});
      }
    });
  }

  /* ── Bootstrap ───────────────────────────────────────────────────────────── */
  window.__dbRefresh = () => fetchData(_range);

  document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    fetchData(_range);
  });

})();
