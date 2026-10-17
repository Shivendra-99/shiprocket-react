import crypto from 'node:crypto';
import type {
  CourierOption,
  CreateAndShipOrderResult,
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
  FastrrCustomerProfile,
  OrderTrackingResult,
  PackageDimensions,
  ServiceabilityQuery,
  ServiceabilityResult,
  ShiprocketAdhocOrderPayload,
  ShiprocketAssignAWBRequest,
  ShiprocketAssignAWBResponse,
  ShiprocketCartItem,
  ShiprocketCreateOrderResponse,
  ShiprocketServerConfig,
  TrackingScan,
} from '../types/index.js';

const DEFAULT_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';
const DEFAULT_FASTRR_API_BASE_URL = 'https://checkout-api.shiprocket.com';
const DEFAULT_FASTRR_BUYER_URL = 'https://fastrr-boost-ui.pickrr.com/';
const DEFAULT_FASTRR_SCRIPT_URL = 'https://fastrr-boost-ui.pickrr.com/assets/js/channels/shopify.js';
// 9.5 days in ms (Shiprocket tokens expire after 10 days / 240 hours)
const TOKEN_TTL_MS = 9.5 * 24 * 60 * 60 * 1000;

export class ShiprocketApiError extends Error {
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.name = 'ShiprocketApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Multi-item package dimension & weight calculator ported from Shiprocket's official
 * WooCommerce plugin (`class-shiprocket-woocommerce-shipping-method.php` lines 318-345).
 *
 * - Converts `grams -> kg` (`/ 1000`) and `inches -> cm` (`* 2.54`).
 * - Sorts each item's `[length, breadth, height]` ascending (`d0 <= d1 <= d2`),
 *   stacks the smallest axis (`height += d0 * units`), and takes `max` for `length` and `breadth`.
 */
export function calculatePackageDimensions(items: ShiprocketCartItem[]): PackageDimensions {
  let totalWeight = 0;
  let stackedHeight = 0;
  let maxLength = 0;
  let maxBreadth = 0;

  for (const item of items) {
    const qty = Math.max(1, Number(item.units) || 1);
    let itemWeight = Number(item.weight) || 0;
    if (item.weightUnit === 'grams') {
      itemWeight /= 1000;
    }
    totalWeight += itemWeight * qty;

    let l = Number(item.length) || 0;
    let b = Number(item.breadth) || 0;
    let h = Number(item.height) || 0;

    if (item.dimensionUnit === 'inches') {
      l *= 2.54;
      b *= 2.54;
      h *= 2.54;
    }

    const sorted = [l, b, h].sort((x, y) => x - y);
    stackedHeight += (sorted[0] || 0) * qty;
    maxLength = Math.max(maxLength, sorted[1] || 0);
    maxBreadth = Math.max(maxBreadth, sorted[2] || 0);
  }

  return {
    length: Number((maxLength || 10).toFixed(2)),
    breadth: Number((maxBreadth || 10).toFixed(2)),
    height: Number((stackedHeight || 10).toFixed(2)),
    weight: Number((totalWeight || 0.5).toFixed(3)),
  };
}

/**
 * Built-in Sandbox / Mock simulator for testing all Shiprocket Shipping & Fastrr Checkout
 * endpoints locally without requiring live merchant credentials.
 */
export function createSandboxFetch(): typeof fetch {
  const PINCODE_DB: Record<string, { city: string; state: string }> = {
    '110001': { city: 'New Delhi', state: 'Delhi' },
    '400001': { city: 'Mumbai', state: 'Maharashtra' },
    '560001': { city: 'Bengaluru', state: 'Karnataka' },
    '560038': { city: 'Bengaluru', state: 'Karnataka' },
    '600001': { city: 'Chennai', state: 'Tamil Nadu' },
    '700001': { city: 'Kolkata', state: 'West Bengal' },
    '500001': { city: 'Hyderabad', state: 'Telangana' },
    '411001': { city: 'Pune', state: 'Maharashtra' },
    '226001': { city: 'Lucknow', state: 'Uttar Pradesh' },
    '302001': { city: 'Jaipur', state: 'Rajasthan' },
  };

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url.endsWith('/auth/login')) {
      return new Response(JSON.stringify({ token: 'sr-sandbox-jwt-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/courier/serviceability/')) {
      const parsed = new URL(url);
      const pin = parsed.searchParams.get('delivery_postcode') || '560001';
      if (pin === '000000' || pin === '999999') {
        return new Response(
          JSON.stringify({ status: 200, data: { available_courier_companies: [] } }),
          { status: 200 }
        );
      }

      const loc = PINCODE_DB[pin] ?? { city: 'Bengaluru', state: 'Karnataka' };
      return new Response(
        JSON.stringify({
          status: 200,
          data: {
            recommended_courier_company_id: 2,
            available_courier_companies: [
              {
                courier_company_id: 1,
                courier_name: 'Delhivery Surface',
                rate: 49,
                cod_charges: 25,
                estimated_delivery_days: '4',
                etd: 'In 4 Days',
                rating: 4.4,
                is_surface: true,
                cod: 1,
                city: loc.city,
                state: loc.state,
              },
              {
                courier_company_id: 2,
                courier_name: 'Bluedart Express Air',
                rate: 79,
                cod_charges: 30,
                estimated_delivery_days: '2',
                etd: 'In 2 Days',
                rating: 4.8,
                is_surface: false,
                cod: 1,
                city: loc.city,
                state: loc.state,
              },
            ],
          },
        }),
        { status: 200 }
      );
    }

    if (url.endsWith('/orders/create/adhoc')) {
      const orderId = Math.floor(100000 + Math.random() * 900000);
      const shipmentId = Math.floor(500000 + Math.random() * 400000);
      return new Response(
        JSON.stringify({
          order_id: orderId,
          shipment_id: shipmentId,
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
      const awb = `SR${Math.floor(100000000 + Math.random() * 900000000)}`;
      return new Response(
        JSON.stringify({
          awb_assign_status: 1,
          response: {
            data: {
              awb_code: awb,
              courier_company_id: 2,
              courier_name: 'Bluedart Express Air',
            },
          },
        }),
        { status: 200 }
      );
    }

    if (url.includes('/courier/track')) {
      const awbMatch = url.match(/\/awb\/([^?]+)/);
      const parsed = new URL(url);
      const identifier =
        (awbMatch ? decodeURIComponent(awbMatch[1]) : parsed.searchParams.get('order_id')) ||
        'SR123456789';

      return new Response(
        JSON.stringify({
          tracking_data: {
            shipment_status: 7,
            track_url: `https://shiprocket.co/tracking/${identifier}`,
            etd: '2 Days',
            shipment_track: [
              {
                id: 884422,
                awb_code: identifier,
                courier_name: 'Bluedart Express Air',
                current_status: 'Out for Delivery',
                origin: 'New Delhi Hub',
                destination: 'Bengaluru Hub',
              },
            ],
            shipment_track_activities: [
              {
                date: 'Today, 09:30 AM',
                status: 'OFD',
                activity: 'Out for delivery with courier executive',
                location: 'Bengaluru (Indiranagar Hub)',
                'sr-status-label': 'OUT FOR DELIVERY',
              },
              {
                date: 'Yesterday, 11:15 PM',
                status: 'IT',
                activity: 'Arrived at destination city hub',
                location: 'Bengaluru Airport Sort Facility',
                'sr-status-label': 'IN TRANSIT',
              },
              {
                date: 'Yesterday, 02:10 PM',
                status: 'PKD',
                activity: 'Shipment picked up from seller warehouse',
                location: 'New Delhi (Okhla Phase III)',
                'sr-status-label': 'PICKED UP',
              },
            ],
          },
        }),
        { status: 200 }
      );
    }

    if (url.endsWith('/api/v1/access-token/s2s-login/initiate')) {
      return new Response(
        JSON.stringify({
          result: { token: 'sandbox-otp-session-token' },
        }),
        { status: 200 }
      );
    }

    if (url.endsWith('/api/v1/access-token/s2s-login/verify')) {
      return new Response(
        JSON.stringify({
          result: { authorised_customer_token: 'sandbox-authorised-customer-token' },
        }),
        { status: 200 }
      );
    }

    if (url.endsWith('/api/v1/customer-data')) {
      return new Response(
        JSON.stringify({
          result: {
            name: 'Shivendra Kumar Sonkar',
            email: 'shivendra@example.com',
            phone: '9876543210',
            addresses: [
              {
                id: 'addr-1',
                first_name: 'Shivendra',
                last_name: 'Sonkar',
                address_line_1: '42 Residency Road, Ashok Nagar',
                city: 'Bengaluru',
                state: 'Karnataka',
                pincode: '560001',
                phone: '9876543210',
              },
              {
                id: 'addr-2',
                first_name: 'Shivendra',
                last_name: 'Sonkar',
                address_line_1: 'Connaught Place, Block B',
                city: 'New Delhi',
                state: 'Delhi',
                pincode: '110001',
                phone: '9876543210',
              },
            ],
          },
        }),
        { status: 200 }
      );
    }

    if (url.includes('/api/v1/access-token/')) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            token: 'sandbox-fastrr-checkout-token',
            checkout_url: 'https://checkout.shiprocket.in/?token=sandbox-fastrr-checkout-token',
          },
        }),
        { status: 200 }
      );
    }

