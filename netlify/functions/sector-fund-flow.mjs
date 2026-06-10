import { persistSectorFlowPayload } from './sectorFlowStore.mjs';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const SECTOR_FLOW_LOG_PREFIX = '[sector-fund-flow]';
const EASTMONEY_RETRY_COUNT = 2;
const EASTMONEY_RETRY_DELAY_MS = 450;
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

function logSectorFlow(message, details = null) {
  if (details === null || details === undefined) {
    console.log(`${SECTOR_FLOW_LOG_PREFIX} ${message}`);
    return;
  }
  console.log(`${SECTOR_FLOW_LOG_PREFIX} ${message}`, details);
}

function logSectorFlowError(message, error, details = null) {
  console.error(`${SECTOR_FLOW_LOG_PREFIX} ${message}`, {
    ...(details || {}),
    error: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : undefined
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseEastMoneyPayload(raw) {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith('jQuery')
    ? trimmed.replace(/^[^(]*\(/, '').replace(/\);?$/, '')
    : trimmed;
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    logSectorFlowError('failed to parse Eastmoney payload', error, {
      rawPreview: trimmed.slice(0, 240)
    });
    throw error;
  }
}

function parseEastMoneyTime(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  return formatter.format(date).replace(',', '');
}

function normalizeSectorFlowItem(item, index, config = null) {
  return {
    rank: index + 1,
    key: config ? config.key : item.f12 || '',
    code: item.f12 || '',
    name: config ? config.displayName : item.f14 || '--',
    rawName: item.f14 || '--',
    sourceType: config ? config.sourceType : 'industry',
    price: parseNumber(item.f2),
    changePct: parseNumber(item.f3),
    mainNetInflow: parseNumber(item.f62),
    mainNetInflowPct: parseNumber(item.f184),
    superNetInflow: parseNumber(item.f66),
    superNetInflowPct: parseNumber(item.f69),
    bigNetInflow: parseNumber(item.f72),
    bigNetInflowPct: parseNumber(item.f75),
    mediumNetInflow: parseNumber(item.f78),
    mediumNetInflowPct: parseNumber(item.f81),
    smallNetInflow: parseNumber(item.f84),
    smallNetInflowPct: parseNumber(item.f87),
    updatedAt: parseEastMoneyTime(parseNumber(item.f124))
  };
}

async function fetchMainstreamSectorRows() {
  const sectorByCode = new Map(MAINSTREAM_SECTORS.map((sector) => [sector.code, sector]));
  const params = new URLSearchParams({
    fltt: '2',
    invt: '2',
    fields: 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f124',
    secids: MAINSTREAM_SECTORS.map((sector) => `90.${sector.code}`).join(',')
  });
  const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?${params.toString()}`;

  for (let attempt = 1; attempt <= EASTMONEY_RETRY_COUNT + 1; attempt += 1) {
    try {
      logSectorFlow('request mainstream secids', { attempt, targetCount: MAINSTREAM_SECTORS.length });
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 Node FearGreed Demo',
          Accept: 'application/json,text/plain,*/*'
        }
      });

      if (!response.ok) {
        throw new Error(`Eastmoney sector fund flow API responded with ${response.status}`);
      }

      const payload = parseEastMoneyPayload(await response.text());
      const rows = payload && payload.data && Array.isArray(payload.data.diff) ? payload.data.diff : [];
      const total = payload && payload.data && Number.isFinite(Number(payload.data.total)) ? Number(payload.data.total) : rows.length;

      logSectorFlow('mainstream secids ok', { attempt, total, rows: rows.length });
      return {
        total,
        rows: rows.map((row) => ({
          row,
          config: sectorByCode.get(row.f12)
        })).filter((item) => item.config)
      };
    } catch (error) {
      const details = { attempt, url };
      if (attempt <= EASTMONEY_RETRY_COUNT) {
        const nextDelayMs = EASTMONEY_RETRY_DELAY_MS * attempt;
        logSectorFlowError('mainstream secids attempt failed, retrying', error, { ...details, nextDelayMs });
        await delay(nextDelayMs);
        continue;
      }

      logSectorFlowError('mainstream secids failed', error, details);
      throw error;
    }
  }
}

async function fetchEastMoneySectorRows(sourceType, pageNumber) {
  const params = new URLSearchParams({
    fid: 'f62',
    po: '1',
    pz: '100',
    pn: String(pageNumber),
    np: '1',
    fltt: '2',
    invt: '2',
    fs: sourceType === 'concept' ? 'm:90+t:3' : 'm:90+t:2',
    fields: 'f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f124'
  });
  const url = `https://push2.eastmoney.com/api/qt/clist/get?${params.toString()}`;

  for (let attempt = 1; attempt <= EASTMONEY_RETRY_COUNT + 1; attempt += 1) {
    try {
      logSectorFlow('request page', { sourceType, pageNumber, attempt });
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 Node FearGreed Demo',
          Accept: 'application/json,text/plain,*/*'
        }
      });

      if (!response.ok) {
        throw new Error(`Eastmoney sector fund flow API responded with ${response.status}`);
      }

      const payload = parseEastMoneyPayload(await response.text());
      const rows = payload && payload.data && Array.isArray(payload.data.diff) ? payload.data.diff : [];
      const total = payload && payload.data && Number.isFinite(Number(payload.data.total)) ? Number(payload.data.total) : rows.length;

      logSectorFlow('page ok', { sourceType, pageNumber, attempt, total, rows: rows.length });
      return { rows, total };
    } catch (error) {
      const details = { sourceType, pageNumber, attempt, url };
      if (attempt <= EASTMONEY_RETRY_COUNT) {
        const nextDelayMs = EASTMONEY_RETRY_DELAY_MS * attempt;
        logSectorFlowError('page attempt failed, retrying', error, { ...details, nextDelayMs });
        await delay(nextDelayMs);
        continue;
      }

      logSectorFlowError('page failed', error, details);
      throw error;
    }
  }
}

