#!/usr/bin/env node
/**
 * Exports Cairo, Giza, and Qalyubia zones as bilingual JSON from:
 * public/assets/js/bosta-regions-data-processed.json
 *
 * Run: node scripts/export-cairo-zones-bilingual.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'public/assets/js/bosta-regions-data-processed.json');
const DEST = path.join(ROOT, 'data/metro-zones-ar-en.json');
const METRO_KEYS = ['Cairo', 'Giza', 'Qalyubia'];

function exportGovernorate(raw, key) {
  const gov = raw[key];
  if (!gov || !Array.isArray(gov.areas)) return null;
  const govEn = (gov.label && gov.label.en) || gov.value || key;
  const govAr = (gov.label && gov.label.ar) || govEn;
  const areas = gov.areas.map((a) => ({
    value: a.value,
    en: (a.label && a.label.en) || a.value,
    ar: (a.label && a.label.ar) || (a.label && a.label.en) || a.value,
  }));
  return {
    value: gov.value || key,
    en: govEn,
    ar: govAr,
    areas,
  };
}

function main() {
  const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const governorates = {};
  for (const key of METRO_KEYS) {
    const block = exportGovernorate(raw, key);
    if (!block) {
      console.error('Expected', key, 'with areas in', SOURCE);
      process.exit(1);
    }
    governorates[key] = block;
  }

  const out = {
    meta: {
      description:
        'Greater Cairo metro Bosta zones — English value (API / validation) + display labels EN/AR',
      sourceFile: 'public/assets/js/bosta-regions-data-processed.json',
      exportedAt: new Date().toISOString(),
      governorateKeys: METRO_KEYS,
    },
    governorates,
  };

  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('Wrote', DEST);
  for (const k of METRO_KEYS) {
    console.log(`  ${k}: ${governorates[k].areas.length} zones`);
  }
}

main();
