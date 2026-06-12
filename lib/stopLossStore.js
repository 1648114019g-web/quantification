const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STOP_LOSS_SELECT = [
  'id',
  'symbol',
  'name',
  'buy_price',
  'stop_loss_price',
  'status',
  'last_price',
  'last_checked_at',
  'last_notified_at',
  'triggered_at',
  'sold_at',
  'created_at',
  'updated_at'
].join(',');

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL.trim() && SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabaseOrigin() {
  try {
    const parsed = new URL(SUPABASE_URL.trim());
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error('Supabase URL must use http or https.');
    }
    return parsed.origin;
  } catch (error) {
    const wrapped = new Error(`Invalid SUPABASE_URL: ${error.message}`);
    wrapped.code = 'SUPABASE_INVALID_URL';
    wrapped.statusCode = 500;
    throw wrapped;
  }
}

function getSupabaseRestUrl(path) {
  return new URL(`/rest/v1/${path.replace(/^\/+/, '')}`, getSupabaseOrigin()).toString();
}

function buildHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

async function requestSupabase(path, options = {}) {
  if (!isSupabaseConfigured()) {
    const error = new Error('Supabase environment variables are not configured.');
    error.code = 'SUPABASE_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }

  if (typeof fetch !== 'function') {
    throw new Error('This Node runtime does not support fetch.');
  }

  const response = await fetch(getSupabaseRestUrl(path), {
    ...options,
    headers: buildHeaders(options.headers)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = payload && payload.message ? payload.message : `Supabase request failed with ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

function createValidationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  error.statusCode = 400;
  return error;
}

function createNotFoundError(message) {
  const error = new Error(message);
  error.code = 'NOT_FOUND';
  error.statusCode = 404;
  return error;
}

function parseFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferMarketPrefix(code) {
  if (/^(60|68|51|52|56|58|50|90)/.test(code)) {
    return 'sh';
  }
  if (/^(00|30|15|16|18|20|39)/.test(code)) {
    return 'sz';
  }
  if (/^(43|83|87|88|92)/.test(code)) {
    return 'bj';
  }
  return '';
}

function normalizeSymbol(rawSymbol) {
  const compact = String(rawSymbol || '').trim().toLowerCase().replace(/\s+/g, '');
  if (/^(sh|sz|bj)\d{6}$/.test(compact)) {
    return compact;
  }
  if (/^\d{6}$/.test(compact)) {
    const prefix = inferMarketPrefix(compact);
    if (prefix) {
      return `${prefix}${compact}`;
    }
  }
  throw createValidationError('Invalid symbol. Use sh/sz/bj followed by 6 digits, for example sh600519.');
}

function assertUuid(id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''))) {
    throw createValidationError('Invalid position id.');
  }
}

function normalizePositionInput(input = {}) {
  const symbol = normalizeSymbol(input.symbol);
  const name = String(input.name || '').trim();
  const buyPrice = parseFiniteNumber(input.buyPrice ?? input.buy_price);
  const stopLossPrice = parseFiniteNumber(input.stopLossPrice ?? input.stop_loss_price);

  if (!name || name.length > 50) {
    throw createValidationError('Name is required and must be 1-50 characters.');
  }
  if (buyPrice === null || buyPrice <= 0) {
    throw createValidationError('Buy price must be a positive number.');
  }
  if (stopLossPrice === null || stopLossPrice <= 0) {
    throw createValidationError('Stop loss price must be a positive number.');
  }
  if (stopLossPrice >= buyPrice) {
    throw createValidationError('Stop loss price must be lower than buy price.');
  }

  return {
    symbol,
    name,
    buy_price: buyPrice,
    stop_loss_price: stopLossPrice
  };
}

function mapPositionRow(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    buyPrice: toNumberOrNull(row.buy_price),
    stopLossPrice: toNumberOrNull(row.stop_loss_price),
    status: row.status,
    lastPrice: toNumberOrNull(row.last_price),
    lastCheckedAt: row.last_checked_at,
    lastNotifiedAt: row.last_notified_at,
    triggeredAt: row.triggered_at,
    soldAt: row.sold_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function listStopLossPositions(options = {}) {
  const params = new URLSearchParams({
    select: STOP_LOSS_SELECT,
    order: 'created_at.desc'
  });
  if (options.status) {
    params.set('status', `eq.${options.status}`);
  }

  const rows = await requestSupabase(`stop_loss_positions?${params.toString()}`, {
    method: 'GET'
  });
  return {
    positions: (Array.isArray(rows) ? rows : []).map(mapPositionRow)
  };
}

async function createStopLossPosition(input) {
  const row = normalizePositionInput(input);
  const rows = await requestSupabase('stop_loss_positions', {
    method: 'POST',
    headers: {
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  const created = Array.isArray(rows) ? rows[0] : rows;
  if (!created || !created.id) {
    throw new Error('Supabase did not return a stop loss position.');
  }
  return {
    position: mapPositionRow(created)
  };
}

async function patchStopLossPosition(id, fields, filters = {}) {
  assertUuid(id);
  const params = new URLSearchParams({
    id: `eq.${id}`,
    select: STOP_LOSS_SELECT
  });
  Object.entries(filters).forEach(([key, value]) => {
    params.set(key, value);
  });

  const rows = await requestSupabase(`stop_loss_positions?${params.toString()}`, {
    method: 'PATCH',
    headers: {
      Prefer: 'return=representation'
    },
    body: JSON.stringify(fields)
  });
  return Array.isArray(rows) ? rows.map(mapPositionRow) : [];
}

async function markStopLossPositionSold(id) {
  const now = new Date().toISOString();
  const rows = await patchStopLossPosition(
    id,
    {
      status: 'sold',
      sold_at: now
    },
    {
      status: 'in.(active,triggered)'
    }
  );
  if (!rows.length) {
    throw createNotFoundError('Position is not active, already sold, or does not exist.');
  }
  return {
    position: rows[0]
  };
}

async function fetchTencentQuotes(symbols) {
  const uniqueSymbols = Array.from(new Set(symbols.map(normalizeSymbol)));
  const quoteMap = new Map();
  const chunkSize = 50;

  for (let start = 0; start < uniqueSymbols.length; start += chunkSize) {
    const chunk = uniqueSymbols.slice(start, start + chunkSize);
    const query = chunk.map((symbol) => encodeURIComponent(symbol)).join(',');
    const response = await fetch(`https://qt.gtimg.cn/q=${query}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 Node FearGreed Demo',
        Accept: 'text/plain,*/*'
      }
    });
    if (!response.ok) {
      throw new Error(`Tencent quote API responded with ${response.status}`);
    }

    const raw = await response.text();
    raw.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^v_([a-z]{2}\d{6})="([^"]*)"/i);
      if (!match) {
        return;
      }
      const symbol = match[1].toLowerCase();
      const values = match[2].split('~');
      const price = parseFiniteNumber(values[3]);
      if (price === null) {
        return;
      }
      const quoteDate = values[30] && /^\d{8}$/.test(values[30])
        ? `${values[30].slice(0, 4)}-${values[30].slice(4, 6)}-${values[30].slice(6, 8)}`
        : null;
      const quoteTime = values[31] && /^\d{6}$/.test(values[31])
        ? `${values[31].slice(0, 2)}:${values[31].slice(2, 4)}:${values[31].slice(4, 6)}`
        : null;
      quoteMap.set(symbol, {
        symbol,
        name: values[1] || '',
        price,
        date: quoteDate,
        time: quoteTime
      });
    });
  }

  return quoteMap;
}

