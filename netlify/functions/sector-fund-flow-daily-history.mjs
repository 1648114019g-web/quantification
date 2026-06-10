import { readSectorDailyFlowHistory } from './sectorFlowStore.mjs';

const SECTOR_FLOW_LOG_PREFIX = '[sector-fund-flow]';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function logSectorFlowError(message, error, details = null) {
  console.error(`${SECTOR_FLOW_LOG_PREFIX} ${message}`, {
    ...(details || {}),
    error: error && error.message ? error.message : String(error),
    stack: error && error.stack ? error.stack : undefined
  });
}

export default async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const startDate = url.searchParams.get('startDate') || '';
  const endDate = url.searchParams.get('endDate') || '';

  if (!code) {
    return json({ error: 'Missing required parameter: code' }, 400);
  }

  try {
    return json(await readSectorDailyFlowHistory(code, {
      startDate: startDate || null,
      endDate: endDate || null
    }));
  } catch (error) {
    const statusCode = error.code === 'SUPABASE_NOT_CONFIGURED'
      ? 503
      : /^Invalid /.test(error.message || '')
        ? 400
        : 500;
    logSectorFlowError('daily history request failed', error, { code, startDate, endDate });
    return json({ error: error.message, code: error.code || null }, statusCode);
  }
};
