import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, BlockStack, Text, Select, Banner, Spinner } from '@shopify/polaris';
import { authFetch } from '../authFetch.js';
import { ZoneSearchCombobox } from '../components/ZoneSearchCombobox.jsx';

/**
 * Import selected Shopify orders into Now with merchant-chosen governorate + zone (required).
 * Uses one governorate/zone for all orders in the batch (typical bulk to same area).
 */
export function ImportOrderModal({ open, onClose, app, orders, onSuccess }) {
  const [loadingZones, setLoadingZones] = useState(false);
  const [zonesError, setZonesError] = useState(null);
  const [governorates, setGovernorates] = useState([]);
  const [govKey, setGovKey] = useState('');
  const [zoneValue, setZoneValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const loadZones = useCallback(async () => {
    setZonesError(null);
    setLoadingZones(true);
    try {
      const data = await authFetch(app, '/api/shopify/app/zones');
      setGovernorates(data.governorates || []);
    } catch (e) {
      setZonesError(e.message || 'zones_failed');
    } finally {
      setLoadingZones(false);
    }
  }, [app]);

  useEffect(() => {
    if (open) {
      loadZones();
      setGovKey('');
      setZoneValue('');
      setSubmitError(null);
    }
  }, [open, loadZones]);

  const govOptions = useMemo(
    () => [{ label: 'Select governorate…', value: '' }, ...governorates.map((g) => ({ label: g.label, value: g.key }))],
    [governorates]
  );

  const selectedGov = useMemo(() => governorates.find((g) => g.key === govKey), [governorates, govKey]);
  const zoneAreas = selectedGov?.areas || [];

  const handleGovChange = (v) => {
    setGovKey(v);
    setZoneValue('');
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!govKey || !zoneValue) {
      setSubmitError('Please select governorate and zone.');
      return;
    }
    if (!orders || !orders.length) return;
    setSubmitting(true);
    try {
      if (orders.length === 1) {
        await authFetch(app, '/api/shopify/app/import-order', {
          method: 'POST',
          body: JSON.stringify({
            shopifyOrderId: orders[0].id,
            government: govKey,
            zone: zoneValue,
          }),
        });
      } else {
        await authFetch(app, '/api/shopify/app/bulk-import', {
          method: 'POST',
          body: JSON.stringify({
            orders: orders.map((o) => ({
              shopifyOrderId: o.id,
              government: govKey,
              zone: zoneValue,
            })),
          }),
        });
      }
      onSuccess?.();
      onClose();
    } catch (e) {
      setSubmitError(e.message || 'import_failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={orders.length > 1 ? `Deliver with Now (${orders.length} orders)` : 'Deliver with Now'}
      primaryAction={{
        content: 'Import order',
        onAction: handleSubmit,
        loading: submitting,
        disabled: loadingZones || !!zonesError,
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <div className="now-zone-combobox-modal-section">
          <BlockStack gap="400">
          {zonesError ? (
            <Banner tone="critical" title="Could not load zones">
              <p>{zonesError}</p>
            </Banner>
          ) : null}
          {submitError ? (
            <Banner tone="critical" title="Import failed">
              <p>{submitError}</p>
            </Banner>
          ) : null}
          {loadingZones ? (
            <Spinner accessibilityLabel="Loading zones" size="small" />
          ) : null}
          <Text as="p" tone="subdued">
            Select the correct Now governorate and delivery zone. This applies to all selected orders.
          </Text>
          <BlockStack gap="200">
            {orders.slice(0, 8).map((o) => (
              <Text key={o.id} as="p" variant="bodyMd">
                <strong>{o.name}</strong> — {o.customerName || '—'} · {o.addressSummary || '—'}
              </Text>
            ))}
            {orders.length > 8 ? (
              <Text as="p" tone="subdued">
                …and {orders.length - 8} more
              </Text>
            ) : null}
          </BlockStack>
          <Select label="Governorate" options={govOptions} value={govKey} onChange={handleGovChange} />
          <ZoneSearchCombobox
            label="Zone / area"
            areas={zoneAreas}
            value={zoneValue}
            onChange={setZoneValue}
            disabled={!govKey}
          />
        </BlockStack>
        </div>
      </Modal.Section>
    </Modal>
  );
}
