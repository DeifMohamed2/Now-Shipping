#!/usr/bin/env node
/**
 * Exports Cairo zones as bilingual JSON (AR + EN) from the same source the app uses:
 * public/assets/js/bosta-regions-data-processed.json
 *
 * Run: node scripts/export-cairo-zones-bilingual.js
 * Or:  npm run export:cairo-zones-bilingual
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'public/assets/js/bosta-regions-data-processed.json');
const DEST = path.join(ROOT, 'data/cairo-zones-ar-en.json');

function main() {
  const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const cairo = raw.Cairo;
  if (!cairo || !Array.isArray(cairo.areas)) {
    console.error('Expected raw.Cairo.areas in', SOURCE);
    process.exit(1);
  }

  const govEn = (cairo.label && cairo.label.en) || cairo.value || 'Cairo';
  const govAr = (cairo.label && cairo.label.ar) || govEn;

  const areas = cairo.areas.map((a) => ({
    value: a.value,
    en: (a.label && a.label.en) || a.value,
    ar: (a.label && a.label.ar) || (a.label && a.label.en) || a.value,
  }));

  const out = {
    meta: {
      description: 'Cairo delivery zones — English value (API / validation) + display labels EN/AR',
      sourceFile: 'public/assets/js/bosta-regions-data-processed.json',
      exportedAt: new Date().toISOString(),
      governorateKey: 'Cairo',
      zoneCount: areas.length,
    },
    governorate: {
      value: cairo.value || 'Cairo',
      en: govEn,
      ar: govAr,
    },
    areas,
  };

  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log('Wrote', DEST, `(${areas.length} zones)`);
}

main();