    return new Response(JSON.stringify({ message: 'Sandbox route not found' }), { status: 404 });
  };
}

export class ShiprocketServerClient {
  private readonly config: Required<
    Pick<ShiprocketServerConfig, 'email' | 'password' | 'baseUrl' | 'defaultPickupLocation'>
  > &
    ShiprocketServerConfig;
  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;
  private fetchImpl: typeof fetch;

  constructor(config: ShiprocketServerConfig, customFetch?: typeof fetch) {
    if (!config.sandbox && (!config.email || !config.password)) {
      throw new Error(
        'ShiprocketServerClient requires both `email` and `password` for API authentication (or set `sandbox: true`).'
      );
    }
    this.config = {
      ...config,
      email: config.email || 'sandbox@shiprocket.local',
      password: config.password || 'sandbox',
      defaultPickupPincode: config.defaultPickupPincode ?? (config.sandbox ? '110001' : undefined),
      fastrr:
        config.fastrr ??
        (config.sandbox
          ? { apiKey: 'sandbox-fastrr-key', secretKey: 'sandbox-fastrr-secret' }
          : undefined),
      baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
      defaultPickupLocation: config.defaultPickupLocation ?? 'Primary',
    };
    this.fetchImpl =
      customFetch ?? (config.sandbox ? createSandboxFetch() : globalThis.fetch.bind(globalThis));
  }

