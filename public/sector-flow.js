const numberFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

let chartInstance = null;
let abortController = null;
let historyAbortController = null;
let autoRefreshTimer = null;
let forceRefreshTimer = null;
let lastAutoRefreshMinuteKey = '';

const AUTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const AUTO_REFRESH_START_MINUTES = 9 * 60 + 25;
const AUTO_REFRESH_END_MINUTES = 15 * 60 + 5;
const MIN_REALTIME_FETCH_INTERVAL_MS = 5 * 60 * 1000;
const FORCE_REFRESH_HOUR = 14;
const FORCE_REFRESH_MINUTE = 55;
const MAINSTREAM_SECTORS = [
  { key: 'bank', displayName: '银行', code: 'BK1283', sourceType: 'industry' },
  { key: 'securities', displayName: '证券', code: 'BK0473', sourceType: 'industry' },
  { key: 'baijiu', displayName: '白酒', code: 'BK0896', sourceType: 'concept' },
  { key: 'food-beverage', displayName: '食品饮料', code: 'BK0438', sourceType: 'industry' },
  { key: 'innovative-drug', displayName: '创新药', code: 'BK1106', sourceType: 'concept' },
  { key: 'robotics', displayName: '机器人', code: 'BK1408', sourceType: 'industry' },
  { key: 'semiconductor', displayName: '半导体', code: 'BK1036', sourceType: 'industry' },
  { key: 'consumer-electronics', displayName: '消费电子', code: 'BK1037', sourceType: 'industry' },
  { key: 'software', displayName: '软件开发', code: 'BK0737', sourceType: 'industry' },
  { key: 'communication-equipment', displayName: '通信设备', code: 'BK0448', sourceType: 'industry' },
  { key: 'optical-module', displayName: '光模块', code: 'BK1136', sourceType: 'concept' },
  { key: 'battery', displayName: '电池', code: 'BK1033', sourceType: 'industry' },
  { key: 'photovoltaic-equipment', displayName: '光伏设备', code: 'BK1031', sourceType: 'industry' },
  { key: 'vehicle', displayName: '汽车整车', code: 'BK1029', sourceType: 'concept' },
  { key: 'auto-parts', displayName: '汽车零部件', code: 'BK0481', sourceType: 'industry' },
  { key: 'defense', displayName: '国防军工', code: 'BK1204', sourceType: 'industry' },
  { key: 'coal', displayName: '煤炭行业', code: 'BK0437', sourceType: 'industry' },
  { key: 'nonferrous', displayName: '有色金属', code: 'BK0478', sourceType: 'industry' },
  { key: 'rare-earth', displayName: '稀土', code: 'BK1626', sourceType: 'industry' },
  { key: 'power', displayName: '电力行业', code: 'BK0428', sourceType: 'industry' }
];

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function getEl(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = getEl(id);
  if (element) {
    element.textContent = value;
  }
}

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }
  return numberFormatter.format(value);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }
  return `${formatNumber(value)}%`;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) {
    return '--';
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (absValue >= 100000000) {
    return `${sign}${formatNumber(absValue / 100000000)}亿`;
  }
  if (absValue >= 10000) {
    return `${sign}${formatNumber(absValue / 10000)}万`;
  }
  return `${sign}${formatNumber(absValue)}`;
}

function formatShanghaiDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || '--';
  }

  return date.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatDateTimeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || '--';
  }

  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function getShanghaiDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

function getShanghaiNowMs() {
  const parts = getShanghaiDateParts();
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
}

