export const config = {
  runtime: 'edge'
};

export default async function handler(request) {
  const userAgent = request.headers.get('user-agent') || '';
  const userAgentLower = userAgent.toLowerCase();
  
  // Разрешаем okhttp (как в вашем запросе), но блокируем curl
  if (userAgentLower.includes('curl') && !userAgentLower.includes('okhttp')) {
    return new Response('Access Denied', { 
      status: 403,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'X-Blocked-Reason': `Blocked. Next time, try not to use someone else's API.`
      }
    });
  }

  const origin = request.headers.get('origin') || '';
  const allowedOrigins = [
    'https://warp-generator.github.io',
  ];
  
  // Разрешаем все origins или только из белого списка
  const corsOrigin = allowedOrigins.includes(origin) ? origin : '*';
  
  if (request.method === 'OPTIONS') {
    return handlePreflight(corsOrigin);
  }

  const url = new URL(request.url);
  const { pathname } = url;

  const apiUrl = routeApi(pathname);
  if (!apiUrl) {
    return new Response('Not Found', {status: 404});
  }

  try {
    // Создаем новый объект заголовков для запроса к API
    const headers = new Headers();
    
    // Копируем только нужные заголовки
    const allowedForwardHeaders = [
      'content-type',
      'accept',
      'accept-encoding',
      'accept-language',
      'user-agent'
    ];
    
    // Копируем разрешенные заголовки
    for (const [key, value] of request.headers.entries()) {
      if (allowedForwardHeaders.includes(key.toLowerCase())) {
        headers.set(key, value);
      }
    }
    
    // Добавляем CF-Client-Version если он есть
    const cfClientVersion = request.headers.get('cf-client-version');
    if (cfClientVersion) {
      headers.set('CF-Client-Version', cfClientVersion);
    }
    
    // Получаем тело запроса
    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = request.body;
    }

    const response = await fetch(apiUrl, {
      method: request.method,
      headers: headers,
      body: body,
    });

    return handleApiResponse(response, corsOrigin);
    
  } catch (error) {
    return new Response(`Error fetching data: ${error.message}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': corsOrigin,
      },
    });
  }
}

function handlePreflight(origin) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent, CF-Client-Version, CF-Client-Version'.toLowerCase(),
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    },
  });
}

function routeApi(pathname) {
  const cleanPath = pathname.startsWith('/api') 
    ? pathname.substring(4) || '/'
    : pathname;
  
  const routes = {
    '/keys': 'https://keygen.warp-generator.workers.dev',
    '/wg': 'https://api.cloudflareclient.com/v0a1922/reg',
  };
  
  return routes[cleanPath] || null;
}

async function handleApiResponse(response, origin) {
  const newHeaders = new Headers(response.headers);
  
  // Устанавливаем CORS заголовки
  newHeaders.set('Access-Control-Allow-Origin', origin);
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent, CF-Client-Version');
  newHeaders.set('Access-Control-Allow-Credentials', 'true');
  
  // Добавляем Vary header для кеширования
  newHeaders.append('Vary', 'Origin');
  newHeaders.append('Vary', 'Access-Control-Request-Headers');
  newHeaders.append('Vary', 'Access-Control-Request-Method');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