  /**
   * Authenticates with Shiprocket and caches the JWT token for 9.5 days.
   */
  public async getToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.cachedToken && now < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const res = await this.fetchImpl(`${this.config.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: this.config.email,
        password: this.config.password,
      }),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof data.token !== 'string') {
      throw new ShiprocketApiError(
        (data.message as string) || 'Failed to authenticate with Shiprocket API',
        res.status,
        data
      );
    }

    this.cachedToken = data.token;
    this.tokenExpiresAt = now + TOKEN_TTL_MS;
    return this.cachedToken;
  }

  /**
   * Performs an authenticated request to Shiprocket with automatic 401 token refresh retry.
   */
  public async request<T>(
    path: string,
    options: RequestInit = {},
    retryOn401 = true
  ): Promise<T> {
    const token = await this.getToken();
    const url = path.startsWith('http')
      ? path
      : `${this.config.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

    const res = await this.fetchImpl(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });

    if (res.status === 401 && retryOn401) {
      await this.getToken(true);
      return this.request<T>(path, options, false);
    }

    const data = (await res.json().catch(() => ({}))) as unknown;
    if (!res.ok) {
      const msg =
        (data as Record<string, unknown>)?.message ||
        `Shiprocket API error (${res.status}) on ${path}`;
      throw new ShiprocketApiError(String(msg), res.status, data);
    }

    return data as T;
  }

