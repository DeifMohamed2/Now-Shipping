import { render } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { extensionFetch, orderStatus, selectedOrderIds } from './api.js';

export default async () => {
  render(<Extension />, document.body);
};

const ZONE_MODE_SAME = 'same';
const ZONE_MODE_PER_ORDER = 'per_order';

function statusLabel(status) {
  switch (status) {
    case 'ready_import':
      return 'Ready to import';
    case 'in_now':
      return 'In Now — syncing to Shopify';
    case 'complete':
      return 'Up to date';
    case 'no_address':
      return 'No shipping address';
    default:
      return 'Unknown';
  }
}

function Extension() {
  const { close, data, i18n } = shopify;
  const orderIds = useMemo(() => selectedOrderIds(data), [data]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [governorates, setGovernorates] = useState([]);
  const [zoneMode, setZoneMode] = useState(ZONE_MODE_SAME);
  const [govKey, setGovKey] = useState('');
  const [zoneValue, setZoneValue] = useState('');
  const [perOrderZones, setPerOrderZones] = useState({});
  const [importCount, setImportCount] = useState(0);
  const [view, setView] = useState('form');

  const readyImport = useMemo(
    () => orders.filter((o) => orderStatus(o) === 'ready_import'),
    [orders]
  );
  const alreadyInNow = useMemo(
    () => orders.filter((o) => ['in_now', 'complete'].includes(orderStatus(o))),
    [orders]
  );
  const blocked = useMemo(
    () => orders.filter((o) => orderStatus(o) === 'no_address'),
    [orders]
  );

  const selectedGov = useMemo(
    () => governorates.find((g) => g.key === govKey) || null,
    [governorates, govKey]
  );

  const applySameZoneToReadyOrders = useCallback(
    (nextGovKey, nextZoneValue) => {
      if (!nextGovKey || !nextZoneValue) return;
      setPerOrderZones((prev) => {
        const next = { ...prev };
        for (const o of readyImport) {
          next[o.id] = { govKey: nextGovKey, zoneValue: nextZoneValue };
        }
        return next;
      });
    },
    [readyImport]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!orderIds.length) {
        if (!cancelled) {
          setLoading(false);
          setView('empty');
        }
        return;
      }

      if (!cancelled) {
        setLoading(true);
        setError(null);
        setView('form');
      }

      try {
        const [ordersData, zonesData] = await Promise.all([
          extensionFetch(`/shopify-orders/by-ids?ids=${encodeURIComponent(orderIds.join(','))}`),
          extensionFetch('/zones'),
        ]);
        if (cancelled) return;

        const rows = ordersData.orders || [];
        setOrders(rows);
        setGovernorates(zonesData.governorates || []);
        const zones = {};
        for (const o of rows) {
          zones[o.id] = { govKey: '', zoneValue: '' };
        }
        setPerOrderZones(zones);
        const ready = rows.filter((o) => orderStatus(o) === 'ready_import');
        setView(ready.length ? 'form' : 'empty');
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'load_failed');
          setView('empty');
        }
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [orderIds.join(',')]);

  const handleGovChange = useCallback(
    (value) => {
      setGovKey(value);
      setZoneValue('');
      if (zoneMode === ZONE_MODE_SAME) {
        setPerOrderZones((prev) => {
          const next = { ...prev };
          for (const o of readyImport) {
            next[o.id] = { govKey: value, zoneValue: '' };
          }
          return next;
        });
      }
    },
    [zoneMode, readyImport]
  );

  const handleZoneChange = useCallback(
    (value) => {
      setZoneValue(value);
      if (zoneMode === ZONE_MODE_SAME) {
        applySameZoneToReadyOrders(govKey, value);
      }
    },
    [zoneMode, govKey, applySameZoneToReadyOrders]
  );

  const handlePerOrderGovChange = useCallback((orderId, value) => {
    setPerOrderZones((prev) => ({
      ...prev,
      [orderId]: { govKey: value, zoneValue: '' },
    }));
  }, []);

  const handlePerOrderZoneChange = useCallback((orderId, value) => {
    setPerOrderZones((prev) => ({
      ...prev,
      [orderId]: { ...prev[orderId], zoneValue: value },
    }));
  }, []);

  const handleModeChange = useCallback(
    (value) => {
      setZoneMode(value);
      if (value === ZONE_MODE_SAME && govKey && zoneValue) {
        applySameZoneToReadyOrders(govKey, zoneValue);
      }
    },
    [govKey, zoneValue, applySameZoneToReadyOrders]
  );

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  const handleImport = useCallback(async () => {
    setError(null);
    if (!readyImport.length) return;

    const payloadOrders = [];
    for (const o of readyImport) {
      const z = perOrderZones[o.id] || {};
      const g = governorates.find((gov) => gov.key === z.govKey);
      if (!g || !z.zoneValue) {
        setError(`Select governorate and zone for ${o.name}`);
        return;
      }
      payloadOrders.push({
        shopifyOrderId: o.id,
        government: g.label,
        zone: z.zoneValue,
      });
    }

    setSubmitting(true);
    try {
      let count = 0;
      if (payloadOrders.length === 1) {
        await extensionFetch('/import-order', {
          method: 'POST',
          body: {
            shopifyOrderId: payloadOrders[0].shopifyOrderId,
            government: payloadOrders[0].government,
            zone: payloadOrders[0].zone,
          },
        });
        count = 1;
      } else {
        const result = await extensionFetch('/bulk-import', {
          method: 'POST',
          body: { orders: payloadOrders },
        });
        count = (result.results || []).filter((r) => r.ok).length;
      }
      setImportCount(count);
      setView('done');
    } catch (e) {
      setError(e.message || 'import_failed');
    } finally {
      setSubmitting(false);
    }
  }, [readyImport, perOrderZones, governorates]);

  const handlePrimaryAction = useCallback(() => {
    if (view === 'done' || view === 'empty') {
      handleClose();
      return;
    }
    if (view === 'form') {
      if (readyImport.length > 0) {
        handleImport();
      } else {
        handleClose();
      }
    }
  }, [view, readyImport.length, handleClose, handleImport]);

  const primaryLabel = useMemo(() => {
    if (submitting) return 'Importing…';
    if (view === 'done') return 'Done';
    if (view === 'empty' || !readyImport.length) return 'Close';
    return `Import ${readyImport.length} order${readyImport.length === 1 ? '' : 's'}`;
  }, [submitting, view, readyImport.length]);

  const showSecondary = view === 'form' && readyImport.length > 0;
  const primaryDisabled = submitting;

  const heading = i18n.translate('name');

  return (
    <s-admin-action heading={heading}>
      {loading ? (
        <s-text>
          Loading {orderIds.length} order{orderIds.length === 1 ? '' : 's'}…
        </s-text>
      ) : null}

      {!loading && !orderIds.length ? (
        <s-banner tone="warning">No orders selected.</s-banner>
      ) : null}

      {!loading && view === 'done' ? (
        <s-banner tone="success" dismissible={false}>
          {importCount > 0
            ? `${importCount} order${importCount === 1 ? '' : 's'} imported into Now. Fulfillment and tracking will sync to Shopify automatically.`
            : 'Done. Fulfillment syncs to Shopify automatically.'}
        </s-banner>
      ) : null}

      {!loading && view === 'empty' && error ? (
        <s-banner tone="critical">{error}</s-banner>
      ) : null}

      {!loading && view === 'empty' && !error && orders.length === 0 && orderIds.length > 0 ? (
        <s-banner tone="critical">Could not load selected orders.</s-banner>
      ) : null}

      {!loading && view === 'empty' && !error && orderIds.length === 0 ? (
        <s-banner tone="warning">No orders selected.</s-banner>
      ) : null}

      {!loading && view === 'form' && orders.length > 0 ? (
        <>
          {error ? (
            <s-banner tone="critical" dismissible={false}>
              {error}
            </s-banner>
          ) : null}

          {alreadyInNow.length > 0 ? (
            <s-banner tone="info" dismissible={false}>
              {alreadyInNow.length} order{alreadyInNow.length === 1 ? ' is' : 's are'} already in Now.
              Fulfillment and tracking sync to Shopify automatically.
            </s-banner>
          ) : null}

          {blocked.length > 0 ? (
            <s-banner tone="warning" dismissible={false}>
              {blocked.length} order{blocked.length === 1 ? '' : 's'} cannot be delivered (missing shipping
              address).
            </s-banner>
          ) : null}

          {readyImport.length > 0 ? (
            <s-section heading="Delivery zones">
              <s-stack gap="base">
                <s-select label="Zone assignment" value={zoneMode} onChange={(e) => handleModeChange(e.currentTarget.value)}>
                  <s-option value={ZONE_MODE_SAME}>Same zone for all orders</s-option>
                  <s-option value={ZONE_MODE_PER_ORDER}>Different zone per order</s-option>
                </s-select>

                {zoneMode === ZONE_MODE_SAME ? (
                  <>
                    <s-text tone="subdued">
                      Choose one governorate and zone for all {readyImport.length} order
                      {readyImport.length === 1 ? '' : 's'}.
                    </s-text>
                    <s-select label="Governorate" value={govKey} onChange={(e) => handleGovChange(e.currentTarget.value)}>
                      <s-option value="">Select governorate</s-option>
                      {governorates.map((g) => (
                        <s-option key={g.key} value={g.key}>
                          {g.label}
                        </s-option>
                      ))}
                    </s-select>
                    <s-select
                      label="Zone"
                      value={zoneValue}
                      disabled={!selectedGov}
                      onChange={(e) => handleZoneChange(e.currentTarget.value)}
                    >
                      <s-option value="">Select zone</s-option>
                      {(selectedGov?.areas || []).map((a) => (
                        <s-option key={a.value} value={a.value}>
                          {a.labelEn || a.value}
                        </s-option>
                      ))}
                    </s-select>
                  </>
                ) : (
                  <s-text tone="subdued">Set governorate and zone for each order below.</s-text>
                )}
              </s-stack>
            </s-section>
          ) : null}

          <s-section heading="Selected orders">
            <s-stack gap="base">
              {orders.map((o) => {
                const status = orderStatus(o);
                const isReady = status === 'ready_import';
                const rowZone = perOrderZones[o.id] || { govKey: '', zoneValue: '' };
                const rowGov = governorates.find((g) => g.key === rowZone.govKey) || null;

                return (
                  <s-box key={o.id} padding="base" borderWidth="base" borderRadius="base">
                    <s-stack gap="small">
                      <s-text type="strong">{o.name}</s-text>
                      <s-text tone="subdued">
                        {o.customerName || '—'} · {o.addressSummary || '—'}
                      </s-text>
                      <s-text>{statusLabel(status)}</s-text>
                      {o.nowOrderNumber ? <s-text>Now tracking: #{o.nowOrderNumber}</s-text> : null}

                      {isReady && zoneMode === ZONE_MODE_PER_ORDER ? (
                        <s-stack gap="small">
                          <s-select
                            label={`Governorate — ${o.name}`}
                            value={rowZone.govKey}
                            onChange={(e) => handlePerOrderGovChange(o.id, e.currentTarget.value)}
                          >
                            <s-option value="">Select governorate</s-option>
                            {governorates.map((g) => (
                              <s-option key={g.key} value={g.key}>
                                {g.label}
                              </s-option>
                            ))}
                          </s-select>
                          <s-select
                            label={`Zone — ${o.name}`}
                            value={rowZone.zoneValue}
                            disabled={!rowGov}
                            onChange={(e) => handlePerOrderZoneChange(o.id, e.currentTarget.value)}
                          >
                            <s-option value="">Select zone</s-option>
                            {(rowGov?.areas || []).map((a) => (
                              <s-option key={a.value} value={a.value}>
                                {a.labelEn || a.value}
                              </s-option>
                            ))}
                          </s-select>
                        </s-stack>
                      ) : null}

                      {isReady && zoneMode === ZONE_MODE_SAME && rowZone.govKey && rowZone.zoneValue ? (
                        <s-text tone="subdued">
                          Zone: {governorates.find((g) => g.key === rowZone.govKey)?.label || rowZone.govKey} —{' '}
                          {rowZone.zoneValue}
                        </s-text>
                      ) : null}
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          </s-section>
        </>
      ) : null}

      {!loading && view === 'empty' && orders.length > 0 && readyImport.length === 0 ? (
        <>
          {alreadyInNow.length > 0 ? (
            <s-banner tone="info" dismissible={false}>
              {alreadyInNow.length} order{alreadyInNow.length === 1 ? ' is' : 's are'} already in Now. Fulfillment
              syncs automatically.
            </s-banner>
          ) : null}
          {blocked.length > 0 ? (
            <s-banner tone="warning" dismissible={false}>
              {blocked.length} order{blocked.length === 1 ? '' : 's'} cannot be delivered.
            </s-banner>
          ) : null}
        </>
      ) : null}

      <s-button slot="primary-action" onClick={handlePrimaryAction} disabled={primaryDisabled}>
        {primaryLabel}
      </s-button>
      {showSecondary ? (
        <s-button slot="secondary-actions" onClick={handleClose} disabled={submitting}>
          Cancel
        </s-button>
      ) : null}
    </s-admin-action>
  );
}
