import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppBridge } from '@shopify/app-bridge-react';
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  Banner,
  Spinner,
  Badge,
  ProgressBar,
  Divider,
} from '@shopify/polaris';
import { authFetch } from '../authFetch.js';
import { DeliverZoneAssignment } from '../components/DeliverZoneAssignment.jsx';
import { useDeliverZones } from '../hooks/useDeliverZones.js';
import { buildShopifyAppNavigateUrl } from '../utils/shopifyAppNavigate.js';
import { needsShopifyFulfillmentSync, orderDeliverStatus, parseAdminLinkOrderIds } from '../utils/shopifyOrderIds.js';

const STEPS = ['Review', 'Delivery zones', 'Complete'];

function statusBadge(status) {
  switch (status) {
    case 'ready_import':
      return <Badge tone="attention">Ready to import</Badge>;
    case 'needs_sync':
      return <Badge tone="info">Sync to Shopify</Badge>;
    case 'complete':
      return <Badge tone="success">Up to date</Badge>;
    case 'no_address':
      return <Badge tone="critical">No shipping address</Badge>;
    default:
      return <Badge>Unknown</Badge>;
  }
}

export function DeliverPage() {
  const app = useAppBridge();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [results, setResults] = useState(null);

  const orderIds = useMemo(() => {
    const fromSearch = parseAdminLinkOrderIds(`?${searchParams.toString()}`);
    return [...new Set(fromSearch)];
  }, [searchParams]);

  const {
    loadingZones,
    zonesError,
    governorates,
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
    buildImportPayload,
    resetZones,
  } = useDeliverZones(app, { enabled: true });

  const grouped = useMemo(() => {
    const readyImport = [];
    const needsSync = [];
    const complete = [];
    const blocked = [];
    for (const o of orders) {
      const s = orderDeliverStatus(o);
      if (s === 'ready_import') readyImport.push(o);
      else if (s === 'needs_sync') needsSync.push(o);
      else if (s === 'complete') complete.push(o);
      else blocked.push(o);
    }
    return { readyImport, needsSync, complete, blocked };
  }, [orders]);

  const loadOrders = useCallback(async () => {
    if (!orderIds.length) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await authFetch(
        app,
        `/api/shopify/app/shopify-orders/by-ids?ids=${encodeURIComponent(orderIds.join(','))}`
      );
      setOrders(data.orders || []);
      resetZones(data.orders || []);
    } catch (e) {
      setError(e.message || 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [app, orderIds, resetZones]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [step]);

  const runSyncOnly = useCallback(
    async (rows) => {
      if (!rows.length) return { synced: 0, results: [] };
      const data = await authFetch(app, '/api/shopify/app/bulk-sync-fulfillment', {
        method: 'POST',
        body: JSON.stringify({ shopifyOrderIds: rows.map((o) => o.id) }),
      });
      const synced = (data.results || []).filter((r) => r.ok).length;
      return { synced, results: data.results || [] };
    },
    [app]
  );

  const handleContinueFromReview = useCallback(async () => {
    setSubmitError(null);
    const { readyImport, needsSync, complete, blocked } = grouped;

    if (blocked.length && !readyImport.length && !needsSync.length) {
      setSubmitError('None of the selected orders can be delivered with Now.');
      return;
    }

    if (!readyImport.length && needsSync.length) {
      setSubmitting(true);
      try {
        const syncResult = await runSyncOnly(needsSync);
        setResults({
          imported: 0,
          synced: syncResult.synced,
          skipped: complete.length,
          blocked: blocked.length,
        });
        setStep(2);
        await loadOrders();
      } catch (e) {
        setSubmitError(e.message || 'sync_failed');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!readyImport.length) {
      setResults({
        imported: 0,
        synced: 0,
        skipped: complete.length,
        blocked: blocked.length,
      });
      setStep(2);
      return;
    }

    resetZones(readyImport);
    setStep(1);
  }, [grouped, runSyncOnly, loadOrders, resetZones]);

  const handleImport = useCallback(async () => {
    setSubmitError(null);
    const { readyImport, needsSync } = grouped;
    const built = buildImportPayload(readyImport);
    if (!built.ok) {
      setSubmitError(built.error);
      return;
    }

    setSubmitting(true);
    try {
      let importCount = 0;
      if (built.payloadOrders.length === 1) {
        await authFetch(app, '/api/shopify/app/import-order', {
          method: 'POST',
          body: JSON.stringify({
            shopifyOrderId: built.payloadOrders[0].shopifyOrderId,
            government: built.payloadOrders[0].government,
            zone: built.payloadOrders[0].zone,
          }),
        });
        importCount = 1;
      } else {
        const data = await authFetch(app, '/api/shopify/app/bulk-import', {
          method: 'POST',
          body: JSON.stringify({ orders: built.payloadOrders }),
        });
        importCount = (data.results || []).filter((r) => r.ok).length;
      }

      let synced = 0;
      if (needsSync.length) {
        const syncResult = await runSyncOnly(needsSync);
        synced = syncResult.synced;
      }

      setResults({
        imported: importCount,
        synced,
        skipped: grouped.complete.length,
        blocked: grouped.blocked.length,
      });
      setStep(2);
      await loadOrders();
    } catch (e) {
      setSubmitError(e.message || 'import_failed');
    } finally {
      setSubmitting(false);
    }
  }, [app, grouped, buildImportPayload, runSyncOnly, loadOrders]);

  const progress = ((step + 1) / STEPS.length) * 100;

  if (!orderIds.length) {
    return (
      <Page
        title="Deliver with Now"
        subtitle="Import Shopify orders and push tracking back to Shopify"
        backAction={{ content: 'Orders', onAction: () => navigate(buildShopifyAppNavigateUrl('/')) }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Banner tone="info" title="No orders selected">
                  <p>
                    Select one or more orders on the Shopify Orders page, open <strong>More actions</strong>, then choose{' '}
                    <strong>Deliver with Now</strong>.
                  </p>
                </Banner>
                <Text as="p" tone="subdued">
                  You can also open this page from the Now Shipping app after selecting orders in the embedded orders list.
                </Text>
                <InlineStack gap="300">
                  <Button variant="primary" onClick={() => navigate(buildShopifyAppNavigateUrl('/'))}>
                    Go to orders
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  if (loading) {
    return (
      <Page title="Deliver with Now" subtitle="Preparing your shipment batch…">
        <BlockStack gap="400" inlineAlign="center">
          <Spinner accessibilityLabel="Loading orders" size="large" />
          <Text as="p" tone="subdued">
            Loading {orderIds.length} selected order{orderIds.length === 1 ? '' : 's'}…
          </Text>
        </BlockStack>
      </Page>
    );
  }

  if (!orders.length) {
    return (
      <Page
        title="Deliver with Now"
        subtitle="Import Shopify orders and push tracking back to Shopify"
        backAction={{ content: 'Orders', onAction: () => navigate(buildShopifyAppNavigateUrl('/')) }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                {error ? (
                  <Banner tone="critical" title="Could not load orders">
                    <p>{error}</p>
                  </Banner>
                ) : (
                  <Banner tone="warning" title="Orders not found">
                    <p>
                      We could not load {orderIds.length} selected order{orderIds.length === 1 ? '' : 's'}. They may have
                      been removed, or your store connection may need to be refreshed.
                    </p>
                  </Banner>
                )}
                <InlineStack gap="300">
                  <Button variant="primary" onClick={() => loadOrders()}>
                    Try again
                  </Button>
                  <Button onClick={() => navigate(buildShopifyAppNavigateUrl('/'))}>Go to orders</Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const missingCount = Math.max(0, orderIds.length - orders.length);

  return (
    <Page
      title="Deliver with Now"
      subtitle={`${orderIds.length} order${orderIds.length === 1 ? '' : 's'} from Shopify`}
      backAction={{ content: 'Orders', onAction: () => navigate(buildShopifyAppNavigateUrl('/')) }}
    >
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                Step {step + 1} of {STEPS.length}: {STEPS[step]}
              </Text>
              <Text as="span" tone="subdued" variant="bodySm">
                {STEPS.join(' → ')}
              </Text>
            </InlineStack>
            <ProgressBar progress={progress} tone="primary" size="small" />
          </BlockStack>
        </Card>

        {error ? (
          <Banner tone="critical" title="Could not load orders" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        ) : null}
        {missingCount > 0 ? (
          <Banner tone="warning" title="Some orders could not be loaded">
            <p>
              {missingCount} of {orderIds.length} selected order{orderIds.length === 1 ? '' : 's'} could not be found in
              Shopify. You can continue with the orders below.
            </p>
          </Banner>
        ) : null}
        {submitError ? (
          <Banner tone="critical" title="Something went wrong" onDismiss={() => setSubmitError(null)}>
            <p>{submitError}</p>
          </Banner>
        ) : null}

        {step === 0 ? (
          <Layout>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Review selected orders
                  </Text>
                  <Text as="p" tone="subdued">
                    Confirm which orders will be imported into Now and synced back to Shopify with tracking.
                  </Text>
                  <div className="now-deliver-review-list">
                    {orders.map((o) => (
                      <div key={o.id} className="now-deliver-review-row">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center" wrap>
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {o.name}
                            </Text>
                            {statusBadge(orderDeliverStatus(o))}
                          </InlineStack>
                          <Text as="p" tone="subdued" variant="bodySm">
                            {o.customerName || '—'} · {o.addressSummary || '—'}
                          </Text>
                          {o.nowOrderNumber ? (
                            <Text as="p" variant="bodySm">
                              Now tracking: <strong>#{o.nowOrderNumber}</strong>
                            </Text>
                          ) : null}
                        </BlockStack>
                      </div>
                    ))}
                  </div>
                  <Divider />
                  <InlineStack gap="400" wrap>
                    <Text as="span" variant="bodySm">
                      <strong>{grouped.readyImport.length}</strong> to import
                    </Text>
                    <Text as="span" variant="bodySm">
                      <strong>{grouped.needsSync.length}</strong> to sync to Shopify
                    </Text>
                    <Text as="span" variant="bodySm">
                      <strong>{grouped.complete.length}</strong> already up to date
                    </Text>
                    {grouped.blocked.length ? (
                      <Text as="span" variant="bodySm" tone="critical">
                        <strong>{grouped.blocked.length}</strong> cannot be delivered
                      </Text>
                    ) : null}
                  </InlineStack>
                  <InlineStack align="end">
                    <Button variant="primary" loading={submitting} onClick={handleContinueFromReview}>
                      {grouped.readyImport.length ? 'Continue to zones' : grouped.needsSync.length ? 'Sync to Shopify' : 'Finish'}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">
                    What happens next
                  </Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm">
                      1. Orders are created in Now with your delivery zones.
                    </Text>
                    <Text as="p" variant="bodySm">
                      2. Shopify is marked <strong>Fulfilled</strong> with Now tracking numbers.
                    </Text>
                    <Text as="p" variant="bodySm">
                      3. You can print AWBs from the Orders page anytime.
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>
        ) : null}

        {step === 1 ? (
          <Card>
            <BlockStack gap="500">
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Delivery zones
                </Text>
                <Text as="p" tone="subdued">
                  Assign governorate and zone for {grouped.readyImport.length} order
                  {grouped.readyImport.length === 1 ? '' : 's'}. Tracking will sync to Shopify automatically.
                </Text>
              </BlockStack>
              <div className="now-zone-combobox-modal-section">
                <DeliverZoneAssignment
                  orders={grouped.readyImport}
                  governorates={governorates}
                  loadingZones={loadingZones}
                  zonesError={zonesError}
                  mode={mode}
                  setMode={setMode}
                  govKey={govKey}
                  setGovKey={setGovKey}
                  zoneValue={zoneValue}
                  setZoneValue={setZoneValue}
                  perOrderZones={perOrderZones}
                  setOrderZone={setOrderZone}
                  applySameZoneToAll={applySameZoneToAll}
                  copyFirstOrderZoneToAll={copyFirstOrderZoneToAll}
                />
              </div>
              <InlineStack align="space-between">
                <Button onClick={() => setStep(0)} disabled={submitting}>
                  Back
                </Button>
                <Button variant="primary" loading={submitting} onClick={handleImport}>
                  Import {grouped.readyImport.length} order{grouped.readyImport.length === 1 ? '' : 's'} & sync
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        ) : null}

        {step === 2 && results ? (
          <Card>
            <BlockStack gap="400">
              <Banner tone="success" title="Delivery batch processed">
                <p>
                  {results.imported > 0
                    ? `${results.imported} order${results.imported === 1 ? '' : 's'} imported into Now. `
                    : ''}
                  {results.synced > 0
                    ? `${results.synced} fulfillment${results.synced === 1 ? '' : 's'} synced to Shopify. `
                    : ''}
                  {results.skipped > 0 ? `${results.skipped} already up to date. ` : ''}
                  {results.blocked > 0 ? `${results.blocked} could not be processed.` : ''}
                </p>
              </Banner>
              <Text as="p" tone="subdued">
                Check the native Shopify Orders page — imported orders should show as Fulfilled with Now tracking.
              </Text>
              <InlineStack gap="300">
                <Button variant="primary" onClick={() => navigate(buildShopifyAppNavigateUrl('/'))}>
                  View all orders
                </Button>
                <Button onClick={() => window.location.reload()}>Process more orders</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </Page>
  );
}
