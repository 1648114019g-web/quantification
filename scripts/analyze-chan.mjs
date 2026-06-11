import https from 'https';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SYMBOL = process.argv[2] || 'sh000001';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const CHAN_EXPORTS = [
  'normalizeContainment',
  'findFractals',
  'buildStrokes',
  'buildSegments',
  'buildCenters',
  'buildSignals'
];

async function loadChanToolkit() {
  const filePath = path.join(ROOT_DIR, 'public', 'chan.js');
  const source = await readFile(filePath, 'utf8');
  const executableSource = source
    .replace(/^import[^\n]+\n/, '')
    .replace(/export\s*\{[\s\S]*?\};\s*$/m, '');
  const context = {
    console,
    Intl,
    Math,
    Date,
    Map,
    Set,
    Array,
    Number,
    String,
    Object,
    JSON,
    INDEXES: { [SYMBOL]: SYMBOL },
    fetchIndexHistory: async () => [],
    globalThis: null
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    `${executableSource}\nObject.assign(globalThis, { ${CHAN_EXPORTS.join(', ')} });`,
    context,
    { filename: filePath }
  );

  return Object.fromEntries(CHAN_EXPORTS.map((name) => [name, context[name]]));
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fetchSinaKLine(symbol, scale, datalen) {
  const url = `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${encodeURIComponent(symbol)}&scale=${scale}&datalen=${datalen}`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json,*/*' } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          resolve(data.map((item) => ({
            date: item.day || '',
            open: parseNumber(item.open),
            close: parseNumber(item.close),
            high: parseNumber(item.high),
            low: parseNumber(item.low),
            volume: parseNumber(item.volume)
          })));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function findExtremeRow(rows, field, compare) {
  let best = null;
  let bestPrice = null;
  rows.forEach((row) => {
    const price = row[field];
    if (!Number.isFinite(price)) return;
    if (best === null || compare(price, bestPrice)) {
      best = row;
      bestPrice = price;
    }
  });
  return best;
}

function createStrokePreview(rows, strokes) {
  if (!rows.length || !strokes.length) return null;
  const latestStroke = strokes[strokes.length - 1];
  const rowsAfterStroke = rows.filter((row) => row.date > latestStroke.endDate);
  if (!rowsAfterStroke.length) return null;

  const isUp = latestStroke.direction === 'up';
  const sameDirectionRow = isUp
    ? findExtremeRow(rowsAfterStroke, 'high', (p, b) => p > b)
    : findExtremeRow(rowsAfterStroke, 'low', (p, b) => p < b);
  const sameDirectionPrice = sameDirectionRow ? (isUp ? sameDirectionRow.high : sameDirectionRow.low) : null;
  const extendsLatest = Number.isFinite(sameDirectionPrice) && (
    isUp ? sameDirectionPrice > latestStroke.endPrice : sameDirectionPrice < latestStroke.endPrice
  );

  if (extendsLatest) {
    return {
      direction: latestStroke.direction,
      startDate: latestStroke.endDate,
      endDate: sameDirectionRow.date,
      startPrice: latestStroke.endPrice,
      endPrice: sameDirectionPrice,
      previewKind: 'extension'
    };
  }

  const reverseRow = isUp
    ? findExtremeRow(rowsAfterStroke, 'low', (p, b) => p < b)
    : findExtremeRow(rowsAfterStroke, 'high', (p, b) => p > b);
  const reversePrice = reverseRow ? (isUp ? reverseRow.low : reverseRow.high) : null;
  if (!Number.isFinite(reversePrice)) return null;

  return {
    direction: isUp ? 'down' : 'up',
    startDate: latestStroke.endDate,
    endDate: reverseRow.date,
    startPrice: latestStroke.endPrice,
    endPrice: reversePrice,
    previewKind: 'reverse'
  };
}

function calculateAnalysis(rows, chan) {
  const cleanRows = rows.filter((r) =>
    Number.isFinite(r.open) && Number.isFinite(r.close) && Number.isFinite(r.high) && Number.isFinite(r.low)
  );
  const bars = chan.normalizeContainment(cleanRows);
  const fractals = chan.findFractals(bars);
  const strokes = chan.buildStrokes(fractals, cleanRows);
  const segments = chan.buildSegments(strokes);
  const centers = chan.buildCenters(strokes);
  const signals = chan.buildSignals(strokes, cleanRows, centers);
  const previewStroke = createStrokePreview(cleanRows, strokes);
  return { cleanRows, strokes, segments, centers, signals, previewStroke };
}

function strengthRatio(strokes) {
  if (strokes.length < 3) return null;
  const last = strokes[strokes.length - 1];
  const prevSame = strokes[strokes.length - 3];
  if (last.direction !== prevSame.direction) return null;
  const lastAmp = Math.abs(last.endPrice - last.startPrice);
  const prevAmp = Math.abs(prevSame.endPrice - prevSame.startPrice);
  const lastEnergy = last.strength?.unitEnergy || lastAmp;
  const prevEnergy = prevSame.strength?.unitEnergy || prevAmp;
  return {
    ampRatio: prevAmp ? lastAmp / prevAmp : null,
    energyRatio: prevEnergy ? lastEnergy / prevEnergy : null,
    lastAmp,
    prevAmp,
    lastEnergy,
    prevEnergy
  };
}

function analyzePeriod(periodLabel, rows, chan) {
  const data = calculateAnalysis(rows, chan);
  const { cleanRows, strokes, segments, centers, signals, previewStroke } = data;
  const latest = cleanRows[cleanRows.length - 1];
  const tradable = signals.filter((s) => s.type === 'buy' || s.type === 'sell');
  const range50 = cleanRows.slice(-50);
  return {
    periodLabel,
    latest,
    hi50: Math.max(...range50.map((r) => r.high)),
    lo50: Math.min(...range50.map((r) => r.low)),
    rowCount: cleanRows.length,
    dateRange: `${cleanRows[0].date} ~ ${latest.date}`,
    last3Strokes: strokes.slice(-3),
    latestStroke: strokes[strokes.length - 1],
    latestCenter: centers[centers.length - 1],
    latestSegment: segments[segments.length - 1],
    strength: strengthRatio(strokes),
    recentSignals: signals.slice(-10),
    latestSignal: tradable[tradable.length - 1],
    previewStroke,
    centers: centers.slice(-3),
    segments: segments.slice(-2)
  };
}

async function main() {
  const chan = await loadChanToolkit();
  const [m30rows, m5rows] = await Promise.all([
    fetchSinaKLine(SYMBOL, 30, 1600),
    fetchSinaKLine(SYMBOL, 5, 1600)
  ]);
  console.log(JSON.stringify({
    symbol: SYMBOL,
    m30: analyzePeriod('30分钟', m30rows, chan),
    m5: analyzePeriod('5分钟', m5rows, chan)
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
