import NotificationService from '../lib/notificationService.js';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const statusLabels = {
  active: '监听中',
  triggered: '已触发',
  sold: '已卖出'
};
const statusClasses = {
  active: 'stop-active',
  triggered: 'stop-triggered',
  sold: 'stop-sold'
};
const numberFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

let positions = [];
let abortController = null;
let checkAbortController = null;
let timerId = null;
let isChecking = false;
let lastFocusedElement = null;

NotificationService.setConfig({ strategyName: '止损监控' });

function getEl(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const element = getEl(id);
  if (element) {
    element.textContent = value;
  }
}

function setHidden(id, hidden) {
  const element = getEl(id);
  if (element) {
    element.hidden = hidden;
  }
}

function formatNumber(value) {
  return Number.isFinite(value) ? numberFormatter.format(value) : '--';
}

function formatDateTime(value) {
  if (!value) {
    return '--';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
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
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败：${response.status}`);
    error.code = payload.code || null;
    throw error;
  }
  return payload;
}

function countByStatus(status) {
  return positions.filter((position) => position.status === status).length;
}

function renderSummary(detail = null) {
  const activeCount = countByStatus('active');
  const triggeredCount = countByStatus('triggered');
  const soldCount = countByStatus('sold');
  setText('stop-loss-active-count', String(activeCount));
  setText('stop-loss-triggered-count', String(triggeredCount));
  setText('stop-loss-list-meta', `共 ${positions.length} 条，已卖出 ${soldCount} 条`);
  setText('stop-loss-status', detail || (activeCount ? '每 5 分钟自动检查' : '暂无 active 记录'));
  document.documentElement.style.setProperty('--score-progress', positions.length ? `${Math.max(12, Math.round((activeCount / positions.length) * 100))}%` : '0%');
}

function renderTable() {
  const tbody = getEl('stop-loss-list');
  if (!tbody) {
    return;
  }

  tbody.innerHTML = positions.map((position) => {
    const statusClass = statusClasses[position.status] || 'stop-sold';
    const canSell = position.status !== 'sold';
    const latestClass =
      Number.isFinite(position.lastPrice) && position.lastPrice <= position.stopLossPrice
        ? 'negative'
        : 'positive';

    return `
      <tr>
        <td><strong>${escapeHtml(position.name)}</strong><div class="meta">${escapeHtml(position.symbol)}</div></td>
        <td>${formatNumber(position.buyPrice)}</td>
        <td class="negative">${formatNumber(position.stopLossPrice)}</td>
        <td class="${latestClass}">${formatNumber(position.lastPrice)}</td>
        <td><span class="status-badge ${statusClass}">${statusLabels[position.status] || position.status}</span></td>
        <td>${formatDateTime(position.lastCheckedAt)}</td>
        <td>
          <button class="stop-loss-sell" type="button" data-sell-id="${escapeHtml(position.id)}" ${canSell ? '' : 'disabled'}>卖出</button>
        </td>
      </tr>
    `;
  }).join('');

  setHidden('stop-loss-empty', positions.length > 0);
  tbody.querySelectorAll('[data-sell-id]').forEach((button) => {
    button.addEventListener('click', () => sellPosition(button.dataset.sellId));
  });
}

function setError(message) {
  const errorBox = getEl('error');
  if (!errorBox) {
    return;
  }
  errorBox.hidden = !message;
  errorBox.textContent = message || '';
}

function setFormError(message) {
  const errorBox = getEl('stop-loss-form-error');
  if (!errorBox) {
    return;
  }
  errorBox.hidden = !message;
  errorBox.textContent = message || '';
}

function setButtonLoading(id, loading, textWhenIdle) {
  const button = getEl(id);
  if (!button) {
    return;
  }
  button.disabled = loading;
  if (textWhenIdle) {
    button.textContent = loading ? '处理中...' : textWhenIdle;
  }
}

async function loadPositions({ silent = false } = {}) {
  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();

  if (!silent) {
    setText('stop-loss-status', '正在加载列表...');
  }

  try {
    const payload = await fetchJson('/api/stop-loss/positions', {
      signal: abortController.signal
    });
    positions = payload.positions || [];
    renderTable();
    renderSummary();
    setError('');
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    setError(`加载失败：${error.message}`);
    renderSummary('加载失败');
  }
}

function buildTriggeredNotification(payload) {
  const lines = [
    `本次检查 ${payload.checkedCount} 条，触发 ${payload.triggeredCount} 条。`,
    ''
  ];

  payload.triggered.forEach((position, index) => {
    lines.push(
      `### ${index + 1}. ${position.name} 触发止损`,
      `- 标的：${position.name} (${position.symbol})`,
      `- 买入价：${formatNumber(position.buyPrice)}`,
      `- 止损价：${formatNumber(position.stopLossPrice)}`,
      `- 最新价：${formatNumber(position.lastPrice)}`,
      `- 检查时间：${formatDateTime(position.triggeredAt || payload.checkedAt)}`,
      ''
    );
  });

  return lines.join('\n').trim();
}

async function sendTriggeredNotification(payload) {
  if (!payload.triggered || !payload.triggered.length) {
    return;
  }

  NotificationService.addNotification(
    buildTriggeredNotification(payload),
    `stop-loss:${payload.checkedAt}`,
    `stop-loss:${payload.checkedAt}`
  );
  await NotificationService.sendAllNotifications();
}

