import { useState, useCallback } from 'react';
import { useShiprocketConfig } from '../context.js';
import type { ServiceabilityQuery, ServiceabilityResult } from '../../types/index.js';

export interface UsePincodeCheckReturn {
  checkPincode: (
    deliveryPincode: string,
    options?: Omit<ServiceabilityQuery, 'deliveryPincode'>
  ) => Promise<ServiceabilityResult | null>;
  data: ServiceabilityResult | null;
  loading: boolean;
  error: string | null;
  reset: () => void;
}

export function usePincodeCheck(): UsePincodeCheckReturn {
  const { apiBaseUrl, defaultPickupPincode, headers } = useShiprocketConfig();
  const [data, setData] = useState<ServiceabilityResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkPincode = useCallback(
    async (
      deliveryPincode: string,
      options?: Omit<ServiceabilityQuery, 'deliveryPincode'>
    ): Promise<ServiceabilityResult | null> => {
      const cleaned = deliveryPincode.trim();
      if (!/^\d{6}$/.test(cleaned)) {
        setError('Please enter a valid 6-digit pincode.');
        setData(null);
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          deliveryPincode: cleaned,
          weight: String(options?.weight ?? 0.5),
          cod: String(options?.cod ?? true),
        });
        const pickup = options?.pickupPincode ?? defaultPickupPincode;
        if (pickup) {
          params.set('pickupPincode', pickup);
        }

        const res = await fetch(`${apiBaseUrl}/serviceability?${params.toString()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(headers || {}),
          },
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Unable to check pincode serviceability');
        }

        setData(json.data as ServiceabilityResult);
        return json.data as ServiceabilityResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to check delivery pincode';
        setError(msg);
        setData(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, defaultPickupPincode, headers]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  return { checkPincode, data, loading, error, reset };
}
