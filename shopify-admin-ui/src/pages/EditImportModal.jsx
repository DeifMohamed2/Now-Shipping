import React, { useCallback, useEffect, useState } from 'react';
import { Modal, BlockStack, Text, Banner, Spinner, TextField } from '@shopify/polaris';
import { authFetch } from '../authFetch.js';
import { ZonePickerFields } from '../components/ZonePickerFields.jsx';

function buildInitialForm(order) {
  const addr = order?.shipping_address;
  if (!addr || typeof addr !== 'object') {
    return {
      fullName: '',
      phoneNumber: '',
      otherPhoneNumber: '',
      address: '',
    };
  }
  const fullName = [addr.first_name, addr.last_name].filter(Boolean).join(' ').trim() || addr.name || '';
  const address = [addr.address1, addr.address2].filter(Boolean).join(', ');
  return {
    fullName,
    phoneNumber: addr.phone ? String(addr.phone) : '',
    otherPhoneNumber: '',
    address,
  };
}

/**
 * Edit customer + governorate/zone, then import a single Shopify order into Now.
 */
export function EditImportModal({ open, onClose, app, order, onSuccess }) {
  const [loadingZones, setLoadingZones] = useState(false);
  const [zonesError, setZonesError] = useState(null);
  const [governorates, setGovernorates] = useState([]);
  const [govKey, setGovKey] = useState('');
  const [zoneValue, setZoneValue] = useState('');
  const [form, setForm] = useState(() => buildInitialForm(null));
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
    if (open && order) {
      loadZones();
      setForm(buildInitialForm(order));
      setGovKey('');
      setZoneValue('');
      setSubmitError(null);
    }
  }, [open, order, loadZones]);

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!order?.id) return;
    if (!govKey || !zoneValue) {
      setSubmitError('Please select governorate and zone.');
      return;
    }
    if (!String(form.fullName || '').trim()) {
      setSubmitError('Customer name is required.');
      return;
    }
    if (!String(form.address || '').trim()) {
      setSubmitError('Address is required.');
      return;
    }
    setSubmitting(true);
    try {
      await authFetch(app, '/api/shopify/app/import-order', {
        method: 'POST',
        body: JSON.stringify({
          shopifyOrderId: order.id,
          government: govKey,
          zone: zoneValue,
          fullName: String(form.fullName).trim(),
          phoneNumber: String(form.phoneNumber || '').trim(),
          otherPhoneNumber: form.otherPhoneNumber != null ? String(form.otherPhoneNumber).trim() : '',
          address: String(form.address).trim(),
        }),
      });
      onSuccess?.();
      onClose();
    } catch (e) {
      setSubmitError(e.message || 'import_failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!order) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit & import ${order.name || ''}`}
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
          {loadingZones ? <Spinner accessibilityLabel="Loading zones" size="small" /> : null}
          <Text as="p" tone="subdued">
            Review and correct customer details before creating the Now delivery order.
          </Text>
          <TextField label="Full name" value={form.fullName} onChange={(v) => setForm((f) => ({ ...f, fullName: v }))} autoComplete="name" />
          <TextField
            label="Phone"
            type="tel"
            value={form.phoneNumber}
            onChange={(v) => setForm((f) => ({ ...f, phoneNumber: v }))}
            autoComplete="tel"
          />
          <TextField
            label="Other phone (optional)"
            type="tel"
            value={form.otherPhoneNumber}
            onChange={(v) => setForm((f) => ({ ...f, otherPhoneNumber: v }))}
            autoComplete="tel"
          />
          <TextField
            label="Address"
            value={form.address}
            onChange={(v) => setForm((f) => ({ ...f, address: v }))}
            multiline={3}
            autoComplete="street-address"
          />
          <ZonePickerFields
            governorates={governorates}
            govKey={govKey}
            zoneValue={zoneValue}
            onGovChange={setGovKey}
            onZoneChange={setZoneValue}
            disabled={loadingZones}
          />
        </BlockStack>
        </div>
      </Modal.Section>
    </Modal>
  );
}
