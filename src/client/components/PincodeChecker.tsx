import React, { useState } from 'react';
import { usePincodeCheck } from '../hooks/usePincodeCheck.js';
import type { ServiceabilityResult } from '../../types/index.js';

export interface PincodeCheckerProps {
  /** Optional warehouse pickup pincode (overrides provider/server default) */
  pickupPincode?: string;
  /** Package weight in kg (default: 0.5) */
  weight?: number;
  /** Whether to check Cash on Delivery availability (default: true) */
  cod?: boolean;
  /** Placeholder text for input */
  placeholder?: string;
  /** Button label */
  buttonText?: string;
  /** Callback fired when serviceability result is received */
  onResult?: (result: ServiceabilityResult) => void;
  /** Custom wrapper className */
  className?: string;
}

export const PincodeChecker: React.FC<PincodeCheckerProps> = ({
  pickupPincode,
  weight = 0.5,
  cod = true,
  placeholder = 'Enter 6-digit Pincode',
  buttonText = 'Check',
  onResult,
  className,
}) => {
  const [pincode, setPincode] = useState('');
  const { checkPincode, data, loading, error } = usePincodeCheck();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await checkPincode(pincode, { pickupPincode, weight, cod });
    if (res && onResult) {
      onResult(res);
    }
  };

  return (
    <div
      className={className}
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '400px',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={pincode}
          onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
          placeholder={placeholder}
          aria-label="Delivery Pincode"
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid #d1d5db',
            fontSize: '14px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || pincode.length !== 6}
          style={{
            padding: '10px 16px',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: loading || pincode.length !== 6 ? '#9ca3af' : '#4f46e5',
            color: '#ffffff',
            fontWeight: 600,
            fontSize: '14px',
            cursor: loading || pincode.length !== 6 ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Checking...' : buttonText}
        </button>
      </form>

      {error && (
        <p style={{ color: '#dc2626', fontSize: '13px', marginTop: '8px', marginBottom: 0 }}>
          {error}
        </p>
      )}

      {data && (
        <div
          style={{
            marginTop: '10px',
            padding: '12px',
            borderRadius: '8px',
            backgroundColor: data.serviceable ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${data.serviceable ? '#bbf7d0' : '#fecaca'}`,
            fontSize: '13px',
          }}
        >
          {data.serviceable && data.recommendedCourier ? (
            <div>
              <div style={{ fontWeight: 600, color: '#166534', marginBottom: '4px' }}>
                ✓ Delivery available to {data.city ? `${data.city} (${data.deliveryPincode})` : data.deliveryPincode}
              </div>
              <div style={{ color: '#374151' }}>
                Estimated Delivery: <strong>{data.recommendedCourier.etd || `${data.recommendedCourier.estimatedDeliveryDays} days`}</strong> via{' '}
                {data.recommendedCourier.courierName}
              </div>
              <div style={{ color: '#4b5563', marginTop: '4px', display: 'flex', gap: '12px' }}>
                <span>
                  Shipping: <strong>₹{data.recommendedCourier.rate}</strong>
                </span>
                <span>
                  COD: <strong>{data.recommendedCourier.codAvailable ? 'Available' : 'Not Available'}</strong>
                </span>
              </div>
            </div>
          ) : (
            <div style={{ color: '#991b1b', fontWeight: 500 }}>
              ✗ Sorry, delivery is currently not serviceable at pincode {data.deliveryPincode}.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
