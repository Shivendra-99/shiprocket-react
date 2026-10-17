import { useState, useCallback, useRef, useEffect } from 'react';
import { useShiprocketConfig } from '../context.js';
import type { FastrrCustomerProfile } from '../../types/index.js';

export interface UseFastrrAddressPrefillReturn {
  /** Initiates SMS OTP from Shiprocket/Fastrr S2S API and starts WebOTP auto-read if supported */
  sendOtp: (phone: string, onAutoOtpRead?: (otpCode: string) => void) => Promise<string | null>;
  /** Verifies the OTP and retrieves the buyer's saved addresses from Fastrr's network */
  verifyOtpAndFetchAddresses: (
    otp: string,
    overrideToken?: string
  ) => Promise<FastrrCustomerProfile | null>;
  otpToken: string | null;
  customerProfile: FastrrCustomerProfile | null;
  loading: boolean;
  error: string | null;
  reset: () => void;
}

/**
 * React hook for 1-click OTP verification & saved address pre-fill from Shiprocket's 100M+ buyer network.
 * Reverse-engineered from `ShiprocketLogin_Core` (`class-shiprocketlogin-core.php`) and
 * `FetchAndAutofillOtp` (`login.js`).
 */
export function useFastrrAddressPrefill(): UseFastrrAddressPrefillReturn {
  const { apiBaseUrl, headers } = useShiprocketConfig();
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [customerProfile, setCustomerProfile] = useState<FastrrCustomerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const sendOtp = useCallback(
    async (
      phone: string,
      onAutoOtpRead?: (otpCode: string) => void
    ): Promise<string | null> => {
      const cleaned = phone.replace(/\D/g, '').slice(-10);
      if (cleaned.length !== 10) {
        setError('Please enter a valid 10-digit mobile number.');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${apiBaseUrl}/fastrr-otp/initiate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(headers || {}),
          },
          body: JSON.stringify({ phone: cleaned }),
        });

        const json = await res.json();
        if (!res.ok || !json.success || !json.token) {
          throw new Error(json.error || 'Failed to send OTP via Shiprocket');
        }

        const token = String(json.token);
        setOtpToken(token);

        // Start browser WebOTP API auto-read (reverse-engineered from `FetchAndAutofillOtp` in `login.js`)
        if (
          typeof window !== 'undefined' &&
          'OTPCredential' in window &&
          navigator.credentials?.get
        ) {
          abortControllerRef.current?.abort();
          const ac = new AbortController();
          abortControllerRef.current = ac;

          navigator.credentials
            .get({
              // @ts-expect-error WebOTP credential request options
              otp: { transport: ['sms'] },
              signal: ac.signal,
            })
            .then((cred: any) => {
              if (cred?.code && onAutoOtpRead) {
                onAutoOtpRead(String(cred.code));
              }
            })
            .catch(() => {
              // Ignore abort or unsupported browser errors
            });
        }

        return token;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to send OTP';
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, headers]
  );

  const verifyOtpAndFetchAddresses = useCallback(
    async (
      otp: string,
      overrideToken?: string
    ): Promise<FastrrCustomerProfile | null> => {
      const activeToken = overrideToken ?? otpToken;
      if (!activeToken) {
        setError('Please request an OTP first.');
        return null;
      }
      if (!otp.trim()) {
        setError('Please enter the OTP received on your mobile.');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        abortControllerRef.current?.abort();

        const res = await fetch(`${apiBaseUrl}/fastrr-otp/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(headers || {}),
          },
          body: JSON.stringify({
            token: activeToken,
            otp: otp.trim(),
            userAddressConsent: true,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success || !json.profile) {
          throw new Error(json.error || 'Invalid OTP');
        }

        const profile = json.profile as FastrrCustomerProfile;
        setCustomerProfile(profile);
        return profile;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to verify OTP';
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, headers, otpToken]
  );

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    setOtpToken(null);
    setCustomerProfile(null);
    setError(null);
    setLoading(false);
  }, []);

  return {
    sendOtp,
    verifyOtpAndFetchAddresses,
    otpToken,
    customerProfile,
    loading,
    error,
    reset,
  };
}
