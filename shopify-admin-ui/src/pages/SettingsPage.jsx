import React, { useCallback, useEffect, useState } from 'react';
import { useAppBridge } from '@shopify/app-bridge-react';
import { authFetch } from '../authFetch.js';
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Checkbox,
  DataTable,
  Banner,
  Spinner,
} from '@shopify/polaris';

export function SettingsPage() {
  const app = useAppBridge();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [toggleBusy, setToggleBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [st, lg] = await Promise.all([
        authFetch(app, '/api/shopify/app/status'),
        authFetch(app, '/api/shopify/app/sync-logs?limit=20&page=1'),
      ]);
      setStatus(st);
      setLogs(lg.logs || []);
      setLogsTotal(lg.total || 0);
    } catch (e) {
      setError(e.message || 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [app]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onToggleSync = useCallback(async () => {
    setToggleBusy(true);
    setError(null);
    try {
      const body = await authFetch(app, '/api/shopify/app/toggle-sync', { method: 'PUT' });
      setStatus((s) => (s ? { ...s, isActive: body.isActive } : s));
    } catch (e) {
      setError(e.message || 'toggle_failed');
    } finally {
      setToggleBusy(false);
    }
  }, [app]);

  if (loading && !status) {
    return (
      <Page fullWidth title="Settings" subtitle="Sync & connection">
        <BlockStack gap="400" inlineAlign="center">
          <Spinner accessibilityLabel="Loading" size="large" />
          <Text as="p" tone="subdued">
            Loading…
          </Text>
        </BlockStack>
      </Page>
    );
  }

  const syncingActive = status?.isActive !== false;
  const rows = (logs || []).map((row) => [
    new Date(row.createdAt).toLocaleString(),
    row.topic || '',
    row.status || '',
    row.shopifyOrderName || row.shopifyOrderId || '—',
    (row.reason || '').slice(0, 120),
  ]);

  return (
    <Page fullWidth title="Settings" subtitle="Shopify connection, sync, and logs">
      <BlockStack gap="500">
        {error ? (
          <Banner tone="critical" title="Something went wrong">
            <p>{error}</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Connection
            </Text>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone={status?.connected ? 'success' : 'attention'}>
                {status?.connected ? 'Connected' : 'Not connected'}
              </Badge>
              <Text as="span" tone="subdued">
                {status?.shopDomain || ''}
              </Text>
            </InlineStack>
            {status?.lastWebhookAt ? (
              <Text as="p" tone="subdued">
                Last webhook: {new Date(status.lastWebhookAt).toLocaleString()}
              </Text>
            ) : null}
            {status?.syncStats ? (
              <Text as="p" tone="subdued">
                Last 24h — success: {status.syncStats.success}, skipped: {status.syncStats.skipped},
                failed: {status.syncStats.failed}
              </Text>
            ) : null}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Order sync
            </Text>
            <Checkbox
              label="Shopify automatic order creation (webhook)"
              checked={syncingActive}
              disabled={toggleBusy}
              onChange={() => {
                void onToggleSync();
              }}
            />
            <Text as="p" tone="subdued">
              New orders are not auto-created in Now from webhooks. Import them from the Orders tab with
              Deliver with Now. When this is off, your installation flag is paused for any future webhook-based
              features. Shopify cancellations still update Now orders that were already imported.
            </Text>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Recent sync activity
              </Text>
              <Button onClick={loadAll} loading={loading}>
                Refresh
              </Button>
            </InlineStack>
            <Text as="p" tone="subdued">
              Showing {logs.length} of {logsTotal} log entries.
            </Text>
            {rows.length ? (
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                headings={['Time', 'Topic', 'Status', 'Order', 'Details']}
                rows={rows}
              />
            ) : (
              <Text as="p" tone="subdued">
                No log entries yet.
              </Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Full Now dashboard
            </Text>
            <Text as="p" tone="subdued">
              Wallet, pickups, returns, and advanced tools are in the main Now portal.
            </Text>
            <InlineStack gap="200" wrap>
              <Button url={status?.portalDashboardUrl || '/business/dashboard'} external variant="primary">
                Dashboard
              </Button>
              {status?.portalSettingsUrl ? (
                <Button url={status.portalSettingsUrl} external>
                  Business settings (integrations)
                </Button>
              ) : null}
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
