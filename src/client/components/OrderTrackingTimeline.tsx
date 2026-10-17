import React, { useState } from 'react';
import { useOrderTracking } from '../hooks/useOrderTracking.js';

export interface OrderTrackingTimelineProps {
  /** Pre-filled AWB code */
  awb?: string;
  /** Pre-filled Order ID */
  orderId?: string;
  /** Automatically fetch tracking info on mount if awb or orderId is passed (default: true) */
  autoFetch?: boolean;
  /** Show search input bar so customers can enter their own AWB/Order ID (default: true) */
  showSearchInput?: boolean;
  /** Optional custom className */
  className?: string;
}

export const OrderTrackingTimeline: React.FC<OrderTrackingTimelineProps> = ({
  awb: initialAwb = '',
  orderId: initialOrderId = '',
  autoFetch = true,
  showSearchInput = true,
  className,
}) => {
  const [searchValue, setSearchValue] = useState(initialAwb || initialOrderId);
  const [searchMode, setSearchMode] = useState<'awb' | 'orderId'>(
    initialOrderId && !initialAwb ? 'orderId' : 'awb'
  );

  const { track, data, loading, error } = useOrderTracking({
    awb: initialAwb || undefined,
    orderId: initialOrderId || undefined,
    autoFetch,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchValue.trim()) return;
    if (searchMode === 'awb') {
      void track({ awb: searchValue.trim(), orderId: undefined });
    } else {
      void track({ orderId: searchValue.trim(), awb: undefined });
    }
  };

  return (
    <div
      className={className}
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '540px',
        border: '1px solid #e5e7eb',
        borderRadius: '12px',
        padding: '16px',
        backgroundColor: '#ffffff',
      }}
    >
      {showSearchInput && (
        <form
          onSubmit={handleSearch}
          style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}
        >
          <select
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value as 'awb' | 'orderId')}
            style={{
              padding: '9px 10px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              fontSize: '13px',
              backgroundColor: '#f9fafb',
            }}
          >
            <option value="awb">AWB Number</option>
            <option value="orderId">Order ID</option>
          </select>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={searchMode === 'awb' ? 'Enter AWB Number' : 'Enter Order ID'}
            style={{
              flex: 1,
              minWidth: '160px',
              padding: '9px 12px',
              borderRadius: '8px',
              border: '1px solid #d1d5db',
              fontSize: '14px',
            }}
          />
          <button
            type="submit"
            disabled={loading || !searchValue.trim()}
            style={{
              padding: '9px 16px',
              borderRadius: '8px',
              border: 'none',
              backgroundColor: loading ? '#9ca3af' : '#111827',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Tracking...' : 'Track'}
          </button>
        </form>
      )}

      {error && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: '8px',
            backgroundColor: '#fef2f2',
            color: '#b91c1c',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      {data && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              paddingBottom: '12px',
              borderBottom: '1px solid #e5e7eb',
              marginBottom: '14px',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                {data.courierName || 'Courier Partner'} • AWB: {data.awbCode || 'N/A'}
              </div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginTop: '2px' }}>
                {data.currentStatus}
              </div>
              {(data.origin || data.destination) && (
                <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '2px' }}>
                  {data.origin || 'Origin'} → {data.destination || 'Destination'}
                </div>
              )}
            </div>
            {data.etd && (
              <div
                style={{
                  backgroundColor: '#eef2ff',
                  color: '#4338ca',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                ETA: {data.etd}
              </div>
            )}
          </div>

          {data.scans.length > 0 ? (
            <div style={{ position: 'relative', paddingLeft: '18px' }}>
              {data.scans.map((scan, idx) => (
                <div
                  key={`${scan.date}-${idx}`}
                  style={{
                    position: 'relative',
                    paddingBottom: idx === data.scans.length - 1 ? '0' : '16px',
                    borderLeft: idx === data.scans.length - 1 ? 'none' : '2px solid #e5e7eb',
                    paddingLeft: '14px',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: '-6px',
                      top: '3px',
                      width: '10px',
                      height: '10px',
                      borderRadius: '50%',
                      backgroundColor: idx === 0 ? '#4f46e5' : '#9ca3af',
                    }}
                  />
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#1f2937' }}>
                    {scan.activity || scan.status}
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px' }}>
                    {scan.location} • {scan.date}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '13px', color: '#6b7280' }}>
              Shipment registered. Scan activity will appear once picked up by the courier.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
