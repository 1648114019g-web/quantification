import { markStopLossPositionSold } from './stopLossStore.mjs';

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
  if (request.method !== 'PATCH' && request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    return json(await markStopLossPositionSold(id));
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
