/**
 * Excel bulk import for business orders — Deliver only, standard shipping.
 */
const ExcelJS = require('exceljs');
const { validateOrderFieldsStructural, buildOrderDocumentFromFields } = require('./orderCreationHelper');
const { governmentCategories } = require('./fees');
const deliveryZonesBosta = require('./deliveryZonesBosta');

const MAX_ROWS = 500;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Headers normalize to lowercase letters+digits only (see normalizeHeader).
 * Maps normalized header -> internal field key used by buildOrderDocumentFromFields.
 */
const COLUMN_ALIASES = {
  // Core — friendly labels
  customerfullname: 'fullName',
  fullname: 'fullName',
  customername: 'fullName',
  name: 'fullName',

  mobilephone: 'phoneNumber',
  mobilenumber: 'phoneNumber',
  phonenumber: 'phoneNumber',
  phone: 'phoneNumber',
  primaryphone: 'phoneNumber',

  secondaryphoneoptional: 'otherPhoneNumber',
  secondaryphone: 'otherPhoneNumber',
  otherphone: 'otherPhoneNumber',
  otherphonenumber: 'otherPhoneNumber',
  altphone: 'otherPhoneNumber',

  streetaddress: 'address',
  deliveryaddress: 'address',
  address: 'address',

  governorate: 'government',
  government: 'government',

  areazone: 'zone',
  area: 'zone',
  zone: 'zone',

  delivertoworkaddressyn: 'deliverToWorkAddress',
  delivertoworkaddress: 'deliverToWorkAddress',
  delivertowork: 'deliverToWorkAddress',

  productdescription: 'productDescription',
  productdetails: 'productDescription',

  quantity: 'numberOfItems',
  numberofitems: 'numberOfItems',
  items: 'numberOfItems',
  qty: 'numberOfItems',

  cashondeliveryyn: 'COD',
  cashondelivery: 'COD',
  cod: 'COD',

  codamountegp: 'amountCOD',
  amountcod: 'amountCOD',
  codamount: 'amountCOD',

  referralcodeoptional: 'referralNumber',
  referralcode: 'referralNumber',
  referralnumber: 'referralNumber',
  referral: 'referralNumber',

  ordernotesremarks: 'Notes',
  orderremarks: 'Notes',
  fullremarks: 'Notes',
  remarks: 'Notes',
  notes: 'Notes',
  ordernotes: 'Notes',
};

const REQUIRED_HEADERS = [
  'fullName',
  'phoneNumber',
  'address',
  'government',
  'zone',
  'productDescription',
  'numberOfItems',
];

const REQUIRED_HEADER_LABELS = {
  fullName: 'Customer full name',
  phoneNumber: 'Mobile phone',
  address: 'Street address',
  government: 'Governorate',
  zone: 'Area / zone',
  productDescription: 'Product description',
  numberOfItems: 'Quantity',
};

