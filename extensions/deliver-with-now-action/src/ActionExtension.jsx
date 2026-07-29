import { render } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { extensionFetch, orderStatus, selectedOrderIds } from './api.js';

export default async () => {
  render(<Extension />, document.body);
};

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
  const [govKey, setGovKey] = useState('');
  const [zoneValue, setZoneValue] = useState('');
  const [perOrderZones, setPerOrderZones] = useState({});
  const [done, setDone] = useState(false);
  const [importCount, setImportCount] = useState(0);

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!orderIds.length) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
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
      } catch (e) {
        if (!cancelled) setError(e.message || 'load_failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orderIds.join(',')]);

  const applySameZoneToAll = useCallback(() => {
    if (!govKey || !zoneValue) return;
    setPerOrderZones((prev) => {
      const next = { ...prev };
      for (const o of readyImport) {
        next[o.id] = { govKey, zoneValue };
      }
      return next;
    });
  }, [govKey, zoneValue, readyImport]);

  const handleImport = useCallback(async () => {
    setError(null);
    if (!readyImport.length) {
      close();
      return;
    }

    const payloadOrders = [];
    for (const o of readyImport) {
      const z = perOrderZones[o.id] || {};
      const g = governorates.find((g) => g.key === z.govKey);
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
      setDone(true);
    } catch (e) {
      setError(e.message || 'import_failed');
    } finally {
      setSubmitting(false);
    }
  }, [readyImport, perOrderZones, governorates, close]);

  if (!orderIds.length) {
    return (
      <s-admin-action heading={i18n.translate('name')}>
        <s-banner tone="warning">No orders selected.</s-banner>
        <s-button slot="secondary-actions" onClick={close}>
          Close
        </s-button>
      </s-admin-action>
    );
  }

  if (loading) {
    return (
      <s-admin-action heading={i18n.translate('name')}>
        <s-text>Loading {orderIds.length} order{orderIds.length === 1 ? '' : 's'}…</s-text>
      </s-admin-action>
    );
  }

  if (done) {
    return (
      <s-admin-action heading={i18n.translate('name')}>
        <s-banner tone="success" dismissible={false}>
          {importCount > 0
            ? `${importCount} order${importCount === 1 ? '' : 's'} imported into Now. Fulfillment and tracking will sync to Shopify automatically.`
            : 'Done. Fulfillment syncs to Shopify automatically.'}
        </s-banner>
        <s-button slot="primary-action" onClick={close}>
          Done
        </s-button>
      </s-admin-action>
    );
  }

  if (!orders.length) {
    return (
      <s-admin-action heading={i18n.translate('name')}>
        <s-banner tone="critical">{error || 'Could not load selected orders.'}</s-banner>
        <s-button slot="secondary-actions" onClick={close}>
          Close
        </s-button>
      </s-admin-action>
    );
  }

  const canImport = readyImport.length > 0;
  const primaryLabel = canImport
    ? `Import ${readyImport.length} order${readyImport.length === 1 ? '' : 's'}`
    : 'Close';

  return (
    <s-admin-action heading={i18n.translate('name')}>
      {error ? (
        <s-banner tone="critical" dismissible={false}>
          {error}
        </s-banner>
      ) : null}

      <s-section heading="Selected orders">
        <s-stack gap="base">
          {orders.map((o) => (
            <s-box key={o.id} padding="base" borderWidth="base" borderRadius="base">
              <s-stack gap="small">
                <s-text type="strong">{o.name}</s-text>
                <s-text tone="subdued">
                  {o.customerName || '—'} · {o.addressSummary || '—'}
                </s-text>
                <s-text>{statusLabel(orderStatus(o))}</s-text>
                {o.nowOrderNumber ? <s-text>Now tracking: #{o.nowOrderNumber}</s-text> : null}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      {alreadyInNow.length > 0 ? (
        <s-banner tone="info" dismissible={false}>
          {alreadyInNow.length} order{alreadyInNow.length === 1 ? ' is' : 's are'} already in Now.
          Fulfillment and tracking sync to Shopify automatically — no action needed.
        </s-banner>
      ) : null}

      {blocked.length > 0 ? (
        <s-banner tone="warning" dismissible={false}>
          {blocked.length} order{blocked.length === 1 ? '' : 's'} cannot be delivered (missing shipping address).
        </s-banner>
      ) : null}

      {canImport ? (
        <s-section heading="Delivery zones">
          <s-stack gap="base">
            <s-text tone="subdued">
              Assign governorate and zone for {readyImport.length} order
              {readyImport.length === 1 ? '' : 's'}. Tracking syncs to Shopify automatically after import.
            </s-text>
            <s-select
              label="Governorate (all orders)"
              value={govKey}
              onChange={(e) => {
                setGovKey(e.currentTarget.value);
                setZoneValue('');
              }}
            >
              <s-option value="">Select governorate</s-option>
              {governorates.map((g) => (
                <s-option key={g.key} value={g.key}>
                  {g.label}
                </s-option>
              ))}
            </s-select>
            <s-select
              label="Zone (all orders)"
              value={zoneValue}
              disabled={!selectedGov}
              onChange={(e) => setZoneValue(e.currentTarget.value)}
            >
              <s-option value="">Select zone</s-option>
              {(selectedGov?.areas || []).map((a) => (
                <s-option key={a.value} value={a.value}>
                  {a.labelEn || a.value}
                </s-option>
              ))}
            </s-select>
            <s-button disabled={!govKey || !zoneValue} onClick={applySameZoneToAll}>
              Apply zone to all orders
            </s-button>
          </s-stack>
        </s-section>
      ) : null}

      <s-button
        slot="primary-action"
        onClick={canImport ? handleImport : close}
        disabled={submitting}
      >
        {submitting ? 'Importing…' : primaryLabel}
      </s-button>
      <s-button slot="secondary-actions" onClick={close} disabled={submitting}>
        Cancel
      </s-button>
    </s-admin-action>
  );
}
