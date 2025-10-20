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
  'Cairo': { Deliver: 80, Return: 70, CashCollection: 70, Exchange: 95 },
  'Alexandria': { Deliver: 85, Return: 75, CashCollection: 75, Exchange: 100 },
  'Delta-Canal': { Deliver: 91, Return: 81, CashCollection: 81, Exchange: 106 },
  'Upper-RedSea': { Deliver: 116, Return: 106, CashCollection: 106, Exchange: 131 },
};

const pickupBaseFees = {
  'Cairo': 50,
  'Alexandria': 55,
  'Delta-Canal': 60,
  'Upper-RedSea': 80,
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
  if (isExpressShipping) fee *= 2;
  return fee;
}

function calculatePickupFee(city, pickedCount) {
  const category = resolveCategoryByCity(city);
  const base = pickupBaseFees[category] || 50;
  return pickedCount < 3 ? Math.round(base * 1.3) : base;
}

module.exports = {
  governmentCategories,
  resolveCategoryByCity,
  calculateOrderFee,
  calculatePickupFee,
  orderBaseFees,
  pickupBaseFees,
};