function normalizeHeader(cellValue) {
  if (cellValue == null || String(cellValue).trim() === '') return null;
  return String(cellValue)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function parseYesNo(val) {
  if (val === true) return true;
  if (val === false) return false;
  if (val == null || val === '') return false;
  const s = String(val).trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === '1' || s === 'true';
}

function parseOptionalNumber(val) {
  if (val == null || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * Excel import always creates standard Deliver orders (no express, no pickup ID).
 */
function coerceRowToFields(rowObj) {
  const o = { ...rowObj };

  const numberOfItems = parseOptionalNumber(o.numberOfItems);

  return {
    fullName: o.fullName != null ? String(o.fullName).trim() : '',
    phoneNumber: o.phoneNumber != null ? String(o.phoneNumber).trim() : '',
    otherPhoneNumber: o.otherPhoneNumber ? String(o.otherPhoneNumber).trim() : null,
    address: o.address != null ? String(o.address).trim() : '',
    government: o.government != null ? String(o.government).trim() : '',
    zone: o.zone != null ? String(o.zone).trim() : '',
    deliverToWorkAddress: parseYesNo(o.deliverToWorkAddress),
    orderType: 'Deliver',
    productDescription: o.productDescription != null ? String(o.productDescription).trim() : '',
    numberOfItems,
    currentPD: '',
    numberOfItemsCurrentPD: null,
    newPD: '',
    numberOfItemsNewPD: null,
    COD: parseYesNo(o.COD),
    amountCOD: parseOptionalNumber(o.amountCOD),
    CashDifference: false,
    amountCashDifference: null,
    previewPermission: false,
    referralNumber: o.referralNumber != null ? String(o.referralNumber).trim() : '',
    Notes: o.Notes != null ? String(o.Notes).trim() : '',
    isExpressShipping: false,
    selectedPickupAddressId: null,
    originalOrderNumber: null,
    returnReason: null,
    returnNotes: null,
    isPartialReturn: false,
    originalOrderItemCount: null,
    partialReturnItemCount: null,
  };
}

/**
 * @returns {Promise<{ error?: string, rows?: Array<{ excelRow: number, fields: object }>, ignoredHeaders?: string[] }>}
 */
async function parseOrdersWorkbook(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { error: 'Invalid file.' };
  }
  if (buffer.length > MAX_FILE_BYTES) {
    return { error: `File too large (max ${MAX_FILE_BYTES / (1024 * 1024)} MB).` };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (e) {
    return { error: 'Could not read Excel file. Use .xlsx format and the provided template.' };
  }

  let sheet = workbook.getWorksheet('Orders');
  if (!sheet) {
    sheet = workbook.worksheets[0];
  }
  if (!sheet) {
    return { error: 'No worksheet found. Add a sheet named "Orders" or use the template.' };
  }

  const headerRow = sheet.getRow(1);
  const headerMap = new Map();
  const ignoredHeaders = [];

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const raw = cell.value != null ? String(cell.value) : '';
    const norm = normalizeHeader(raw);
    if (!norm) return;
    const key = COLUMN_ALIASES[norm];
    if (key) {
      if (!headerMap.has(colNumber)) headerMap.set(colNumber, key);
    } else {
      ignoredHeaders.push(raw.trim());
    }
  });

  for (const req of REQUIRED_HEADERS) {
    const has = [...headerMap.values()].includes(req);
    if (!has) {
      const label = REQUIRED_HEADER_LABELS[req] || req;
      return {
        error: `Missing required column: "${label}". Download the latest template and keep the header row intact.`,
      };
    }
  }

  const rows = [];
  const rowCount = sheet.rowCount;
  for (let r = 2; r <= rowCount; r++) {
    const row = sheet.getRow(r);
    const obj = {};
    let any = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = headerMap.get(colNumber);
      if (!key) return;
      let val = cell.value;
      if (val && typeof val === 'object' && val.text) val = val.text;
      if (val != null && val !== '') any = true;
      obj[key] = val;
    });
    if (!any) continue;

    rows.push({
      excelRow: r,
      fields: coerceRowToFields(obj),
    });
    if (rows.length > MAX_ROWS) {
      return { error: `Too many data rows (max ${MAX_ROWS}). Split into multiple files.` };
    }
  }

  if (rows.length === 0) {
    return { error: 'No data rows found below the header row.' };
  }

  return { rows, ignoredHeaders: [...new Set(ignoredHeaders)] };
}

async function validateImportRows(_businessId, parsed) {
  const rowResults = [];
  let validCount = 0;

  for (const { excelRow, fields } of parsed.rows) {
    const errors = [];
    const structural = validateOrderFieldsStructural(fields);
    errors.push(...structural.errors);

    if (errors.length === 0) {
      const bosta = deliveryZonesBosta.validateGovernmentAndZone(fields.government, fields.zone);
      if (!bosta.ok) {
        errors.push(bosta.error);
      } else {
        fields.government = bosta.canonicalGovernment;
        fields.zone = bosta.canonicalZone;
      }
    }

    if (errors.length === 0) {
      validCount += 1;
    }

    rowResults.push({
      row: excelRow,
      errors,
      preview: {
        fullName: fields.fullName,
        orderType: 'Deliver',
        phoneNumber: fields.phoneNumber,
      },
    });
  }

  const invalidRows = rowResults.filter((r) => r.errors.length > 0);
  const ok = invalidRows.length === 0;

  return {
    ok,
    validCount,
    invalidCount: invalidRows.length,
    rows: rowResults,
  };
}

