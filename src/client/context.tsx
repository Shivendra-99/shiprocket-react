import React, { createContext, useContext, useMemo } from 'react';
import type { CheckoutMode } from '../types/index.js';

export interface ShiprocketContextValue {
  /** Base URL of your backend proxy route (defaults to "/api/shiprocket") */
  apiBaseUrl: string;
  /** Default checkout mode ("builtin" or "fastrr") */
  defaultCheckoutMode: CheckoutMode;
  /** Default pickup pincode if not set on the server */
  defaultPickupPincode?: string;
  /** Custom headers to attach to backend requests (e.g. user auth token) */
  headers?: Record<string, string>;
}

export interface ShiprocketProviderProps extends Partial<ShiprocketContextValue> {
  children: React.ReactNode;
}

const ShiprocketContext = createContext<ShiprocketContextValue>({
  apiBaseUrl: '/api/shiprocket',
  defaultCheckoutMode: 'builtin',
});

export const ShiprocketProvider: React.FC<ShiprocketProviderProps> = ({
  apiBaseUrl = '/api/shiprocket',
  defaultCheckoutMode = 'builtin',
  defaultPickupPincode,
  headers,
  children,
}) => {
  const value = useMemo<ShiprocketContextValue>(
    () => ({
      apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
      defaultCheckoutMode,
      defaultPickupPincode,
      headers,
    }),
    [apiBaseUrl, defaultCheckoutMode, defaultPickupPincode, headers]
  );

  return <ShiprocketContext.Provider value={value}>{children}</ShiprocketContext.Provider>;
};

export function useShiprocketConfig(): ShiprocketContextValue {
  return useContext(ShiprocketContext);
}
