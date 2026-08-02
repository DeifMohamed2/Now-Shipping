import React, { useEffect } from 'react';
import { Modal, BlockStack, Banner } from '@shopify/polaris';
import { authFetch } from '../authFetch.js';
import { DeliverZoneAssignment } from '../components/DeliverZoneAssignment.jsx';
import { useDeliverZones } from '../hooks/useDeliverZones.js';

/**
 * Import selected Shopify orders into Now with merchant-chosen governorate + zone.
 */
export function ImportOrderModal({ open, onClose, app, orders, onSuccess }) {
  const orderList = orders || [];
  const isBulk = orderList.length > 1;
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(null);

  const zones = useDeliverZones(app, { enabled: open });
  const { resetZones, buildImportPayload, ...zoneFields } = zones;

  useEffect(() => {
    if (open) {
      resetZones(orderList);
      setSubmitError(null);
    }
  }, [open, orderList, resetZones]);

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!orderList.length) return;

    const built = buildImportPayload(orderList);
    if (!built.ok) {
      setSubmitError(built.error);
      return;
    }

    setSubmitting(true);
    try {
      let fulfillmentWarning = null;

      if (built.payloadOrders.length === 1) {
        const data = await authFetch(app, '/api/shopify/app/import-order', {
          method: 'POST',
          body: JSON.stringify({
            shopifyOrderId: built.payloadOrders[0].shopifyOrderId,
            government: built.payloadOrders[0].government,
            zone: built.payloadOrders[0].zone,
          }),
        });
        if (data.fulfillment && !data.fulfillment.synced) {
          fulfillmentWarning =
            data.fulfillment.needsReconnect
              ? 'Imported into Now but Shopify fulfillment failed. Reconnect your store in Now Shipping settings.'
              : `Imported into Now but Shopify fulfillment failed: ${data.fulfillment.reason || 'unknown'}`;
        }
      } else {
        const data = await authFetch(app, '/api/shopify/app/bulk-import', {
          method: 'POST',
          body: JSON.stringify({ orders: built.payloadOrders }),
        });
        const imported = (data.results || []).filter((r) => r.ok);
        const synced = imported.filter((r) => r.fulfillment?.synced);
        if (synced.length < imported.length) {
          fulfillmentWarning = `${imported.length - synced.length} order${imported.length - synced.length === 1 ? '' : 's'} imported but Shopify fulfillment failed. Reconnect your store in Now Shipping settings.`;
        }
      }

      if (fulfillmentWarning) {
        setSubmitError(fulfillmentWarning);
        return;
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
      size={isBulk && zones.mode === 'individual' ? 'large' : undefined}
      title={isBulk ? `Deliver with Now (${orderList.length} orders)` : 'Deliver with Now'}
      primaryAction={{
        content: isBulk ? `Import ${orderList.length} orders` : 'Import order',
        onAction: handleSubmit,
        loading: submitting,
        disabled: zones.loadingZones || !!zones.zonesError,
      }}
      secondaryActions={[{ content: 'Cancel', onAction: onClose }]}
    >
      <Modal.Section>
        <div className="now-zone-combobox-modal-section">
          <BlockStack gap="400">
            {submitError ? (
              <Banner tone="critical" title="Import failed">
                <p>{submitError}</p>
              </Banner>
            ) : null}
            <DeliverZoneAssignment
              orders={orderList}
              governorates={zones.governorates}
              loadingZones={zones.loadingZones}
              zonesError={zones.zonesError}
              mode={zones.mode}
              setMode={zones.setMode}
              govKey={zones.govKey}
              setGovKey={zones.setGovKey}
              zoneValue={zones.zoneValue}
              setZoneValue={zones.setZoneValue}
              perOrderZones={zones.perOrderZones}
              setOrderZone={zones.setOrderZone}
              applySameZoneToAll={zones.applySameZoneToAll}
              copyFirstOrderZoneToAll={zones.copyFirstOrderZoneToAll}
            />
          </BlockStack>
        </div>
      </Modal.Section>
    </Modal>
  );
}
