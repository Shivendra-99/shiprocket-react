import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ShiprocketServerClient,
  handleShiprocketAction,
} from '../src/server/index.js';
import {
  ShiprocketProvider,
  PincodeChecker,
  ShiprocketCheckoutButton,
  ShiprocketCheckoutModal,
  OrderTrackingTimeline,
} from '../src/client/index.js';

describe('End-to-End Live HTTP Server + React Component Verification', () => {
  let server: http.Server;
  let baseUrl = '';

  const sandboxClient = new ShiprocketServerClient({
    email: '',
    password: '',
    sandbox: true,
    fallbackRate: 60,
  });

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const action = url.pathname.replace(/^\/api\/shiprocket\/?/, '');
      const query: Record<string, string | undefined> = {};
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
        headers: req.headers as Record<string, string | string[] | undefined>,
        client: sandboxClient,
      });

      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}/api/shiprocket`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves live HTTP pincode serviceability checks in sandbox mode', async () => {
    const res = await fetch(`${baseUrl}/serviceability?deliveryPincode=560001&cod=true`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.serviceable).toBe(true);
    expect(json.data.city).toBe('Bengaluru');
    expect(json.data.recommendedCourier.courierName).toBe('Bluedart Express Air');
  });

  it('serves live HTTP S2S OTP initiation, verification, and saved address prefill', async () => {
    const initRes = await fetch(`${baseUrl}/fastrr-otp/initiate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210' }),
    });
    const initJson = await initRes.json();
    expect(initRes.status).toBe(200);
    expect(initJson.success).toBe(true);
    expect(initJson.token).toBe('sandbox-otp-session-token');

    const verifyRes = await fetch(`${baseUrl}/fastrr-otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: initJson.token, otp: '123456' }),
    });
    const verifyJson = await verifyRes.json();
    expect(verifyRes.status).toBe(200);
    expect(verifyJson.success).toBe(true);
    expect(verifyJson.profile.addresses.length).toBeGreaterThanOrEqual(2);
    expect(verifyJson.profile.addresses[0].city).toBe('Bengaluru');
  });

  it('serves live HTTP Built-in Order + AWB creation and Fastrr Checkout session', async () => {
    const cartItems = [
      {
        id: 'item-1',
        name: 'Pro Wireless Mouse',
        sku: 'PWM-01',
        units: 2,
        sellingPrice: 1499,
        weight: 200,
        weightUnit: 'grams',
        length: 12,
        breadth: 8,
        height: 5,
        dimensionUnit: 'cm',
      },
    ];

    const builtinRes = await fetch(`${baseUrl}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'builtin',
        autoAssignAWB: true,
        cartItems,
        buyer: {
          firstName: 'Shivendra',
          lastName: 'Sonkar',
          email: 'shivendra@example.com',
          phone: '9876543210',
          address: '42 Residency Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
        paymentMethod: 'Prepaid',
      }),
    });
    const builtinJson = await builtinRes.json();
    expect(builtinRes.status).toBe(200);
    expect(builtinJson.success).toBe(true);
    expect(builtinJson.mode).toBe('builtin');
    expect(builtinJson.orderResult.awbCode).toMatch(/^SR\d+/);

    const fastrrRes = await fetch(`${baseUrl}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'fastrr',
        cartItems,
      }),
    });
    const fastrrJson = await fastrrRes.json();
    expect(fastrrRes.status).toBe(200);
    expect(fastrrJson.success).toBe(true);
    expect(fastrrJson.mode).toBe('fastrr');
    expect(fastrrJson.fastrrSession.widgetUrl).toContain('fastrr-boost-ui.pickrr.com');
  });

  it('serves live HTTP AWB shipment tracking timeline', async () => {
    const res = await fetch(`${baseUrl}/track?awb=SR998877665`);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.awbCode).toBe('SR998877665');
    expect(json.data.currentStatus).toBe('Out for Delivery');
    expect(json.data.scans).toHaveLength(3);
  });

  it('renders all React UI components cleanly without errors', () => {
    const cartItems = [
      {
        id: 'item-1',
        name: 'Mechanical Keyboard',
        sku: 'MK-01',
        units: 1,
        sellingPrice: 3999,
      },
    ];

    const html = renderToStaticMarkup(
      <ShiprocketProvider apiBaseUrl={baseUrl} defaultCheckoutMode="builtin">
        <PincodeChecker placeholder="Enter Pincode" buttonText="Verify" />
        <ShiprocketCheckoutButton cartItems={cartItems} buttonText="Buy with Shiprocket" />
        <ShiprocketCheckoutModal cartItems={cartItems} onClose={() => {}} />
        <OrderTrackingTimeline awb="SR998877665" autoFetch={false} />
      </ShiprocketProvider>
    );

    expect(html).toContain('Enter Pincode');
    expect(html).toContain('Buy with Shiprocket');
    expect(html).toContain('Express Checkout');
    expect(html).toContain('Fast Address Autofill (Shiprocket Network)');
    expect(html).toContain('Track');
  });
});