async function checkPositions({ silent = false } = {}) {
  if (isChecking) {
    return;
  }

  isChecking = true;
  if (checkAbortController) {
    checkAbortController.abort();
  }
  checkAbortController = new AbortController();
  setButtonLoading('stop-loss-check', true, '立即检查');
  if (!silent) {
    setText('stop-loss-status', '正在批量检查...');
  }

  try {
    const payload = await fetchJson('/api/stop-loss/check', {
      method: 'POST',
      body: JSON.stringify({}),
      signal: checkAbortController.signal
    });
    let notificationError = null;
    try {
      await sendTriggeredNotification(payload);
    } catch (error) {
      notificationError = error;
    }
    setText('stop-loss-last-check', formatDateTime(payload.checkedAt));
    await loadPositions({ silent: true });
    const detail = notificationError
      ? `本次触发 ${payload.triggeredCount} 条，推送失败`
      : payload.triggeredCount
        ? `本次触发 ${payload.triggeredCount} 条，已汇总推送`
        : `本次检查 ${payload.checkedCount} 条，无触发`;
    renderSummary(detail);
    if (notificationError) {
      setError(`微信推送失败：${notificationError.message}`);
      return;
    }
    setError('');
  } catch (error) {
    if (error.name === 'AbortError') {
      return;
    }
    setError(`检查失败：${error.message}`);
    renderSummary('检查失败');
  } finally {
    isChecking = false;
    setButtonLoading('stop-loss-check', false, '立即检查');
  }
}

function validateFormData(form) {
  const formData = new FormData(form);
  const payload = {
    symbol: String(formData.get('symbol') || '').trim(),
    name: String(formData.get('name') || '').trim(),
    buyPrice: Number(formData.get('buyPrice')),
    stopLossPrice: Number(formData.get('stopLossPrice'))
  };

  if (!payload.symbol) {
    throw new Error('请填写标的代码。');
  }
  if (!payload.name) {
    throw new Error('请填写标的名称。');
  }
  if (!Number.isFinite(payload.buyPrice) || payload.buyPrice <= 0) {
    throw new Error('买入价格必须大于 0。');
  }
  if (!Number.isFinite(payload.stopLossPrice) || payload.stopLossPrice <= 0) {
    throw new Error('止损价格必须大于 0。');
  }
  if (payload.stopLossPrice >= payload.buyPrice) {
    throw new Error('止损价格必须低于买入价格。');
  }

  return payload;
}

function openModal() {
  const modal = getEl('stop-loss-modal');
  const form = getEl('stop-loss-form');
  if (!modal || !form) {
    return;
  }

  lastFocusedElement = document.activeElement;
  form.reset();
  setFormError('');
  modal.hidden = false;
  document.body.classList.add('modal-open');
  window.setTimeout(() => getEl('stop-loss-symbol')?.focus(), 0);
}

function closeModal() {
  const modal = getEl('stop-loss-modal');
  if (!modal) {
    return;
  }
  modal.hidden = true;
  document.body.classList.remove('modal-open');
  setFormError('');
  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    lastFocusedElement.focus();
  }
}

async function createPosition(event) {
  event.preventDefault();
  const form = event.currentTarget;
  let payload;
  try {
    payload = validateFormData(form);
  } catch (error) {
    setFormError(error.message);
    return;
  }

  setButtonLoading('stop-loss-submit', true, '添加');
  try {
    await fetchJson('/api/stop-loss/positions', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    closeModal();
    await loadPositions();
    await checkPositions({ silent: true });
  } catch (error) {
    setFormError(error.message);
  } finally {
    setButtonLoading('stop-loss-submit', false, '添加');
  }
}

async function sellPosition(id) {
  const position = positions.find((item) => item.id === id);
  if (!position) {
    return;
  }

  const confirmed = window.confirm(`确认将 ${position.name} 标记为已卖出？卖出后将停止监听止损价。`);
  if (!confirmed) {
    return;
  }

  try {
    await fetchJson(`/api/stop-loss/sell?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    await loadPositions();
  } catch (error) {
    setError(`卖出失败：${error.message}`);
  }
}

function bindEvents() {
  getEl('stop-loss-add')?.addEventListener('click', openModal);
  getEl('stop-loss-check')?.addEventListener('click', () => checkPositions());
  getEl('stop-loss-close')?.addEventListener('click', closeModal);
  getEl('stop-loss-cancel')?.addEventListener('click', closeModal);
  getEl('stop-loss-modal')?.addEventListener('click', (event) => {
    if (event.target && event.target.hasAttribute('data-stop-loss-close')) {
      closeModal();
    }
  });
  getEl('stop-loss-form')?.addEventListener('submit', createPosition);
  window.addEventListener('keydown', handleKeydown);
}

function handleKeydown(event) {
  if (event.key === 'Escape' && !getEl('stop-loss-modal')?.hidden) {
    closeModal();
  }
}

function startTimer() {
  stopTimer();
  timerId = window.setInterval(() => {
    checkPositions({ silent: true });
  }, CHECK_INTERVAL_MS);
}

function stopTimer() {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function destroy() {
  stopTimer();
  window.removeEventListener('keydown', handleKeydown);
  document.body.classList.remove('modal-open');
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  if (checkAbortController) {
    checkAbortController.abort();
    checkAbortController = null;
  }
  isChecking = false;
}

async function init() {
  destroy();
  positions = [];
  bindEvents();
  await loadPositions();
  await checkPositions({ silent: true });
  startTimer();
  return destroy;
}

export { destroy, init };