function getShanghaiMinutesOfDay() {
  const parts = getShanghaiDateParts();
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function getShanghaiMinuteKey() {
  const parts = getShanghaiDateParts();
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function isWithinAutoRefreshWindow() {
  const minutes = getShanghaiMinutesOfDay();
  return minutes >= AUTO_REFRESH_START_MINUTES && minutes <= AUTO_REFRESH_END_MINUTES;
}

function getRefreshWindowText() {
  return '09:25-15:05';
}

function getNextShanghaiForceRefreshDelayMs() {
  const now = getShanghaiNowMs();
  const parts = getShanghaiDateParts();
  let target = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    FORCE_REFRESH_HOUR,
    FORCE_REFRESH_MINUTE,
    0
  );

  if (target <= now) {
    target += 24 * 60 * 60 * 1000;
  }

  return target - now;
}

function trendClass(value) {
  if (value > 0) {
    return 'positive';
  }
  if (value < 0) {
    return 'negative';
  }
  return '';
}

function flowColor(value) {
  if (value > 0) {
    return cssVar('--buy') || '#059669';
  }
  if (value < 0) {
    return cssVar('--sell') || '#dc2626';
  }
  return cssVar('--muted') || '#687789';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[char];
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed with ${response.status}`);
    error.code = payload.code || null;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function buildOption(items) {
  const ordered = [...items].reverse();
  const names = ordered.map((item) => item.name);
  const values = ordered.map((item) => item.mainNetInflow || 0);
  const mutedColor = cssVar('--muted') || '#687789';
  const axisColor = 'rgba(104, 119, 137, 0.26)';
  const splitColor = 'rgba(104, 119, 137, 0.14)';

  return {
    animation: true,
    backgroundColor: 'transparent',
    grid: {
      left: 92,
      right: 44,
      top: 28,
      bottom: 34
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'shadow'
      },
      backgroundColor: 'rgba(30, 35, 41, 0.92)',
      borderWidth: 0,
      textStyle: {
        color: '#fdf8f1'
      },
      formatter(params) {
        const item = ordered[params[0].dataIndex];
        return [
          `<div style="margin-bottom:6px;font-weight:600;">${escapeHtml(item.name)}</div>`,
          `主力净流入: ${formatMoney(item.mainNetInflow)}`,
          `主力净占比: ${formatPercent(item.mainNetInflowPct)}`,
          `涨跌幅: ${formatPercent(item.changePct)}`
        ].join('<br>');
      }
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        color: mutedColor,
        formatter(value) {
          return formatMoney(value);
        }
      },
      axisLine: { lineStyle: { color: axisColor } },
      splitLine: {
        lineStyle: { color: splitColor, type: 'dashed' }
      }
    },
    yAxis: {
      type: 'category',
      data: names,
      axisLabel: {
        color: mutedColor,
        overflow: 'truncate',
        width: 78
      },
      axisLine: { lineStyle: { color: axisColor } },
      axisTick: { show: false }
    },
    series: [
      {
        name: '主力净流入',
        type: 'bar',
        data: values,
        barMaxWidth: 24,
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color(params) {
            return flowColor(params.value);
          }
        },
        label: {
          show: true,
          position: 'right',
          color: mutedColor,
          formatter(params) {
            return formatMoney(params.value);
          }
        }
      }
    ]
  };
}

function renderChart(items) {
  const chartDom = getEl('sector-flow-chart');
  if (!chartDom || !window.echarts) {
    return;
  }

  if (!chartInstance) {
    chartInstance = echarts.init(chartDom, null, { renderer: 'canvas' });
    window.addEventListener('resize', resizeChart);
  }

  chartInstance.setOption(buildOption(items), true);
}

function resizeChart() {
  if (chartInstance) {
    chartInstance.resize();
  }
}

function renderTable(items) {
  const tableBody = getEl('sector-flow-list');
  const empty = getEl('sector-flow-empty');
  if (!tableBody || !empty) {
    return;
  }

  tableBody.innerHTML = '';
  empty.hidden = items.length > 0;

  items.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="sector-rank">${item.rank}</span></td>
      <td>
        <strong>${escapeHtml(item.name)}</strong>
        <div class="meta">${escapeHtml(item.code)}</div>
      </td>
      <td class="${trendClass(item.changePct)}">${formatPercent(item.changePct)}</td>
      <td class="${trendClass(item.mainNetInflow)}">${formatMoney(item.mainNetInflow)}</td>
      <td class="${trendClass(item.mainNetInflowPct)}">${formatPercent(item.mainNetInflowPct)}</td>
      <td class="${trendClass(item.superNetInflow)}">${formatMoney(item.superNetInflow)}</td>
      <td class="${trendClass(item.bigNetInflow)}">${formatMoney(item.bigNetInflow)}</td>
    `;
    tableBody.appendChild(tr);
  });
}

