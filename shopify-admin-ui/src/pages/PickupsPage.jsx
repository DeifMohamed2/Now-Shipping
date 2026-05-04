import React, { useCallback, useEffect, useState } from 'react';
import { useAppBridge } from '@shopify/app-bridge-react';
import { authFetch } from '../authFetch.js';
import {
  Page,
  BlockStack,
  Text,
  Button,
  Banner,
  Spinner,
  IndexTable,
  Badge,
} from '@shopify/polaris';

export function PickupsPage() {
  const app = useAppBridge();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pickups, setPickups] = useState([]);
  const [total, setTotal] = useState(0);
  const [portals, setPortals] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await authFetch(app, '/api/shopify/app/pickups?limit=30&page=1');
      setPickups(data.pickups || []);
      setTotal(data.total || 0);
      setPortals(data.portals || null);
    } catch (e) {
      setError(e.message || 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [app]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && pickups.length === 0) {
    return (
      <Page fullWidth title="Pickups" subtitle="Pickup runs from Now">
        <BlockStack gap="400" inlineAlign="center">
          <Spinner accessibilityLabel="Loading pickups" size="large" />
          <Text as="p" tone="subdued">
            Loading pickups…
          </Text>
        </BlockStack>
      </Page>
    );
  }

  return (
    <Page fullWidth title="Pickups" subtitle="Schedule and manage pickups in the Now portal">
      <BlockStack gap="500">
        {error ? (
          <Banner tone="critical" title="Could not load pickups">
            <p>{error}</p>
          </Banner>
        ) : null}

        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            Showing {pickups.length} of {total} pickups. Create or edit pickups in Now (not in this embedded view).
          </Text>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button onClick={load} loading={loading}>
              Refresh
            </Button>
            {portals?.pickups ? (
              <Button url={portals.pickups} external variant="primary">
                Manage pickups in Now
              </Button>
            ) : null}
          </div>
          {pickups.length === 0 ? (
            <Text as="p" tone="subdued">
              No pickups yet. Open Now to schedule a pickup from your business account.
            </Text>
          ) : (
            <IndexTable
                resourceName={{ singular: 'pickup', plural: 'pickups' }}
                itemCount={pickups.length}
                headings={[
                  { title: 'Pickup #' },
                  { title: 'Status' },
                  { title: 'Orders' },
                  { title: 'Phone' },
                  { title: 'Location' },
                  { title: 'Date' },
                ]}
                selectable={false}
              >
                {pickups.map((row, index) => (
                  <IndexTable.Row id={row.id} key={row.id} position={index}>
                    <IndexTable.Cell>
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        {row.pickupNumber}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone="attention">{row.status}</Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.numberOfOrders}</IndexTable.Cell>
                    <IndexTable.Cell>{row.phoneNumber || '—'}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" truncate>
                        {(row.pickupLocation || '—').slice(0, 48)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {row.pickupDate ? new Date(row.pickupDate).toLocaleString() : '—'}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
          )}
        </BlockStack>
      </BlockStack>
    </Page>
  );
}
