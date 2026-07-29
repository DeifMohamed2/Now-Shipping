import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../authFetch.js';

const EMPTY_ZONE = { govKey: '', zoneValue: '' };

export function buildPerOrderZoneState(orders) {
  const next = {};
  for (const o of orders || []) {
    next[o.id] = { ...EMPTY_ZONE };
  }
  return next;
}

export function useDeliverZones(app, { enabled = true } = {}) {
  const [loadingZones, setLoadingZones] = useState(false);
  const [zonesError, setZonesError] = useState(null);
  const [governorates, setGovernorates] = useState([]);
  const [mode, setMode] = useState('same');
  const [govKey, setGovKey] = useState('');
  const [zoneValue, setZoneValue] = useState('');
  const [perOrderZones, setPerOrderZones] = useState({});

  const loadZones = useCallback(async () => {
    setZonesError(null);
    setLoadingZones(true);
    try {
      const data = await authFetch(app, '/api/shopify/app/zones');
      setGovernorates(data.governorates || []);
    } catch (e) {
      setZonesError(e.message || 'zones_failed');
    } finally {
      setLoadingZones(false);
    }
  }, [app]);

  const resetZones = useCallback((orders = []) => {
    setMode('same');
    setGovKey('');
    setZoneValue('');
    setPerOrderZones(buildPerOrderZoneState(orders));
  }, []);

  useEffect(() => {
    if (enabled) loadZones();
  }, [enabled, loadZones]);

  const setOrderZone = useCallback((orderId, patch) => {
    setPerOrderZones((prev) => ({
      ...prev,
      [orderId]: { ...EMPTY_ZONE, ...prev[orderId], ...patch },
    }));
  }, []);

  const applySameZoneToAll = useCallback(
    (orders) => {
      if (!govKey || !zoneValue) return;
      setPerOrderZones((prev) => {
        const next = { ...prev };
        for (const o of orders || []) {
          next[o.id] = { govKey, zoneValue };
        }
        return next;
      });
    },
    [govKey, zoneValue]
  );

  const copyFirstOrderZoneToAll = useCallback((orders) => {
    const first = orders?.[0];
    if (!first) return;
    const src = perOrderZones[first.id];
    if (!src?.govKey || !src?.zoneValue) return;
    setPerOrderZones((prev) => {
      const next = { ...prev };
      for (const o of orders) {
        next[o.id] = { govKey: src.govKey, zoneValue: src.zoneValue };
      }
      return next;
    });
  }, [perOrderZones]);

  const buildImportPayload = useCallback(
    (orders) => {
      const list = orders || [];
      const isBulk = list.length > 1;
      const payloadOrders = [];

      if (mode === 'same' || !isBulk) {
        if (!govKey || !zoneValue) {
          return { ok: false, error: 'Please select governorate and zone.' };
        }
        for (const o of list) {
          payloadOrders.push({
            shopifyOrderId: o.id,
            government: govKey,
            zone: zoneValue,
          });
        }
      } else {
        for (const o of list) {
          const z = perOrderZones[o.id] || EMPTY_ZONE;
          if (!z.govKey || !z.zoneValue) {
            return { ok: false, error: `Please set governorate and zone for ${o.name || 'order'}.` };
          }
          payloadOrders.push({
            shopifyOrderId: o.id,
            government: z.govKey,
            zone: z.zoneValue,
          });
        }
      }

      return { ok: true, payloadOrders };
    },
    [mode, govKey, zoneValue, perOrderZones]
  );

  return {
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
    reloadZones: loadZones,
  };
}
