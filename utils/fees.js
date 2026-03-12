// Centralized fee config and helpers (orders + pickups)

const governmentCategories = {
  'Cairo': ['Cairo', 'Giza', 'Qalyubia'],
  'Alexandria': ['Alexandria', 'Beheira', 'Matrouh'],
  'Delta-Canal': [
    'Dakahlia', 'Sharqia', 'Monufia', 'Gharbia',
    'Kafr el-Sheikh', 'Damietta', 'Port Said', 'Ismailia', 'Suez'
  ],
  'Upper-RedSea': [
    'Fayoum', 'Beni Suef', 'Minya', 'Asyut',
    'Sohag', 'Qena', 'Luxor', 'Aswan', 'Red Sea',
    'North Sinai', 'South Sinai', 'New Valley'
  ]
};

const orderBaseFees = {
  'Cairo': { Deliver: 100, Return: 100, Exchange: 100, 'Cash Collection': 100 },
  'Alexandria': { Deliver: 100, Return: 100, Exchange: 100, 'Cash Collection': 100 },
  'Delta-Canal': { Deliver: 100, Return: 100, Exchange: 100, 'Cash Collection': 100 },
  'Upper-RedSea': { Deliver: 100, Return: 100, Exchange: 100, 'Cash Collection': 100 },
};

const pickupBaseFees = {
  'Cairo': 100,
  'Alexandria': 100,
  'Delta-Canal': 100,
  'Upper-RedSea': 100,
};

function resolveCategoryByCity(city) {
  let category = 'Cairo';
  for (const [cat, govs] of Object.entries(governmentCategories)) {
    if (govs.includes(city)) { category = cat; break; }
  }
  return category;
}

function calculateOrderFee(city, orderType, isExpressShipping) {
  const category = resolveCategoryByCity(city);
  let fee = orderBaseFees[category]?.[orderType] || 0;
  // Fast shipping (isExpressShipping) is always 200 EGP
  if (isExpressShipping) return 200;
  return fee;
}

function calculatePickupFee(city, pickedCount) {
  return 100; // All pickup fees 100 EGP
}

module.exports = {
  governmentCategories,
  resolveCategoryByCity,
  calculateOrderFee,
  calculatePickupFee,
  orderBaseFees,
  pickupBaseFees,
};