function renderSummary(payload) {
  const items = payload.items || [];
  const leader = items[0] || null;
  const positiveCount = items.filter((item) => item.mainNetInflow > 0).length;
  const totalInflow = items.reduce((sum, item) => sum + (Number.isFinite(item.mainNetInflow) ? item.mainNetInflow : 0), 0);
  const leaderPercent = leader && Number.isFinite(leader.mainNetInflowPct) ? Math.max(0, Math.min(100, leader.mainNetInflowPct)) : 0;
  const accent = leader ? flowColor(leader.mainNetInflow) : cssVar('--price') || '#2563eb';

  setText('sector-flow-leader', leader ? leader.name : '--');
  setText('sector-flow-leader-money', leader ? formatMoney(leader.mainNetInflow) : '--');
  setText('sector-flow-status', leader ? `主力净占比 ${formatPercent(leader.mainNetInflowPct)}` : '暂无数据');
  setText('sector-flow-updated', payload.updatedAt || '--');
  setText('sector-flow-count', payload.total ? `${items.length}/${payload.total}` : String(items.length));
  setText('sector-flow-positive-count', String(positiveCount));
  setText('sector-flow-total', formatMoney(totalInflow));

  const leaderMoney = getEl('sector-flow-leader-money');
  const status = getEl('sector-flow-status');
  if (leaderMoney) {
    leaderMoney.style.color = accent;
  }
  if (status) {
    status.style.color = accent;
  }
  document.documentElement.style.setProperty('--score-accent', accent);
  document.documentElement.style.setProperty('--score-progress', `${leaderPercent}%`);
}

function setLoading(isLoading) {
  const button = getEl('sector-flow-refresh');
  if (button) {
    button.disabled = isLoading;
    button.textContent = isLoading ? '刷新中' : '刷新';
  }
}

function setHistoryStatus(text) {
  setText('sector-flow-history-status', text);
}

function buildHistoryCellTitle(sector, record) {
  return [
    `${sector.displayName} ${record.tradingDate || '--'}`,
    `最晚快照: ${record.capturedAt ? formatDateTimeLabel(record.capturedAt) : '--'}`,
    `当日排名: ${Number.isFinite(record.rank) ? record.rank : '--'}`,
    `涨跌幅: ${formatPercent(record.changePct)}`,
    `主力净流入: ${formatMoney(record.mainNetInflow)}`,
    `主力净占比: ${formatPercent(record.mainNetInflowPct)}`
  ].join('\n');
}

function buildRecentInflowTitle(sector, dates, value) {
  return [
    `${sector.displayName} 近5日总流入`,
    `统计日期: ${dates.length ? dates.join(' / ') : '--'}`,
    `合计: ${formatMoney(value)}`
  ].join('\n');
}

