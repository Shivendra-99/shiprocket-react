import crypto from 'node:crypto';
import type { ShiprocketServerClient } from './client.js';
import type {
  CreateCheckoutSessionRequest,
  ServiceabilityQuery,
  ShiprocketWebhookEvent,
} from '../types/index.js';

export interface ShiprocketAdapterOptions {
  /** Optional webhook secret token (overrides client config webhookSecret) */
  webhookSecret?: string;
  /** Optional Fastrr secret key for verifying Fastrr HMAC webhooks */
  fastrrSecretKey?: string;
  /** Callback fired when a valid Shiprocket Shipping or Fastrr Checkout webhook arrives */
  onWebhook?: (event: ShiprocketWebhookEvent) => Promise<void> | void;
  /** Optional hook to validate or transform checkout session requests before sending to Shiprocket */
  beforeCheckout?: (
    req: CreateCheckoutSessionRequest
  ) => Promise<CreateCheckoutSessionRequest> | CreateCheckoutSessionRequest;
}

function safeCompare(aStr: string, bStr: string): boolean {
  const a = Buffer.from(aStr);
  const b = Buffer.from(bStr);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Verifies a Shiprocket webhook using either `x-api-key` (Shiprocket Shipping webhook token)
 * or `x-api-hmac-sha256` (Fastrr Checkout Base64 or Hex HMAC-SHA256 signature).
 */
export function verifyShiprocketWebhook(params: {
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  webhookSecret?: string;
  fastrrSecretKey?: string;
}): boolean {
  const { rawBody, headers, webhookSecret, fastrrSecretKey } = params;

  const normalizeHeader = (key: string): string | undefined => {
    const val = headers[key] ?? headers[key.toLowerCase()];
    return Array.isArray(val) ? val[0] : val;
  };

  // 1. Check Fastrr HMAC-SHA256 header if present (supports official Base64 as well as Hex)
  const hmacHeader = normalizeHeader('x-api-hmac-sha256');
  if (hmacHeader && fastrrSecretKey) {
    const computedBase64 = crypto
      .createHmac('sha256', fastrrSecretKey)
      .update(rawBody)
      .digest('base64');
    const computedHex = crypto
      .createHmac('sha256', fastrrSecretKey)
      .update(rawBody)
      .digest('hex');

    return safeCompare(hmacHeader, computedBase64) || safeCompare(hmacHeader, computedHex);
  }

  // 2. Check Shiprocket Shipping `x-api-key` header if webhookSecret is configured
  if (webhookSecret) {
    const apiKeyHeader = normalizeHeader('x-api-key');
    if (!apiKeyHeader) return false;
    return safeCompare(apiKeyHeader, webhookSecret);
  }

  return true;
}

/**
 * Framework-agnostic dispatcher that handles:
 * - GET/POST `/serviceability`
 * - POST `/checkout`
 * - GET/POST `/track`
 * - POST `/fastrr-token`
 * - POST `/fastrr-otp/initiate`
 * - POST `/fastrr-otp/verify`
 * - POST `/webhook`
 */
export async function handleShiprocketAction(params: {
  action: string;
  method: string;
  query?: Record<string, string | undefined>;
  body?: any;
  rawBody?: string;
  headers?: Record<string, string | string[] | undefined>;
  client: ShiprocketServerClient;
  options?: ShiprocketAdapterOptions;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { action, method, query = {}, body = {}, rawBody, headers = {}, client, options } = params;
  const normalizedAction = action.replace(/^\/+|\/+$/g, '').toLowerCase();

  try {
    if (normalizedAction === 'serviceability') {
      const deliveryPincode = String(query.deliveryPincode ?? body.deliveryPincode ?? '');
      const pickupPincode = (query.pickupPincode ?? body.pickupPincode) as string | undefined;
      const weight = query.weight ? Number(query.weight) : body.weight ? Number(body.weight) : 0.5;
      const cod =
        query.cod !== undefined
          ? query.cod === 'true' || query.cod === '1'
          : Boolean(body.cod);

      const serviceabilityQuery: ServiceabilityQuery = {
        deliveryPincode,
        pickupPincode,
        weight,
        cod,
      };
      const result = await client.checkServiceability(serviceabilityQuery);
      return { status: 200, body: { success: true, data: result } };
    }

    if (normalizedAction === 'checkout' && method.toUpperCase() === 'POST') {
      let checkoutReq = body as CreateCheckoutSessionRequest;
      if (options?.beforeCheckout) {
        checkoutReq = await options.beforeCheckout(checkoutReq);
      }
      const session = await client.createCheckoutSession(checkoutReq);
      return { status: 200, body: session as unknown as Record<string, unknown> };
    }

    if (normalizedAction === 'track') {
      const awb = (query.awb ?? body.awb) as string | undefined;
      const orderId = (query.orderId ?? body.orderId) as string | undefined;
      const channelId = (query.channelId ?? body.channelId) as string | undefined;
      const tracking = await client.trackOrder({ awb, orderId, channelId });
      return { status: 200, body: { success: true, data: tracking } };
    }

    if (normalizedAction === 'fastrr-token' && method.toUpperCase() === 'POST') {
      const token = await client.generateFastrrAccessToken(Boolean(body.address));
      return { status: 200, body: { success: true, token } };
    }

    if (normalizedAction === 'fastrr-otp/initiate' && method.toUpperCase() === 'POST') {
      const { token } = await client.initiateFastrrOtp(
        String(body.phone ?? ''),
        body.countryCode ? String(body.countryCode) : '91'
      );
      return { status: 200, body: { success: true, token } };
    }

    if (normalizedAction === 'fastrr-otp/verify' && method.toUpperCase() === 'POST') {
      const { authorisedCustomerToken } = await client.verifyFastrrOtp(
        String(body.token ?? ''),
        String(body.otp ?? ''),
        body.userAddressConsent !== false
      );
      const profile = await client.fetchFastrrCustomerData(authorisedCustomerToken);
      return {
        status: 200,
        body: {
          success: true,
          authorisedCustomerToken,
          profile,
        },
      };
    }

    if (normalizedAction === 'webhook' && method.toUpperCase() === 'POST') {
      const raw = rawBody ?? JSON.stringify(body);
      const isValid = verifyShiprocketWebhook({
        rawBody: raw,
        headers,
        webhookSecret: options?.webhookSecret,
        fastrrSecretKey: options?.fastrrSecretKey,
      });

      if (!isValid) {
        return {
          status: 401,
          body: { success: false, error: 'Invalid webhook signature or token' },
        };
      }

      if (options?.onWebhook) {
        await options.onWebhook(body as ShiprocketWebhookEvent);
      }
      return { status: 200, body: { success: true, received: true } };
    }

    return {
      status: 404,
      body: { success: false, error: `Unknown Shiprocket route action: ${normalizedAction}` },
    };
  } catch (err: any) {
    const status = typeof err?.statusCode === 'number' ? err.statusCode : 400;
    return {
      status,
      body: {
        success: false,
        error: err instanceof Error ? err.message : 'Unexpected Shiprocket error',
        details: err?.details,
      },
    };
  }
}

/**
 * Express / Connect compatible middleware.
 * Mount at e.g. `app.use('/api/shiprocket', createExpressMiddleware(client, options))`
 */
export function createExpressMiddleware(
  client: ShiprocketServerClient,
  options?: ShiprocketAdapterOptions
) {
  return async (req: any, res: any) => {
    const action = (req.path || req.url || '').split('?')[0].replace(/^\/+/, '');
    const result = await handleShiprocketAction({
      action,
      method: req.method || 'GET',
      query: req.query || {},
      body: req.body || {},
      headers: req.headers || {},
      client,
      options,
    });
    res.status(result.status).json(result.body);
  };
}

/**
 * Next.js App Router compatible Route Handler (`app/api/shiprocket/[...action]/route.ts`).
 * Export as `export const { GET, POST } = createNextRouteHandler(client, options);`
 */
export function createNextRouteHandler(
  client: ShiprocketServerClient,
  options?: ShiprocketAdapterOptions
) {
  const handler = async (
    request: Request,
    context?: {
      params?: Promise<{ action?: string | string[] }> | { action?: string | string[] };
    }
  ) => {
    const url = new URL(request.url);
    let action = '';

    if (context?.params) {
      const resolvedParams = await Promise.resolve(context.params);
      const act = resolvedParams?.action;
      action = Array.isArray(act) ? act.join('/') : act ?? '';
    }
    if (!action) {
      const segments = url.pathname.split('/').filter(Boolean);
      action = segments[segments.length - 1] ?? '';
    }

    const query: Record<string, string | undefined> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    let body: any = {};
    let rawBody = '';
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      rawBody = await request.text().catch(() => '');
      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = {};
        }
      }
    }

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });

    const result = await handleShiprocketAction({
      action,
      method: request.method,
      query,
      body,
      rawBody,
      headers,
      client,
      options,
    });

    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    GET: handler,
    POST: handler,
  };
}
