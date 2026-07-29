import React from 'react';
import {
  BlockStack,
  Text,
  ChoiceList,
  Button,
  Card,
  InlineStack,
  Divider,
  Spinner,
  Banner,
} from '@shopify/polaris';
import { ZonePickerFields } from './ZonePickerFields.jsx';

const EMPTY_ZONE = { govKey: '', zoneValue: '' };

/**
 * Zone assignment UI shared by the import modal and deliver wizard.
 */
export function DeliverZoneAssignment({
  orders,
  governorates,
  loadingZones,
  zonesError,
  mode,
  setMode,
  govKey,
  setGovKey,
  zoneValue,
  setZoneValue,
  perOrderZones,
  setOrderZone,
  applySameZoneToAll,
  copyFirstOrderZoneToAll,
  showOrderList = true,
}) {
  const orderList = orders || [];
  const isBulk = orderList.length > 1;

  return (
    <BlockStack gap="400">
      {zonesError ? (
        <Banner tone="critical" title="Could not load zones">
          <p>{zonesError}</p>
        </Banner>
      ) : null}
      {loadingZones ? <Spinner accessibilityLabel="Loading zones" size="small" /> : null}

      {isBulk ? (
        <ChoiceList
          title="How should delivery zones be assigned?"
          choices={[
            {
              label: 'Same governorate & zone for all orders',
              value: 'same',
              helpText: 'Best when every order delivers to the same area.',
            },
            {
              label: 'Different zone per order',
              value: 'individual',
              helpText: 'Set governorate and zone separately for each order.',
            },
          ]}
          selected={[mode]}
          onChange={([v]) => setMode(v)}
        />
      ) : (
        <Text as="p" tone="subdued">
          Select the Now governorate and delivery zone for this shipment.
        </Text>
      )}

      {mode === 'same' || !isBulk ? (
        <BlockStack gap="400">
          {isBulk && showOrderList ? (
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                Orders in this batch
              </Text>
              <div className="now-import-order-list">
                {orderList.map((o) => (
                  <Text key={o.id} as="p" variant="bodyMd">
                    <strong>{o.name}</strong> — {o.customerName || '—'} · {o.addressSummary || '—'}
                  </Text>
                ))}
              </div>
            </BlockStack>
          ) : null}
          <ZonePickerFields
            governorates={governorates}
            govKey={govKey}
            zoneValue={zoneValue}
            onGovChange={setGovKey}
            onZoneChange={setZoneValue}
            disabled={loadingZones}
          />
          {isBulk && mode === 'same' ? (
            <Button variant="plain" onClick={() => setMode('individual')}>
              Need different zones? Switch to per-order mode
            </Button>
          ) : null}
        </BlockStack>
      ) : (
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center" gap="300">
            <Text as="p" tone="subdued">
              Set governorate and zone for each order, or copy the first row to all.
            </Text>
            <Button size="slim" onClick={() => copyFirstOrderZoneToAll(orderList)}>
              Copy first zone to all
            </Button>
          </InlineStack>
          <div className="now-import-per-order-list">
            {orderList.map((o, index) => {
              const z = perOrderZones[o.id] || EMPTY_ZONE;
              return (
                <Card key={o.id} padding="400">
                  <BlockStack gap="300">
                    <Text as="p" variant="headingSm">
                      {index + 1}. {o.name} — {o.customerName || '—'}
                    </Text>
                    <Text as="p" tone="subdued" variant="bodySm">
                      {o.addressSummary || '—'}
                    </Text>
                    <ZonePickerFields
                      governorates={governorates}
                      govKey={z.govKey}
                      zoneValue={z.zoneValue}
                      onGovChange={(v) => setOrderZone(o.id, { govKey: v, zoneValue: '' })}
                      onZoneChange={(v) => setOrderZone(o.id, { zoneValue: v })}
                      disabled={loadingZones}
                    />
                  </BlockStack>
                </Card>
              );
            })}
          </div>
          <Divider />
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Quick fill: same zone for everyone
            </Text>
            <ZonePickerFields
              governorates={governorates}
              govKey={govKey}
              zoneValue={zoneValue}
              onGovChange={setGovKey}
              onZoneChange={setZoneValue}
              disabled={loadingZones}
              govLabel="Governorate (quick fill)"
              zoneLabel="Zone / area (quick fill)"
            />
            <Button disabled={!govKey || !zoneValue} onClick={() => applySameZoneToAll(orderList)}>
              Apply this zone to all {orderList.length} orders
            </Button>
          </BlockStack>
        </BlockStack>
      )}
    </BlockStack>
  );
}
