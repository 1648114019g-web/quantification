import { checkStopLossPositions } from './stopLossStore.mjs';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    return json(await checkStopLossPositions());
  } catch (error) {
    return json(
      {
        error: error.message,
        code: error.code || null
      },
      error.statusCode || 500
    );
  }
};
