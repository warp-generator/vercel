// Указываем, что это Edge Function (работает на граничной сети)
export const config = {
  runtime: 'edge'  // Важно: это делает функцию Edge Function, а не обычной Serverless
};

// Главный обработчик запросов
export default async function handler(request) {
  // Логируем запрос (для отладки)
  console.log('Запрос получен:', {
    method: request.method,
    url: request.url,
    userAgent: request.headers.get('user-agent'),
    origin: request.headers.get('origin')
  });

  // === БЛОКИРОВКА ПО USER-AGENT (curl) ===
  const userAgent = request.headers.get('user-agent') || '';
  const userAgentLower = userAgent.toLowerCase();
  
  if (userAgentLower.includes('curl')) {
    console.log('Заблокирован curl запрос от:', request.headers.get('cf-connecting-ip') || 'unknown');
    
    return new Response('Access Denied', { 
      status: 403,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Blocked-Reason': `Blocked. Next time, try not to use someone else's API.`,
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });
  }

  // === БЕЛЫЙ СПИСОК ORIGIN (только разрешённые) ===
  const origin = request.headers.get('origin') || '';
  
  // Список разрешённых origins
  const allowedOrigins = [
    'https://warp-generator.github.io',
    'https://ваш-другой-сайт.com',
    'null',  // Для локального тестирования file://
    ''       // Для запросов без Origin header
  ];
  
  // Если есть Origin header и он не в белом списке - блокируем
  if (origin && !allowedOrigins.includes(origin)) {
    console.log('Заблокирован запрос с неразрешённым origin:', origin);
    
    return new Response('Access Denied', { 
      status: 403,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Blocked-Reason': `Blocked Origin: ${origin}`,
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });
  }

  // Парсим URL для получения пути
  const url = new URL(request.url);
  const { pathname, searchParams } = url;
  
  console.log('Обрабатываем путь:', pathname);

  // === ОБРАБОТКА CORS PREFLIGHT (OPTIONS) ЗАПРОСОВ ===
  if (request.method === 'OPTIONS') {
    console.log('Обрабатываем CORS preflight запрос');
    return handlePreflight();
  }

  // === ПЕРЕНАПРАВЛЕНИЕ НА НУЖНЫЙ API ===
  const apiUrl = routeApi(pathname);
  
  if (!apiUrl) {
    console.log('Маршрут не найден:', pathname);
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });
  }

  console.log('Перенаправляем на API:', apiUrl);

  try {
    // Подготавливаем headers для отправки
    const headers = new Headers(request.headers);
    
    // Удаляем заголовки, которые не нужно передавать
    headers.delete('host');
    headers.delete('origin');
    headers.delete('referer');
    
    // Можно добавить свои заголовки
    headers.set('X-Forwarded-For', request.headers.get('cf-connecting-ip') || '');
    headers.set('X-Forwarded-Host', url.hostname);
    
    // Копируем тело запроса, если оно есть
    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = request.body;
    }

    // Формируем полный URL для API (добавляем query параметры)
    const fullApiUrl = searchParams.toString() 
      ? `${apiUrl}?${searchParams.toString()}`
      : apiUrl;

    // Отправляем запрос к целевому API
    const apiResponse = await fetch(fullApiUrl, {
      method: request.method,
      headers: headers,
      body: body,
      // Дополнительные опции
      redirect: 'follow',
      cf: {
        // Cloudflare-specific options (если нужно)
        cacheEverything: false,
      }
    });

    console.log('Получен ответ от API:', apiResponse.status);
    
    // Обрабатываем и возвращаем ответ
    return handleApiResponse(apiResponse, request);

  } catch (error) {
    console.error('Ошибка при запросе к API:', error);
    
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      message: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      },
    });
  }
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

/**
 * Обработка CORS preflight (OPTIONS) запросов
 */
function handlePreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, User-Agent',
      'Access-Control-Max-Age': '86400', // 24 часа кэширования preflight
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin, Access-Control-Request-Headers'
    },
  });
}

/**
 * Маршрутизация API путей
 */
function routeApi(pathname) {
  // Убираем префикс /api если он есть
  const cleanPath = pathname.startsWith('/api') 
    ? pathname.substring(4) || '/'
    : pathname;
  
  const routes = {
    '/keys': 'https://keygen.warp-generator.workers.dev',
    '/wg': 'https://api.cloudflareclient.com/v0a1922/reg',
    // Можно добавить дополнительные маршруты
    '/test': 'https://httpbin.org/anything', // Для тестирования
  };
  
  return routes[cleanPath] || null;
}

/**
 * Обработка ответа от API
 */
async function handleApiResponse(apiResponse, originalRequest) {
  // Получаем тип контента
  const contentType = apiResponse.headers.get('content-type') || 'text/plain';
  
  // Клонируем response для чтения тела
  const responseClone = apiResponse.clone();
  
  // Подготавливаем headers
  const newHeaders = new Headers(apiResponse.headers);
  
  // Добавляем CORS headers
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', '*');
  
  // Заголовки для безопасности
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('X-XSS-Protection', '1; mode=block');
  
  // Управление кэшем
  if (!newHeaders.has('Cache-Control')) {
    newHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    newHeaders.set('Pragma', 'no-cache');
    newHeaders.set('Expires', '0');
  }
  
  // Добавляем информацию о прокси
  newHeaders.set('X-Proxy', 'Vercel-Edge-Function');
  newHeaders.set('X-Proxy-Version', '1.0');
  
  // Можно модифицировать тело ответа если нужно
  let body = apiResponse.body;
  let status = apiResponse.status;
  let statusText = apiResponse.statusText;
  
  // Пример: логгируем успешные ответы
  if (status === 200) {
    try {
      const text = await responseClone.text();
      console.log('Успешный ответ от API (первые 500 символов):', text.substring(0, 500));
      // Преобразуем обратно в поток
      body = text;
    } catch (e) {
      // Если не можем прочитать как текст, оставляем как есть
      console.log('Успешный ответ от API (бинарный)');
    }
  }
  
  return new Response(body, {
    status: status,
    statusText: statusText,
    headers: newHeaders,
  });
}

// === ДОПОЛНИТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ОБРАБОТКИ ОШИБОК ===

/**
 * Создание JSON ответа с ошибкой
 */
function createErrorResponse(message, status = 500, details = {}) {
  return new Response(JSON.stringify({
    success: false,
    error: message,
    ...details,
    timestamp: new Date().toISOString()
  }), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}

/**
 * Проверка rate limiting (если нужно)
 */
function checkRateLimit(request) {
  // Можно реализовать rate limiting используя Vercel KV или другие хранилища
  // Для Edge Functions подойдёт Vercel KV (Redis)
  
  // Пример простой проверки по IP
  const ip = request.headers.get('cf-connecting-ip') || 
             request.headers.get('x-real-ip') || 
             'unknown';
  
  // Здесь можно добавить логику проверки лимитов
  // Например, используя Vercel KV
  
  return { allowed: true, remaining: 100 }; // Заглушка
}
