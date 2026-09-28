const { createOrder, cashfreeRequest, updateOrderStatus, allowedOrigins, storefrontUrl } = require('./server');

function response(statusCode, body, origin, extraHeaders = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'vary': 'origin',
    ...extraHeaders
  };
  if (origin && allowedOrigins.has(origin)) headers['access-control-allow-origin'] = origin;
  return {
    statusCode,
    headers,
    body: body === undefined ? '' : JSON.stringify(body),
    isBase64Encoded: false
  };
}

function redirect(location, origin) {
  return response(302, undefined, origin, { location });
}

function getRoute(event) {
  let path = event.rawPath || event.requestContext?.http?.path || '/';
  const stage = event.requestContext?.stage;
  if (stage && stage !== '$default' && path.startsWith(`/${stage}/`)) {
    path = path.slice(stage.length + 1);
  }
  const method = (event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
  return { path, method };
}

exports.handler = async event => {
  const { path, method } = getRoute(event);
  const origin = event.headers?.origin || event.headers?.Origin;

  if (method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return response(403, { error: 'Origin not allowed' }, origin);
    return response(204, undefined, origin);
  }

  if (path.startsWith('/api/') && origin && !allowedOrigins.has(origin)) {
    return response(403, { error: 'Origin not allowed' }, origin);
  }

  if (method === 'GET' && path === '/health') {
    return response(200, { status: 'ok' }, origin);
  }

  if (method === 'GET' && path === '/payment-return') {
    const params = event.queryStringParameters || new URLSearchParams(event.rawQueryString || '');
    const orderId = params.get ? params.get('order_id') : params.order_id;
    if (!orderId) return redirect(`${storefrontUrl}/?payment_status=missing_order`, origin);

    try {
      const result = await cashfreeRequest('GET', `/orders/${encodeURIComponent(orderId)}`);
      const paymentStatus = result.order_status || 'UNKNOWN';
      await updateOrderStatus(orderId, paymentStatus);
      return redirect(`${storefrontUrl}/?payment_status=${encodeURIComponent(paymentStatus)}&order_id=${encodeURIComponent(orderId)}`, origin);
    } catch (error) {
      console.error('Cashfree return verification failed:', error.message);
      return redirect(`${storefrontUrl}/?payment_status=verification_failed&order_id=${encodeURIComponent(orderId)}`, origin);
    }
  }

  const statusMatch = path.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (method === 'GET' && statusMatch) {
    try {
      const orderId = decodeURIComponent(statusMatch[1]);
      const result = await cashfreeRequest('GET', `/orders/${encodeURIComponent(orderId)}`);
      await updateOrderStatus(orderId, result.order_status);
      return response(200, { orderId, status: result.order_status }, origin);
    } catch (error) {
      return response(502, { error: error.message }, origin);
    }
  }

  if (method === 'POST' && path === '/api/orders') {
    try {
      let rawBody = event.body || '';
      if (event.isBase64Encoded) rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
      const payload = JSON.parse(rawBody || '{}');
      const order = await createOrder(payload);
      return response(201, {
        orderId: order.id,
        amount: order.total,
        currency: 'INR',
        cashfreeMode: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox',
        paymentSessionId: order.paymentSessionId,
        mrpTotal: order.mrpTotal,
        savings: order.savings,
        items: order.items
      }, origin);
    } catch (error) {
      console.error('Order creation failed:', error.message);
      const clientError = ['Cart is empty', 'Complete shipping details are required', 'Invalid phone number', 'Invalid PIN code', 'Invalid email address', 'Invalid product variant or quantity'].includes(error.message);
      return response(clientError ? 400 : 502, { error: error.message }, origin);
    }
  }

  return response(404, { error: 'Not found' }, origin);
};
