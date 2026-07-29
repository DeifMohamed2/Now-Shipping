import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { NavigationMenu, useRoutePropagation } from '@shopify/app-bridge-react';
import { ShopifyOrdersPage } from './pages/ShopifyOrdersPage.jsx';
import { DeliverPage } from './pages/DeliverPage.jsx';
import { PickupsPage } from './pages/PickupsPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';

const NAV_LINKS = [
  { label: 'Orders', destination: '/shopify-app/' },
  { label: 'Pickups', destination: '/shopify-app/pickups' },
  { label: 'Settings', destination: '/shopify-app/settings' },
];

function RouteSync() {
  const location = useLocation();
  useRoutePropagation(location);
  return null;
}

function AppRoutes() {
  return (
    <>
      <NavigationMenu navigationLinks={NAV_LINKS} />
      <RouteSync />
      <Routes>
        <Route path="/" element={<ShopifyOrdersPage />} />
        <Route path="/deliver" element={<DeliverPage />} />
        <Route path="/pickups" element={<PickupsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export function App() {
  return (
    <BrowserRouter basename="/shopify-app">
      <AppRoutes />
    </BrowserRouter>
  );
}
