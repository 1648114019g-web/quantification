import { getShanghaiDate, readSectorFlowHistory } from './sectorFlowStore.mjs';

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
  const date = url.searchParams.get('date') || getShanghaiDate();

  try {
    return json(await readSectorFlowHistory(date));
  } catch (error) {
    const statusCode = error.code === 'SUPABASE_NOT_CONFIGURED' ? 503 : 500;
    logSectorFlowError('history request failed', error, { date });
    return json({ error: error.message }, statusCode);
  }
};