async function buildImportTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const cairoZones = deliveryZonesBosta.getCairoZoneValues();
  const cairoCount = cairoZones.length;
  const sampleZone = cairoZones[0] || '';

  const govHidden = workbook.addWorksheet('Gov');
  govHidden.getCell(1, 1).value = 'Cairo';
  govHidden.state = 'hidden';

  const areasHidden = workbook.addWorksheet('Areas');
  cairoZones.forEach((z, i) => {
    areasHidden.getCell(i + 1, 1).value = z;
  });
  areasHidden.state = 'hidden';

  const orders = workbook.addWorksheet('Orders');

  const headers = [
    'Customer full name',
    'Mobile phone',
    'Secondary phone (optional)',
    'Street address',
    'Governorate',
    'Area / zone',
    'Deliver to work address (Y/N)',
    'Product description',
    'Quantity',
    'Cash on delivery (Y/N)',
    'COD amount (EGP)',
    'Referral code (optional)',
    'Order notes / remarks',
  ];

  orders.addRow(headers);
  orders.getRow(1).font = { bold: true };

  orders.addRow([
    'Ahmed Hassan',
    '01012345678',
    '',
    '12 Nile Corniche, Apt 4',
    'Cairo',
    sampleZone,
    'N',
    'Wireless headphones — black',
    '2',
    'Y',
    '850',
    'SUMMER10',
    'Call before delivery. Gate code 4321.',
  ]);

  const widths = [22, 16, 22, 36, 14, 16, 26, 32, 10, 22, 16, 18, 48];
  widths.forEach((w, i) => {
    orders.getColumn(i + 1).width = w;
  });

  const maxDataRows = 500;
  orders.dataValidations.add(`E2:E${maxDataRows + 1}`, {
    type: 'list',
    allowBlank: false,
    formulae: ['Gov!$A$1:$A$1'],
    showInputMessage: true,
    promptTitle: 'Governorate',
    prompt: 'Cairo only.',
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: 'Governorate',
    error: 'Must be Cairo.',
  });
  orders.dataValidations.add(`F2:F${maxDataRows + 1}`, {
    type: 'list',
    allowBlank: false,
    formulae: [`Areas!$A$1:$A$${cairoCount}`],
    showInputMessage: true,
    promptTitle: 'Area / zone',
    prompt: 'Pick from the list (same as Create order).',
    showErrorMessage: true,
    errorStyle: 'warning',
    errorTitle: 'Area / zone',
    error: 'Pick from the list.',
  });

  const instr = workbook.addWorksheet('Instructions');
  instr.getColumn(1).width = 44;
  instr.getColumn(2).width = 88;

  const govList = Object.entries(governmentCategories)
    .map(([cat, govs]) => `${cat}: ${govs.join(', ')}`)
    .join('\n');

  const lines = [
    ['Deliver orders — Excel import', ''],
    ['', ''],
    [
      'What this file does',
      'Each row creates one normal delivery order for your business. Shipping is standard (not express). Use the website for returns, exchanges, or express shipping.',
    ],
    ['', ''],
    [
      'Governorate & zone',
      'Governorate is Cairo. Area must match the dropdown (same zones as Create order).',
    ],
    ['', ''],
    [
      'Steps',
      '1) Delete the sample row on the Orders sheet.\n2) Fill one row per order.\n3) In the app: Validate, then Import orders.',
    ],
    ['', ''],
    [
      'Cash on delivery',
      'Set "Cash on delivery (Y/N)" to Y or N. If Y, put the collection amount in "COD amount (EGP)". If N, you can leave the amount empty.',
    ],
    ['', ''],
    [
      'Flags',
      '"Deliver to work address (Y/N)" is optional; use Y or N.',
    ],
    ['', ''],
    ['Governorates (fee categories)', govList],
    ['', ''],
    [
      'Need help?',
      'Download a fresh template if columns are missing or renamed. Unrecognized extra columns are ignored.',
    ],
  ];

  lines.forEach((pair, i) => {
    instr.addRow(pair);
    if (i === 0) instr.getRow(i + 1).font = { bold: true, size: 14 };
  });

  const tabOrder = ['Orders', 'Instructions', 'Gov', 'Areas'];
  tabOrder.forEach((name, i) => {
    const ws = workbook.getWorksheet(name);
    if (ws) ws.orderNo = i + 1;
  });

  return workbook;
}

module.exports = {
  MAX_ROWS,
  MAX_FILE_BYTES,
  parseOrdersWorkbook,
  validateImportRows,
  buildImportTemplateWorkbook,
};
