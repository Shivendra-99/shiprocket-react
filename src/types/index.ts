/**
 * Core TypeScript definitions for `shiprocket-react` and `shiprocket-react/server`
 */

export type CheckoutMode = 'fastrr' | 'builtin';

export interface ShiprocketServerConfig {
  /** Shiprocket API User email (created in Settings -> API -> Configure) */
  email: string;
  /** Shiprocket API User password */
  password: string;
  /** Default warehouse pickup pincode (6 digits) used when not passed per request */
  defaultPickupPincode?: string;
  /** Default pickup location name configured in Shiprocket (e.g. "Primary") */
  defaultPickupLocation?: string;
  /** Base URL for Shiprocket Shipping API (defaults to https://apiv2.shiprocket.in/v1/external) */
  baseUrl?: string;
  /**
   * Enable built-in Sandbox/Mock mode for local testing and open-source demos
   * without making real network calls to Shiprocket servers.
   */
  sandbox?: boolean;
  /**
   * Optional fallback shipping rate (in INR) returned when Shiprocket API is unreachable
   * or returns no couriers for a zone (modeled after Shiprocket's WooCommerce plugin).
   */
  fallbackRate?: number;
  /** Optional display name for the fallback shipping rate (default: "Standard Shipping") */
  fallbackCarrierName?: string;
  /** Optional ETD label for fallback shipping rate (default: "4-6 Days") */
  fallbackEtd?: string;
  /** Optional Fastrr / Shiprocket Checkout credentials for official headless checkout & S2S address prefill */
  fastrr?: {
    /** Merchant API Key from Shiprocket Checkout / Fastrr dashboard */
    apiKey: string;
    /** Merchant Secret Key used for Base64 HMAC-SHA256 payload signing */
    secretKey: string;
    /** Optional custom Fastrr Checkout API base URL (defaults to https://checkout-api.shiprocket.com) */
    checkoutApiBaseUrl?: string;
    /** Optional custom redirect URL after checkout completes */
    redirectUrl?: string;
  };
  /** Optional webhook secret token configured in Shiprocket Settings -> API -> Webhooks */
  webhookSecret?: string;
}

export interface ServiceabilityQuery {
  /** 6-digit pickup warehouse pincode (optional if defaultPickupPincode is set on server) */
  pickupPincode?: string;
  /** 6-digit customer delivery pincode */
  deliveryPincode: string;
  /** Package weight in kg (defaults to 0.5) */
  weight?: number;
  /** Whether Cash on Delivery is required (true/false or 1/0) */
  cod?: boolean;
  /** Optional declared order value in INR */
  declaredValue?: number;
  /** Optional package dimensions in cm */
  length?: number;
  breadth?: number;
  height?: number;
}

export interface CourierOption {
  courierCompanyId: number | string;
  courierName: string;
  rate: number;
  codCharges: number;
  estimatedDeliveryDays: string;
  etd: string;
  rating: number;
  isSurface: boolean;
  codAvailable: boolean;
  isFallback?: boolean;
}

export interface ServiceabilityResult {
  serviceable: boolean;
  deliveryPincode: string;
  city?: string;
  state?: string;
  fastestCourier?: CourierOption;
  cheapestCourier?: CourierOption;
  recommendedCourier?: CourierOption;
  couriers: CourierOption[];
  usedFallbackRate?: boolean;
}

export interface ShiprocketCartItem {
  id: string;
  name: string;
  sku: string;
  units: number;
  sellingPrice: number;
  discount?: number;
  tax?: number;
  hsn?: number | string;
  imageUrl?: string;
  /** Item weight (default unit: kg unless weightUnit === 'grams') */
  weight?: number;
  weightUnit?: 'kg' | 'grams';
  /** Item dimensions (default unit: cm unless dimensionUnit === 'inches') */
  length?: number;
  breadth?: number;
  height?: number;
  dimensionUnit?: 'cm' | 'inches';
}

export interface PackageDimensions {
  length: number;
  breadth: number;
  height: number;
  weight: number;
}

export interface ShiprocketBuyerAddress {
  firstName: string;
  lastName?: string;
  email: string;
  phone: string;
  address: string;
  address2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
}

/**
 * Saved address returned by Fastrr S2S `/api/v1/customer-data`
 * (reverse-engineered from `class-shiprocketlogin-core.php` & `class-shiprocketlogin-ajax.php`)
 */
