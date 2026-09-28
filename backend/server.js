const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { findVariant } = require('./catalog');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const port = Number(process.env.PORT || 8080);
const databasePath = path.join(__dirname, 'orders.json');
const region = process.env.AWS_REGION || 'ap-south-1';
const ordersTable = process.env.ORDERS_TABLE;
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const secretsManager = new SecretsManagerClient({ region });
const cashfreeBaseUrl = process.env.CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';
const cashfreeApiVersion = process.env.CASHFREE_API_VERSION || '2025-01-01';
const cashfreeReturnUrl = process.env.CASHFREE_RETURN_URL || `https://h7ghhk8dea.execute-api.ap-south-1.amazonaws.com/payment-return?order_id={order_id}`;
const storefrontUrl = (process.env.STOREFRONT_URL || 'https://seedghar.com').replace(/\/$/, '');
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://seedghar.com,https://www.seedghar.com,http://localhost:8787,http://127.0.0.1:8787').split(',').map(origin => origin.trim()));
if (process.env.NODE_ENV !== 'production') allowedOrigins.add('null');

function sendJson(response, status, body) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
  if (response._allowedOrigin) headers['Access-Control-Allow-Origin'] = response._allowedOrigin;
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function saveLocalOrder(order) {
  const orders = fs.existsSync(databasePath)
    ? JSON.parse(fs.readFileSync(databasePath, 'utf8'))
    : [];
  orders.push(order);
  fs.writeFileSync(databasePath, JSON.stringify(orders, null, 2));
}

async function updateOrderStatus(orderId, status) {
  if (!ordersTable) return;
  await dynamo.send(new UpdateCommand({
    TableName: ordersTable,
    Key: { id: orderId },
    UpdateExpression: 'SET #status = :status, paymentVerifiedAt = :verifiedAt',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':status': status, ':verifiedAt': new Date().toISOString() },
    ConditionExpression: 'attribute_exists(id)'
  }));
}

function redirect(response, location) {
  response.writeHead(302, { Location: location });
  response.end();
}

function calculateOrder(items) {
  const normalizedItems = [];
  let mrpTotal = 0;
  let total = 0;

  for (const item of items) {
    const quantity = Number(item.quantity);
    const variant = findVariant(String(item.variantId || ''));
    if (!variant || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new Error('Invalid product variant or quantity');
    }

    const lineTotal = variant.price * quantity;
    const lineMrpTotal = variant.mrp * quantity;
    normalizedItems.push({ ...variant, quantity, lineTotal, lineMrpTotal });
    total += lineTotal;
    mrpTotal += lineMrpTotal;
  }

  return { items: normalizedItems, mrpTotal, savings: mrpTotal - total, total };
}

function validateShipping(shipping) {
  const required = ['fullName', 'phone', 'email', 'address', 'postalCode', 'city', 'state'];
  if (!shipping || required.some(field => typeof shipping[field] !== 'string' || !shipping[field].trim())) {
    throw new Error('Complete shipping details are required');
  }
  if (!/^[0-9]{10}$/.test(shipping.phone)) throw new Error('Invalid phone number');
  if (!/^[0-9]{6}$/.test(shipping.postalCode)) throw new Error('Invalid PIN code');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(shipping.email)) throw new Error('Invalid email address');
}

let cashfreeCredentialsPromise;
async function getCashfreeCredentials() {
  if (process.env.CASHFREE_CLIENT_ID && process.env.CASHFREE_CLIENT_SECRET) {
    return { clientId: process.env.CASHFREE_CLIENT_ID, clientSecret: process.env.CASHFREE_CLIENT_SECRET };
  }
  const secretId = process.env.CASHFREE_SECRET_ARN;
  if (!secretId) throw new Error('Cashfree credentials are not configured on the server');
  if (!cashfreeCredentialsPromise) {
    cashfreeCredentialsPromise = secretsManager.send(new GetSecretValueCommand({ SecretId: secretId })).then(result => {
      const secret = JSON.parse(result.SecretString || '{}');
      if (!secret.clientId || !secret.clientSecret) throw new Error('Cashfree secret must contain clientId and clientSecret');
      return { clientId: secret.clientId, clientSecret: secret.clientSecret };
    });
  }
  return cashfreeCredentialsPromise;
}

