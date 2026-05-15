import React, { useCallback, useEffect, useState } from 'react';
import { useAppBridge } from '@shopify/app-bridge-react';
import { getSessionToken } from '@shopify/app-bridge/utilities';
import { Page, BlockStack, Spinner, Banner, Text, Link } from '@shopify/polaris';

const SESSION_PATH = '/api/shopify/app/session';
const MAX_ATTEMPTS = 4;
const RETRY_MS = 400;

async function fetchSessionJson(app) {
  const token = await getSessionToken(app);
  const res = await fetch(SESSION_PATH, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { res, body };
}

/**
 * Blocks embedded UI until App Bridge session token is accepted by the backend.
 * Must render inside App Bridge Provider.
 */
export function EmbeddedAuthGate({ children }) {
  const app = useAppBridge();
  const [phase, setPhase] = useState('checking');
  const [errorCode, setErrorCode] = useState(null);

  const runBootstrap = useCallback(async () => {
    setPhase('checking');
    setErrorCode(null);
    let lastBody = {};
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const { res, body } = await fetchSessionJson(app);
        lastBody = body;
        if (res.ok) {
          setPhase('ready');
          return;
        }
        if (res.status === 401 && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_MS));
          continue;
        }
        setErrorCode(body.error || `http_${res.status}`);
        setPhase('error');
        return;
      } catch {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, RETRY_MS));
          continue;
        }
        setErrorCode('network_error');
        setPhase('error');
        return;
      }
    }
    setErrorCode(lastBody.error || 'session_failed');
    setPhase('error');
  }, [app]);

  useEffect(() => {
    runBootstrap();
  }, [runBootstrap]);

  if (phase === 'ready') {
    return children;
  }

  if (phase === 'error') {
    const isNotConnected = errorCode === 'shop_not_connected';
    const settingsUrl = `${window.location.origin}/business/settings`;

    if (isNotConnected) {
      return (
        <Page title="Connect your store">
          <BlockStack gap="400">
            <Banner tone="warning" title="This Shopify store is not connected to Now Shipping">
              <p>
                Connect your store from your Now Shipping account: Settings → Integrations → Shopify,
                then open this app again from Shopify Admin.
              </p>
            </Banner>
            <Text as="p">
              <Link url={settingsUrl} target="_top">
                Open business settings
              </Link>
            </Text>
          </BlockStack>
        </Page>
      );
    }

    return (
      <Page title="Could not sign in">
        <BlockStack gap="400">
          <Banner tone="critical" title="Authentication failed">
            <p>
              {errorCode === 'network_error'
                ? 'Network error. Check your connection and reload.'
                : 'Please reload this page or open the app from Shopify Admin.'}
            </p>
          </Banner>
        </BlockStack>
      </Page>
    );
  }

  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        pointerEvents: 'none',
      }}
    >
      <Spinner accessibilityLabel="Signing in to Shopify" size="large" />
    </div>
  );
}
