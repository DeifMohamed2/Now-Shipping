import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Combobox, Listbox, Text, AutoSelection } from '@shopify/polaris';

/** Same idea as `area-selection-modal.js` — match typed query against Arabic, English, and values. */
export function normalizeArabicDigitsToLatin(s) {
  if (!s) return '';
  const map = {
    '\u0660': '0',
    '\u0661': '1',
    '\u0662': '2',
    '\u0663': '3',
    '\u0664': '4',
    '\u0665': '5',
    '\u0666': '6',
    '\u0667': '7',
    '\u0668': '8',
    '\u0669': '9',
    '\u06f0': '0',
    '\u06f1': '1',
    '\u06f2': '2',
    '\u06f3': '3',
    '\u06f4': '4',
    '\u06f5': '5',
    '\u06f6': '6',
    '\u06f7': '7',
    '\u06f8': '8',
    '\u06f9': '9',
  };
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += map[ch] !== undefined ? map[ch] : ch;
  }
  return out;
}

export function textMatches(text, query) {
  const q = (query || '').trim();
  if (!q) return true;
  const t = String(text || '');
  if (t.includes(q)) return true;
  const tN = normalizeArabicDigitsToLatin(t);
  const qN = normalizeArabicDigitsToLatin(q);
  if (tN.includes(qN)) return true;
  if (t.toLowerCase().includes(q.toLowerCase())) return true;
  if (tN.toLowerCase().includes(qN.toLowerCase())) return true;
  return false;
}

function areaMatchesQuery(area, query) {
  const q = (query || '').trim();
  if (!q) return true;
  return (
    textMatches(area.labelEn, q) ||
    textMatches(area.labelAr, q) ||
    textMatches(area.value, q)
  );
}

export function formatZoneDisplay(area) {
  if (!area) return '';
  const en = String(area.labelEn || '').trim();
  const ar = String(area.labelAr || '').trim();
  if (en && ar) return `${en} - ${ar}`;
  return en || ar || String(area.value || '');
}

/**
 * Searchable zone field (English + Arabic), aligned with main app `area-selection-modal.js` matching.
 * @param {{ value: string, labelEn: string, labelAr: string }[]} areas
 * @param {string} value — selected zone `value` sent to the API
 * @param {(value: string) => void} onChange
 */
export function ZoneSearchCombobox({ areas, value, onChange, disabled, label }) {
  const list = Array.isArray(areas) ? areas : [];
  const [inputValue, setInputValue] = useState('');
  const inputValueRef = useRef('');

  useEffect(() => {
    if (!value) {
      setInputValue('');
      inputValueRef.current = '';
      return;
    }
    const a = list.find((x) => x.value === value);
    const next = a ? formatZoneDisplay(a) : value;
    setInputValue(next);
    inputValueRef.current = next;
  }, [value, list]);

  const filteredAreas = useMemo(() => {
    if (!list.length) return [];
    const q = inputValueRef.current.trim();
    if (!q) return list;
    return list.filter((a) => areaMatchesQuery(a, q));
  }, [list, inputValue]);

  const handleTextChange = (v) => {
    inputValueRef.current = v;
    setInputValue(v);
    if (!String(v).trim()) {
      onChange('');
    }
  };

  const handleSelect = useCallback(
    (selected) => {
      if (!selected || selected === '_nomatch_') return;
      const a = list.find((x) => x.value === selected);
      if (!a) return;
      onChange(a.value);
      const display = formatZoneDisplay(a);
      setInputValue(display);
      inputValueRef.current = display;
    },
    [list, onChange]
  );

  const handleBlur = useCallback(() => {
    const raw = inputValueRef.current;
    if (!String(raw).trim()) {
      onChange('');
      return;
    }
    const sel = list.find((a) => a.value === value);
    if (!value || !sel) return;
    const display = formatZoneDisplay(sel);
    if (String(raw).trim() === String(display).trim()) return;

    const norm = (s) =>
      normalizeArabicDigitsToLatin(String(s || ''))
        .trim()
        .toLowerCase();
    const hit = list.find(
      (a) =>
        norm(formatZoneDisplay(a)) === norm(raw) ||
        norm(a.value) === norm(raw) ||
        norm(a.labelEn) === norm(raw) ||
        norm(a.labelAr) === norm(raw)
    );
    if (hit) {
      onChange(hit.value);
      const d = formatZoneDisplay(hit);
      setInputValue(d);
      inputValueRef.current = d;
    } else {
      setInputValue(display);
      inputValueRef.current = display;
    }
  }, [list, value, onChange]);

  const noResults = list.length > 0 && filteredAreas.length === 0 && String(inputValue).trim().length > 0;

  return (
    <Combobox
      preferredPosition="below"
      height="240px"
      activator={
        <Combobox.TextField
          label={label}
          value={inputValue}
          onChange={handleTextChange}
          onBlur={handleBlur}
          autoComplete="off"
          disabled={disabled || !list.length}
          placeholder="Search zone (English or Arabic)…"
        />
      }
    >
      {list.length > 0 ? (
        <Listbox autoSelection={AutoSelection.First} enableKeyboardControl onSelect={handleSelect}>
          {noResults ? (
            <Listbox.Option value="_nomatch_" disabled accessibilityLabel="No matching zones">
              <div className="now-zone-option now-zone-option--empty">
                <Text as="p" tone="subdued">
                  No matching zones — try another spelling (English or Arabic)
                </Text>
              </div>
            </Listbox.Option>
          ) : (
            filteredAreas.map((area) => (
              <Listbox.Option
                key={area.value}
                value={area.value}
                selected={value === area.value}
                accessibilityLabel={formatZoneDisplay(area)}
              >
                <div className="now-zone-option" translate="no">
                  <div className="now-zone-option__line" dir="ltr">
                    <span className="now-zone-option__en" lang="en">
                      {area.labelEn || area.value}
                    </span>
                    {area.labelAr ? (
                      <>
                        <span className="now-zone-option__dash" aria-hidden="true">
                          {' '}
                          -{' '}
                        </span>
                        <bdi className="now-zone-option__ar" dir="rtl" lang="ar">
                          {area.labelAr}
                        </bdi>
                      </>
                    ) : null}
                  </div>
                </div>
              </Listbox.Option>
            ))
          )}
        </Listbox>
      ) : null}
    </Combobox>
  );
}
