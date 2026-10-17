import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShiprocketServerClient, handleShiprocketAction } from '../dist/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);

const shiprocketClient = new ShiprocketServerClient({
  email: process.env.SHIPROCKET_API_EMAIL || '',
  password: process.env.SHIPROCKET_API_PASSWORD || '',
  sandbox: !process.env.SHIPROCKET_API_EMAIL,
  defaultPickupPincode: '110001',
  fallbackRate: 60,
});

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>shiprocket-react — Interactive Playground</title>
  <script type="importmap">
    {
      "imports": {
        "react": "https://esm.sh/react@18.3.1",
        "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
        "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
        "shiprocket-react": "/dist/index.js"
      }
    }
  </script>
  <style>
    body {
      margin: 0;
      font-family: system-ui, -apple-system, sans-serif;
      background: #f3f4f6;
      color: #111827;
    }
    .header {
      background: #111827;
      color: #fff;
      padding: 20px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .badge {
      background: #ea580c;
      color: #fff;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
    }
    .grid {
      max-width: 1100px;
      margin: 28px auto;
      padding: 0 20px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(460px, 1fr));
      gap: 24px;
    }
    .card {
      background: #fff;
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.07);
      border: 1px solid #e5e7eb;
    }
    h2 {
      margin-top: 0;
      font-size: 18px;
      margin-bottom: 6px;
    }
    p.hint {
      color: #6b7280;
      font-size: 13px;
      margin-top: 0;
      margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <strong style="font-size: 18px;">🚀 shiprocket-react</strong>
      <span style="color: #9ca3af; font-size: 13px; margin-left: 10px;">Interactive Storefront Playground</span>
    </div>
    <span class="badge">Sandbox Mode Active</span>
  </div>
  <div id="root"></div>

  <script type="module">
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import {
      ShiprocketProvider,
      PincodeChecker,
      ShiprocketCheckoutButton,
      OrderTrackingTimeline,
    } from 'shiprocket-react';

    function App() {
      const [lastOrder, setLastOrder] = useState(null);

      const cartItems = [
        {
          id: 'sku-wireless-headphones',
          name: 'Sony WH-1000XM5 Wireless Headphones',
          sku: 'SONY-XM5',
          units: 1,
          sellingPrice: 24990,
          weight: 350,
          weightUnit: 'grams',
          length: 22,
          breadth: 18,
          height: 8,
          dimensionUnit: 'cm',
        },
      ];

      return React.createElement(
        ShiprocketProvider,
        { apiBaseUrl: '/api/shiprocket', defaultCheckoutMode: 'builtin' },
        React.createElement(
          'div',
          { className: 'grid' },
          // Card 1: Product & Pincode + Checkout
          React.createElement(
            'div',
            { className: 'card' },
            React.createElement('h2', null, '1. Product Page — Pincode EDD & Express Checkout'),
            React.createElement(
              'p',
              { className: 'hint' },
              'Try pincodes 560001 (Bengaluru), 110001 (Delhi), 400001 (Mumbai), or 999999 (Fallback Rate).'
            ),
            React.createElement(
              'div',
              {
                style: {
                  padding: '14px',
                  background: '#f9fafb',
                  borderRadius: '10px',
                  marginBottom: '18px',
                  border: '1px solid #e5e7eb',
                },
              },
              React.createElement('div', { style: { fontWeight: 700 } }, cartItems[0].name),
              React.createElement(
                'div',
                { style: { color: '#ea580c', fontWeight: 700, marginTop: '4px' } },
                '₹24,990.00'
              )
            ),
            React.createElement(PincodeChecker, { weight: 0.35, cod: true }),
            React.createElement(
              'div',
              { style: { marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' } },
              React.createElement(
                'p',
                { className: 'hint' },
                'Click below to open the Express Checkout Modal (includes 1-click Fastrr S2S OTP address autofill — try any 10-digit mobile + OTP 123456):'
              ),
              React.createElement(ShiprocketCheckoutButton, {
                cartItems,
                autoAssignAWB: true,
                enableFastrrAddressPrefill: true,
                buttonText: 'Buy Now with Shiprocket Checkout',
                onSuccess: (res) => {
                  setLastOrder(res.orderResult);
                },
              })
            )
          ),
          // Card 2: Live Order Tracking Timeline
          React.createElement(
            'div',
            { className: 'card' },
            React.createElement('h2', null, '2. Live Shipment Tracking Timeline'),
            React.createElement(
              'p',
              { className: 'hint' },
              lastOrder?.awbCode
                ? 'Tracking your newly created order AWB: ' + lastOrder.awbCode
                : 'Enter any AWB code (e.g. SR123456789) to test the live tracking timeline.'
            ),
            React.createElement(OrderTrackingTimeline, {
              awb: lastOrder?.awbCode || 'SR123456789',
              autoFetch: true,
              showSearchInput: true,
            })
          )
        )
      );
    }

    createRoot(document.getElementById('root')).render(React.createElement(App));
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML_PAGE);
    return;
  }

  if (url.pathname.startsWith('/dist/')) {
    const filePath = path.join(__dirname, '..', url.pathname);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(filePath));
      return;
    }
  }

  if (url.pathname.startsWith('/api/shiprocket')) {
    const action = url.pathname.replace(/^\/api\/shiprocket\/?/, '');
    const query = {};
    url.searchParams.forEach((v, k) => {
      query[k] = v;
    });

    let rawBody = '';
    for await (const chunk of req) {
      rawBody += chunk;
    }
    const body = rawBody ? JSON.parse(rawBody) : {};

    const result = await handleShiprocketAction({
      action,
      method: req.method || 'GET',
      query,
      body,
      rawBody,
      headers: req.headers,
      client: shiprocketClient,
    });

    res.writeHead(result.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result.body));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`🚀 shiprocket-react playground running at http://localhost:${PORT}`);
});
