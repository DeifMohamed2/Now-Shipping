/**
 * Bosta zone catalog: hierarchy, full-zone expansion, display grouping.
 */
(function (global) {
  'use strict';

  const CATALOG_URL = '/assets/js/bosta-regions-data-processed.json';
  let bostaData = null;
  let hierarchy = null;
  let valueToArea = null;

  function getParentKey(areaValue) {
    const v = String(areaValue || '').trim();
    const idx = v.indexOf(' - ');
    return idx === -1 ? v : v.slice(0, idx);
  }

  function getLang() {
    const htmlLang = document.documentElement.lang;
    if (htmlLang && htmlLang !== 'en') return htmlLang;
    try {
      const stored = localStorage.getItem('language');
      if (stored && stored !== 'en') return stored;
    } catch (e) { /* ignore */ }
    return 'en';
  }

  function labelFor(area, lang) {
    if (!area) return '';
    const l = lang || getLang();
    return (area.label && (area.label[l] || area.label.en)) || area.value;
  }

  function buildValueIndex(data) {
    const map = new Map();
    Object.keys(data || {}).forEach((govKey) => {
      const areas = data[govKey].areas || [];
      areas.forEach((area) => {
        map.set(area.value, { area, governorateKey: govKey });
      });
    });
    return map;
  }

  function buildZoneHierarchy(data) {
    const result = {};
    Object.keys(data || {}).forEach((govKey) => {
      const gov = data[govKey];
      const parents = {};
      (gov.areas || []).forEach((area) => {
        const parentKey = getParentKey(area.value);
        if (!parents[parentKey]) {
          parents[parentKey] = {
            parentKey,
            governorateKey: govKey,
            governorateLabel: gov.label,
            areas: [],
          };
        }
        parents[parentKey].areas.push(area);
      });
      result[govKey] = {
        governorateKey: govKey,
        label: gov.label,
        parents: Object.values(parents).sort((a, b) =>
          labelFor(a.areas[0]).localeCompare(labelFor(b.areas[0]), 'en')
        ),
      };
    });
    return result;
  }

  async function loadCatalog() {
    if (bostaData) return bostaData;
    const res = await fetch(CATALOG_URL);
    if (!res.ok) throw new Error('Failed to load zone catalog');
    bostaData = await res.json();
    hierarchy = buildZoneHierarchy(bostaData);
    valueToArea = buildValueIndex(bostaData);
    return bostaData;
  }

  function getHierarchy() {
    return hierarchy;
  }

  function getBostaData() {
    return bostaData;
  }

  function getAreaValuesForParent(governorateKey, parentKey) {
    if (!hierarchy || !hierarchy[governorateKey]) return [];
    const group = hierarchy[governorateKey].parents.find((p) => p.parentKey === parentKey);
    if (!group) return [];
    return group.areas.map((a) => a.value);
  }

  function expandFullZone(governorateKey, parentKey) {
    return getAreaValuesForParent(governorateKey, parentKey);
  }

  function isFullZoneSelected(governorateKey, parentKey, selectedSet) {
    const values = getAreaValuesForParent(governorateKey, parentKey);
    if (!values.length) return false;
    return values.every((v) => selectedSet.has(v));
  }

  function getZoneLabel(zoneValue, lang) {
    const entry = valueToArea && valueToArea.get(zoneValue);
    if (entry) return labelFor(entry.area, lang);
    return zoneValue;
  }

  function collapseSelectedForDisplay(zoneValues) {
    const selected = new Set(zoneValues || []);
    const covered = new Set();
    const groups = [];
    const lang = getLang();

    if (!hierarchy) {
      return (zoneValues || []).map((value) => ({
        type: 'partial',
        value,
        label: getZoneLabel(value, lang),
        values: [value],
      }));
    }

    Object.keys(hierarchy).forEach((govKey) => {
      hierarchy[govKey].parents.forEach((parentGroup) => {
        const values = parentGroup.areas.map((a) => a.value);
        const allSelected = values.length > 0 && values.every((v) => selected.has(v));
        if (allSelected && values.length > 1) {
          values.forEach((v) => covered.add(v));
          const parentArea = parentGroup.areas.find((a) => a.value === parentGroup.parentKey)
            || parentGroup.areas[0];
          groups.push({
            type: 'full',
            parentKey: parentGroup.parentKey,
            governorateKey: govKey,
            label: labelFor(parentArea, lang),
            count: values.length,
            values,
          });
        }
      });
    });

    (zoneValues || []).forEach((value) => {
      if (covered.has(value)) return;
      groups.push({
        type: 'partial',
        value,
        label: getZoneLabel(value, lang),
        values: [value],
      });
    });

    return groups;
  }

  function getParentZoneOptions() {
    const options = [];
    if (!hierarchy) return options;
    Object.keys(hierarchy).forEach((govKey) => {
      hierarchy[govKey].parents.forEach((p) => {
        const parentArea = p.areas.find((a) => a.value === p.parentKey) || p.areas[0];
        options.push({
          value: p.parentKey,
          governorateKey: govKey,
          label: labelFor(parentArea),
          subCount: p.areas.length,
        });
      });
    });
    return options.sort((a, b) => a.label.localeCompare(b.label, 'en'));
  }

  function uniqueValues(arr) {
    return [...new Set((arr || []).filter(Boolean))];
  }

  global.CourierZoneCatalog = {
    loadCatalog,
    getHierarchy,
    getBostaData,
    getLang,
    labelFor,
    getParentKey,
    getAreaValuesForParent,
    expandFullZone,
    isFullZoneSelected,
    getZoneLabel,
    collapseSelectedForDisplay,
    getParentZoneOptions,
    uniqueValues,
  };
})(typeof window !== 'undefined' ? window : global);