async function cashfreeRequest(method, endpoint, body) {
  const credentials = await getCashfreeCredentials();
  return new Promise((resolve, reject) => {
    const request = require('https').request(new URL(`${cashfreeBaseUrl}${endpoint}`), {
      method,
      headers: {
        'x-client-id': credentials.clientId,
        'x-client-secret': credentials.clientSecret,
        'x-api-version': cashfreeApiVersion,
        'content-type': 'application/json',
        accept: 'application/json'
      }
    }, response => {
      let responseBody = '';
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(responseBody || '{}'); } catch (error) { parsed = {}; }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          return reject(new Error(parsed.message || `Cashfree request failed (${response.statusCode})`));
        }
        resolve(parsed);
      });
    });
    request.on('error', reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function createOrder(payload) {
  if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error('Cart is empty');
  if (process.env.NODE_ENV === 'production' && !ordersTable) throw new Error('ORDERS_TABLE is not configured');
  validateShipping(payload.shipping);
  const calculated = calculateOrder(payload.items);
  const order = {
    id: `SG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    status: 'created',
    createdAt: new Date().toISOString(),
    shipping: payload.shipping,
    ...calculated
  };
  const cashfreeOrder = await cashfreeRequest('POST', '/orders', {
    order_id: order.id,
    order_amount: order.total,
    order_currency: 'INR',
    customer_details: {
      customer_id: order.id,
      customer_name: payload.shipping.fullName,
      customer_email: payload.shipping.email,
      customer_phone: payload.shipping.phone
    },
    order_meta: {
      return_url: cashfreeReturnUrl.replace('{order_id}', order.id)
    },
    order_note: 'Seed Ghar order'
  });
  order.cashfreeOrderId = cashfreeOrder.order_id;
  order.paymentSessionId = cashfreeOrder.payment_session_id;
  if (ordersTable) {
    await dynamo.send(new PutCommand({
      TableName: ordersTable,
      Item: order,
      ConditionExpression: 'attribute_not_exists(id)'
    }));
  } else if (process.env.NODE_ENV !== 'production') {
    saveLocalOrder(order);
  }
  return order;
}

const server = http.createServer((request, response) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) response._allowedOrigin = origin;
  if (request.method === 'OPTIONS') {
    if (origin && !allowedOrigins.has(origin)) return sendJson(response, 403, { error: 'Origin not allowed' });
    const preflightHeaders = {
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Vary': 'Origin'
    };
    if (response._allowedOrigin) preflightHeaders['Access-Control-Allow-Origin'] = response._allowedOrigin;
    response.writeHead(204, preflightHeaders);
    return response.end();
  }
  if (request.method === 'GET' && request.url === '/health') return sendJson(response, 200, { status: 'ok' });
  if (request.url.startsWith('/api/') && origin && !allowedOrigins.has(origin)) {
    return sendJson(response, 403, { error: 'Origin not allowed' });
  }
  if (request.method === 'GET' && request.url.startsWith('/payment-return')) {
    const returnUrl = new URL(request.url, `http://localhost:${port}`);
    const orderId = returnUrl.searchParams.get('order_id');
    if (!orderId) return redirect(response, `${storefrontUrl}/?payment_status=missing_order`);
    return cashfreeRequest('GET', `/orders/${encodeURIComponent(orderId)}`)
      .then(async result => {
        const paymentStatus = result.order_status || 'UNKNOWN';
        await updateOrderStatus(orderId, paymentStatus);
        redirect(response, `${storefrontUrl}/?payment_status=${encodeURIComponent(paymentStatus)}&order_id=${encodeURIComponent(orderId)}`);
      })
      .catch(() => redirect(response, `${storefrontUrl}/?payment_status=verification_failed&order_id=${encodeURIComponent(orderId)}`));
  }
  if (request.method === 'GET' && !request.url.startsWith('/api/')) {
    return sendJson(response, 404, { error: 'API route not found' });
  }
  const statusMatch = request.url.match(/^\/api\/orders\/([^/]+)\/status$/);
  if (request.method === 'GET' && statusMatch) {
    return cashfreeRequest('GET', `/orders/${encodeURIComponent(statusMatch[1])}`)
      .then(async result => {
        await updateOrderStatus(statusMatch[1], result.order_status);
        sendJson(response, 200, { orderId: statusMatch[1], status: result.order_status });
      })
      .catch(error => sendJson(response, 502, { error: error.message }));
  }
  if (request.method !== 'POST' || request.url !== '/api/orders') return sendJson(response, 404, { error: 'Not found' });

  let body = '';
  request.on('data', chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) request.destroy();
  });
  request.on('end', async () => {
    try {
      const order = await createOrder(JSON.parse(body));
      sendJson(response, 201, {
        orderId: order.id,
        amount: order.total,
        currency: 'INR',
        cashfreeMode: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox',
        paymentSessionId: order.paymentSessionId,
        mrpTotal: order.mrpTotal,
        savings: order.savings,
        items: order.items
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
  });
});

if (require.main === module) {
  server.listen(port, () => console.log(`Seed Ghar order API listening on http://localhost:${port}`));
}

module.exports = {
  createOrder,
  cashfreeRequest,
  updateOrderStatus,
  allowedOrigins,
  storefrontUrl
};