async function fetchAllEastMoneySectorRows(sourceType) {
  const firstPage = await fetchEastMoneySectorRows(sourceType, 1);
  const pageCount = Math.max(1, Math.ceil(firstPage.total / 100));
  logSectorFlow('source page count', { sourceType, total: firstPage.total, pageCount });
  const pages = [firstPage];
  for (let pageNumber = 2; pageNumber <= pageCount; pageNumber += 1) {
    pages.push(await fetchEastMoneySectorRows(sourceType, pageNumber));
  }

  const result = {
    total: firstPage.total,
    rows: pages.flatMap((page) => page.rows)
  };
  logSectorFlow('source loaded', { sourceType, total: result.total, rows: result.rows.length });
  return result;
}

export default async () => {
  try {
    logSectorFlow('start', { targetCount: MAINSTREAM_SECTORS.length });
    const sectorRows = await fetchMainstreamSectorRows();
    const foundCodes = new Set(sectorRows.rows.map(({ config }) => config.code));
    const missing = [];
    const items = MAINSTREAM_SECTORS.flatMap((config) => {
      const sector = sectorRows.rows.find((item) => item.config.code === config.code);
      if (!sector) {
        missing.push(config.displayName);
        return [];
      }
      return [normalizeSectorFlowItem(sector.row, 0, config)];
    }).sort((left, right) => {
      const leftValue = Number.isFinite(left.mainNetInflow) ? left.mainNetInflow : -Infinity;
      const rightValue = Number.isFinite(right.mainNetInflow) ? right.mainNetInflow : -Infinity;
      return rightValue - leftValue;
    }).map((item, index) => ({
      ...item,
      rank: index + 1
    }));

    if (!items.length) {
      return json({ error: 'Eastmoney sector fund flow API did not return data.' }, 502);
    }

    logSectorFlow('matched mainstream sectors', {
      matched: items.length,
      missing,
      top: items.slice(0, 5).map((item) => ({
        rank: item.rank,
        name: item.name,
        rawName: item.rawName,
        code: item.code,
        sourceType: item.sourceType,
        mainNetInflow: item.mainNetInflow
      }))
    });

    const payload = {
      source: 'Eastmoney sector fund flow',
      sectorType: 'mainstream',
      sortBy: 'mainNetInflow',
      total: MAINSTREAM_SECTORS.length,
      universeTotals: {
        mainstream: sectorRows.total
      },
      foundCodes: Array.from(foundCodes),
      missing,
      updatedAt: items.find((item) => item.updatedAt)?.updatedAt || new Date().toISOString(),
      items
    };

    try {
      const persistence = await persistSectorFlowPayload(payload);
      if (persistence.skipped) {
        logSectorFlow('persistence skipped', { reason: persistence.reason });
      } else {
        logSectorFlow('persistence ok', {
          snapshotId: persistence.snapshotId,
          tradingDate: persistence.tradingDate,
          itemCount: persistence.itemCount
        });
      }
      return json({ ...payload, persistence });
    } catch (error) {
      logSectorFlowError('persistence failed', error);
      return json({
        ...payload,
        persistence: {
          skipped: false,
          error: error.message
        }
      });
    }
  } catch (error) {
    logSectorFlowError('request failed', error);
    return json({ error: error.message }, 500);
  }
};
