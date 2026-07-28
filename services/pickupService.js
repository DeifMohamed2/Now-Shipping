const mongoose = require('mongoose');
const User = require('../models/user');
const Pickup = require('../models/pickup');
const firebase = require('../config/firebase');
const statusHelper = require('../utils/statusHelper');
const { calculatePickupFee: calcPickupFee } = require('../utils/fees');
const { resolveEffectivePricing } = require('../utils/effectivePricing');
const { resolvePickupAddressForOrder } = require('../utils/pickupAddressResolve');
const {
  isValidPickupDate,
  getPickupDateTooEarlyApiError,
} = require('../utils/pickupDatePolicy');
const {
  canBusinessCancelPickupStatus,
  canBusinessEditPickupStatus,
  canBusinessHardDeletePickupStatus,
} = require('../utils/pickupCancellation');

const FEE_FIELDS_TO_STRIP = ['pickupFees', 'fee', 'amountOfFees'];

function stripClientPickupFeeFields(body) {
  if (!body || typeof body !== 'object') return {};
  const copy = { ...body };
  for (const key of FEE_FIELDS_TO_STRIP) {
    delete copy[key];
  }
  return copy;
}

async function findPickupByIdOrNumber(pickupIdOrNumber, extraPopulates = []) {
  if (pickupIdOrNumber == null || String(pickupIdOrNumber).trim() === '') {
    return null;
  }
  const raw = String(pickupIdOrNumber).trim();

  const buildQuery = (filter) => {
    let q = Pickup.findOne(filter).populate('business');
    extraPopulates.forEach((path) => {
      q = q.populate(path);
    });
    return q;
  };

  let pickup = null;
  if (mongoose.Types.ObjectId.isValid(raw)) {
    pickup = await buildQuery({ _id: raw });
  }
  if (!pickup) {
    pickup = await buildQuery({ pickupNumber: raw });
  }
  return pickup;
}

function resolveSelectedPickupAddress(business, pickupAddressId) {
  let selectedAddress = null;
  if (pickupAddressId && business.pickUpAddresses && business.pickUpAddresses.length > 0) {
    selectedAddress = business.pickUpAddresses.find((addr) => addr.addressId === pickupAddressId);
  }
  if (!selectedAddress && business.pickUpAddresses && business.pickUpAddresses.length > 0) {
    selectedAddress =
      business.pickUpAddresses.find((addr) => addr.isDefault) || business.pickUpAddresses[0];
  }
  return selectedAddress;
}

async function computePickupFeeForBusiness(business, pickupAddressId, numberOfOrders = 0) {
  const selectedAddress = resolveSelectedPickupAddress(business, pickupAddressId);
  const businessCity = selectedAddress?.city || business?.pickUpAdress?.city || 'Cairo';
  const count = parseInt(numberOfOrders, 10) || 0;
  const pricing = await resolveEffectivePricing(business);
  return calcPickupFee(businessCity, count, pricing);
}

async function createPickupForBusiness(business, body) {
  const sanitized = stripClientPickupFeeFields(body);
  const {
    numberOfOrders,
    pickupDate,
    phoneNumber,
    isFragileItems,
    isLargeItems,
    pickupNotes,
    pickupLocation,
    pickupAddressId,
  } = sanitized;

  if (!numberOfOrders || !pickupDate || !phoneNumber) {
    return { ok: false, status: 400, error: 'All pickup info fields are required.' };
  }
  if (!isValidPickupDate(pickupDate)) {
    return { ok: false, status: 400, error: getPickupDateTooEarlyApiError() };
  }

  const businessDoc = business._id ? await User.findById(business._id) : business;
  const selectedAddress = resolveSelectedPickupAddress(businessDoc, pickupAddressId);
  const computedPickupFee = await computePickupFeeForBusiness(businessDoc, pickupAddressId, 0);
  const pickupPhoneNumber =
    phoneNumber || selectedAddress?.pickupPhone || businessDoc.phoneNumber || '';

  const newPickup = new Pickup({
    business: businessDoc._id,
    pickupNumber: `${Math.floor(Math.random() * (900000 - 100000 + 1)) + 100000}`,
    numberOfOrders,
    pickupDate,
    phoneNumber: pickupPhoneNumber,
    isFragileItems: isFragileItems === 'true' || isFragileItems === true,
    isLargeItems: isLargeItems === 'true' || isLargeItems === true,
    picikupStatus: 'new',
    pickupNotes,
    pickupFees: computedPickupFee,
    pickupAddressId: pickupAddressId || selectedAddress?.addressId || null,
    pickupLocation:
      pickupLocation ||
      (selectedAddress
        ? `${selectedAddress.adressDetails}, ${selectedAddress.city}, ${selectedAddress.country}`
        : ''),
  });
  newPickup.pickupStages.push({
    stageName: 'Pickup Created',
    stageDate: new Date(),
    stageNotes: [{ text: 'Pickup has been created.', date: new Date() }],
  });

  const savedPickup = await newPickup.save();
  return { ok: true, status: 201, message: 'Pickup created successfully.', pickup: savedPickup };
}

