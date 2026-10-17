import React, { useState, useEffect } from 'react';
import { useShiprocketConfig } from '../context.js';
import {
  useShiprocketCheckout,
  prefetchFastrrIframe,
} from '../hooks/useShiprocketCheckout.js';
import { usePincodeCheck } from '../hooks/usePincodeCheck.js';
import { useFastrrAddressPrefill } from '../hooks/useFastrrAddressPrefill.js';
import type {
  CheckoutMode,
  CreateCheckoutSessionResponse,
  FastrrCustomerAddress,
  ShiprocketBuyerAddress,
  ShiprocketCartItem,
} from '../../types/index.js';

export interface ShiprocketCheckoutButtonProps {
  /** Items in the customer's cart */
  cartItems: ShiprocketCartItem[];
  /** Override checkout mode ("fastrr" or "builtin") */
  mode?: CheckoutMode;
  /** Pre-filled buyer details if already logged in */
  initialBuyer?: Partial<ShiprocketBuyerAddress>;
  /** Automatically assign AWB in Shiprocket when order is created (default: false) */
  autoAssignAWB?: boolean;
  /** Enable 1-click Shiprocket OTP address autofill inside built-in modal (default: true) */
  enableFastrrAddressPrefill?: boolean;
  /** Preload Fastrr iframe in background when mode === 'fastrr' (default: true) */
  prefetch?: boolean;
  /** Custom button text (default: "Proceed to Checkout") */
  buttonText?: string;
  /** Optional custom handler for Prepaid payment (e.g. Razorpay/Cashfree) before creating Shiprocket order */
  onPrepaidPayment?: (params: {
    amount: number;
    buyer: ShiprocketBuyerAddress;
    cartItems: ShiprocketCartItem[];
  }) => Promise<boolean>;
  /** Fired when checkout succeeds */
  onSuccess?: (response: CreateCheckoutSessionResponse) => void;
  /** Fired when checkout fails */
  onError?: (error: string) => void;
  /** Optional custom className for the trigger button */
  className?: string;
}

export const ShiprocketCheckoutButton: React.FC<ShiprocketCheckoutButtonProps> = ({
  cartItems,
  mode,
  initialBuyer,
  autoAssignAWB = false,
  enableFastrrAddressPrefill = true,
  prefetch = true,
  buttonText = 'Proceed to Checkout',
  onPrepaidPayment,
  onSuccess,
  onError,
  className,
}) => {
  const { defaultCheckoutMode } = useShiprocketConfig();
  const activeMode = mode ?? defaultCheckoutMode;
  const { initiateCheckout, loading } = useShiprocketCheckout();
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    if (activeMode === 'fastrr' && prefetch) {
      prefetchFastrrIframe();
    }
  }, [activeMode, prefetch]);

  const handleButtonClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (activeMode === 'fastrr') {
      const res = await initiateCheckout(
        {
          mode: 'fastrr',
          cartItems,
          buyer: initialBuyer,
        },
        { nativeEvent: e.nativeEvent }
      );
      if (res?.success) {
        onSuccess?.(res);
      } else if (onError) {
        onError(res?.error || 'Failed to launch Fastrr checkout');
      }
      return;
    }

    setIsModalOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={loading || cartItems.length === 0}
        className={className}
        style={{
          padding: '12px 24px',
          borderRadius: '10px',
          border: 'none',
          backgroundColor: loading || cartItems.length === 0 ? '#9ca3af' : '#ea580c',
          color: '#ffffff',
          fontWeight: 700,
          fontSize: '15px',
          cursor: loading || cartItems.length === 0 ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span>{loading ? 'Initializing Checkout...' : buttonText}</span>
      </button>

      {isModalOpen && (
        <ShiprocketCheckoutModal
          cartItems={cartItems}
          initialBuyer={initialBuyer}
          autoAssignAWB={autoAssignAWB}
          enableFastrrAddressPrefill={enableFastrrAddressPrefill}
          onPrepaidPayment={onPrepaidPayment}
          onClose={() => setIsModalOpen(false)}
          onSuccess={(res) => {
            onSuccess?.(res);
          }}
          onError={onError}
        />
      )}
    </>
  );
};

export interface ShiprocketCheckoutModalProps {
  cartItems: ShiprocketCartItem[];
  initialBuyer?: Partial<ShiprocketBuyerAddress>;
  autoAssignAWB?: boolean;
  enableFastrrAddressPrefill?: boolean;
  onPrepaidPayment?: (params: {
    amount: number;
    buyer: ShiprocketBuyerAddress;
    cartItems: ShiprocketCartItem[];
  }) => Promise<boolean>;
  onClose: () => void;
  onSuccess?: (response: CreateCheckoutSessionResponse) => void;
  onError?: (error: string) => void;
}

