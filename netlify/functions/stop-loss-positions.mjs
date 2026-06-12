import { createStopLossPosition, listStopLossPositions } from './stopLossStore.mjs';

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    const error = new Error('Invalid JSON body.');
    error.statusCode = 400;
    throw error;
  }
}

export default async (request) => {
  try {
    if (request.method === 'GET') {
      return json(await listStopLossPositions());
    }

    if (request.method === 'POST') {
      const body = await parseJsonBody(request);
      return json(await createStopLossPosition(body), 201);
    }

    return json({ error: 'Method not allowed' }, 405);
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