function renderDailyHistoryTable(payloads) {
  const tableHead = getEl('sector-flow-history-head');
  const tableBody = getEl('sector-flow-history-list');
  const empty = getEl('sector-flow-history-empty');
  if (!tableHead || !tableBody || !empty) {
    return;
  }

  const payloadByCode = new Map(payloads.map((payload) => [payload.code, payload]));
  const dateSet = new Set();
  payloads.forEach((payload) => {
    (payload.records || []).forEach((record) => {
      if (record.tradingDate) {
        dateSet.add(record.tradingDate);
      }
    });
  });

  const dates = Array.from(dateSet).sort().reverse();
  const recentDates = dates.slice(0, 5);
  tableHead.innerHTML = `
    <tr>
      <th>标的</th>
      <th>近5日总流入</th>
      ${dates.map((date) => `<th>${escapeHtml(date)}</th>`).join('')}
    </tr>
  `;
  tableBody.innerHTML = '';
  empty.hidden = dates.length > 0;

  const rows = MAINSTREAM_SECTORS.map((sector, index) => {
    const records = (payloadByCode.get(sector.code)?.records || []);
    const recordByDate = new Map(records.map((record) => [record.tradingDate, record]));
    const recentNetInflow = recentDates.reduce((sum, date) => {
      const value = recordByDate.get(date)?.mainNetInflow;
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    return {
      sector,
      index,
      recordByDate,
      recentNetInflow
    };
  }).sort((left, right) => {
    if (right.recentNetInflow !== left.recentNetInflow) {
      return right.recentNetInflow - left.recentNetInflow;
    }
    return left.index - right.index;
  });

  rows.forEach(({ sector, recordByDate, recentNetInflow }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(sector.displayName)}</strong>
        <div class="meta">${escapeHtml(sector.code)}</div>
      </td>
      <td class="sector-flow-recent-total ${trendClass(recentNetInflow)}" title="${escapeHtml(buildRecentInflowTitle(sector, recentDates, recentNetInflow))}">
        <strong>${formatMoney(recentNetInflow)}</strong>
        <span>${recentDates.length}日合计</span>
      </td>
      ${dates.map((date) => {
        const record = recordByDate.get(date);
        if (!record) {
          return '<td class="muted-cell">--</td>';
        }

        return `
          <td class="${trendClass(record.mainNetInflow)}" title="${escapeHtml(buildHistoryCellTitle(sector, record))}">
            <strong>${formatMoney(record.mainNetInflow)}</strong>
            <span>${formatPercent(record.mainNetInflowPct)}</span>
          </td>
        `;
      }).join('')}
    `;
    tableBody.appendChild(tr);
  });
}

async function loadSectorDailyHistory() {
  const errorBox = getEl('error');
  if (historyAbortController) {
    historyAbortController.abort();
  }
  historyAbortController = new AbortController();
  setHistoryStatus('板块历史资金流向加载中...');

  try {
    const payloads = await Promise.all(MAINSTREAM_SECTORS.map((sector) => (
      fetchJson(`/api/sector-fund-flow/daily-history?code=${encodeURIComponent(sector.code)}`, {
        signal: historyAbortController.signal
      }).then((payload) => ({
        ...payload,
        code: payload.code || sector.code,
        name: payload.name || sector.displayName
      }))
    )));
    const totalDays = new Set(payloads.flatMap((payload) => (
      (payload.records || []).map((record) => record.tradingDate).filter(Boolean)
    ))).size;
    const sectorCount = payloads.filter((payload) => (payload.records || []).length > 0).length;

    renderDailyHistoryTable(payloads);
    if (!totalDays) {
      setHistoryStatus('暂无板块历史资金数据。');
      return;
    }

    setHistoryStatus(`已展示 ${sectorCount}/${MAINSTREAM_SECTORS.length} 个板块、${totalDays} 个历史交易日；每天取当天最晚一条快照。`);
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    const message = error.code === 'SUPABASE_NOT_CONFIGURED'
      ? '历史数据加载失败：数据库连接未配置，请配置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY。'
      : `历史数据加载失败：${error.message}`;
    setHistoryStatus(message);
    if (errorBox && /^Invalid /.test(error.message)) {
      errorBox.hidden = false;
      errorBox.textContent = `加载失败：${error.message}`;
    }
  }
}

function buildSavedSectorFlowPayload(historyPayload) {
  const snapshots = historyPayload.snapshots || [];
  const latestSnapshot = snapshots[snapshots.length - 1] || null;
  const items = latestSnapshot
    ? (latestSnapshot.items || []).map((item, index) => ({
      rank: Number.isFinite(item.rank) ? item.rank : index + 1,
      key: item.code,
      code: item.code,
      name: item.name,
      rawName: item.name,
      sourceType: 'saved',
      changePct: Number.isFinite(item.changePct) ? item.changePct : null,
      mainNetInflow: Number.isFinite(item.mainNetInflow) ? item.mainNetInflow : null,
      mainNetInflowPct: Number.isFinite(item.mainNetInflowPct) ? item.mainNetInflowPct : null,
      superNetInflow: null,
      bigNetInflow: null,
      updatedAt: latestSnapshot.capturedAt ? formatTimeLabel(latestSnapshot.capturedAt) : historyPayload.date
    }))
    : [];

  return {
    source: 'Supabase sector flow history',
    sectorType: 'saved',
    sortBy: 'mainNetInflow',
    total: historyPayload.sectorCount || items.length,
    updatedAt: latestSnapshot ? formatTimeLabel(latestSnapshot.capturedAt) : '--',
    items
  };
}

function getLatestHistorySnapshot(historyPayload) {
  const snapshots = historyPayload && Array.isArray(historyPayload.snapshots) ? historyPayload.snapshots : [];
  return snapshots[snapshots.length - 1] || null;
}

function getSnapshotAgeMs(snapshot) {
  if (!snapshot || !snapshot.capturedAt) {
    return Infinity;
  }

  const capturedAtMs = new Date(snapshot.capturedAt).getTime();
  if (!Number.isFinite(capturedAtMs)) {
    return Infinity;
  }

  return Math.max(0, Date.now() - capturedAtMs);
}

function isRecentHistoryPayload(historyPayload) {
  return getSnapshotAgeMs(getLatestHistorySnapshot(historyPayload)) < MIN_REALTIME_FETCH_INTERVAL_MS;
}

async function renderSavedSectorFlow(historyPayload) {
  if (!historyPayload.snapshots || !historyPayload.snapshots.length) {
    throw new Error(`${historyPayload.date} 暂无已保存的板块资金快照。`);
  }

  const payload = buildSavedSectorFlowPayload(historyPayload);
  if (!payload.items.length) {
    throw new Error(`${historyPayload.date} 暂无可展示的板块资金明细。`);
  }

  renderSummary(payload);
  renderChart(payload.items);
  renderTable(payload.items);
}

async function loadSavedSectorFlow(date = formatShanghaiDate()) {
  const historyPayload = await fetchJson(`/api/sector-fund-flow/history?date=${encodeURIComponent(date)}`);
  await renderSavedSectorFlow(historyPayload);
}

async function loadSectorFlow({ silent = false } = {}) {
  const errorBox = getEl('error');
  const date = formatShanghaiDate();
  if (!isWithinAutoRefreshWindow()) {
    if (errorBox && !silent) {
      errorBox.hidden = true;
    }
    setLoading(true);
    setText('sector-flow-status', `非实时请求时段 ${getRefreshWindowText()}`);
    try {
      await loadSavedSectorFlow(date);
    } catch (error) {
      if (errorBox && !silent) {
        errorBox.hidden = false;
        errorBox.textContent = `加载失败：${error.message}`;
      }
    } finally {
      setLoading(false);
    }
    return;
  }

  try {
    const historyPayload = await fetchJson(`/api/sector-fund-flow/history?date=${encodeURIComponent(date)}`);
    if (isRecentHistoryPayload(historyPayload)) {
      await renderSavedSectorFlow(historyPayload);
      if (errorBox && !silent) {
        errorBox.hidden = true;
      }
      setLoading(false);
      return;
    }
  } catch (error) {
    if (!silent) {
      setText('sector-flow-status', `历史快照预检查失败，继续请求实时数据`);
    }
  }

  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();
  setLoading(true);

  if (errorBox && !silent) {
    errorBox.hidden = true;
  }

  try {
    const payload = await fetchJson('/api/sector-fund-flow', {
      signal: abortController.signal
    });
    const items = payload.items || [];

    if (!items.length) {
      throw new Error('没有可展示的板块资金数据。');
    }

    renderSummary(payload);
    renderChart(items);
    renderTable(items);
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = `加载失败：${error.message}`;
    }
  } finally {
    setLoading(false);
  }
}

function runScheduledSectorFlowRefresh() {
  if (!isWithinAutoRefreshWindow()) {
    return;
  }

  const minuteKey = getShanghaiMinuteKey();
  if (minuteKey === lastAutoRefreshMinuteKey) {
    return;
  }

  lastAutoRefreshMinuteKey = minuteKey;
  loadSectorFlow({ silent: true });
}

function scheduleForceRefresh() {
  if (forceRefreshTimer) {
    clearTimeout(forceRefreshTimer);
  }

  forceRefreshTimer = window.setTimeout(() => {
    runScheduledSectorFlowRefresh();
    scheduleForceRefresh();
  }, getNextShanghaiForceRefreshDelayMs());
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }

  autoRefreshTimer = window.setInterval(() => {
    runScheduledSectorFlowRefresh();
  }, AUTO_REFRESH_INTERVAL_MS);
  scheduleForceRefresh();
}

function destroy() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  if (historyAbortController) {
    historyAbortController.abort();
    historyAbortController = null;
  }
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (forceRefreshTimer) {
    clearTimeout(forceRefreshTimer);
    forceRefreshTimer = null;
  }
  lastAutoRefreshMinuteKey = '';
  window.removeEventListener('resize', resizeChart);
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
  }
}

async function init() {
  destroy();
  const refreshButton = getEl('sector-flow-refresh');
  if (refreshButton) {
    refreshButton.addEventListener('click', async () => {
      await loadSectorFlow();
      await loadSectorDailyHistory();
    });
  }

  await Promise.all([
    loadSectorFlow(),
    loadSectorDailyHistory()
  ]);
  startAutoRefresh();
  return destroy;
}

export { destroy, init };
