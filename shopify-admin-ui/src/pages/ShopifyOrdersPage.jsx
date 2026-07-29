import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppBridge } from '@shopify/app-bridge-react';
import { authFetch, authFetchBlob } from '../authFetch.js';
import { EditImportModal } from './EditImportModal.jsx';
import { parseAdminLinkOrderIds } from '../utils/shopifyOrderIds.js';
import { buildShopifyAppNavigateUrl } from '../utils/shopifyAppNavigate.js';
import {
  Page,
  BlockStack,
  Text,
  Button,
  Banner,
  Spinner,
  IndexTable,
  Badge,
  InlineStack,
  TextField,
  Select,
  useIndexResourceState,
  ProgressBar,
  Modal,
} from '@shopify/polaris';

const STATUS_OPTIONS = [
  { label: 'Any', value: 'any' },
  { label: 'Open', value: 'open' },
  { label: 'Closed', value: 'closed' },
  { label: 'Cancelled', value: 'cancelled' },
];

function fulfillmentBadge(status) {
  if (status === 'fulfilled') return <Badge tone="success">Fulfilled</Badge>;
  if (status === 'partial') return <Badge tone="attention">Partial</Badge>;
  return <Badge tone="warning">Unfulfilled</Badge>;
}

export function ShopifyOrdersPage() {
  const app = useAppBridge();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [orders, setOrders] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [prevCursor, setPrevCursor] = useState(null);
  const [listCursor, setListCursor] = useState('');
  const [status, setStatus] = useState('any');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [editOrder, setEditOrder] = useState(null);
  const [printAwbLoading, setPrintAwbLoading] = useState(false);
  const [printAwbProgress, setPrintAwbProgress] = useState(0);
  const [awbPdfUrl, setAwbPdfUrl] = useState(null);
  const [awbPdfModalOpen, setAwbPdfModalOpen] = useState(false);

  useEffect(() => {
    if (!printAwbLoading) return undefined;
    const id = setInterval(() => {
      setPrintAwbProgress((prev) => {
        if (prev >= 92) return prev;
        const step = prev < 35 ? 8 : prev < 65 ? 5 : 3;
        return Math.min(92, prev + step);
      });
    }, 300);
    return () => clearInterval(id);
  }, [printAwbLoading]);

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(orders);
  const clearSelectionRef = React.useRef(clearSelection);
  clearSelectionRef.current = clearSelection;

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(
    async (opts = {}) => {
      setError(null);
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('status', status);
        if (opts.cursor) params.set('cursor', opts.cursor);
        if (!opts.cursor && qDebounced) params.set('q', qDebounced);
        const data = await authFetch(app, `/api/shopify/app/shopify-orders?${params.toString()}`);
        setOrders(data.orders || []);
        setNextCursor(data.nextCursor || null);
        setPrevCursor(data.prevCursor || null);
        setListCursor(opts.cursor || '');
        clearSelectionRef.current();
      } catch (e) {
        setError(e.message || 'load_failed');
      } finally {
        setLoading(false);
      }
    },
    [app, status, qDebounced]
  );

  useEffect(() => {
    load({ cursor: '' });
  }, [load]);

  useEffect(() => {
    const ids = parseAdminLinkOrderIds();
    if (ids.length) {
      navigate(buildShopifyAppNavigateUrl('/deliver', { ids: ids.join(',') }), { replace: true });
    }
  }, [navigate]);

  const selectedOrders = useMemo(
    () => orders.filter((o) => selectedResources.includes(o.id)),
    [orders, selectedResources]
  );

  const canPrintAwb = selectedOrders.length > 0 && selectedOrders.every((o) => o.nowOrderNumber);
  const canDeliverWithNow =
    selectedOrders.length > 0 &&
    selectedOrders.every((o) => o.hasShippingAddress);

  const handleBulkDeliver = useCallback(() => {
    if (!selectedOrders.length) return;
    const ids = selectedOrders.map((o) => o.id).join(',');
    navigate(buildShopifyAppNavigateUrl('/deliver', { ids }));
  }, [selectedOrders, navigate]);

  const handlePrintAwb = useCallback(async () => {
    if (!selectedOrders.length || !selectedOrders.every((o) => o.nowOrderNumber)) return;

    let popup = null;
    try {
      /* Do not pass noopener/noreferrer here: MDN says those features make open() return null,
         so we could not assign popup.location after await. Clear opener after navigation instead. */
      popup = window.open('about:blank', '_blank');
    } catch {
      popup = null;
    }
    if (popup) {
      try {
        popup.document.title = 'AWB PDF';
        popup.document.body.innerHTML =
          '<p style="font-family:system-ui,sans-serif;padding:2rem;text-align:center">Preparing PDF…</p>';
      } catch {
        /* strict sandbox may block writing to about:blank */
      }
    }

    setPrintAwbProgress(14);
    setPrintAwbLoading(true);
    let objectUrl = null;
    try {
      const blob = await authFetchBlob(app, '/api/shopify/app/print-awb', {
        method: 'POST',
        body: {
          orderNumbers: selectedOrders.map((o) => o.nowOrderNumber),
          paperSize: 'A4',
        },
      });
      setPrintAwbProgress(100);
      await new Promise((r) => setTimeout(r, 150));
      objectUrl = URL.createObjectURL(blob);

      let openedInTab = false;
      if (popup && !popup.closed) {
        try {
          popup.location.href = objectUrl;
          try {
            popup.opener = null;
          } catch {
            /* ignore */
          }
          openedInTab = true;
        } catch {
          openedInTab = false;
        }
      }

      if (openedInTab) {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 120_000);
      } else {
        if (popup && !popup.closed) {
          try {
            popup.close();
          } catch {
            /* ignore */
          }
        }
        setAwbPdfUrl(objectUrl);
        setAwbPdfModalOpen(true);
      }
    } catch (e) {
      if (popup && !popup.closed) {
        try {
          popup.close();
        } catch {
          /* ignore */
        }
      }
      setError(e.message || 'print_failed');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    } finally {
      setPrintAwbLoading(false);
      setPrintAwbProgress(0);
    }
  }, [app, selectedOrders]);

  const closeAwbPdfModal = useCallback(() => {
    setAwbPdfModalOpen(false);
    setAwbPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const handleDownloadAwbPdf = useCallback(() => {
    if (!awbPdfUrl) return;
    const a = document.createElement('a');
    a.href = awbPdfUrl;
    a.download = 'now-awb-batch.pdf';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [awbPdfUrl]);

  if (loading && orders.length === 0) {
    return (
      <Page
        fullWidth
        title="Orders"
        subtitle="Import Shopify orders into Now and sync fulfillment & tracking back to Shopify"
      >
        <BlockStack gap="400" inlineAlign="center">
          <Spinner accessibilityLabel="Loading Shopify orders" size="large" />
          <Text as="p" tone="subdued">
            Loading…
          </Text>
        </BlockStack>
      </Page>
    );
  }

  return (
    <Page
      fullWidth
      title="Orders"
      subtitle="Import Shopify orders into Now and sync fulfillment & tracking back to Shopify"
      primaryAction={{
        content: 'Deliver with Now',
        onAction: () => navigate(buildShopifyAppNavigateUrl('/deliver')),
      }}
    >
      <BlockStack gap="500">
        {error ? (
          <Banner tone="critical" title="Something went wrong" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        ) : null}

        <BlockStack gap="400">
          <InlineStack gap="400" wrap blockAlign="end" align="space-between">
            <InlineStack gap="400" wrap>
              <div style={{ minWidth: '200px' }}>
                <Select label="Order status" labelInline options={STATUS_OPTIONS} value={status} onChange={setStatus} />
              </div>
              <div style={{ flex: '1 1 220px', minWidth: '180px' }}>
                <TextField
                  label="Search order #"
                  labelHidden
                  placeholder="Search by Shopify order number…"
                  value={q}
                  onChange={setQ}
                  autoComplete="off"
                />
              </div>
              <Button onClick={() => load({ cursor: '' })} loading={loading}>
                Refresh
              </Button>
            </InlineStack>
            <InlineStack gap="200" wrap>
              <Button variant="primary" disabled={!canDeliverWithNow} onClick={handleBulkDeliver}>
                Deliver with Now
              </Button>
              <Button
                disabled={!canPrintAwb || printAwbLoading}
                loading={printAwbLoading}
                onClick={handlePrintAwb}
              >
                Print AWB
              </Button>
            </InlineStack>
          </InlineStack>

          {orders.length === 0 ? (
            <Text as="p" tone="subdued">
              No orders on this page.
            </Text>
          ) : (
            <div className="now-orders-table">
              <IndexTable
                resourceName={{ singular: 'order', plural: 'orders' }}
                itemCount={orders.length}
                selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
                onSelectionChange={handleSelectionChange}
                headings={[
                  { title: 'Order' },
                  { title: 'Date' },
                  { title: 'Customer' },
                  { title: 'Address' },
                  { title: 'Total' },
                  { title: 'Payment' },
                  { title: 'Fulfillment' },
                  { title: 'Now' },
                  { title: 'Zone' },
                  { title: 'Actions' },
                ]}
              >
                {orders.map((row, index) => (
                  <IndexTable.Row id={row.id} key={row.id} position={index} selected={selectedResources.includes(row.id)}>
                    <IndexTable.Cell>
                      {row.nowOrderNumber ? <span className="now-imported-row-marker" aria-hidden="true" /> : null}
                      <Text variant="bodyMd" fontWeight="semibold" as="span">
                        {row.name}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {row.created_at ? new Date(row.created_at).toLocaleDateString() : '—'}
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.customerName || '—'}</IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" breakWord>
                        {row.addressSummary || '—'}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {row.total_price != null ? `${row.total_price} ${row.currency || ''}` : '—'}
                    </IndexTable.Cell>
                    <IndexTable.Cell>{row.financial_status || '—'}</IndexTable.Cell>
                    <IndexTable.Cell>{fulfillmentBadge(row.fulfillment_status)}</IndexTable.Cell>
                    <IndexTable.Cell>
                      {row.nowOrderNumber ? (
                        <Badge tone="success">Now #{row.nowOrderNumber}</Badge>
                      ) : (
                        <Text as="span" tone="subdued">
                          —
                        </Text>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {row.nowZone ? (
                        <Text as="span" variant="bodyMd">
                          {row.nowZone}
                        </Text>
                      ) : (
                        <Text as="span" tone="subdued">
                          —
                        </Text>
                      )}
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      {!row.nowOrderNumber && row.hasShippingAddress ? (
                        <Button size="slim" className="now-edit-import-btn" onClick={() => setEditOrder(row)}>
                          Edit & import
                        </Button>
                      ) : (
                        <Text as="span" tone="subdued">
                          —
                        </Text>
                      )}
                    </IndexTable.Cell>
                  </IndexTable.Row>
                ))}
              </IndexTable>
            </div>
          )}

          <InlineStack gap="300" align="space-between" blockAlign="center">
            <Text as="span" tone="subdued">
              {listCursor ? 'Page (cursor)' : 'First page'}
            </Text>
            <InlineStack gap="200">
              <Button disabled={!prevCursor || loading} onClick={() => load({ cursor: prevCursor })}>
                Previous
              </Button>
              <Button disabled={!nextCursor || loading} onClick={() => load({ cursor: nextCursor })}>
                Next
              </Button>
            </InlineStack>
          </InlineStack>
        </BlockStack>
      </BlockStack>

      <EditImportModal
        open={!!editOrder}
        onClose={() => setEditOrder(null)}
        app={app}
        order={editOrder}
        onSuccess={() => load({ cursor: listCursor || '' })}
      />

      <Modal
        open={awbPdfModalOpen}
        onClose={closeAwbPdfModal}
        title="AWB PDF"
        size="large"
        primaryAction={{ content: 'Close', onAction: closeAwbPdfModal }}
        secondaryActions={[{ content: 'Download', onAction: handleDownloadAwbPdf }]}
      >
        <Modal.Section>
          {awbPdfUrl ? (
            <iframe className="now-awb-pdf-frame" title="AWB PDF preview" src={awbPdfUrl} />
          ) : null}
        </Modal.Section>
      </Modal>

      {printAwbLoading ? (
        <div
          className="now-print-awb-overlay"
          role="alertdialog"
          aria-busy="true"
          aria-live="polite"
          aria-label="Generating combined AWB PDF"
        >
          <div className="now-print-awb-overlay__card">
            <BlockStack gap="400" inlineAlign="center">
              <Spinner size="large" accessibilityLabel="Generating PDF" />
              <div style={{ width: '100%', maxWidth: '320px' }}>
                <BlockStack gap="300">
                  <Text as="p" variant="headingSm">
                    Preparing AWB PDF
                  </Text>
                  <ProgressBar progress={printAwbProgress} tone="primary" size="small" />
                  <Text as="p" tone="subdued" alignment="center">
                    Merging {selectedOrders.length} order{selectedOrders.length === 1 ? '' : 's'} on the server…
                  </Text>
                </BlockStack>
              </div>
            </BlockStack>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
