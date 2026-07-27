const crypto = require('crypto');
const bcrypt = require('bcrypt');
const User = require('../models/user');
const Courier = require('../models/courier');
const { validateGovernmentAndZone } = require('../utils/deliveryZonesBosta');
const { findMerchantForCompany, serializeMerchantSummary } = require('../utils/merchantResolve');

function validateCreateMerchantBody(body) {
  const errors = [];
  const { name, email, phone, brandName, pickupAddress } = body || {};

  if (!name || !String(name).trim()) errors.push('name is required');
  if (!email || !String(email).trim()) errors.push('email is required');
  if (!phone || !String(phone).trim()) errors.push('phone is required');
  if (!brandName || !String(brandName).trim()) errors.push('brandName is required');

  if (!pickupAddress || typeof pickupAddress !== 'object') {
    errors.push('pickupAddress is required');
  } else {
    const { city, zone, addressDetails, pickupPhone } = pickupAddress;
    if (!city || !String(city).trim()) {
      errors.push('pickupAddress.city is required (governorate: Cairo, Giza, or Qalyubia)');
    }
    if (!zone || !String(zone).trim()) {
      errors.push('pickupAddress.zone is required');
    }
    if (!addressDetails || !String(addressDetails).trim()) {
      errors.push('pickupAddress.addressDetails is required');
    }
    if (!pickupPhone || !String(pickupPhone).trim()) {
      errors.push('pickupAddress.pickupPhone is required');
    }

    if (city && zone) {
      const zoneCheck = validateGovernmentAndZone(city, zone);
      if (!zoneCheck.ok) {
        errors.push(
          `${zoneCheck.error} Call GET /delivery-zones and use an exact zone value from the catalog.`
        );
      }
    }
  }

  if (phone && !/^\d{11}$/.test(String(phone).trim())) {
    errors.push('phone must be 11 digits');
  }

  if (pickupAddress?.pickupPhone && !/^\d{11}$/.test(String(pickupAddress.pickupPhone).trim())) {
    errors.push('pickupAddress.pickupPhone must be 11 digits');
  }

  return errors;
}

function buildPickupAddressFromInput(pickupAddress) {
  const zoneCheck = validateGovernmentAndZone(pickupAddress.city, pickupAddress.zone);
  const canonicalCity = zoneCheck.canonicalGovernment || String(pickupAddress.city).trim();
  const canonicalZone = zoneCheck.canonicalZone || String(pickupAddress.zone).trim();

  return {
    city: canonicalCity,
    zone: canonicalZone,
    adressDetails: String(pickupAddress.addressDetails).trim(),
    pickupPhone: String(pickupAddress.pickupPhone).trim(),
    nearbyLandmark: pickupAddress.nearbyLandmark
      ? String(pickupAddress.nearbyLandmark).trim()
      : undefined,
    country: pickupAddress.country ? String(pickupAddress.country).trim() : 'Egypt',
  };
}

async function listMerchantsForCompany(company, query = {}) {
  const { page = 1, limit = 50, search } = query;
  const mongoQuery = {
    parentCompany: company._id,
    role: { $in: ['business', 'Business'] },
    isDeleted: { $ne: true },
  };

  if (search && String(search).trim()) {
    const searchRegex = new RegExp(String(search).trim(), 'i');
    mongoQuery.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { phoneNumber: searchRegex },
      { businessAccountCode: searchRegex },
      { externalMerchantId: searchRegex },
      { 'brandInfo.brandName': searchRegex },
    ];
  }

  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const limitNum = parseInt(limit, 10);

  const merchants = await User.find(mongoQuery)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .select(
      'name email phoneNumber brandInfo businessAccountCode externalMerchantId isCompleted isVerified parentCompany createdAt'
    );

  const totalCount = await User.countDocuments(mongoQuery);

  return {
    merchants: merchants.map(serializeMerchantSummary),
    pagination: {
      currentPage: parseInt(page, 10),
      totalPages: Math.ceil(totalCount / limitNum),
      totalCount,
      hasNext: skip + merchants.length < totalCount,
      hasPrev: parseInt(page, 10) > 1,
    },
  };
}

async function getMerchantForCompany(company, merchantIdValue) {
  const merchant = await findMerchantForCompany(company._id, merchantIdValue);
  if (!merchant) {
    return { ok: false, status: 404, error: 'Merchant not found under this company.' };
  }
  return { ok: true, merchant: serializeMerchantSummary(merchant) };
}

async function createMerchantForCompany(company, body) {
  const validationErrors = validateCreateMerchantBody(body);
  if (validationErrors.length) {
    return {
      ok: false,
      status: 400,
      code: 'VALIDATION_ERROR',
      error: validationErrors.join('; '),
    };
  }

  const { name, email, phone, brandName, pickupAddress, externalMerchantId } = body;
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedPhone = String(phone).trim();

  const [existingEmail, phoneUsedUser, phoneUsedCourier] = await Promise.all([
    User.findOne({ email: normalizedEmail, isDeleted: { $ne: true } }),
    User.findOne({ phoneNumber: normalizedPhone, isDeleted: { $ne: true } }),
    Courier.findOne({ phoneNumber: normalizedPhone }),
  ]);

  if (existingEmail) {
    return {
      ok: false,
      status: 409,
      code: 'MERCHANT_ALREADY_EXISTS',
      error: 'A user with this email already exists.',
    };
  }

  if (phoneUsedUser || phoneUsedCourier) {
    return {
      ok: false,
      status: 409,
      code: 'MERCHANT_ALREADY_EXISTS',
      error: 'A user with this phone number already exists.',
    };
  }

  const normalizedExternalId = externalMerchantId ? String(externalMerchantId).trim() : null;
  if (normalizedExternalId) {
    const existingExternal = await User.findOne({
      parentCompany: company._id,
      externalMerchantId: normalizedExternalId,
      isDeleted: { $ne: true },
    });
    if (existingExternal) {
      return {
        ok: false,
        status: 409,
        code: 'MERCHANT_ALREADY_EXISTS',
        error: 'externalMerchantId is already registered under this company.',
      };
    }
  }

  const pickupData = buildPickupAddressFromInput(pickupAddress);
  const randomPassword = crypto.randomBytes(32).toString('hex');
  const hashedPassword = await bcrypt.hash(randomPassword, 10);

  const addressEntry = {
    addressName: 'Main Address',
    isDefault: true,
    ...pickupData,
  };

  const user = new User({
    name: String(name).trim(),
    email: normalizedEmail,
    phoneNumber: normalizedPhone,
    password: hashedPassword,
    role: 'Business',
    parentCompany: company._id,
    isVerified: true,
    isCompleted: true,
    brandInfo: { brandName: String(brandName).trim() },
    pickUpAdress: pickupData,
    pickUpAddresses: [addressEntry],
    externalMerchantId: normalizedExternalId,
  });

  try {
    await user.save();
  } catch (error) {
    if (error.code === 11000) {
      return {
        ok: false,
        status: 409,
        code: 'MERCHANT_ALREADY_EXISTS',
        error: 'A merchant with these details already exists.',
      };
    }
    throw error;
  }

  return { ok: true, merchant: serializeMerchantSummary(user) };
}

module.exports = {
  listMerchantsForCompany,
  getMerchantForCompany,
  createMerchantForCompany,
};
