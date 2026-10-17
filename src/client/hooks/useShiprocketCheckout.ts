import { useState, useCallback } from 'react';
import { useShiprocketConfig } from '../context.js';
import type {
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,
} from '../../types/index.js';

declare global {
  interface Window {
    HeadlessCheckout?: {
      addToCart: (
        event: unknown,
        token: string,
        options?: { fallbackUrl?: string; isInitiatedFromApp?: boolean },
        callback?: (eventData: { event?: string; exitCheckout?: boolean; [k: string]: unknown }) => void
      ) => void;
    };
    srCustomCheckoutCallBackFn?: (eventData: unknown) => void;
  }
}

const FASTRR_UPTIME_URL = 'https://uptime2.fastrr.com/fe2';
const FASTRR_BUYER_URL = 'https://fastrr-boost-ui.pickrr.com/';

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load Fastrr script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Checks Fastrr's live uptime circuit-breaker endpoint (`https://uptime2.fastrr.com/fe2`)
 * reverse-engineered from `login.js` (line 98) and `shopify.js` (`Ze`).
 * Returns `true` if Fastrr is operational (`1`), or `false` if down (`0`).
 */
export async function checkFastrrUptime(): Promise<boolean> {
  if (typeof fetch === 'undefined') return true;
  try {
    const res = await fetch(FASTRR_UPTIME_URL, { method: 'GET' });
    if (!res.ok) return true;
    const data = await res.json();
    if (data === 0 || data?.status === 0 || Number(data?.status) === 0) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Mounts a hidden prefetch iframe (`https://fastrr-boost-ui.pickrr.com/?prefetch=true`)
 * once per browser session on non-iOS devices so the Fastrr checkout modal opens instantaneously.
 * Reverse-engineered from `shopify.js` bottom initializer.
 */
export function prefetchFastrrIframe(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return;
  if (document.getElementById('fastrr-prefetch-container')) return;

  const container = document.createElement('div');
  container.id = 'fastrr-prefetch-container';
  container.style.display = 'none';
  container.innerHTML = `<iframe id="prefetch-iframe" src="${FASTRR_BUYER_URL}?prefetch=true" style="width:0;height:0;border:0;"></iframe>`;
  document.body.appendChild(container);
}

export interface UseShiprocketCheckoutReturn {
  initiateCheckout: (
    request: CreateCheckoutSessionRequest,
    options?: {
      /** Automatically redirect or open Fastrr modal when mode === 'fastrr' (default: true) */
      autoLaunchFastrr?: boolean;
      /** Click event if needed by Fastrr HeadlessCheckout.addToCart */
      nativeEvent?: unknown;
      /** Callback invoked when the Fastrr modal closes or emits an event */
      onFastrrEvent?: (eventData: unknown) => void;
    }
  ) => Promise<CreateCheckoutSessionResponse | null>;
  session: CreateCheckoutSessionResponse | null;
  loading: boolean;
  error: string | null;
  reset: () => void;
}

export function useShiprocketCheckout(): UseShiprocketCheckoutReturn {
  const { apiBaseUrl, defaultCheckoutMode, headers } = useShiprocketConfig();
  const [session, setSession] = useState<CreateCheckoutSessionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initiateCheckout = useCallback(
    async (
      request: CreateCheckoutSessionRequest,
      options?: {
        autoLaunchFastrr?: boolean;
        nativeEvent?: unknown;
        onFastrrEvent?: (eventData: unknown) => void;
      }
    ): Promise<CreateCheckoutSessionResponse | null> => {
      setLoading(true);
      setError(null);

      try {
        let desiredMode = request.mode ?? defaultCheckoutMode;

        // Check Fastrr uptime circuit-breaker before launching Fastrr mode
        if (desiredMode === 'fastrr') {
          const isUp = await checkFastrrUptime();
          if (!isUp && request.buyer?.firstName) {
            desiredMode = 'builtin';
          }
        }

        const payload: CreateCheckoutSessionRequest = {
          ...request,
          mode: desiredMode,
        };

        const res = await fetch(`${apiBaseUrl}/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(headers || {}),
          },
          body: JSON.stringify(payload),
        });

        const data = (await res.json()) as CreateCheckoutSessionResponse;
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Checkout initialization failed');
        }

        setSession(data);

        if (
          data.mode === 'fastrr' &&
          data.fastrrSession &&
          (options?.autoLaunchFastrr ?? true) &&
          typeof window !== 'undefined'
        ) {
          const { scriptUrl, token, checkoutUrl, widgetUrl } = data.fastrrSession;
          try {
            await loadScriptOnce(scriptUrl);
            if (window.HeadlessCheckout?.addToCart) {
              window.HeadlessCheckout.addToCart(
                options?.nativeEvent ?? null,
                token,
                { fallbackUrl: checkoutUrl },
                options?.onFastrrEvent
              );
            } else {
              window.location.href = widgetUrl || checkoutUrl;
            }
          } catch {
            window.location.href = widgetUrl || checkoutUrl;
          }
        }

        return data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to complete checkout';
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, defaultCheckoutMode, headers]
  );

  const reset = useCallback(() => {
    setSession(null);
    setError(null);
    setLoading(false);
  }, []);

  return { initiateCheckout, session, loading, error, reset };
}