  /**
   * Checks pincode serviceability, shipping rates, and estimated delivery dates (EDD).
   * Includes WooCommerce's `fallbackRateGenerator` behavior when configured.
   */
  public async checkServiceability(query: ServiceabilityQuery): Promise<ServiceabilityResult> {
    const pickupPincode = query.pickupPincode ?? this.config.defaultPickupPincode;
    if (!pickupPincode) {
      throw new Error(
        'pickupPincode must be provided in query or configured via defaultPickupPincode.'
      );
    }
    const cleanDelivery = String(query.deliveryPincode).trim();
    if (!/^\d{6}$/.test(cleanDelivery)) {
      throw new Error('Invalid deliveryPincode: must be a 6-digit Indian pincode.');
    }

    const params = new URLSearchParams({
      pickup_postcode: String(pickupPincode).trim(),
      delivery_postcode: cleanDelivery,
      weight: String(query.weight ?? 0.5),
      cod: query.cod ? '1' : '0',
    });

    if (query.declaredValue !== undefined) {
      params.set('declared_value', String(query.declaredValue));
    }
    if (query.length !== undefined) params.set('length', String(query.length));
    if (query.breadth !== undefined) params.set('breadth', String(query.breadth));
    if (query.height !== undefined) params.set('height', String(query.height));

    try {
      const raw = await this.request<Record<string, any>>(
        `/courier/serviceability/?${params.toString()}`,
        { method: 'GET' }
      );

      const rawCouriers: any[] = raw?.data?.available_courier_companies ?? [];
      const recommendedId = raw?.data?.recommended_courier_company_id;

      const couriers: CourierOption[] = rawCouriers.map((c) => ({
        courierCompanyId: Number(c.courier_company_id),
        courierName: String(c.courier_name ?? ''),
        rate: Number(c.rate ?? c.freight_charge ?? 0),
        codCharges: Number(c.cod_charges ?? 0),
        estimatedDeliveryDays: String(c.estimated_delivery_days ?? ''),
        etd: String(c.etd ?? ''),
        rating: Number(c.rating ?? 0),
        isSurface: Boolean(c.is_surface),
        codAvailable: Boolean(c.cod),
      }));

      if (couriers.length === 0 && this.config.fallbackRate !== undefined) {
        return this.buildFallbackServiceability(cleanDelivery, Boolean(query.cod));
      }

      const cheapestCourier =
        couriers.length > 0 ? [...couriers].sort((a, b) => a.rate - b.rate)[0] : undefined;

      const fastestCourier =
        couriers.length > 0
          ? [...couriers].sort(
              (a, b) =>
                (Number.parseInt(a.estimatedDeliveryDays, 10) || 999) -
                (Number.parseInt(b.estimatedDeliveryDays, 10) || 999)
            )[0]
          : undefined;

      const recommendedCourier =
        couriers.find((c) => c.courierCompanyId === Number(recommendedId)) ??
        fastestCourier ??
        cheapestCourier;

      const firstRaw = rawCouriers[0];

      return {
        serviceable: couriers.length > 0,
        deliveryPincode: cleanDelivery,
        city: firstRaw?.city ? String(firstRaw.city) : undefined,
        state: firstRaw?.state ? String(firstRaw.state) : undefined,
        fastestCourier,
        cheapestCourier,
        recommendedCourier,
        couriers,
      };
    } catch (err) {
      if (this.config.fallbackRate !== undefined) {
        return this.buildFallbackServiceability(cleanDelivery, Boolean(query.cod));
      }
      throw err;
    }
  }

  private buildFallbackServiceability(
    deliveryPincode: string,
    codRequested: boolean
  ): ServiceabilityResult {
    const fallbackCourier: CourierOption = {
      courierCompanyId: 'fallback_rate',
      courierName: this.config.fallbackCarrierName ?? 'Standard Shipping',
      rate: Number(this.config.fallbackRate ?? 0),
      codCharges: 0,
      estimatedDeliveryDays: '5',
      etd: this.config.fallbackEtd ?? '4-6 Days',
      rating: 4.5,
      isSurface: true,
      codAvailable: codRequested,
      isFallback: true,
    };

    return {
      serviceable: true,
      deliveryPincode,
      fastestCourier: fallbackCourier,
      cheapestCourier: fallbackCourier,
      recommendedCourier: fallbackCourier,
      couriers: [fallbackCourier],
      usedFallbackRate: true,
    };
  }