async function updateActivePositionCheck(position, quote, checkedAt) {
  return patchStopLossPosition(
    position.id,
    {
      last_price: quote.price,
      last_checked_at: checkedAt
    },
    {
      status: 'eq.active'
    }
  );
}

async function markActivePositionTriggered(position, quote, checkedAt) {
  return patchStopLossPosition(
    position.id,
    {
      status: 'triggered',
      last_price: quote.price,
      last_checked_at: checkedAt,
      last_notified_at: checkedAt,
      triggered_at: checkedAt
    },
    {
      status: 'eq.active'
    }
  );
}

async function checkStopLossPositions() {
  const checkedAt = new Date().toISOString();
  const { positions } = await listStopLossPositions({ status: 'active' });
  const symbols = positions.map((position) => position.symbol);
  const quoteMap = symbols.length ? await fetchTencentQuotes(symbols) : new Map();
  const triggered = [];
  const missingQuotes = [];
  let updatedCount = 0;

  for (const position of positions) {
    const quote = quoteMap.get(position.symbol);
    if (!quote) {
      missingQuotes.push(position.symbol);
      continue;
    }

    if (quote.price <= position.stopLossPrice) {
      const rows = await markActivePositionTriggered(position, quote, checkedAt);
      if (rows.length) {
        triggered.push(rows[0]);
        updatedCount += 1;
      }
      continue;
    }

    const rows = await updateActivePositionCheck(position, quote, checkedAt);
    if (rows.length) {
      updatedCount += 1;
    }
  }

  return {
    checkedAt,
    checkedCount: positions.length,
    updatedCount,
    triggeredCount: triggered.length,
    missingQuotes,
    triggered
  };
}

module.exports = {
  checkStopLossPositions,
  createStopLossPosition,
  fetchTencentQuotes,
  isSupabaseConfigured,
  listStopLossPositions,
  markStopLossPositionSold,
  normalizeSymbol
};
