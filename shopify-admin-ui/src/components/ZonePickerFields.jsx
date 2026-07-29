import React, { useMemo } from 'react';
import { BlockStack, Select } from '@shopify/polaris';
import { ZoneSearchCombobox } from './ZoneSearchCombobox.jsx';

/**
 * Governorate + searchable zone picker used in import modals.
 */
export function ZonePickerFields({
  governorates,
  govKey,
  zoneValue,
  onGovChange,
  onZoneChange,
  disabled = false,
  govLabel = 'Governorate',
  zoneLabel = 'Zone / area',
}) {
  const govOptions = useMemo(
    () => [
      { label: 'Select governorate…', value: '' },
      ...governorates.map((g) => ({ label: g.label, value: g.key })),
    ],
    [governorates]
  );

  const selectedGov = useMemo(
    () => governorates.find((g) => g.key === govKey),
    [governorates, govKey]
  );
  const zoneAreas = selectedGov?.areas || [];

  return (
    <BlockStack gap="300">
      <Select
        label={govLabel}
        options={govOptions}
        value={govKey}
        onChange={(v) => {
          onGovChange(v);
          onZoneChange('');
        }}
        disabled={disabled}
      />
      <ZoneSearchCombobox
        label={zoneLabel}
        areas={zoneAreas}
        value={zoneValue}
        onChange={onZoneChange}
        disabled={disabled || !govKey}
        placeholder={
          govKey
            ? 'Click to search zone (English or Arabic)…'
            : 'Select governorate first…'
        }
      />
    </BlockStack>
  );
}