export interface FastrrCustomerAddress {
  id?: string | number;
  first_name?: string;
  last_name?: string;
  name?: string;
  address_line_1?: string;
  address_line_2?: string;
  address?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
  phone?: string;
}

export interface FastrrCustomerProfile {
  name?: string;
  email?: string;
  phone: string;
  addresses: FastrrCustomerAddress[];
}

export interface CreateCheckoutSessionRequest {
  mode?: CheckoutMode;
  cartItems: ShiprocketCartItem[];
  buyer?: Partial<ShiprocketBuyerAddress>;
  paymentMethod?: 'Prepaid' | 'COD';
  subTotal?: number;
  shippingCharges?: number;
  discount?: number;
  orderId?: string;
  pickupLocation?: string;
  dimensions?: PackageDimensions;
  autoAssignAWB?: boolean;
  redirectUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateCheckoutSessionResponse {
  success: boolean;
  mode: CheckoutMode;
  /** Present when mode === 'fastrr' */
  fastrrSession?: {
    token: string;
    checkoutUrl: string;
    widgetUrl: string;
    hmacSignature: string;
    orderId: string;
    scriptUrl: string;
  };
  /** Present when mode === 'builtin' and an order is placed directly */
  orderResult?: CreateAndShipOrderResult;
  error?: string;
}

export interface ShiprocketOrderItemPayload {
  name: string;
  sku: string;
  units: number;
  selling_price: number;
  discount?: number;
  tax?: number;
  hsn?: number | string;
}

export interface ShiprocketAdhocOrderPayload {
  order_id: string;
  order_date: string;
  pickup_location: string;
  channel_id?: string;
  comment?: string;
  billing_customer_name: string;
  billing_last_name?: string;
  billing_address: string;
  billing_address_2?: string;
  billing_city: string;
  billing_pincode: string | number;
  billing_state: string;
  billing_country: string;
  billing_email: string;
  billing_phone: string | number;
  shipping_is_billing: boolean;
  shipping_customer_name?: string;
  shipping_last_name?: string;
  shipping_address?: string;
  shipping_address_2?: string;
  shipping_city?: string;
  shipping_pincode?: string | number;
  shipping_country?: string;
  shipping_state?: string;
  shipping_email?: string;
  shipping_phone?: string | number;
  order_items: ShiprocketOrderItemPayload[];
  payment_method: 'Prepaid' | 'COD';
  shipping_charges?: number;
  giftwrap_charges?: number;
  transaction_charges?: number;
  total_discount?: number;
  sub_total: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
}

export interface ShiprocketCreateOrderResponse {
  order_id: number;
  shipment_id: number;
  status: string;
  status_code: number;
  onboarding_completed_now: number;
  awb_code: string;
  courier_company_id: string | number;
  courier_name: string;
}

export interface ShiprocketAssignAWBRequest {
  shipmentId: number | string;
  courierId?: number | string;
}

export interface ShiprocketAssignAWBResponse {
  awbAssignStatus: number;
  awbCode: string;
  courierCompanyId: number | string;
  courierName: string;
  shipmentId: number | string;
}

export interface CreateAndShipOrderResult {
  orderId: number;
  clientOrderId: string;
  shipmentId: number;
  status: string;
  awbCode?: string;
  courierName?: string;
  courierCompanyId?: number | string;
}

export interface TrackingScan {
  date: string;
  status: string;
  activity: string;
  location: string;
  srStatusLabel?: string;
}

export interface OrderTrackingResult {
  trackingId: string;
  awbCode: string;
  courierName: string;
  currentStatus: string;
  currentStatusCode?: number | string;
  etd?: string;
  deliveredDate?: string;
  origin?: string;
  destination?: string;
  trackUrl?: string;
  scans: TrackingScan[];
}

export interface ShiprocketWebhookEvent {
  awb?: string;
  courier_name?: string;
  current_status?: string;
  current_status_id?: number;
  shipment_status?: string;
  shipment_status_id?: number;
  current_timestamp?: string;
  order_id?: string;
  sr_order_id?: number;
  etd?: string;
  scans?: Array<{
    date: string;
    activity: string;
    location: string;
    status?: string;
  }>;
  /** Fastrr Checkout specific fields */
  event_type?: string;
  payment_status?: string;
  [key: string]: unknown;
}