  /**
   * Creates an adhoc order in Shiprocket Shipping.
   */
  public async createAdhocOrder(
    payload: ShiprocketAdhocOrderPayload
  ): Promise<ShiprocketCreateOrderResponse> {
    return this.request<ShiprocketCreateOrderResponse>('/orders/create/adhoc', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Assigns an AWB (Air Waybill) and courier to a shipment.
   */
  public async assignAWB(
    request: ShiprocketAssignAWBRequest
  ): Promise<ShiprocketAssignAWBResponse> {
    const body: Record<string, unknown> = {
      shipment_id: request.shipmentId,
    };
    if (request.courierId !== undefined) {
      body.courier_id = request.courierId;
    }

    const raw = await this.request<Record<string, any>>('/courier/assign/awb', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const awbData = raw?.response?.data ?? raw?.data ?? {};
    return {
      awbAssignStatus: Number(raw?.awb_assign_status ?? 1),
      awbCode: String(awbData.awb_code ?? ''),
      courierCompanyId: awbData.courier_company_id ?? '',
      courierName: String(awbData.courier_name ?? ''),
      shipmentId: request.shipmentId,
    };
  }

  /**
   * High-level helper that creates a Shiprocket order from React checkout data
   * (using WooCommerce's smart multi-item package dimension calculator)
   * and optionally assigns an AWB in a single call.
   */
  public async createAndShipOrder(
    req: CreateCheckoutSessionRequest
  ): Promise<CreateAndShipOrderResult> {
    if (
      !req.buyer ||
      !req.buyer.firstName ||
      !req.buyer.address ||
      !req.buyer.pincode ||
      !req.buyer.phone
    ) {
      throw new Error(
        'Buyer details (firstName, address, pincode, phone) are required to create an order.'
      );
    }
    if (!req.cartItems || req.cartItems.length === 0) {
      throw new Error('At least one cart item is required to create an order.');
    }

    const clientOrderId = req.orderId ?? `SR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const computedSubTotal =
      req.subTotal ??
      req.cartItems.reduce((sum, item) => sum + item.sellingPrice * item.units, 0);

    const computedDims = req.dimensions ?? calculatePackageDimensions(req.cartItems);

    const now = new Date();
    const orderDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;

    const adhocPayload: ShiprocketAdhocOrderPayload = {
      order_id: clientOrderId,
      order_date: orderDate,
      pickup_location: req.pickupLocation ?? this.config.defaultPickupLocation,
      billing_customer_name: req.buyer.firstName,
      billing_last_name: req.buyer.lastName ?? '',
      billing_address: req.buyer.address,
      billing_address_2: req.buyer.address2 ?? '',
      billing_city: req.buyer.city ?? '',
      billing_pincode: req.buyer.pincode,
      billing_state: req.buyer.state ?? '',
      billing_country: req.buyer.country ?? 'India',
      billing_email: req.buyer.email ?? 'customer@example.com',
      billing_phone: req.buyer.phone,
      shipping_is_billing: true,
      order_items: req.cartItems.map((item) => ({
        name: item.name,
        sku: item.sku || item.id,
        units: item.units,
        selling_price: item.sellingPrice,
        discount: item.discount ?? 0,
        tax: item.tax ?? 0,
        hsn: item.hsn,
      })),
      payment_method: req.paymentMethod ?? 'Prepaid',
      shipping_charges: req.shippingCharges ?? 0,
      total_discount: req.discount ?? 0,
      sub_total: computedSubTotal,
      length: computedDims.length,
      breadth: computedDims.breadth,
      height: computedDims.height,
      weight: computedDims.weight,
    };

    const orderRes = await this.createAdhocOrder(adhocPayload);

    let awbCode = orderRes.awb_code || undefined;
    let courierName = orderRes.courier_name || undefined;
    let courierCompanyId: number | string | undefined = orderRes.courier_company_id || undefined;

    if (req.autoAssignAWB && orderRes.shipment_id && !awbCode) {
      const awbRes = await this.assignAWB({ shipmentId: orderRes.shipment_id });
      awbCode = awbRes.awbCode || undefined;
      courierName = awbRes.courierName || undefined;
      courierCompanyId = awbRes.courierCompanyId || undefined;
    }

    return {
      orderId: orderRes.order_id,
      clientOrderId,
      shipmentId: orderRes.shipment_id,
      status: orderRes.status,
      awbCode,
      courierName,
      courierCompanyId,
    };
  }

  /**
   * Generates a Base64-encoded raw binary HMAC-SHA256 signature for Shiprocket Checkout (Fastrr).
   * Matches `base64_encode(hash_hmac('sha256', $json_data, $secret_key, true))` in
   * `class-shiprocketlogin-core.php` and `hmacInBase64` in `login.js`.
   */
  public signFastrrPayload(payloadString: string): string {
    const secret = this.config.fastrr?.secretKey;
    if (!secret) {
      throw new Error('Fastrr `secretKey` is not configured in ShiprocketServerConfig.fastrr.');
    }
    return crypto.createHmac('sha256', secret).update(payloadString).digest('base64');
  }

  /**
   * Sends a signed POST request to `checkout-api.shiprocket.com` with `X-Api-Key` and
   * Base64 `X-Api-HMAC-SHA256` headers (ported from `ShiprocketLogin_Core::make_request`).
   */
  public async fastrrSignedPost<T = Record<string, any>>(
    endpointPath: string,
    bodyPayload: Record<string, unknown>
  ): Promise<T> {
    if (!this.config.fastrr?.apiKey || !this.config.fastrr?.secretKey) {
      throw new Error(
        'Fastrr credentials (`fastrr.apiKey` and `fastrr.secretKey`) are required.'
      );
    }

    const baseUrl = (
      this.config.fastrr.checkoutApiBaseUrl ?? DEFAULT_FASTRR_API_BASE_URL
    ).replace(/\/+$/, '');
    const url = endpointPath.startsWith('http')
      ? endpointPath
      : `${baseUrl}${endpointPath.startsWith('/') ? '' : '/'}${endpointPath}`;

    const jsonData = JSON.stringify(bodyPayload);
    const hmac = this.signFastrrPayload(jsonData);

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.config.fastrr.apiKey,
        'X-Api-HMAC-SHA256': hmac,
      },
      body: jsonData,
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      throw new ShiprocketApiError(
        data?.message || `Fastrr API error (${res.status}) on ${endpointPath}`,
        res.status,
        data
      );
    }

    return data as T;
  }

  /**
   * Generates a Fastrr SDK access token (`POST /api/v1/access-token/login`).
   * Reverse-engineered from `ShiprocketLogin_Token::generate_token()`.
   */
  public async generateFastrrAccessToken(address = false): Promise<string> {
    const data = await this.fastrrSignedPost('/api/v1/access-token/login', {
      address,
      timestamp: new Date().toISOString(),
    });
    const token = data?.result?.token ?? data?.token;
    if (!token) {
      throw new Error('Fastrr API did not return a valid access token');
    }
    return String(token);
  }

  /**
   * Initiates a Server-to-Server (S2S) OTP login via Shiprocket/Fastrr network
   * (`POST /api/v1/access-token/s2s-login/initiate`).
   * Reverse-engineered from `ShiprocketLogin_Core::initiate_login()`.
   */
  public async initiateFastrrOtp(
    phone: string,
    countryCode = '91'
  ): Promise<{ token: string }> {
    const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
      throw new Error('Please provide a valid 10-digit mobile number.');
    }

    const data = await this.fastrrSignedPost('/api/v1/access-token/s2s-login/initiate', {
      country_code: countryCode,
      phone: cleanPhone,
      modes: ['SMS'],
      timestamp: new Date().toISOString(),
    });

    const token = data?.result?.token;
    if (!token) {
      throw new Error('Failed to initiate Fastrr OTP login');
    }
    return { token: String(token) };
  }

  /**
   * Verifies a Fastrr OTP and returns the `authorised_customer_token`
   * (`POST /api/v1/access-token/s2s-login/verify`).
   * Reverse-engineered from `ShiprocketLogin_Core::verify_otp()`.
   */
  public async verifyFastrrOtp(
    token: string,
    otp: string,
    userAddressConsent = true
  ): Promise<{ authorisedCustomerToken: string }> {
    const data = await this.fastrrSignedPost('/api/v1/access-token/s2s-login/verify', {
      token,
      otp: String(otp).trim(),
      user_address_consent: userAddressConsent,
    });

    const authorisedCustomerToken = data?.result?.authorised_customer_token;
    if (!authorisedCustomerToken) {
      throw new Error('Invalid OTP or expired Fastrr verification session');
    }
    return { authorisedCustomerToken: String(authorisedCustomerToken) };
  }

  /**
   * Fetches a buyer's saved profile and pre-filled addresses from the Fastrr network
   * (`POST /api/v1/customer-data`).
   * Reverse-engineered from `ShiprocketLogin_Core::fetch_customer_data()`.
   */
  public async fetchFastrrCustomerData(
    authorisedCustomerToken: string
  ): Promise<FastrrCustomerProfile> {
    const data = await this.fastrrSignedPost('/api/v1/customer-data', {
      token: authorisedCustomerToken,
    });

    const result = data?.result ?? {};
    return {
      name: result.name ? String(result.name) : undefined,
      email: result.email ? String(result.email) : undefined,
      phone: String(result.phone ?? ''),
      addresses: Array.isArray(result.addresses) ? result.addresses : [],
    };
  }

  /**
   * Builds the exact Fastrr Headless Iframe Widget URL (`fastrr-boost-ui.pickrr.com/?...`)
   * reverse-engineered from `shopify.js` (`ze` + `Ye` functions, `case "custom"`).
   */
  public buildFastrrWidgetUrl(params: {
    token: string;
    cartItems: ShiprocketCartItem[];
    redirectUrl?: string;
    shopName?: string;
    shopUrl?: string;
  }): string {
    const encodeB64 = (obj: unknown) =>
      Buffer.from(encodeURIComponent(JSON.stringify(obj)), 'utf-8').toString('base64');

    const channelParam = encodeB64({
      shop_name: params.shopName ?? 'custom-react-store',
      shop_url: params.shopUrl ?? '',
      redirectUrl: params.redirectUrl ?? this.config.fastrr?.redirectUrl ?? '',
      credInstalled: false,
      gpayInstalled: 'YES',
    });

    const cartParam = encodeB64(
      params.cartItems.map((item) => ({
        productId: item.id,
        variantId: item.id,
        title: item.name,
        price: item.sellingPrice,
        quantity: item.units,
        image: item.imageUrl ?? '',
      }))
    );

    const qs = new URLSearchParams({
      platform: 'CUSTOM',
      type: 'cart',
      customCheckoutToken: params.token,
      channel: channelParam,
    });

    return `${DEFAULT_FASTRR_BUYER_URL}?${qs.toString()}#cart=${cartParam}`;
  }

  /**
   * Initializes a Checkout Session.
   * - If `mode === 'fastrr'`, signs the cart payload with Base64 HMAC-SHA256 and creates a Fastrr Checkout session.
   * - If `mode === 'builtin'`, creates the order directly in Shiprocket Shipping (and optionally assigns AWB).
   */
  public async createCheckoutSession(
    req: CreateCheckoutSessionRequest
  ): Promise<CreateCheckoutSessionResponse> {
    const mode = req.mode ?? (this.config.fastrr?.apiKey ? 'fastrr' : 'builtin');

    if (mode === 'fastrr') {
      if (!this.config.fastrr?.apiKey || !this.config.fastrr?.secretKey) {
        throw new Error(
          'Fastrr mode requires `fastrr.apiKey` and `fastrr.secretKey` in ShiprocketServerConfig.'
        );
      }

      const orderId = req.orderId ?? `FASTRR-${Date.now()}`;
      const subTotal =
        req.subTotal ??
        req.cartItems.reduce((sum, item) => sum + item.sellingPrice * item.units, 0);

      const fastrrPayload = {
        order_id: orderId,
        cart_data: {
          items: req.cartItems.map((item) => ({
            variant_id: item.id,
            title: item.name,
            sku: item.sku,
            quantity: item.units,
            price: item.sellingPrice,
            image_url: item.imageUrl,
          })),
          sub_total: subTotal,
        },
        redirect_url: req.redirectUrl ?? this.config.fastrr.redirectUrl ?? '',
        timestamp: new Date().toISOString(),
      };

      const rawPayload = JSON.stringify(fastrrPayload);
      const hmacSignature = this.signFastrrPayload(rawPayload);

      let token = hmacSignature;
      let checkoutUrl = `https://checkout.shiprocket.in/?order_id=${encodeURIComponent(
        orderId
      )}&token=${encodeURIComponent(token)}`;

      try {
        const data = await this.fastrrSignedPost(
          '/api/v1/access-token/checkout',
          fastrrPayload
        );
        token = data?.result?.token ?? data?.token ?? hmacSignature;
        checkoutUrl = data?.result?.checkout_url ?? data?.checkout_url ?? checkoutUrl;
      } catch {
        // Fallback to locally signed Base64 HMAC session token for client widget usage
      }

      const widgetUrl = this.buildFastrrWidgetUrl({
        token,
        cartItems: req.cartItems,
        redirectUrl: req.redirectUrl,
      });

      return {
        success: true,
        mode: 'fastrr',
        fastrrSession: {
          token,
          checkoutUrl,
          widgetUrl,
          hmacSignature,
          orderId,
          scriptUrl: DEFAULT_FASTRR_SCRIPT_URL,
        },
      };
    }

    // Built-in checkout mode: create order directly in Shiprocket
    const orderResult = await this.createAndShipOrder(req);
    return {
      success: true,
      mode: 'builtin',
      orderResult,
    };
  }

  /**
   * Tracks a shipment by its AWB code or Order ID and normalizes the scan timeline.
   */
  public async trackOrder(params: {
    awb?: string;
    orderId?: string;
    channelId?: string;
  }): Promise<OrderTrackingResult> {
    if (!params.awb && !params.orderId) {
      throw new Error('Either `awb` or `orderId` must be provided to trackOrder.');
    }

    let raw: Record<string, any>;
    if (params.awb) {
      raw = await this.request<Record<string, any>>(
        `/courier/track/awb/${encodeURIComponent(params.awb)}`,
        { method: 'GET' }
      );
    } else {
      const qs = new URLSearchParams({ order_id: String(params.orderId) });
      if (params.channelId) qs.set('channel_id', params.channelId);
      raw = await this.request<Record<string, any>>(`/courier/track?${qs.toString()}`, {
        method: 'GET',
      });
    }

    const trackingData =
      raw?.tracking_data ??
      (Array.isArray(raw) ? raw[0]?.tracking_data : undefined) ??
      {};

    const shipmentTrack = Array.isArray(trackingData.shipment_track)
      ? trackingData.shipment_track[0] ?? {}
      : {};
    const activities: any[] = Array.isArray(trackingData.shipment_track_activities)
      ? trackingData.shipment_track_activities
      : [];

    const scans: TrackingScan[] = activities.map((act) => ({
      date: String(act.date ?? ''),
      status: String(act.status ?? ''),
      activity: String(act.activity ?? ''),
      location: String(act.location ?? ''),
      srStatusLabel: act['sr-status-label'] ? String(act['sr-status-label']) : undefined,
    }));

    return {
      trackingId: String(shipmentTrack.id ?? params.awb ?? params.orderId ?? ''),
      awbCode: String(shipmentTrack.awb_code ?? params.awb ?? ''),
      courierName: String(
        shipmentTrack.courier_name ?? trackingData.courier_name ?? ''
      ),
      currentStatus: String(
        shipmentTrack.current_status ??
          (trackingData.shipment_status
            ? `Status ${trackingData.shipment_status}`
            : 'Pending')
      ),
      currentStatusCode: trackingData.shipment_status,
      etd: trackingData.etd
        ? String(trackingData.etd)
        : shipmentTrack.edd
          ? String(shipmentTrack.edd)
          : undefined,
      deliveredDate: shipmentTrack.delivered_date
        ? String(shipmentTrack.delivered_date)
        : undefined,
      origin: shipmentTrack.origin ? String(shipmentTrack.origin) : undefined,
      destination: shipmentTrack.destination
        ? String(shipmentTrack.destination)
        : undefined,
      trackUrl: trackingData.track_url ? String(trackingData.track_url) : undefined,
      scans,
    };
  }
}
