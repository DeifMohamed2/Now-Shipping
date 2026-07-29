import React from 'react';
import ReactDOM from 'react-dom/client';
import '@shopify/polaris/build/esm/styles.css';
import './now-theme.css';
import { AppProvider } from '@shopify/polaris';
import en from '@shopify/polaris/locales/en.json';
import { AppBridgeWrapper } from './AppBridgeProvider.jsx';
import { App } from './App.jsx';
import { AppErrorBoundary } from './AppErrorBoundary.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProvider i18n={en}>
      <AppErrorBoundary>
        <AppBridgeWrapper>
          <App />
        </AppBridgeWrapper>
      </AppErrorBoundary>
    </AppProvider>
  </React.StrictMode>
);
