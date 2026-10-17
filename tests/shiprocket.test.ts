import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  ShiprocketServerClient,
  calculatePackageDimensions,
  handleShiprocketAction,
  verifyShiprocketWebhook,
  createNextRouteHandler,
} from '../src/server/index.js';

describe('shiprocket-react / reverse-engineered WooCommerce & Shopify features', () => {
  const createMockFetch = () => {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith('/auth/login')) {
        return new Response(JSON.stringify({ token: 'mock-jwt-token-123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/courier/serviceability/')) {
        if (url.includes('delivery_postcode=999999')) {
          return new Response(
            JSON.stringify({
              status: 200,
              data: { available_courier_companies: [] },
            }),
            { status: 200 }
          );
        }

        return new Response(
          JSON.stringify({
            status: 200,
            data: {
              recommended_courier_company_id: 2,
              available_courier_companies: [
                {
                  courier_company_id: 1,
                  courier_name: 'Delhivery Surface',
                  rate: 55,
                  cod_charges: 25,
                  estimated_delivery_days: '5',
                  etd: 'Oct 22, 2026',
                  rating: 4.2,
                  is_surface: true,
                  cod: 1,
                  city: 'Bengaluru',
                  state: 'Karnataka',
                },
                {
                  courier_company_id: 2,
                  courier_name: 'Bluedart Air',
                  rate: 85,
                  cod_charges: 30,
                  estimated_delivery_days: '2',
                  etd: 'Oct 19, 2026',
                  rating: 4.8,
                  is_surface: false,
                  cod: 1,
                  city: 'Bengaluru',
                  state: 'Karnataka',
                },
              ],
            },
          }),
          { status: 200 }
        );
      }

      if (url.endsWith('/orders/create/adhoc')) {
        return new Response(
          JSON.stringify({
            order_id: 998877,
            shipment_id: 554433,
            status: 'NEW',
            status_code: 1,
            onboarding_completed_now: 0,
            awb_code: '',
            courier_company_id: '',
            courier_name: '',
          }),
          { status: 200 }
        );
      }

      if (url.endsWith('/courier/assign/awb')) {
        return new Response(
          JSON.stringify({
            awb_assign_status: 1,
            response: {
              data: {
                awb_code: 'AWB99887766',
                courier_company_id: 2,
                courier_name: 'Bluedart Air',
              },
            },
          }),
          { status: 200 }
        );
      }

      if (url.includes('/courier/track/awb/')) {
        return new Response(
          JSON.stringify({
            tracking_data: {
              shipment_status: 7,
              track_url: 'https://shiprocket.co/tracking/AWB99887766',
              etd: '2026-10-19',
              shipment_track: [
                {
                  id: 554433,
                  awb_code: 'AWB99887766',
                  courier_name: 'Bluedart Air',
                  current_status: 'In Transit',
                  origin: 'New Delhi',
                  destination: 'Bengaluru',
                },
              ],
              shipment_track_activities: [
                {
                  date: '2026-10-17 14:00:00',
                  status: 'IT',
                  activity: 'Shipment picked up at origin hub',
                  location: 'New Delhi',
                  'sr-status-label': 'IN TRANSIT',
                },
              ],
            },
          }),
          { status: 200 }
        );
      }

      if (url.endsWith('/api/v1/access-token/checkout')) {
        return new Response(
          JSON.stringify({
            result: {
              token: 'fastrr-live-token-xyz',
              checkout_url: 'https://checkout.shiprocket.in/?token=fastrr-live-token-xyz',
            },
          }),
          { status: 200 }
        );
      }

      if (url.endsWith('/api/v1/access-token/s2s-login/initiate')) {
        return new Response(
          JSON.stringify({
            result: {
              token: 's2s-otp-session-token-001',
            },
          }),
          { status: 200 }
        );
      }

      if (url.endsWith('/api/v1/access-token/s2s-login/verify')) {
        return new Response(
          JSON.stringify({
            result: {
              authorised_customer_token: 'auth-customer-token-999',
            },
          }),
          { status: 200 }
        );
      }

      if (url.endsWith('/api/v1/customer-data')) {
        return new Response(
          JSON.stringify({
            result: {
              name: 'Aarav Sharma',
              email: 'aarav@example.com',
              phone: '9876543210',
              addresses: [
                {
                  id: 'addr-1',
                  address_line_1: '12 MG Road, Indiranagar',
                  city: 'Bengaluru',
                  state: 'Karnataka',
                  pincode: '560038',
                },
              ],
            },
          }),
          { status: 200 }
        );
      }

      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    });
  };

  it('caches JWT token across multiple calls', async () => {
    const mockFetch = createMockFetch();
    const client = new ShiprocketServerClient(
      {
        email: 'api@example.com',
        password: 'secret',
        defaultPickupPincode: '110001',
      },
      mockFetch as unknown as typeof fetch
    );

    const t1 = await client.getToken();
    const t2 = await client.getToken();
    expect(t1).toBe('mock-jwt-token-123');
    expect(t2).toBe('mock-jwt-token-123');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('calculates multi-item box dimensions and unit conversions using WooCommerce algorithm', () => {
    const dims = calculatePackageDimensions([
      {
        id: '1',
        name: 'T-Shirt',
        sku: 'TS-1',
        units: 2,
        sellingPrice: 599,
        weight: 250,
        weightUnit: 'grams',
        length: 10,
        breadth: 8,
        height: 2,
        dimensionUnit: 'inches',
      },
    ]);

    // 250g * 2 = 0.5kg
    expect(dims.weight).toBe(0.5);
    // 2 inches * 2.54 * 2 units = 10.16 cm stacked height
    expect(dims.height).toBeCloseTo(10.16, 2);
    // 8 inches * 2.54 = 20.32 cm length
    expect(dims.length).toBeCloseTo(20.32, 2);
    // 10 inches * 2.54 = 25.4 cm breadth
    expect(dims.breadth).toBeCloseTo(25.4, 2);
  });

  it('returns configured fallbackRate when Shiprocket returns no couriers for a zone', async () => {
    const mockFetch = createMockFetch();
    const client = new ShiprocketServerClient(
      {
        email: 'api@example.com',
        password: 'secret',
        defaultPickupPincode: '110001',
        fallbackRate: 65,
        fallbackCarrierName: 'Standard Surface Delivery',
      },
      mockFetch as unknown as typeof fetch
    );

    const res = await client.checkServiceability({
      deliveryPincode: '999999',
      cod: true,
    });

    expect(res.serviceable).toBe(true);
    expect(res.usedFallbackRate).toBe(true);
    expect(res.recommendedCourier?.rate).toBe(65);
    expect(res.recommendedCourier?.courierName).toBe('Standard Surface Delivery');
  });

  it('signs Fastrr payload with Base64 HMAC-SHA256 (matching WooCommerce PHP & login.js)', async () => {
    const mockFetch = createMockFetch();
    const secretKey = 'fastrr-secret-xyz';
    const client = new ShiprocketServerClient(
      {
        email: 'api@example.com',
        password: 'secret',
        fastrr: {
          apiKey: 'fastrr-key-1',
          secretKey,
        },
      },
      mockFetch as unknown as typeof fetch
    );

    const sampleJson = '{"address":false,"timestamp":"2026-10-17T09:00:00.000Z"}';
    const expectedBase64 = crypto
      .createHmac('sha256', secretKey)
      .update(sampleJson)
      .digest('base64');

    expect(client.signFastrrPayload(sampleJson)).toBe(expectedBase64);

    const session = await client.createCheckoutSession({
      mode: 'fastrr',
      orderId: 'ORD-1001',
      cartItems: [{ id: '1', name: 'Sneakers', sku: 'SNK-1', units: 1, sellingPrice: 1999 }],
    });

    expect(session.success).toBe(true);
    expect(session.mode).toBe('fastrr');
    expect(session.fastrrSession?.token).toBe('fastrr-live-token-xyz');
    expect(session.fastrrSession?.widgetUrl).toContain(
      'https://fastrr-boost-ui.pickrr.com/?platform=CUSTOM&type=cart&customCheckoutToken=fastrr-live-token-xyz'
    );
  });

  it('completes Fastrr S2S OTP initiation, verification, and saved address retrieval via adapter', async () => {
    const mockFetch = createMockFetch();
    const client = new ShiprocketServerClient(
      {
        email: 'api@example.com',
        password: 'secret',
        fastrr: {
          apiKey: 'fastrr-key-1',
          secretKey: 'fastrr-secret-xyz',
        },
      },
      mockFetch as unknown as typeof fetch
    );

    const initRes = await handleShiprocketAction({
      action: 'fastrr-otp/initiate',
      method: 'POST',
      body: { phone: '9876543210' },
      client,
    });

    expect(initRes.status).toBe(200);
    expect(initRes.body.token).toBe('s2s-otp-session-token-001');

    const verifyRes = await handleShiprocketAction({
      action: 'fastrr-otp/verify',
      method: 'POST',
      body: { token: 's2s-otp-session-token-001', otp: '123456' },
      client,
    });

    expect(verifyRes.status).toBe(200);
    const profile = verifyRes.body.profile as any;
    expect(profile.name).toBe('Aarav Sharma');
    expect(profile.addresses).toHaveLength(1);
    expect(profile.addresses[0].pincode).toBe('560038');
  });

  it('tracks shipment by AWB via Next.js Route Handler adapter and verifies Base64 webhooks', async () => {
    const mockFetch = createMockFetch();
    const client = new ShiprocketServerClient(
      {
        email: 'api@example.com',
        password: 'secret',
      },
      mockFetch as unknown as typeof fetch
    );

    const { GET } = createNextRouteHandler(client);
    const req = new Request('http://localhost:3000/api/shiprocket/track?awb=AWB99887766', {
      method: 'GET',
    });

    const response = await GET(req, { params: { action: ['track'] } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.awbCode).toBe('AWB99887766');

    const rawBody = JSON.stringify({ awb: 'AWB99887766', current_status: 'DELIVERED' });
    const fastrrSecret = 'my-fastrr-secret';
    const validBase64Hmac = crypto
      .createHmac('sha256', fastrrSecret)
      .update(rawBody)
      .digest('base64');

    expect(
      verifyShiprocketWebhook({
        rawBody,
        headers: { 'x-api-hmac-sha256': validBase64Hmac },
        fastrrSecretKey: fastrrSecret,
      })
    ).toBe(true);
  });
});