async function listPickupsForBusiness(business, query = {}) {
  const {
    page = 1,
    limit = 30,
    status,
    statusCategory,
    dateFrom,
    dateTo,
    search,
    pickupType,
  } = query;

  const mongoQuery = { business: business._id };

  if (pickupType === 'Upcoming') {
    mongoQuery.statusCategory = {
      $in: [statusHelper.STATUS_CATEGORIES.NEW, statusHelper.STATUS_CATEGORIES.PROCESSING],
    };
  } else if (pickupType === 'Completed') {
    mongoQuery.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
  }

  if (status && status !== 'all') {
    mongoQuery.picikupStatus = status;
  }
  if (statusCategory && statusHelper.STATUS_CATEGORIES[statusCategory]) {
    mongoQuery.statusCategory = statusCategory;
  }
  if (dateFrom || dateTo) {
    mongoQuery.pickupDate = {};
    if (dateFrom) mongoQuery.pickupDate.$gte = new Date(dateFrom);
    if (dateTo) mongoQuery.pickupDate.$lte = new Date(dateTo);
  }
  if (search && search.trim() !== '') {
    const searchRegex = new RegExp(search.trim(), 'i');
    mongoQuery.$or = [{ pickupNumber: searchRegex }, { phoneNumber: searchRegex }];
  }

  const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const limitNum = parseInt(limit, 10);

  const pickups = await Pickup.find(mongoQuery)
    .sort({ pickupDate: -1, createdAt: -1 })
    .populate('business')
    .populate('assignedDriver')
    .skip(skip)
    .limit(limitNum);

  const totalCount = await Pickup.countDocuments(mongoQuery);

  const enhancedPickups = pickups.map((pickup) => {
    const pickupObj = pickup.toObject();
    pickupObj.statusLabel = statusHelper.getPickupStatusLabel(pickup.picikupStatus);
    pickupObj.statusDescription = statusHelper.getPickupStatusDescription(pickup.picikupStatus);
    pickupObj.categoryClass = statusHelper.getCategoryClass(pickup.statusCategory);
    pickupObj.categoryColor = statusHelper.getCategoryColor(pickup.statusCategory);
    return pickupObj;
  });

  return {
    pickups: enhancedPickups,
    pagination: {
      currentPage: parseInt(page, 10),
      totalPages: Math.ceil(totalCount / limitNum),
      totalCount,
      hasNext: skip + pickups.length < totalCount,
      hasPrev: parseInt(page, 10) > 1,
    },
  };
}

async function getPickupDetailsForBusiness(business, pickupNumber) {
  const pickup = await Pickup.findOne({ pickupNumber, business: business._id })
    .populate('business')
    .populate('assignedDriver');

  if (!pickup) {
    return { ok: false, status: 404, error: 'Pickup not found' };
  }

  const { address: selectedPickupAddress } = resolvePickupAddressForOrder(
    { selectedPickupAddressId: pickup.pickupAddressId },
    pickup.business
  );

  const pickupObj = pickup.toObject();
  pickupObj.statusLabel = statusHelper.getPickupStatusLabel(pickup.picikupStatus);
  pickupObj.statusDescription = statusHelper.getPickupStatusDescription(pickup.picikupStatus);
  pickupObj.categoryClass = statusHelper.getCategoryClass(pickup.statusCategory);
  pickupObj.categoryColor = statusHelper.getCategoryColor(pickup.statusCategory);

  return {
    ok: true,
    pickup: pickupObj,
    selectedPickupAddress,
  };
}

async function cancelPickupForBusiness(business, pickupIdOrNumber) {
  const pickup = await findPickupByIdOrNumber(pickupIdOrNumber, ['assignedDriver']);
  if (!pickup) {
    return { ok: false, status: 404, error: 'Pickup not found' };
  }

  const businessId = pickup.business._id
    ? pickup.business._id.toString()
    : pickup.business.toString();
  if (businessId !== business._id.toString()) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  if (pickup.picikupStatus === 'canceled') {
    return { ok: false, status: 400, error: 'This pickup is already cancelled.' };
  }

  if (!canBusinessCancelPickupStatus(pickup.picikupStatus)) {
    return {
      ok: false,
      status: 400,
      error: 'This pickup can no longer be cancelled — it is already in progress or completed.',
      meta: { currentStatus: pickup.picikupStatus },
    };
  }

  pickup.picikupStatus = 'canceled';
  pickup.pickupStages.push({
    stageName: 'Cancelled',
    stageDate: new Date(),
    stageNotes: [{ text: 'Pickup cancelled by business', date: new Date() }],
  });
  await pickup.save();

  try {
    await firebase.sendPickupStatusNotification(
      pickup.business._id || pickup.business,
      pickup.pickupNumber,
      'canceled',
      { cancelledAt: new Date(), cancelledBy: 'Business' }
    );
  } catch (notificationError) {
    console.error('Failed to send pickup cancellation notification to business:', notificationError);
  }

  if (pickup.assignedDriver) {
    try {
      await firebase.sendPickupStatusNotification(
        pickup.assignedDriver._id,
        pickup.pickupNumber,
        'canceled',
        { cancelledAt: new Date(), cancelledBy: 'Business' }
      );
    } catch (notificationError) {
      console.error('Failed to send pickup cancellation notification to courier:', notificationError);
    }
  }

  return { ok: true, status: 200, message: 'Pickup cancelled successfully.' };
}