export const ShiprocketCheckoutModal: React.FC<ShiprocketCheckoutModalProps> = ({
  cartItems,
  initialBuyer,
  autoAssignAWB = false,
  enableFastrrAddressPrefill = true,
  onPrepaidPayment,
  onClose,
  onSuccess,
  onError,
}) => {
  const [buyer, setBuyer] = useState<ShiprocketBuyerAddress>({
    firstName: initialBuyer?.firstName ?? '',
    lastName: initialBuyer?.lastName ?? '',
    email: initialBuyer?.email ?? '',
    phone: initialBuyer?.phone ?? '',
    address: initialBuyer?.address ?? '',
    address2: initialBuyer?.address2 ?? '',
    city: initialBuyer?.city ?? '',
    state: initialBuyer?.state ?? '',
    pincode: initialBuyer?.pincode ?? '',
    country: initialBuyer?.country ?? 'India',
  });
  const [paymentMethod, setPaymentMethod] = useState<'Prepaid' | 'COD'>('Prepaid');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [completedSession, setCompletedSession] = useState<CreateCheckoutSessionResponse | null>(
    null
  );

  // Fastrr S2S OTP & Address Prefill state
  const [otpInput, setOtpInput] = useState('');
  const {
    sendOtp,
    verifyOtpAndFetchAddresses,
    otpToken,
    customerProfile,
    loading: otpLoading,
    error: otpError,
  } = useFastrrAddressPrefill();

  const { checkPincode, data: pincodeData, loading: checkingPincode } = usePincodeCheck();
  const { initiateCheckout } = useShiprocketCheckout();

  const itemsSubTotal = cartItems.reduce(
    (sum, item) => sum + item.sellingPrice * item.units,
    0
  );
  const shippingFee = pincodeData?.recommendedCourier?.rate ?? 0;
  const grandTotal = itemsSubTotal + shippingFee;

  const handlePincodeChange = async (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 6);
    setBuyer((prev) => ({ ...prev, pincode: cleaned }));
    if (cleaned.length === 6) {
      const res = await checkPincode(cleaned, { cod: true });
      if (res?.city || res?.state) {
        setBuyer((prev) => ({
          ...prev,
          city: res.city || prev.city,
          state: res.state || prev.state,
        }));
      }
    }
  };

  const applySavedAddress = (addr: FastrrCustomerAddress, profileName?: string, profileEmail?: string) => {
    const fullName = (addr.name || profileName || '').trim();
    const parts = fullName.split(' ');
    const firstName = addr.first_name || parts[0] || buyer.firstName;
    const lastName = addr.last_name || parts.slice(1).join(' ') || buyer.lastName;
    const pin = String(addr.pincode || '').replace(/\D/g, '').slice(0, 6);

    setBuyer((prev) => ({
      ...prev,
      firstName: firstName || prev.firstName,
      lastName: lastName || prev.lastName,
      email: profileEmail || prev.email,
      phone: addr.phone || prev.phone,
      address: addr.address_line_1 || addr.address || prev.address,
      address2: addr.address_line_2 || prev.address2,
      city: addr.city || prev.city,
      state: addr.state || prev.state,
      pincode: pin || prev.pincode,
    }));

    if (pin.length === 6) {
      void checkPincode(pin, { cod: true });
    }
  };

  const handleSendOtp = async () => {
    const token = await sendOtp(buyer.phone, async (autoCode) => {
      setOtpInput(autoCode);
      const profile = await verifyOtpAndFetchAddresses(autoCode, token ?? undefined);
      if (profile?.addresses?.[0]) {
        applySavedAddress(profile.addresses[0], profile.name, profile.email);
      }
    });
  };

  const handleVerifyOtp = async () => {
    const profile = await verifyOtpAndFetchAddresses(otpInput);
    if (profile?.addresses?.[0]) {
      applySavedAddress(profile.addresses[0], profile.name, profile.email);
    }
  };

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!buyer.firstName || !buyer.phone || !buyer.address || buyer.pincode.length !== 6) {
      setLocalError('Please fill in your name, 10-digit phone number, address, and 6-digit pincode.');
      return;
    }

    if (pincodeData && !pincodeData.serviceable) {
      setLocalError('Selected pincode is not serviceable for delivery.');
      return;
    }

    setSubmitting(true);
    try {
      if (paymentMethod === 'Prepaid' && onPrepaidPayment) {
        const paid = await onPrepaidPayment({
          amount: grandTotal,
          buyer,
          cartItems,
        });
        if (!paid) {
          setLocalError('Payment was cancelled or failed.');
          setSubmitting(false);
          return;
        }
      }

      const res = await initiateCheckout({
        mode: 'builtin',
        cartItems,
        buyer,
        paymentMethod,
        subTotal: itemsSubTotal,
        shippingCharges: shippingFee,
        autoAssignAWB,
      });

      if (!res || !res.success) {
        const errMsg = res?.error || 'Failed to place order';
        setLocalError(errMsg);
        onError?.(errMsg);
      } else {
        setCompletedSession(res);
        onSuccess?.(res);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unexpected checkout error';
      setLocalError(errMsg);
      onError?.(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 11px',
    borderRadius: '8px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
    boxSizing: 'border-box',
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Shiprocket Express Checkout"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(17, 24, 39, 0.6)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 9999,
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          maxWidth: '480px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: '22px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #e5e7eb',
            paddingBottom: '12px',
            marginBottom: '16px',
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#111827' }}>
              Express Checkout
            </h3>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              Powered by Shiprocket Logistics
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Checkout"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '20px',
              cursor: 'pointer',
              color: '#6b7280',
            }}
          >
            ✕
          </button>
        </div>

        {completedSession?.orderResult ? (
          <div style={{ textAlign: 'center', padding: '16px 8px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#dcfce7',
                color: '#15803d',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                fontWeight: 700,
                marginBottom: '12px',
              }}
            >
              ✓
            </div>
            <h4 style={{ margin: '0 0 6px', fontSize: '18px', color: '#111827' }}>
              Order Confirmed!
            </h4>
            <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#4b5563' }}>
              Order ID: <strong>{completedSession.orderResult.clientOrderId}</strong> (Shiprocket #
              {completedSession.orderResult.orderId})
            </p>
            {completedSession.orderResult.awbCode && (
              <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#4f46e5' }}>
                AWB Tracking: <strong>{completedSession.orderResult.awbCode}</strong> via{' '}
                {completedSession.orderResult.courierName}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#111827',
                color: '#ffffff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handlePlaceOrder}>
            {/* Order Summary */}
            <div
              style={{
                backgroundColor: '#f9fafb',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '14px',
                fontSize: '13px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>Subtotal ({cartItems.reduce((n, i) => n + i.units, 0)} items)</span>
                <strong>₹{itemsSubTotal.toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span>
                  Shipping{' '}
                  {pincodeData?.recommendedCourier
                    ? `(${pincodeData.recommendedCourier.courierName})`
                    : ''}
                </span>
                <strong>
                  {shippingFee > 0 ? `₹${shippingFee.toFixed(2)}` : 'Calculated by Pincode'}
                </strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderTop: '1px solid #e5e7eb',
                  paddingTop: '6px',
                  marginTop: '6px',
                  fontSize: '15px',
                  fontWeight: 700,
                }}
              >
                <span>Total</span>
                <span>₹{grandTotal.toFixed(2)}</span>
              </div>
            </div>

            {/* 1-Click Fastrr Network Address Prefill via Mobile + OTP */}
            {enableFastrrAddressPrefill && (
              <div
                style={{
                  backgroundColor: '#fff7ed',
                  border: '1px solid #fed7aa',
                  borderRadius: '8px',
                  padding: '10px 12px',
                  marginBottom: '14px',
                  fontSize: '12px',
                }}
              >
                <div style={{ fontWeight: 700, color: '#9a3412', marginBottom: '6px' }}>
                  ⚡ Fast Address Autofill (Shiprocket Network)
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input
                    type="tel"
                    maxLength={10}
                    value={buyer.phone}
                    onChange={(e) =>
                      setBuyer({ ...buyer, phone: e.target.value.replace(/\D/g, '') })
                    }
                    placeholder="10-digit Mobile Number"
                    style={{ ...inputStyle, flex: 1, padding: '7px 10px', fontSize: '13px' }}
                  />
                  {!otpToken ? (
                    <button
                      type="button"
                      disabled={otpLoading || buyer.phone.length < 10}
                      onClick={() => void handleSendOtp()}
                      style={{
                        padding: '7px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        backgroundColor: '#ea580c',
                        color: '#ffffff',
                        fontWeight: 600,
                        fontSize: '12px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {otpLoading ? 'Sending...' : 'Get OTP'}
                    </button>
                  ) : (
                    <>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={otpInput}
                        onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="OTP"
                        style={{ ...inputStyle, width: '80px', padding: '7px 8px', fontSize: '13px' }}
                      />
                      <button
                        type="button"
                        disabled={otpLoading || !otpInput}
                        onClick={() => void handleVerifyOtp()}
                        style={{
                          padding: '7px 12px',
                          borderRadius: '6px',
                          border: 'none',
                          backgroundColor: '#15803d',
                          color: '#ffffff',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer',
                        }}
                      >
                        Verify
                      </button>
                    </>
                  )}
                </div>
                {otpError && (
                  <div style={{ color: '#dc2626', marginTop: '4px' }}>{otpError}</div>
                )}
                {customerProfile && customerProfile.addresses.length > 1 && (
                  <div style={{ marginTop: '6px' }}>
                    <select
                      onChange={(e) => {
                        const idx = Number(e.target.value);
                        const chosen = customerProfile.addresses[idx];
                        if (chosen) {
                          applySavedAddress(chosen, customerProfile.name, customerProfile.email);
                        }
                      }}
                      style={{ ...inputStyle, padding: '6px 8px', fontSize: '12px' }}
                    >
                      {customerProfile.addresses.map((a, idx) => (
                        <option key={a.id ?? idx} value={idx}>
                          {a.address_line_1 || a.address}, {a.city} - {a.pincode}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Pincode + Serviceability */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Delivery Pincode *
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={buyer.pincode}
                onChange={(e) => void handlePincodeChange(e.target.value)}
                placeholder="6-digit Pincode (auto-fills City & State)"
                style={inputStyle}
              />
              {checkingPincode && (
                <span style={{ fontSize: '12px', color: '#6b7280' }}>Checking serviceability...</span>
              )}
              {pincodeData && (
                <div
                  style={{
                    fontSize: '12px',
                    marginTop: '4px',
                    color: pincodeData.serviceable ? '#15803d' : '#dc2626',
                  }}
                >
                  {pincodeData.serviceable
                    ? `✓ Deliverable by ${
                        pincodeData.recommendedCourier?.etd ||
                        pincodeData.recommendedCourier?.estimatedDeliveryDays + ' days'
                      }`
                    : '✗ Pincode is not serviceable'}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginBottom: '12px',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  First Name *
                </label>
                <input
                  type="text"
                  required
                  value={buyer.firstName}
                  onChange={(e) => setBuyer({ ...buyer, firstName: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Last Name
                </label>
                <input
                  type="text"
                  value={buyer.lastName}
                  onChange={(e) => setBuyer({ ...buyer, lastName: e.target.value })}
                  style={inputStyle}
                />
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginBottom: '12px',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Phone Number *
                </label>
                <input
                  type="tel"
                  required
                  value={buyer.phone}
                  onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })}
                  placeholder="10-digit mobile"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={buyer.email}
                  onChange={(e) => setBuyer({ ...buyer, email: e.target.value })}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                Complete Address *
              </label>
              <input
                type="text"
                required
                value={buyer.address}
                onChange={(e) => setBuyer({ ...buyer, address: e.target.value })}
                placeholder="House/Flat No., Building, Street, Area"
                style={inputStyle}
              />
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px',
                marginBottom: '14px',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  City *
                </label>
                <input
                  type="text"
                  required
                  value={buyer.city}
                  onChange={(e) => setBuyer({ ...buyer, city: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  State *
                </label>
                <input
                  type="text"
                  required
                  value={buyer.state}
                  onChange={(e) => setBuyer({ ...buyer, state: e.target.value })}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Payment Method */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                Payment Method
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <label
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    border: paymentMethod === 'Prepaid' ? '2px solid #ea580c' : '1px solid #d1d5db',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === 'Prepaid'}
                    onChange={() => setPaymentMethod('Prepaid')}
                    style={{ marginRight: '6px' }}
                  />
                  Prepaid (UPI / Card)
                </label>
                <label
                  style={{
                    flex: 1,
                    padding: '10px',
                    borderRadius: '8px',
                    border: paymentMethod === 'COD' ? '2px solid #ea580c' : '1px solid #d1d5db',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                    opacity:
                      pincodeData?.recommendedCourier && !pincodeData.recommendedCourier.codAvailable
                        ? 0.5
                        : 1,
                  }}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    checked={paymentMethod === 'COD'}
                    disabled={
                      Boolean(
                        pincodeData?.recommendedCourier &&
                          !pincodeData.recommendedCourier.codAvailable
                      )
                    }
                    onChange={() => setPaymentMethod('COD')}
                    style={{ marginRight: '6px' }}
                  />
                  Cash on Delivery
                </label>
              </div>
            </div>

            {localError && (
              <div
                style={{
                  padding: '10px',
                  borderRadius: '8px',
                  backgroundColor: '#fef2f2',
                  color: '#b91c1c',
                  fontSize: '13px',
                  marginBottom: '12px',
                }}
              >
                {localError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: submitting ? '#9ca3af' : '#ea580c',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '15px',
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Placing Order...' : `Place Order • ₹${grandTotal.toFixed(2)}`}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
