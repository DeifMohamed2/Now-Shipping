/**
 * Admin dashboard charts — Chart.js (doughnut, bar, line, mixed).
 * Percentages for doughnuts are count/total only (legend + tooltip), never stacked bogus labels.
 */
(function (global) {
  'use strict';

  var Chart = global.Chart;
  if (!Chart) {
    console.warn('Chart.js not loaded; admin dashboard charts disabled.');
    global.AdminDashboardCharts = { render: function () {}, destroy: function () {} };
    return;
  }

  var P = {
    primary: '#f59e0b',
    success: '#0ab39c',
    danger: '#f06548',
    warning: '#f7b84b',
    info: '#3b82f6',
    purple: '#7c5cbf',
    muted: '#94a3b8',
    grid: 'rgba(148, 163, 184, 0.25)',
    text: '#475569',
    navy: '#405189',
    slate700: '#334155',
  };

  var IS_RTL =
    typeof document !== 'undefined' && document.documentElement.getAttribute('dir') === 'rtl';

  Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
  Chart.defaults.color = P.text;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.padding = 12;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;

  var _fmtNum = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  function fmtNum(v) {
    return _fmtNum.format(v || 0);
  }

  var instances = [];

  function push(chart) {
    if (chart) instances.push(chart);
  }

  function destroy() {
    instances.forEach(function (c) {
      try {
        if (c && typeof c.destroy === 'function') c.destroy();
      } catch (e) {}
    });
    instances = [];
  }

  var CHART_IDS = [
    'admin-revenue-chart',
    'admin-pickup-status-chart',
    'admin-shop-status-chart',
    'admin-courier-assignments',
    'admin-orders-by-status',
    'admin-orders-by-category',
    'admin-orders-by-government',
    'admin-amount-type',
    'admin-express-breakdown',
    'admin-returns-monthly',
  ];

  function clearChartDom() {
    CHART_IDS.forEach(function (id) {
      var n = document.getElementById(id);
      if (!n) return;
      var cv = n.querySelector('canvas');
      if (cv && Chart.getChart) {
        var ch = Chart.getChart(cv);
        if (ch) ch.destroy();
      }
      n.innerHTML = '';
    });
  }

  function ensureCanvas(parentId, minH) {
    var wrap = document.getElementById(parentId);
    if (!wrap) return null;
    wrap.innerHTML = '';
    wrap.style.position = 'relative';
    wrap.style.minHeight = (minH || 240) + 'px';
    var c = document.createElement('canvas');
    wrap.appendChild(c);
    return c;
  }

  /** Doughnut: canvas + custom HTML legend (Chart.js legend clips in narrow cards). */
  function ensureDoughnutLayout(parentId, minH) {
    var wrap = document.getElementById(parentId);
    if (!wrap) return null;
    wrap.innerHTML = '';
    wrap.style.position = 'relative';
    wrap.style.minHeight = '';
    wrap.style.maxHeight = '';
    wrap.classList.add('adm-donut-host');
    if (IS_RTL) wrap.classList.add('adm-donut-host--rtl');
    var row = document.createElement('div');
    row.className = 'adm-donut-row';
    var box = document.createElement('div');
    box.className = 'adm-donut-canvas-wrap';
    var canvas = document.createElement('canvas');
    box.appendChild(canvas);
    var ul = document.createElement('ul');
    ul.className = 'adm-donut-legend-list';
    ul.setAttribute('aria-label', 'Breakdown');
    row.appendChild(box);
    row.appendChild(ul);
    wrap.appendChild(row);
    return { canvas: canvas, legend: ul };
  }

  var centerTotalPlugin = {
    id: 'adminCenterTotal',
    afterDatasetsDraw: function (chart) {
      var meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data.length) return;
      var el = meta.data[0];
      if (!el || el.x == null) return;
      var sum = chart.data.datasets[0].data.reduce(function (a, b) {
        return a + (Number(b) || 0);
      }, 0);
      var ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 17px ' + Chart.defaults.font.family;
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtNum(sum), el.x, el.y - 8);
      ctx.font = '11px ' + Chart.defaults.font.family;
      ctx.fillStyle = '#64748b';
      ctx.fillText('Total', el.x, el.y + 10);
      ctx.restore();
    },
  };

  function renderDoughnut(elId, labels, values, colors, height) {
    var layout = ensureDoughnutLayout(elId, height || 260);
    if (!layout) return;
    var canvas = layout.canvas;
    var legendEl = layout.legend;
    var nums = values.map(function (x) {
      return Math.max(0, Number(x) || 0);
    });
    var sum = nums.reduce(function (a, b) {
      return a + b;
    }, 0);
    if (!sum || !labels.length) {
      canvas.closest('.adm-donut-host').innerHTML =
        '<p class="text-muted text-center py-5 mb-0">No data</p>';
      return;
    }
    legendEl.innerHTML = '';
    labels.forEach(function (lbl, i) {
      var pct = sum ? ((nums[i] / sum) * 100).toFixed(1) : '0.0';
      var li = document.createElement('li');
      li.className = 'adm-donut-legend-item';
      var sw = document.createElement('span');
      sw.className = 'adm-donut-legend-swatch';
      sw.setAttribute('aria-hidden', 'true');
      sw.style.backgroundColor = colors[i] || P.muted;
      var tx = document.createElement('span');
      tx.className = 'adm-donut-legend-text';
      tx.textContent = String(lbl) + ' · ' + fmtNum(nums[i]) + ' (' + pct + '%)';
      li.appendChild(sw);
      li.appendChild(tx);
      legendEl.appendChild(li);
    });
    var ch = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [
          {
            data: nums,
            backgroundColor: colors,
            borderColor: '#ffffff',
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '64%',
        layout: { padding: 10 },
        animation: { duration: 520, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                var v = Number(ctx.raw) || 0;
                var arr = ctx.dataset.data.map(Number);
                var t = arr.reduce(function (a, b) {
                  return a + b;
                }, 0);
                var pct = t ? ((v / t) * 100).toFixed(1) : '0.0';
                return ' ' + ctx.label + ': ' + fmtNum(v) + ' orders (' + pct + '%)';
              },
            },
          },
        },
      },
      plugins: [centerTotalPlugin],
    });
    push(ch);
  }

  function adminStatusColor(status) {
    var s = String(status || '');
    var map = {
      new: P.primary,
      pendingPickup: P.warning,
      pickedUp: P.navy,
      inStock: P.info,
      inProgress: P.info,
      headingToCustomer: P.info,
      completed: P.success,
      returnCompleted: P.success,
      waitingAction: P.purple,
      headingToYou: P.warning,
      canceled: P.danger,
      returned: P.warning,
      terminated: P.danger,
      deliveryFailed: P.danger,
      rejected: P.danger,
    };
    return map[s] || P.muted;
  }

  function categoryColor(name) {
    var n = String(name || '');
    if (n === 'NEW') return P.primary;
    if (n === 'PROCESSING') return P.info;
    if (n === 'SUCCESSFUL') return P.success;
    if (n === 'PAUSED') return P.purple;
    if (n === 'UNSUCCESSFUL') return P.danger;
    return P.muted;
  }

  function renderRevenueCombo(fin) {
    var el = document.getElementById('admin-revenue-chart');
    if (!el) return;
    var rev = (fin && fin.revenueByMonth) || [];
    var ord = (fin && fin.ordersByMonth) || [];
    var revMap = new Map();
    rev.forEach(function (r) {
      revMap.set(r._id.y + '-' + String(r._id.m).padStart(2, '0'), r.revenue || 0);
    });
    var ordMap = new Map();
    rev.forEach(function (r) {
      if (r.orders != null) ordMap.set(r._id.y + '-' + String(r._id.m).padStart(2, '0'), r.orders);
    });
    (ord || []).forEach(function (o) {
      var k = o._id.y + '-' + String(o._id.m).padStart(2, '0');
      if (!ordMap.has(k)) ordMap.set(k, o.count || 0);
    });
    var keys = Array.from(new Set([].concat(Array.from(revMap.keys()), Array.from(ordMap.keys()))))
      .sort()
      .slice(-12);
    if (!keys.length) {
      el.innerHTML = '<p class="text-muted text-center py-5 mb-0">No revenue data in this range.</p>';
      return;
    }
    var revSeries = keys.map(function (k) {
      return +(revMap.get(k) || 0).toFixed(2);
    });
    var ordSeries = keys.map(function (k) {
      return ordMap.get(k) || 0;
    });
    var canvas = ensureCanvas('admin-revenue-chart', 300);
    if (!canvas) return;
    var ch = new Chart(canvas, {
      data: {
        labels: keys,
        datasets: [
          {
            type: 'bar',
            label: 'Revenue (EGP)',
            data: revSeries,
            backgroundColor: 'rgba(245, 158, 11, 0.85)',
            borderColor: P.primary,
            borderWidth: 1,
            borderRadius: 6,
            yAxisID: 'y',
            order: 2,
          },
          {
            type: 'line',
            label: 'Orders',
            data: ordSeries,
            borderColor: P.slate700,
            backgroundColor: 'rgba(51, 65, 85, 0.08)',
            borderWidth: 2.5,
            tension: 0.35,
            fill: true,
            yAxisID: 'y1',
            order: 1,
            pointRadius: 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        animation: { duration: 550, easing: 'easeOutQuart' },
        plugins: {
          legend: { position: 'top', align: IS_RTL ? 'end' : 'start' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                if (ctx.datasetIndex === 0) {
                  return ' ' + ctx.dataset.label + ': ' + (ctx.parsed.y != null ? ctx.parsed.y.toFixed(2) : '0');
                }
                return ' ' + ctx.dataset.label + ': ' + fmtNum(ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 }, maxRotation: 45 },
          },
          y: {
            position: 'left',
            beginAtZero: true,
            grid: { color: P.grid },
            ticks: {
              callback: function (v) {
                return fmtNum(v);
              },
            },
            title: { display: true, text: 'Revenue (EGP)', font: { size: 11 } },
          },
          y1: {
            position: 'right',
            beginAtZero: true,
            grid: { drawOnChartArea: false },
            ticks: {
              callback: function (v) {
                return fmtNum(v);
              },
            },
            title: { display: true, text: 'Orders', font: { size: 11 } },
          },
        },
      },
    });
    push(ch);
  }

  function renderOrdersByStatus(b) {
    var arr = (b && b.byStatus) || [];
    var labels = arr.map(function (x) {
      return String(x._id || 'Unknown');
    });
    var series = arr.map(function (x) {
      return x.count || 0;
    });
    var colors = arr.map(function (x) {
      return adminStatusColor(x._id);
    });
    renderDoughnut('admin-orders-by-status', labels, series, colors, 280);
  }

  function renderOrdersByCategory(b) {
    var arr = (b && b.byCategory) || [];
    var labels = arr.map(function (x) {
      return String(x._id || 'Unknown');
    });
    var series = arr.map(function (x) {
      return x.count || 0;
    });
    var colors = arr.map(function (x) {
      return categoryColor(x._id);
    });
    renderDoughnut('admin-orders-by-category', labels, series, colors, 280);
  }

  function renderGovBar(b) {
    var canvas = ensureCanvas('admin-orders-by-government', 300);
    if (!canvas) return;
    var gov = (b && b.byGovernment) || [];
    if (!gov.length) {
      canvas.parentNode.innerHTML =
        '<p class="text-muted text-center py-4 mb-0">No governorate data</p>';
      return;
    }
    var ch = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: gov.map(function (x) {
          return String(x._id || 'N/A');
        }),
        datasets: [
          {
            label: 'Orders',
            data: gov.map(function (x) {
              return x.count || 0;
            }),
            backgroundColor: 'rgba(245, 158, 11, 0.88)',
            borderColor: P.primary,
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 40 } },
          y: { beginAtZero: true, grid: { color: P.grid }, ticks: { callback: fmtNum } },
        },
      },
    });
    push(ch);
  }

  function renderPaymentBar(b) {
    var canvas = ensureCanvas('admin-amount-type', 280);
    if (!canvas) return;
    var at = (b && b.amountType) || [];
    if (!at.length) {
      canvas.parentNode.innerHTML =
        '<p class="text-muted text-center py-4 mb-0">No payment type data</p>';
      return;
    }
    var ch = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: at.map(function (x) {
          return String(x._id || 'N/A');
        }),
        datasets: [
          {
            label: 'Orders',
            data: at.map(function (x) {
              return x.count || 0;
            }),
            backgroundColor: 'rgba(64, 81, 137, 0.9)',
            borderColor: P.navy,
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: P.grid }, ticks: { callback: fmtNum } },
        },
      },
    });
    push(ch);
  }

  function renderExpressDonut(b) {
    var ex = (b && b.express) || [];
    var labels = ex.map(function (x) {
      return x._id ? 'Express' : 'Standard';
    });
    var series = ex.map(function (x) {
      return x.count || 0;
    });
    renderDoughnut('admin-express-breakdown', labels, series, [P.primary, P.muted], 260);
  }

  function renderCourierBar(d) {
    var canvas = ensureCanvas('admin-courier-assignments', 280);
    if (!canvas) return;
    var items = (d.courierStats && d.courierStats.assignments30d) || [];
    if (!items.length) {
      canvas.parentNode.innerHTML =
        '<p class="text-muted text-center py-4 mb-0">No courier assignments for this scope.</p>';
      return;
    }
    var labels = items.map(function (i) {
      var n = i.courierName && String(i.courierName).trim();
      return n ? String(n).slice(0, 28) : String(i._id || '').slice(-8);
    });
    var ch = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Assignments',
            data: items.map(function (i) {
              return i.count || 0;
            }),
            backgroundColor: 'rgba(59, 130, 246, 0.85)',
            borderColor: P.info,
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: P.grid }, ticks: { callback: fmtNum } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } },
        },
      },
    });
    push(ch);
  }

  function renderReturnsMonthly(d) {
    var canvas = ensureCanvas('admin-returns-monthly', 300);
    if (!canvas) return;
    var ret = (d.returnStats && d.returnStats.monthly) || [];
    if (!ret.length) {
      canvas.parentNode.innerHTML =
        '<p class="text-muted text-center py-4 mb-0">No return series in range</p>';
      return;
    }
    var cats = ret
      .map(function (i) {
        return i._id.y + '-' + String(i._id.m).padStart(2, '0');
      })
      .reverse();
    var vals = ret
      .map(function (i) {
        return i.count || 0;
      })
      .reverse();
    var ch = new Chart(canvas, {
      type: 'line',
      data: {
        labels: cats,
        datasets: [
          {
            label: 'Returns / issues',
            data: vals,
            borderColor: P.danger,
            backgroundColor: 'rgba(240, 101, 72, 0.12)',
            borderWidth: 2.5,
            tension: 0.35,
            fill: true,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 45 } },
          y: { beginAtZero: true, grid: { color: P.grid }, ticks: { callback: fmtNum } },
        },
      },
    });
    push(ch);
  }

  function renderPickupDonut(d) {
    var pk = d.pickupBreakdown || [];
    if (!pk.length) {
      var w = document.getElementById('admin-pickup-status-chart');
      if (w) w.innerHTML = '<p class="text-muted text-center py-4 mb-0">No pickup data</p>';
      return;
    }
    var labels = pk.map(function (x) {
      return String(x._id || '—');
    });
    var series = pk.map(function (x) {
      return x.count || 0;
    });
    var colors = labels.map(function (_, i) {
      return [P.navy, P.success, P.primary, P.danger, P.muted][i % 5];
    });
    renderDoughnut('admin-pickup-status-chart', labels, series, colors, 260);
  }

  function renderShopBar(d) {
    var canvas = ensureCanvas('admin-shop-status-chart', 280);
    if (!canvas) return;
    var sh = d.shopBreakdown || [];
    if (!sh.length) {
      canvas.parentNode.innerHTML =
        '<p class="text-muted text-center py-4 mb-0">No shop orders</p>';
      return;
    }
    var ch = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: sh.map(function (x) {
          return String(x._id || '—');
        }),
        datasets: [
          {
            label: 'Count',
            data: sh.map(function (x) {
              return x.count || 0;
            }),
            backgroundColor: 'rgba(10, 179, 156, 0.88)',
            borderColor: P.success,
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 35 } },
          y: { beginAtZero: true, grid: { color: P.grid }, ticks: { callback: fmtNum } },
        },
      },
    });
    push(ch);
  }

  function renderAll(dashboardData) {
    destroy();
    clearChartDom();
    if (!dashboardData) return;
    var fin = dashboardData.financialStats || {};
    var b = dashboardData.breakdowns || {};

    renderRevenueCombo(fin);
    renderOrdersByStatus(b);
    renderOrdersByCategory(b);
    renderGovBar(b);
    renderPaymentBar(b);
    renderExpressDonut(b);
    renderCourierBar(dashboardData);
    renderReturnsMonthly(dashboardData);
    renderPickupDonut(dashboardData);
    renderShopBar(dashboardData);
  }

  global.AdminDashboardCharts = {
    render: renderAll,
    destroy: destroy,
  };
})(typeof window !== 'undefined' ? window : this);