async function updatePickupForBusiness(business, pickupIdOrNumber, body) {
  const sanitized = stripClientPickupFeeFields(body);
  const {
    numberOfOrders,
    pickupDate,
    phoneNumber,
    isFragileItems,
    isLargeItems,
    pickupNotes,
    pickupLocation,
    pickupAddressId,
  } = sanitized;

  const pickup = await findPickupByIdOrNumber(pickupIdOrNumber, []);
  if (!pickup) {
    return { ok: false, status: 404, error: 'Pickup not found.' };
  }

  const businessId = pickup.business._id
    ? pickup.business._id.toString()
    : pickup.business.toString();
  if (businessId !== business._id.toString()) {
    return { ok: false, status: 403, error: 'Forbidden.' };
  }

  if (!canBusinessEditPickupStatus(pickup.picikupStatus)) {
    return {
      ok: false,
      status: 400,
      error: 'This pickup can no longer be edited — it is already in progress.',
      meta: { currentStatus: pickup.picikupStatus },
    };
  }

  if (!numberOfOrders || !pickupDate || !phoneNumber) {
    return {
      ok: false,
      status: 400,
      error: 'numberOfOrders, pickupDate and phoneNumber are required.',
    };
  }
  if (!isValidPickupDate(pickupDate)) {
    return { ok: false, status: 400, error: getPickupDateTooEarlyApiError() };
  }

  const businessDoc = pickup.business;
  const addressId = pickupAddressId || pickup.pickupAddressId;
  const selectedAddress = resolveSelectedPickupAddress(businessDoc, addressId);
  const computedPickupFee = computePickupFeeForBusiness(businessDoc, addressId, 0);

  pickup.numberOfOrders = numberOfOrders;
  pickup.pickupDate = pickupDate;
  pickup.phoneNumber = phoneNumber;
  pickup.isFragileItems = isFragileItems === 'true' || isFragileItems === true;
  pickup.isLargeItems = isLargeItems === 'true' || isLargeItems === true;
  pickup.pickupNotes = pickupNotes || pickup.pickupNotes;
  pickup.pickupFees = computedPickupFee;
  if (pickupAddressId) pickup.pickupAddressId = pickupAddressId;
  if (pickupLocation) pickup.pickupLocation = pickupLocation;
  else if (selectedAddress && pickupAddressId) {
    pickup.pickupLocation = `${selectedAddress.adressDetails}, ${selectedAddress.city}, ${selectedAddress.country}`;
  }

  const saved = await pickup.save();
  return { ok: true, status: 200, message: 'Pickup updated successfully.', pickup: saved };
}

async function deletePickupForBusiness(business, pickupIdOrNumber) {
  const pickup = await findPickupByIdOrNumber(pickupIdOrNumber, []);
  if (!pickup) {
    return { ok: false, status: 404, error: 'Pickup not found.' };
  }

  const businessId = pickup.business._id
    ? pickup.business._id.toString()
    : pickup.business.toString();
  if (businessId !== business._id.toString()) {
    return { ok: false, status: 403, error: 'Forbidden.' };
  }

  if (!canBusinessHardDeletePickupStatus(pickup.picikupStatus)) {
    return {
      ok: false,
      status: 400,
      error:
        'This pickup can no longer be deleted — it is already in progress or has been assigned to a driver.',
      meta: { currentStatus: pickup.picikupStatus },
    };
  }

  await Pickup.findByIdAndDelete(pickup._id);
  return { ok: true, status: 200, message: 'Pickup deleted successfully.' };
}

async function calculatePickupFeeForBusiness(business, { numberOfOrders, pickupAddressId } = {}) {
  const businessDoc = business;
  const fee = await computePickupFeeForBusiness(
    businessDoc,
    pickupAddressId,
    numberOfOrders || 0
  );
  return { ok: true, fee };
}

function serializePickupSummary(pickup) {
  const p = pickup.toObject ? pickup.toObject() : pickup;
  return {
    pickupId: p._id,
    pickupNumber: p.pickupNumber,
    pickupDate: p.pickupDate,
    picikupStatus: p.picikupStatus,
    statusCategory: p.statusCategory,
    statusLabel: p.statusLabel || statusHelper.getPickupStatusLabel(p.picikupStatus),
    numberOfOrders: p.numberOfOrders,
    pickupFees: p.pickupFees,
    phoneNumber: p.phoneNumber,
    pickupLocation: p.pickupLocation,
    pickupAddressId: p.pickupAddressId,
    isFragileItems: p.isFragileItems,
    isLargeItems: p.isLargeItems,
    pickupNotes: p.pickupNotes,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

module.exports = {
  findPickupByIdOrNumber,
  createPickupForBusiness,
  listPickupsForBusiness,
  getPickupDetailsForBusiness,
  cancelPickupForBusiness,
  updatePickupForBusiness,
  deletePickupForBusiness,
  calculatePickupFeeForBusiness,
  serializePickupSummary,
};
