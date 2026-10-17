import { useState, useCallback, useEffect } from 'react';
import { useShiprocketConfig } from '../context.js';
import type { OrderTrackingResult } from '../../types/index.js';

export interface UseOrderTrackingOptions {
  awb?: string;
  orderId?: string;
  channelId?: string;
  autoFetch?: boolean;
}

export interface UseOrderTrackingReturn {
  track: (params?: { awb?: string; orderId?: string; channelId?: string }) => Promise<OrderTrackingResult | null>;
  data: OrderTrackingResult | null;
  loading: boolean;
  error: string | null;
}

export function useOrderTracking(options?: UseOrderTrackingOptions): UseOrderTrackingReturn {
  const { apiBaseUrl, headers } = useShiprocketConfig();
  const [data, setData] = useState<OrderTrackingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const track = useCallback(
    async (overrideParams?: { awb?: string; orderId?: string; channelId?: string }): Promise<OrderTrackingResult | null> => {
      const awb = overrideParams?.awb ?? options?.awb;
      const orderId = overrideParams?.orderId ?? options?.orderId;
      const channelId = overrideParams?.channelId ?? options?.channelId;

      if (!awb && !orderId) {
        setError('Please provide an AWB number or Order ID to track.');
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const qs = new URLSearchParams();
        if (awb) qs.set('awb', awb.trim());
        if (orderId) qs.set('orderId', orderId.trim());
        if (channelId) qs.set('channelId', channelId.trim());

        const res = await fetch(`${apiBaseUrl}/track?${qs.toString()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(headers || {}),
          },
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.error || 'Unable to fetch tracking details');
        }

        setData(json.data as OrderTrackingResult);
        return json.data as OrderTrackingResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to track order';
        setError(msg);
        setData(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, headers, options?.awb, options?.orderId, options?.channelId]
  );

  useEffect(() => {
    if (options?.autoFetch && (options.awb || options.orderId)) {
      void track();
    }
  }, [options?.autoFetch, options?.awb, options?.orderId, track]);

  return { track, data, loading, error };
}
