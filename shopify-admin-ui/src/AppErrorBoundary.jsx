import React from 'react';
import { Page, Banner, BlockStack, Button } from '@shopify/polaris';

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[Now Shipping app]', error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Page title="Something went wrong">
        <BlockStack gap="400">
          <Banner tone="critical" title="The app could not load">
            <p>Please reload this page. If the problem continues, open Now Shipping from Shopify Admin again.</p>
          </Banner>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </BlockStack>
      </Page>
    );
  }
}
