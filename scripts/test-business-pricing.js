#!/usr/bin/env node
/**
 * Unit tests for per-business custom pricing (utils/fees + businessPricingService).
 * Run: node scripts/test-business-pricing.js
 */
const {
  calculateOrderFee,
  calculatePickupFee,
  resolveBusinessPricing,
  GLOBAL_EXPRESS_FEE,
} = require('../utils/fees');
const {
  snapshotPricing,
  normalizePricingInput,
  getGlobalDefaults,
} = require('../utils/businessPricingService');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log('  OK:', message);
  } else {
    failed++;
    console.error('  FAIL:', message);
  }
}

console.log('=== Global fees (no business context) ===\n');
assert(calculateOrderFee('Cairo', 'Deliver', false) === 100, 'Cairo Deliver = 100');
assert(calculateOrderFee('Cairo', 'Deliver', true) === GLOBAL_EXPRESS_FEE, 'Express = global 200');
assert(calculatePickupFee('Cairo', 0) === 100, 'Pickup Cairo = 100');
assert(calculateOrderFee('Giza', 'Deliver', false) === 100, 'Giza Deliver = 100');
assert(calculateOrderFee('Qalyubia', 'Return', false) === 100, 'Qalyubia Return = 100');

console.log('\n=== Custom pricing enabled — full override ===\n');
const fullPricing = {
  enabled: true,
  order: {
    Cairo: { Deliver: 75, Return: 80, Exchange: 85 },
    Giza: { Deliver: 90, Return: 90, Exchange: 90 },
    Qalyubia: { Deliver: 95, Return: 95, Exchange: 95 },
  },
  expressFee: 150,
  pickupFee: 60,
};
assert(
  calculateOrderFee('Cairo', 'Deliver', false, fullPricing) === 75,
  'Custom Cairo Deliver = 75'
);
assert(
  calculateOrderFee('Cairo', 'Return', false, fullPricing) === 80,
  'Custom Cairo Return = 80'
);
assert(
  calculateOrderFee('Cairo', 'Deliver', true, fullPricing) === 150,
  'Custom express = 150'
);
assert(calculatePickupFee('Cairo', 0, fullPricing) === 60, 'Custom pickup = 60');

console.log('\n=== Partial override — fallback to global ===\n');
const partialPricing = {
  enabled: true,
  order: {
    Cairo: { Deliver: 70, Return: null, Exchange: null },
    Giza: { Deliver: null, Return: null, Exchange: null },
    Qalyubia: { Deliver: null, Return: null, Exchange: null },
  },
  expressFee: null,
  pickupFee: null,
};
assert(
  calculateOrderFee('Cairo', 'Deliver', false, partialPricing) === 70,
  'Partial: custom Deliver used'
);
assert(
  calculateOrderFee('Cairo', 'Return', false, partialPricing) === 100,
  'Partial: Return falls back to global 100'
);
assert(
  calculateOrderFee('Cairo', 'Deliver', true, partialPricing) === GLOBAL_EXPRESS_FEE,
  'Partial: express falls back to global 200'
);
assert(
  calculatePickupFee('Giza', 0, partialPricing) === 100,
  'Partial: pickup falls back to global 100'
);
assert(
  calculateOrderFee('Giza', 'Deliver', false, fullPricing) === 90,
  'Custom Giza Deliver = 90'
);

console.log('\n=== Disabled pricing — ignores stored values ===\n');
const disabledDoc = {
  customPricing: {
    enabled: false,
    order: { Cairo: { Deliver: 50, Return: 50, Exchange: 50 } },
    expressFee: 99,
    pickupFee: 55,
  },
};
assert(resolveBusinessPricing(disabledDoc) === null, 'Disabled pricing resolves to null');
assert(
  calculateOrderFee('Cairo', 'Deliver', false, disabledDoc.customPricing) === 100,
  'Disabled: uses global even if values exist on object passed directly'
);

console.log('\n=== businessPricingService helpers ===\n');
const normalized = normalizePricingInput({
  enabled: true,
  order: {
    Cairo: { Deliver: '80', Return: '', Exchange: 85 },
  },
  expressFee: '',
  pickupFee: 70,
  note: 'Volume discount',
});
assert(normalized.enabled === true, 'normalize: enabled true');
assert(normalized.order.Cairo.Deliver === 80, 'normalize: string number parsed');
assert(normalized.order.Cairo.Return === null, 'normalize: empty string -> null');
assert(normalized.expressFee === null, 'normalize: empty express -> null');
assert(normalized.pickupFee === 70, 'normalize: pickup fee parsed');
assert(normalized.note === 'Volume discount', 'normalize: note preserved');

const snap = snapshotPricing({
  enabled: true,
  order: { Cairo: { Deliver: 80 } },
  expressFee: 180,
  pickupFee: null,
  updatedByName: 'Admin',
  updatedAt: new Date(),
});
assert(snap.order.Cairo.Deliver === 80, 'snapshot: preserves custom Deliver');
assert(snap.order.Giza.Return === null, 'snapshot: fills missing with null');

const legacySnap = snapshotPricing({
  enabled: true,
  order: {
    Cairo: { Deliver: 65, Return: 70, Exchange: null },
    Alexandria: { Deliver: null, Return: null, Exchange: null },
    'Delta-Canal': { Deliver: null, Return: null, Exchange: null },
    'Upper-RedSea': { Deliver: null, Return: null, Exchange: null },
  },
});
assert(legacySnap.order.Giza.Deliver === 65, 'legacy broad Cairo fee maps to Giza');
assert(legacySnap.order.Qalyubia.Return === 70, 'legacy broad Cairo fee maps to Qalyubia');
assert(getGlobalDefaults().expressFee === GLOBAL_EXPRESS_FEE, 'global defaults include express');

console.log('\n=== Validation ===\n');
let threw = false;
try {
  normalizePricingInput({ enabled: true, order: {}, expressFee: -5 });
} catch (e) {
  threw = true;
  assert(e.message.includes('non-negative'), 'reject negative fee');
}
assert(threw, 'negative fee throws');

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
