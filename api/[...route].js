export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  const { pathname } = new URL(request.url);
  
  // === БЛОКИРОВКА ПО USER-AGENT (okhttp и curl) ===
  const userAgent = request.headers.get('user-agent') || '';
  const userAgentLower = userAgent.toLowerCase();
  
  if (userAgentLower.includes('curl')) {
    return new Response('Access Denied', { 
      status: 403,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'X-Blocked-Reason': `Blocked. Next time, try not to use someone else's API.`
      }
    });
  }

  // === БЕЛЫЙ СПИСОК ORIGIN ===
  const origin = request.headers.get('origin') || '';
  const allowedOrigins = [
    'https://warp-generator.github.io',
    'null'
  ];
  
  if (origin && !allowedOrigins.includes(origin)) {
    return new Response('Access Denied', { 
      status: 403,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'X-Blocked-Reason': `Blocked Origin: ${origin}`
      }
    });
  }

  // Handle CORS Preflight
  if (request.method === 'OPTIONS') {
    return handlePreflight();
  }

  // Route API requests
  const apiUrl = routeApi(pathname);
  if (!apiUrl) {
    return new Response('Not Found', {status: 404});
  }

  try {
    const response = await fetch(apiUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    });

    return handleApiResponse(response);
  } catch (error) {
    return new Response(`Error fetching data: ${error.message}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

function handlePreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}

function routeApi(pathname) {
  const routes = {

  '/keys': 'https://keygen.warp-generator.workers.dev',
  '/wg': 'https://api.cloudflareclient.com/v0a1922/reg',
 };
  
  return routes[pathname] || null;
}

async function handleApiResponse(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', '*');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
