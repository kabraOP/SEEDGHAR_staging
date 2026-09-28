# Seed Ghar Order API

This service creates orders and calculates prices server-side. Run `server.js` locally for development, or deploy `lambda.handler` behind API Gateway HTTP API for AWS. Production order data is stored in DynamoDB.

## Run

From this directory, set the test credentials in a local `.env` file based on `.env.example`:

```bash
cp .env.example .env
```

Put the Cashfree **App ID** in `CASHFREE_CLIENT_ID` and the Cashfree **Secret Key** in `CASHFREE_CLIENT_SECRET`. Do not put either key in `index.html` or commit `.env`.

Then start the service:

```bash
node server.js
```

Locally set `PORT=8787` in `.env`. The server creates the Cashfree Sandbox order at `https://sandbox.cashfree.com/pg/orders` and returns its `payment_session_id` to the browser.

## Create an order

`POST /api/orders`

The client must send only variant IDs, quantities, and shipping details. Do not send prices or totals.

```json
{
  "items": [
    { "variantId": "chia-seeds-900-gm", "quantity": 1 }
  ],
  "shipping": {
    "fullName": "Asha Sharma",
    "phone": "9876543210",
    "email": "asha@example.com",
    "address": "12 Main Road",
    "landmark": "Near City Park",
    "postalCode": "342001",
    "city": "Jodhpur",
    "state": "Rajasthan"
  }
}
```

The response contains the server-generated `orderId`, calculated `amount`, MRP total, savings, normalized line items, and Cashfree `paymentSessionId`. The frontend opens Cashfree checkout with that session ID.

The server also exposes `GET /api/orders/:orderId/status` for server-side status verification. Only treat an order as paid when Cashfree reports `PAID` or a verified webhook confirms it.

Prices are maintained in `catalog.js`. Production orders are stored in DynamoDB. The table `seedghar-orders` must have partition key `id` (String). The Lambda execution role needs `PutItem` and `UpdateItem` on that table.

## AWS Lambda + API Gateway deployment (Sandbox)

1. In AWS Console, select region `ap-south-1` (Mumbai). Keep the existing `seedghar-orders` table.
2. On the Lambda execution role, keep `AWSLambdaBasicExecutionRole` and attach the permissions in `lambda-execution-policy.example.json`. Replace `YOUR_12_DIGIT_ACCOUNT_ID` with your AWS account ID. This policy only grants access to the orders table.
4. From the `SEEDGHAR/backend` directory, run `npm run package:lambda`. Upload the resulting `seedghar-lambda.zip` under the Lambda function’s **Code → Upload from → .zip file**.
5. Set runtime to **Node.js 22.x**, handler to `lambda.handler`, architecture to `x86_64`, and timeout to 30 seconds.
6. Set Lambda environment variables: `NODE_ENV=production`, `ORDERS_TABLE=seedghar-orders`, `CASHFREE_ENV=sandbox`, `CASHFREE_API_VERSION=2025-01-01`, `CASHFREE_CLIENT_ID`, `CASHFREE_CLIENT_SECRET`, `ALLOWED_ORIGINS=https://seedghar.com,https://www.seedghar.com`, and `STOREFRONT_URL=https://seedghar.com`. Do not add `AWS_REGION`; Lambda reserves and sets it automatically. Restrict AWS account access because users who can view Lambda configuration may be able to view these credential values.
7. Create an API Gateway **HTTP API**, add a Lambda integration to this function, and create routes `POST /api/orders`, `GET /api/orders/{orderId}/status`, `GET /payment-return`, and `GET /health`. Use the `$default` stage or let the handler strip the named stage prefix. Enable auto-deploy and configure CORS for the storefront origins, methods `GET`, `POST`, `OPTIONS`, and header `content-type`.
8. Copy the API Gateway invoke URL. Set Lambda's `CASHFREE_RETURN_URL` to `<invoke URL>/payment-return?order_id={order_id}`. The handler verifies order status with Cashfree and redirects the browser to the storefront.
9. Update the frontend API base URL in `index.html` to the API Gateway invoke URL, publish the storefront to GitHub Pages, then test `/health`, order creation, successful payment, cancellation, and cart restoration.
10. After GoDaddy access is available, add `api.seedghar.com` as an API Gateway custom domain, configure DNS, and update the frontend API URL and Cashfree return URL to use it.

The frontend remains hosted by GitHub Pages at `seedghar.com`; only the API is deployed to Lambda/API Gateway.

Before live launch, add and verify Cashfree webhooks (signature verification using the raw request body), ensure order status changes are idempotent, enable DynamoDB point-in-time recovery, and review privacy, retention, rate limiting, monitoring, and support processes. Do not mark orders paid from browser query parameters; only use verified Cashfree server responses/webhooks.
