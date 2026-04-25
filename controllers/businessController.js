const PDFDocument = require('pdfkit');
const firebase = require('../config/firebase');
const User = require('../models/user');
const Order = require('../models/order');
const Pickup = require('../models/pickup');
const Courier = require('../models/courier');
const ShopProduct = require('../models/shopProduct');
const ShopOrder = require('../models/shopOrder');
const nodemailer = require('nodemailer');
const statusHelper = require('../utils/statusHelper');
const ExcelJS = require('exceljs');
const { emailService } = require('../utils/email');
const { uploadFile, deleteFile } = require('../utils/fileUpload');
const { calculateOrderFee, calculatePickupFee: calcPickupFee, orderBaseFees } = require('../utils/fees');
const puppeteer = require('puppeteer');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const { getPuppeteerLaunchOptions } = require('../utils/puppeteerLaunch');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
  normalizeFieldsFromBody,
  validateOrderFieldsStructural,
  applyPickupDefaults,
  validatePickupForOrderCreation,
  validateReturnOrderAsync,
  buildOrderDocumentFromFields,
  generateUniqueOrderNumber,
} = require('../utils/orderCreationHelper');
const orderBulkImport = require('../utils/orderBulkImport');
const { resolvePickupAddressForOrder } = require('../utils/pickupAddressResolve');
const {
  canBusinessCancelPickupStatus,
  canBusinessEditPickupStatus,
  canBusinessHardDeletePickupStatus,
} = require('../utils/pickupCancellation.js');
const {
  canBusinessCancel,
  canBusinessChangeAddress,
  ADDRESS_EDITABLE_STATUSES,
} = require('../utils/orderUiPolicy');
const { applyBusinessLikeCancellation } = require('../utils/orderCancellationFlow');
const orderWaitingActionPolicy = require('../utils/orderWaitingActionPolicy');
const {
  DASHBOARD_HEATMAP_TIMEZONE,
  resolveDashboardRange,
  pctDelta,
} = require('../utils/dashboardMetricHelpers');

const normalizeBusinessLanguage = (language) => {
  const normalized = String(language || '').trim().toLowerCase();
  return normalized === 'ar' || normalized === 'en' ? normalized : null;
};

/** True when MongoDB cannot run multi-document transactions (typical standalone dev server). */
function isMongoTransactionUnsupported(err) {
  if (!err) return false;
  const code = err.code ?? err.codeNumber;
  if (code === 20) return true;
  const m = String(err.message || err.errmsg || '');
  return /replica set|Transaction numbers are only allowed|transactions are not supported|Multi-document transactions require replica set/i.test(
    m
  );
}

// Ensure all models are properly registered with Mongoose
require('../models/courier');
require('../models/shopProduct');
require('../models/shopOrder');
// Transporter is centralized in utils/email via emailService

//================================================ Dashboard  ================================================= //
// Cache: keyed by userId+range, 60s TTL
const dashboardCache = new Map();
const DASHBOARD_CACHE_TTL = 60 * 1000;

const getDashboardPage = async (req, res) => {
  try {
    res.render('business/dashboard', {
      title: req.translations.business.pages.dashboard.title,
      page_title: req.translations.business.pages.dashboard.title,
      folder: req.translations.business.breadcrumb.pages,
      user: req.userData,
    });
  } catch (error) {
    console.error('Error rendering dashboard:', error);
    res.render('business/dashboard', {
      title: req.translations.business.pages.dashboard.title,
      page_title: req.translations.business.pages.dashboard.title,
      folder: req.translations.business.breadcrumb.pages,
      user: req.userData,
      error: 'Failed to load dashboard',
    });
  }
};

// Dashboard data API — supports ?range=today|7d|30d|90d|ytd|custom&from=&to=
const getDashboardData = async (req, res) => {
  try {
    if (!req.userData.isCompleted) {
      return res.status(200).json({ status: 'success', dashboardData: {} });
    }

    const businessId = req.userData._id;
    const { range = '30d', from, to } = req.query;
    const cacheKey = `db_${businessId}_${range}_${from || ''}_${to || ''}`;

    const cached = dashboardCache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < DASHBOARD_CACHE_TTL) {
      return res.status(200).json({ status: 'success', dashboardData: cached.data });
    }

    const { start, end, prevStart, prevEnd } = resolveDashboardRange(range, from, to);

    // ── helpers ──────────────────────────────────────────────────────────
    const matchCurrent  = { business: businessId, orderDate: { $gte: start, $lte: end } };
    const matchPrevious = { business: businessId, orderDate: { $gte: prevStart, $lte: prevEnd } };

    // KPI pipeline (current period)
    function kpiPipeline(matchFilter) {
      return Order.aggregate([
        { $match: matchFilter },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            completedCount:       { $sum: { $cond: [{ $eq: ['$orderStatus', 'completed'] }, 1, 0] } },
            returnCount:          { $sum: { $cond: [{ $in: ['$orderStatus', ['returned', 'returnCompleted', 'returnToBusiness']] }, 1, 0] } },
            cancelCount:          { $sum: { $cond: [{ $in: ['$orderStatus', ['canceled', 'rejected', 'terminated', 'deliveryFailed']] }, 1, 0] } },
            activeCount:          { $sum: { $cond: [{ $in: ['$orderStatus', ['inProgress', 'headingToCustomer', 'new', 'inStock', 'waitingAction']] }, 1, 0] } },
            revenue: {
              $sum: {
                $cond: [
                  { $in: ['$orderStatus', ['completed', 'returnCompleted']] },
                  { $ifNull: ['$feeBreakdown.total', { $ifNull: ['$orderFees', 0] }] },
                  0
                ]
              }
            },
            revenueOrderCount: {
              $sum: {
                $cond: [
                  { $in: ['$orderStatus', ['completed', 'returnCompleted']] },
                  1,
                  0
                ]
              }
            },
            expectedCash: {
              $sum: {
                $cond: [
                  { $and: [
                    { $in: ['$orderShipping.amountType', ['COD', 'CD']] },
                    { $in: ['$orderStatus', ['headingToCustomer', 'inProgress']] }
                  ]},
                  { $ifNull: ['$orderShipping.amount', 0] }, 0
                ]
              }
            },
            /* COD collected for completed orders in scope (orderDate window) — matches sum(series.daily.codCollected) */
            collectedCash: {
              $sum: {
                $cond: [
                  { $and: [
                    { $eq: ['$orderShipping.amountType', 'COD'] },
                    { $eq: ['$orderStatus', 'completed'] }
                  ]},
                  { $ifNull: ['$orderShipping.amount', 0] }, 0
                ]
              }
            },
          }
        }
      ]);
    }

    // Daily trend series (buckets within current range)
    const useDayBucket = (end.getTime() - start.getTime()) <= 91 * 86400000;
    const dateTruncUnit = useDayBucket ? 'day' : 'month';

    const trendPipeline = Order.aggregate([
      { $match: matchCurrent },
      {
        $group: {
          _id: {
            $dateTrunc: { unit: dateTruncUnit, date: '$orderDate' }
          },
          orders: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$orderStatus', 'completed'] }, 1, 0] } },
          returned:  { $sum: { $cond: [{ $in: ['$orderStatus', ['returned', 'returnCompleted', 'returnToBusiness']] }, 1, 0] } },
          canceled:  { $sum: { $cond: [{ $in: ['$orderStatus', ['canceled', 'rejected', 'terminated', 'deliveryFailed']] }, 1, 0] } },
          revenue: {
            $sum: {
              $cond: [
                { $in: ['$orderStatus', ['completed', 'returnCompleted']] },
                { $ifNull: ['$feeBreakdown.total', { $ifNull: ['$orderFees', 0] }] },
                0
              ]
            }
          },
          shippingFees: {
            $sum: { $ifNull: ['$orderFees', 0] }
          },
          codCollected: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$orderShipping.amountType', 'COD'] },
                  { $eq: ['$orderStatus', 'completed'] }
                ]},
                { $ifNull: ['$orderShipping.amount', 0] }, 0
              ]
            }
          },
          codExpected: {
            $sum: {
              $cond: [
                { $and: [
                  { $in: ['$orderShipping.amountType', ['COD', 'CD']] },
                  { $in: ['$orderStatus', ['headingToCustomer', 'inProgress']] }
                ]},
                { $ifNull: ['$orderShipping.amount', 0] }, 0
              ]
            }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Status breakdown donut
    const statusBreakdownPipeline = Order.aggregate([
      { $match: matchCurrent },
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Top governorates
    const topGovPipeline = Order.aggregate([
      { $match: matchCurrent },
      {
        $group: {
          _id: '$orderCustomer.government',
          count: { $sum: 1 },
          revenue: {
            $sum: {
              $cond: [
                { $in: ['$orderStatus', ['completed', 'returnCompleted']] },
                { $ifNull: ['$feeBreakdown.total', { $ifNull: ['$orderFees', 0] }] },
                0
              ]
            }
          }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    // Weekday × hour heatmap (local wall clock via IANA tz — DASHBOARD_HEATMAP_TZ)
    const heatmapPipeline = Order.aggregate([
      { $match: matchCurrent },
      {
        $group: {
          _id: {
            dow: { $dayOfWeek: { date: '$orderDate', timezone: DASHBOARD_HEATMAP_TIMEZONE } },
            hour: { $hour: { date: '$orderDate', timezone: DASHBOARD_HEATMAP_TIMEZONE } }
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Recent orders + pickups
    const recentOrdersPipeline = Order.find({ business: businessId })
      .sort({ orderDate: -1 })
      .limit(6)
      .select('orderNumber orderCustomer.fullName orderStatus orderDate orderShipping.amountType orderShipping.amount')
      .lean();

    const recentPickupsPipeline = Pickup.find({ business: businessId })
      .sort({ pickupDate: -1 })
      .limit(6)
      .select('pickupNumber pickupDate numberOfOrders picikupStatus')
      .lean();

    // ── Execute all in parallel ─────────────────────────────────────────
    const [
      kpiCurrentRaw,
      kpiPrevRaw,
      trendSeries,
      statusBreakdown,
      topGov,
      heatmapRaw,
      recentOrders,
      recentPickups
    ] = await Promise.all([
      kpiPipeline(matchCurrent),
      kpiPipeline(matchPrevious),
      trendPipeline,
      statusBreakdownPipeline,
      topGovPipeline,
      heatmapPipeline,
      recentOrdersPipeline,
      recentPickupsPipeline
    ]);

    const cur  = kpiCurrentRaw[0]  || {};
    const prev = kpiPrevRaw[0]     || {};

    const totalOrders     = cur.totalOrders     || 0;
    const completedCount  = cur.completedCount  || 0;
    const revenue         = cur.revenue         || 0;
    const revenueOrderCount = cur.revenueOrderCount || 0;
    const avgOrderValue   = revenueOrderCount > 0 ? parseFloat((revenue / revenueOrderCount).toFixed(2)) : 0;
    const successRate = totalOrders > 0 ? parseFloat(((completedCount / totalOrders) * 100).toFixed(1)) : 0;
    const returnRate  = totalOrders > 0 ? parseFloat(((( cur.returnCount || 0) / totalOrders) * 100).toFixed(1)) : 0;
    const cancelRate  = totalOrders > 0 ? parseFloat(((( cur.cancelCount || 0) / totalOrders) * 100).toFixed(1)) : 0;

    const dashboardData = {
      range: { from: start.toISOString(), to: end.toISOString() },
      kpi: {
        totalOrders,
        completedCount,
        activeCount:      cur.activeCount      || 0,
        revenue,
        avgOrderValue,
        expectedCash:     cur.expectedCash     || 0,
        collectedCash:    cur.collectedCash    || 0,
        successRate,
        returnRate,
        cancelRate,
        delta: {
          totalOrders:   pctDelta(cur.totalOrders   || 0, prev.totalOrders   || 0),
          revenue:       pctDelta(cur.revenue        || 0, prev.revenue        || 0),
          completedCount:pctDelta(cur.completedCount || 0, prev.completedCount || 0),
          collectedCash: pctDelta(cur.collectedCash  || 0, prev.collectedCash  || 0),
        },
      },
      series: {
        daily: trendSeries.map(b => ({
          date:          b._id,
          orders:        b.orders,
          completed:     b.completed,
          returned:      b.returned,
          canceled:      b.canceled,
          revenue:       b.revenue,
          shippingFees:  b.shippingFees,
          codCollected:  b.codCollected,
          codExpected:   b.codExpected,
        })),
        status: statusBreakdown.map(s => ({ status: s._id, count: s.count })),
        geo:    topGov.map(g => ({ name: g._id || 'Unknown', count: g.count, revenue: g.revenue })),
        heatmap: heatmapRaw.map(h => ({ dow: h._id.dow, hour: h._id.hour, count: h.count })),
      },
      recent: { recentOrders, recentPickups }
    };

    // Cache result
    dashboardCache.set(cacheKey, { data: dashboardData, ts: Date.now() });
    if (dashboardCache.size > 200) {
      dashboardCache.delete(dashboardCache.keys().next().value);
    }

    return res.status(200).json({ status: 'success', dashboardData });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load dashboard data', error: error.message });
  }
};

function normalizeSellingPointsArray(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeSocialLinksInput(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isValidHttpUrlString(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseCoordinatesInput(raw) {
  if (!raw) return null;

  if (typeof raw === 'object' && raw !== null) {
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
    return null;
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const lat = Number(parsed.lat);
        const lng = Number(parsed.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng };
        }
      }
    } catch {
      // Not JSON, try comma-separated coordinates next.
    }

    const parts = trimmed.split(',').map((part) => part.trim());
    if (parts.length === 2) {
      const lat = Number(parts[0]);
      const lng = Number(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
}

const completionConfirm = async (req, res) => {
  try {
    const {
      IPAorPhoneNumber,
      mobileWalletNumber,
      accountName,
      accountNumber,
      IBAN,
      bankName,
      brandName,
      brandType,
      industry,
      monthlyOrders,
      sellingPoints,
      socialLinks,
      country,
      city,
      adressDetails,
      pickupPhone,
      nearbyLandmark,
      paymentMethod,
      nationalId,
      photosOfBrandType,
      taxNumber,
      pickUpPointCoordinates,
      pickUpPointInMaps,
      coordinates,
      zone
    } = req.body;

    console.log(req.userData);

    const sellingPointsArr = normalizeSellingPointsArray(sellingPoints);
    const socialLinksNorm = normalizeSocialLinksInput(socialLinks);

    // ✅ 1. Validate required fields
    if (!brandName || !brandType || !industry || !monthlyOrders || !sellingPointsArr.length) {
      return res.status(400).json({ error: "All brand info fields are required." });
    }

    for (const ch of sellingPointsArr) {
      if (!isValidHttpUrlString(socialLinksNorm[ch])) {
        return res.status(400).json({
          error:
            'Select at least one sales channel and add a valid full URL (https://…) for each selected channel.',
        });
      }
    }
    if (!country || !city || !adressDetails || !zone) {
      return res.status(400).json({ error: "All address fields are required." });
    }
    if (!paymentMethod) {
      return res.status(400).json({ error: "Payment method is required." });
    }

    if(!req.userData.isVerified){
      return res.status(400).json({ error: "Please verify your email address to complete your account setup." });
    }
    
    // ✅ 2. Validate Payment Method
    let paymentDetails = {};
    console.log(paymentMethod, mobileWalletNumber);
    if (paymentMethod === "instaPay" ) {
      if (!IPAorPhoneNumber) return res.status(400).json({ error: "IPA or Phone Number is required for InstaPay or Mobile Wallet." });
      paymentDetails = { IPAorPhoneNumber };

    }else if(paymentMethod === "mobileWallet")  {
      if (!mobileWalletNumber) return res.status(400).json({ error: "Mobile Wallet Number is required." });
      paymentDetails = { mobileWalletNumber };
    
    } else if (paymentMethod === "bankTransfer") {
      if (!accountName || !accountNumber || !bankName) {
        return res.status(400).json({ error: "Account Name, Account Number, and Bank Name are required for Bank Transfer." });
      }
      paymentDetails = { accountName, accountNumber, bankName };
      // Add IBAN if provided (optional)
      if (IBAN) {
        paymentDetails.IBAN = IBAN;
      }
    } else {
      return res.status(400).json({ error: "Invalid payment method." });
    }

    // ✅ 3. Validate Brand Type
    let brandDetails = {};
    if (brandType === "personal") {
      if (!nationalId || !Array.isArray(photosOfBrandType) || photosOfBrandType.length === 0) {
        return res.status(400).json({ error: "National ID and photos are required for Personal brand type." });
      }
      brandDetails = { nationalId, photos: photosOfBrandType };
    } else if (brandType === "company") {
      if (!taxNumber || !Array.isArray(photosOfBrandType) || photosOfBrandType.length === 0) {
        return res.status(400).json({ error: "Tax Number and photos are required for Company brand type." });
      }
      brandDetails = { taxNumber, photos: photosOfBrandType };
    } else {
      return res.status(400).json({ error: "Invalid brand type." });
    }

    // Helper function to generate random 13-character alphanumeric ID
    const generateRandomId = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < 13; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    // Process coordinates from JSON/object/comma-separated formats.
    const locationCoords = parseCoordinatesInput(pickUpPointCoordinates) || parseCoordinatesInput(coordinates);

    // Process multiple pickup addresses if provided
    let pickUpAddressesArray = [];
    let pickupAddressesInput = req.body.pickupAddresses;
    if (typeof pickupAddressesInput === 'string') {
      try {
        pickupAddressesInput = JSON.parse(pickupAddressesInput);
      } catch {
        pickupAddressesInput = null;
      }
    }

    if (Array.isArray(pickupAddressesInput)) {
      pickUpAddressesArray = pickupAddressesInput.map((addr, index) => {
        const addrCoords = parseCoordinatesInput(addr.coordinates);
        return {
          addressId: addr.addressId || generateRandomId(),
          addressName: addr.addressName || (index === 0 ? 'Main Address' : `Address ${index + 1}`),
          isDefault: addr.isDefault || index === 0,
          country: addr.country || country,
          city: addr.city || city,
          zone: addr.zone || zone,
          adressDetails: addr.adressDetails || addr.adressDetails,
          nearbyLandmark: addr.nearbyLandmark || '',
          pickupPhone: addr.pickupPhone || pickupPhone,
          otherPickupPhone: addr.otherPickupPhone || req.body.otherPickupPhone || '',
          pickUpPointInMaps: addr.pickUpPointInMaps || '',
          coordinates: addrCoords || locationCoords
        };
      });
    } else {
      // If no multiple addresses provided, create one from single address (backward compatibility)
      pickUpAddressesArray = [{
        addressId: generateRandomId(),
        addressName: 'Main Address',
        isDefault: true,
        country,
        city,
        zone,
        adressDetails,
        nearbyLandmark: nearbyLandmark || '',
        pickupPhone,
        otherPickupPhone: req.body.otherPickupPhone || '',
        pickUpPointInMaps: pickUpPointInMaps || '',
        coordinates: locationCoords
      }];
    }

    // ✅ 4. Update Existing User
    const updatedUser = await User.findByIdAndUpdate(
      req.userData._id,
      {
        brandInfo: {
          brandName,
          industry,
          monthlyOrders,
          sellingPoints: sellingPointsArr,
          socialLinks: socialLinksNorm,
        },
        pickUpAdress: {
          country,
          city,
          adressDetails,
          nearbyLandmark: nearbyLandmark || '',
          pickupPhone,
          otherPickupPhone: req.body.otherPickupPhone || '',
          pickUpPointInMaps: pickUpPointInMaps || '',
          coordinates: locationCoords,
          zone  
        },
        pickUpAddresses: pickUpAddressesArray,
        paymentMethod: {
          paymentChoice: paymentMethod,
          details: paymentDetails,
        },
        brandType: {
          brandChoice: brandType,
          brandDetails,
        },
        isCompleted: true,
      },
      { new: true } // Return the updated document
    );

    if (!updatedUser) {
      return res.status(404).json({ error: "User not found." });
    }

    res
      .status(200)
      .json({
        message: 'Account Successfully Fully Completed',
        user: updatedUser,
      });
  

  } catch (error) {
    console.error("Error in completionConfirm:", error);
    res.status(500).json({ error: "Internal server error. Please try again." });
  }
};


async function sendVerificationEmail(user, token) {
  try {
    await emailService.sendVerificationEmail(user, token);
  } catch (e) {
    console.error('Email send failed:', e);
  }
}

//
const requestVerification = async (req, res) => {
try {
  const user = req.userData;


  const verificationToken = user.generateVerificationToken();
  sendVerificationEmail(user, verificationToken);
  user.save();
  res.status(200).json({
    status: 'success',
    message: 'Verification email sent successfully',
  });
}catch (error) {
  console.error('Error in requestVerification:', error);
  res.status(500).json({
    status: 'error',
    message: 'Failed to send verification email',
  });
}
};


//================================================END Dashboard  ================================================= //



//================================================ Orders ================================================= //

const get_ordersPage = async (req, res) => {
  res.render('business/orders' , {
    title: req.translations.business.pages.orders.title,
    page_title: req.translations.business.pages.orders.title,
    folder: req.translations.business.breadcrumb.pages,
  });
};

const get_orders = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      orderType,
      status,
      statusCategory,
      paymentType, // amountType (e.g. COD, CD, NA)
      dateFrom,
      dateTo,
      search
    } = req.query;

    // Build query
    const query = { business: req.userData._id };

    // Filter by order type if provided
    if (orderType && orderType !== 'All') {
      query['orderShipping.orderType'] = orderType;
    }

    // Filter by status if provided
    if (status && status !== 'All') {
      query.orderStatus = status;
    }

    // Filter by status category if provided
    if (statusCategory && statusCategory !== 'All') {
      query.statusCategory = statusCategory;
    }
    
    // Filter by payment/amount type
    if (paymentType && paymentType !== 'All') {
      query['orderShipping.amountType'] = paymentType;
    }

    // Date range filter
    if (dateFrom || dateTo) {
      query.orderDate = {};
      if (dateFrom) query.orderDate.$gte = new Date(dateFrom);
      if (dateTo) query.orderDate.$lte = new Date(dateTo);
    }

    // Text search across key fields
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { orderNumber: searchRegex },
        { 'orderCustomer.fullName': searchRegex },
        { 'orderCustomer.phoneNumber': searchRegex },
        { 'orderShipping.productDescription': searchRegex },
        { 'orderShipping.productDescriptionReplacement': searchRegex }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find(query)
      .sort({ orderDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const totalCount = await Order.countDocuments(query);

    // Enhance orders with status info + UI flags aligned with API rules
    const enhancedOrders = orders.map(order => {
      const orderObj = order.toObject();
      orderObj.statusLabel = statusHelper.getOrderStatusLabel(order.orderStatus);
      orderObj.statusDescription = statusHelper.getOrderStatusDescription(order.orderStatus);
      orderObj.categoryClass = statusHelper.getCategoryClass(order.statusCategory);
      orderObj.categoryColor = statusHelper.getCategoryColor(order.statusCategory);
      orderObj.isFastShipping = order.orderShipping && order.orderShipping.isExpressShipping;
      orderObj.canCancel = canBusinessCancel(order);
      orderObj.canEditAddress = canBusinessChangeAddress(order);
      orderObj.canDelete = order.orderStatus === 'new';
      return orderObj;
    });

    res.status(200).json({
      orders: enhancedOrders || [],
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + orders.length < totalCount,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Error in orders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Professional Excel Export for Orders
const exportOrdersToExcel = async (req, res) => {
  try {
    // Get ALL orders for the business (no filters)
    const orders = await Order.find({ business: req.userData._id })
      .populate('deliveryMan', 'name phone')
      .sort({ orderDate: -1 });
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders Report');
    
    // Define columns
    worksheet.columns = [
      { header: 'Order ID', key: 'orderNumber', width: 15 },
      { header: 'Order Date', key: 'orderDate', width: 15 },
      { header: 'Order Type', key: 'orderType', width: 15 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Customer Name', key: 'customerName', width: 25 },
      { header: 'Phone Number', key: 'phoneNumber', width: 15 },
      { header: 'Address', key: 'address', width: 30 },
      { header: 'Government', key: 'government', width: 15 },
      { header: 'Zone', key: 'zone', width: 15 },
      { header: 'Product Description', key: 'productDescription', width: 30 },
      { header: 'Number of Items', key: 'numberOfItems', width: 15 },
      { header: 'Amount Type', key: 'amountType', width: 15 },
      { header: 'Amount (EGP)', key: 'amount', width: 15 },
      { header: 'Order Fees (EGP)', key: 'orderFees', width: 18 },
      { header: 'Express Shipping', key: 'expressShipping', width: 18 },
      { header: 'Delivery Man', key: 'deliveryMan', width: 20 },
      { header: 'Completed Date', key: 'completedDate', width: 18 },
      { header: 'Notes', key: 'notes', width: 30 }
    ];
    
    // Style header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '2A3950' }
    };
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Add data rows
    orders.forEach(order => {
      const statusLabel = statusHelper.getOrderStatusLabel(order.orderStatus);
      const expressShipping = order.orderShipping?.isExpressShipping ? 'Yes' : 'No';
      const deliveryManName = order.deliveryMan ? order.deliveryMan.name : 'N/A';
      
      worksheet.addRow({
        orderNumber: order.orderNumber,
        orderDate: order.orderDate ? new Date(order.orderDate).toLocaleDateString() : 'N/A',
        orderType: order.orderShipping?.orderType || 'N/A',
        status: statusLabel,
        customerName: order.orderCustomer?.fullName || 'N/A',
        phoneNumber: order.orderCustomer?.phoneNumber || 'N/A',
        address: order.orderCustomer?.address || 'N/A',
        government: order.orderCustomer?.government || 'N/A',
        zone: order.orderCustomer?.zone || 'N/A',
        productDescription: order.orderShipping?.productDescription || 'N/A',
        numberOfItems: order.orderShipping?.numberOfItems || 0,
        amountType: order.orderShipping?.amountType || 'N/A',
        amount: order.orderShipping?.amount || 0,
        orderFees: order.orderFees || 0,
        expressShipping: expressShipping,
        deliveryMan: deliveryManName,
        completedDate: order.completedDate ? new Date(order.completedDate).toLocaleDateString() : 'N/A',
        notes: order.orderNotes || ''
      });
    });
    
    // Style data rows
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = { vertical: 'middle' };
        
        // Color code amounts
        const amountCell = row.getCell('amount');
        if (amountCell.value > 0) {
          amountCell.font = { color: { argb: '10B981' } };
        }
        
        // Color code fees
        const feesCell = row.getCell('orderFees');
        if (feesCell.value > 0) {
          feesCell.font = { color: { argb: 'EF4444' } };
        }
        
        // Color code express shipping
        const expressCell = row.getCell('expressShipping');
        if (expressCell.value === 'Yes') {
          expressCell.font = { color: { argb: 'F59E0B' }, bold: true };
        }
      }
    });
    
    // Add borders
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });
    
    // Set response headers
    const filename = `orders_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Write to response
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (error) {
    console.error('Error exporting orders to Excel:', error);
    res.status(500).json({ error: 'Failed to export orders' });
  }
};

const getOrdersImportTemplate = async (req, res) => {
  try {
    const workbook = await orderBulkImport.buildImportTemplateWorkbook();
    const filename = `orders_import_template.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error building import template:', error);
    res.status(500).json({ error: 'Failed to build template' });
  }
};

const postOrdersImportValidate = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Choose an .xlsx file.' });
    }
    const parsed = await orderBulkImport.parseOrdersWorkbook(req.file.buffer);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const validation = await orderBulkImport.validateImportRows(req.userData._id, parsed);
    res.status(200).json({
      ok: validation.ok,
      validCount: validation.validCount,
      invalidCount: validation.invalidCount,
      rows: validation.rows,
      ignoredHeaders: parsed.ignoredHeaders || [],
    });
  } catch (error) {
    console.error('Error validating order import:', error);
    res.status(500).json({ error: 'Validation failed. Please try again.' });
  }
};

const postOrdersImportCommit = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Choose an .xlsx file.' });
    }
    const parsed = await orderBulkImport.parseOrdersWorkbook(req.file.buffer);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const validation = await orderBulkImport.validateImportRows(req.userData._id, parsed);
    if (!validation.ok) {
      return res.status(400).json({
        error: 'Validation failed. Fix all row errors before importing.',
        invalidCount: validation.invalidCount,
        rows: validation.rows.filter((r) => r.errors.length > 0),
      });
    }

    const created = [];
    const session = await mongoose.startSession();
    try {
      try {
        await session.withTransaction(async () => {
          for (const { fields } of parsed.rows) {
            applyPickupDefaults(req.userData, fields);
            const doc = buildOrderDocumentFromFields(
              req.userData,
              fields,
              await generateUniqueOrderNumber()
            );
            const saved = await doc.save({ session });
            created.push({ orderNumber: saved.orderNumber, orderId: saved._id });
          }
        });
      } catch (txnErr) {
        if (!isMongoTransactionUnsupported(txnErr)) throw txnErr;
        console.warn(
          'Order import: MongoDB transactions unavailable; saving orders without a transaction (use a replica set for atomic bulk import).',
          txnErr.message
        );
        created.length = 0;
        for (const { fields } of parsed.rows) {
          applyPickupDefaults(req.userData, fields);
          const doc = buildOrderDocumentFromFields(
            req.userData,
            fields,
            await generateUniqueOrderNumber()
          );
          const saved = await doc.save();
          created.push({ orderNumber: saved.orderNumber, orderId: saved._id });
        }
      }
    } finally {
      await session.endSession();
    }

    res.status(201).json({
      message: `Successfully imported ${created.length} orders.`,
      createdCount: created.length,
      orders: created,
    });
  } catch (error) {
    console.error('Error committing order import:', error);
    res.status(500).json({ error: 'Import failed. No orders were saved. Please try again.' });
  }
};


const get_createOrderPage = async (req, res) => {
  try {
    const user = await User.findById(req.userData._id).lean();
    res.render('business/create-order', {
      title: req.translations.business.pages.createOrder.title,
      page_title: req.translations.business.pages.createOrder.title,
      folder: req.translations.business.breadcrumb.pages,
      user: user,
      userData: user
    });
  } catch (error) {
    console.error('Error in get_createOrderPage:', error);
    res.render('business/create-order', {
      title: req.translations.business.pages.createOrder.title,
      page_title: req.translations.business.pages.createOrder.title,
      folder: req.translations.business.breadcrumb.pages,
      user: req.userData,
      userData: req.userData
    });
  }
}


/**
 * Submit a new order with proper status categorization
 */
const submitOrder = async (req, res) => {
  try {
    console.log(req.body);

    const fields = normalizeFieldsFromBody(req.body);
    applyPickupDefaults(req.userData, fields);

    const structural = validateOrderFieldsStructural(fields);
    if (structural.errors.length) {
      return res.status(400).json({ error: structural.errors[0] });
    }

    const pickupVal = validatePickupForOrderCreation(req.userData, fields);
    if (pickupVal.errors.length) {
      return res.status(400).json({ error: pickupVal.errors[0] });
    }

    const returnVal = await validateReturnOrderAsync(req.userData._id, fields);
    if (returnVal.errors.length) {
      return res.status(400).json({ error: returnVal.errors[0] });
    }

    const orderNumber = await generateUniqueOrderNumber();
    const newOrder = buildOrderDocumentFromFields(req.userData, fields, orderNumber);
    const savedOrder = await newOrder.save();
    res.status(201).json({ message: 'Order created successfully.', order: savedOrder });
  } catch (error) {
    console.error('Error in submitOrder:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};



const get_editOrderPage = async (req, res) => {
  const { orderNumber } = req.params;

  try{
    const order = await Order
    .findOne({ orderNumber, business: req.userData._id })
    .populate('business');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!canBusinessChangeAddress(order)) {
      req.flash(
        'error',
        req.translations?.business?.pages?.orderDetails?.addressEditLocked ||
          'Address and order details cannot be edited — a courier may already be assigned, or this order is past the editable stage.'
      );
      return res.redirect(`/business/order-details/${order.orderNumber}`);
    }

    res.render('business/edit-order' , {
      title: req.translations.business.pages.editOrder.title,
      page_title: req.translations.business.pages.editOrder.title,
      folder: req.translations.business.breadcrumb.pages,
      order
    });


  }catch (error) {
    console.error("Error in get_editOrderPage:", error);
    res.render('business/edit-order', {
      title: req.translations.business.pages.editOrder.title,
      page_title: req.translations.business.pages.editOrder.title,
      folder: req.translations.business.breadcrumb.pages,
      order: null,
    });

  }


};




const editOrder = async (req, res) => {
  const { orderId } = req.params;
  const {
    fullName,
    phoneNumber,
    otherPhoneNumber,
    address,
    government,
    zone,
    deliverToWorkAddress,
    orderType,
    productDescription,
    numberOfItems,
    COD,
    amountCOD,
    currentPD,
    numberOfItemsCurrentPD,
    newPD,
    numberOfItemsNewPD,
    CashDifference,
    amountCashDifference,
    previewPermission,
    referralNumber,
    Notes,
    isExpressShipping
  } = req.body;

  try {
    const order = await findOrderByIdOrNumber(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify the order belongs to the user's business
    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'You do not have permission to edit this order' });
    }

    if (!canBusinessChangeAddress(order)) {
      return res.status(403).json({
        error:
          'Address and order details cannot be edited — a courier may already be assigned, or this order is past the editable stage.',
        orderStatus: order.orderStatus,
        allowedStatuses: Array.from(ADDRESS_EDITABLE_STATUSES),
        courierAssigned: Boolean(order.deliveryMan),
      });
    }

    // Use existing order type if not provided in form (since radio buttons are disabled in form)
    const updatedOrderType = orderType || order.orderShipping.orderType;

    // Validate required fields
    if (!fullName || !phoneNumber || !address || !government || !zone) {
      return res.status(400).json({ error: 'All customer info fields are required' });
    }

    // Check if order was created more than 6 hours ago
    const orderCreationTime = new Date(order.createdAt).getTime();
    const currentTime = new Date().getTime();
    const sixHoursInMs = 6 * 60 * 60 * 1000;
    const isOrderOlderThanSixHours = (currentTime - orderCreationTime) > sixHoursInMs;
    
    // Convert isExpressShipping to boolean for comparison
    const requestedExpressShipping = isExpressShipping === true || isExpressShipping === 'true' || isExpressShipping === 'on';
    const currentExpressShipping = order.orderShipping.isExpressShipping;

    // Check if user is trying to change express shipping on an old order
    if (isOrderOlderThanSixHours && requestedExpressShipping !== currentExpressShipping) {
      return res.status(403).json({ 
        error: 'Express shipping option cannot be changed for orders older than 6 hours.',
        orderAge: 'old'
      });
    }

    // Calculate fees based on updated information
    const expressShippingValue = requestedExpressShipping;
    const orderFees = calculateFees(government, updatedOrderType, expressShippingValue);

    // Determine the amount value based on order type
    let amountFromConditions = 0;
    let amountType = 'NA';
    
    if (COD === 'on' || COD === true) {
      amountType = 'COD';
      amountFromConditions = parseFloat(amountCOD) || 0;
    } else if (CashDifference === 'on' || CashDifference === true) {
      amountType = 'CD';
      amountFromConditions = parseFloat(amountCashDifference) || 0;
    }

    // Get the shipping fee (either from the frontend or calculate it here)
    const calculatedOrderFees = orderFees ? Number(orderFees) : 120; // Default fee if not provided

    // ✅ 3. Update Order (always by Mongo _id; :orderId may be order number)
    const updatedOrder = await Order.findByIdAndUpdate(
      order._id,
      {
      orderCustomer: {
        fullName,
        phoneNumber,
        otherPhoneNumber: otherPhoneNumber || null,
        address,
        government,
        zone,
        deliverToWorkAddress: deliverToWorkAddress === 'on' || deliverToWorkAddress === true,
      },
      orderFees: calculatedOrderFees,
      orderShipping: {
        productDescription: productDescription || currentPD || '',
        numberOfItems: numberOfItems || numberOfItemsCurrentPD || 0,
        productDescriptionReplacement: newPD || '',
        numberOfItemsReplacement: numberOfItemsNewPD || 0,
        orderType: updatedOrderType,
        amountType: amountType,
        amount: amountFromConditions,
        isExpressShipping: expressShippingValue,
      },
      isOrderAvailableForPreview: previewPermission === 'on',
      orderNotes: Notes || '',
      referralNumber: referralNumber || '',
      },
      { new: true } // Return the updated document
    );

    

    if (!updatedOrder) {
      return res.status(404).json({ error: "Order not found." });
    }

    res.status(200).json({ message: "Order updated successfully.", order: updatedOrder });
  } catch (error) {
    console.error("Error in editOrder:", error);
    res.status(500).json({ error: "Internal server error. Please try again." });
  }
};



const get_orderDetailsPage = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const userData = req.userData;
    if (!userData || !userData._id) {
      req.flash('error', 'Unauthorized');
      return res.redirect('/business/orders');
    }
    const order = await Order.findOne({ orderNumber: orderNumber, business: userData._id })
      .populate('deliveryMan')
      .populate('business')
      .populate({
        path: 'courierHistory.courier',
        model: 'courier',
        select: 'name'
      });

    if (!order) {
      req.flash('error', 'Order not found');
      return res.redirect('/business/orders');
    }

    const { address: selectedPickupAddress } = resolvePickupAddressForOrder(
      order,
      order.business
    );

    res.render('business/order-details', {
      title: req.translations.business.pages.orderDetails.title,
      page_title: req.translations.business.pages.orderDetails.title,
      folder: req.translations.business.breadcrumb.orders,
      order: order,
      selectedPickupAddress: selectedPickupAddress,
      canCancelOrder: canBusinessCancel(order),
      canChangeAddress: canBusinessChangeAddress(order),
      canDeleteOrder: order.orderStatus === 'new',
      waitingActionFlags: orderWaitingActionPolicy.getWaitingActionFlags(order),
    });
  } catch (error) {
    console.log(error);
    req.flash('error', 'Internal Server Error');
    res.redirect('/business/orders');
  }
};

// API function for mobile - returns JSON data instead of rendering page
const get_orderDetailsAPI = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const userData = req.userData;
    
    if (!userData || !userData._id) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized access'
      });
    }

    const order = await Order.findOne({ orderNumber: orderNumber, business: userData._id })
      .populate('deliveryMan', 'name phone email')
      .populate({
        path: 'courierHistory.courier',
        model: 'courier',
        select: 'name phone email'
      })
      .populate('business', 'name email phone brandInfo pickUpAddresses');

    if (!order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found'
      });
    }

    // Enhance order with status information
    const orderObj = order.toObject();
    orderObj.statusLabel = statusHelper.getOrderStatusLabel(order.orderStatus);
    orderObj.statusDescription = statusHelper.getOrderStatusDescription(order.orderStatus);
    orderObj.categoryClass = statusHelper.getCategoryClass(order.statusCategory);
    orderObj.categoryColor = statusHelper.getCategoryColor(order.statusCategory);
    
    // Add fast shipping indicator
    orderObj.isFastShipping = order.orderShipping && order.orderShipping.isExpressShipping;

    // Calculate progress percentage for order stages
    const orderType = order.orderShipping && order.orderShipping.orderType;
    let orderStages;
    if (orderType === 'Exchange') {
      orderStages = [
        'orderPlaced', 'packed', 'shipping', 'inProgress',
        'outForDelivery', 'exchangePickup', 'delivered', 'returnCompleted',
      ];
    } else {
      orderStages = [
        'orderPlaced', 'packed', 'shipping', 'inProgress',
        'outForDelivery', 'delivered'
      ];
    }
    
    const completedStages = orderStages.filter(stage => 
      order.orderStages[stage]?.isCompleted
    ).length;
    
    const progressPercentage = Math.round((completedStages / orderStages.length) * 100);

    // Get stage timeline
    const stageTimeline = orderStages.map(stage => ({
      stage,
      isCompleted: order.orderStages[stage]?.isCompleted || false,
      completedAt: order.orderStages[stage]?.completedAt || null,
      notes: order.orderStages[stage]?.notes || '',
      ...(order.orderStages[stage]?.toObject ? order.orderStages[stage].toObject() : order.orderStages[stage] || {})
    }));

    const { address: resolvedPickupAddress, addressId: resolvedPickupAddressId } =
      resolvePickupAddressForOrder(order, order.business);

    const businessForApi =
      orderObj.business && typeof orderObj.business === 'object'
        ? (() => {
            const b = { ...orderObj.business };
            delete b.pickUpAddresses;
            return b;
          })()
        : orderObj.business;

    // Prepare response data
    const responseData = {
      status: 'success',
      message: 'Order details retrieved successfully',
      order: {
        _id: orderObj._id,
        orderNumber: orderObj.orderNumber,
        orderDate: orderObj.orderDate,
        completedDate: orderObj.completedDate,
        orderStatus: orderObj.orderStatus,
        statusLabel: orderObj.statusLabel,
        statusDescription: orderObj.statusDescription,
        categoryClass: orderObj.categoryClass,
        categoryColor: orderObj.categoryColor,
        isFastShipping: orderObj.isFastShipping,
        orderCustomer: orderObj.orderCustomer,
        orderShipping: orderObj.orderShipping,
        orderFees: orderObj.orderFees,
        orderNotes: orderObj.orderNotes,
        referralNumber: orderObj.referralNumber,
        isOrderAvailableForPreview: orderObj.isOrderAvailableForPreview,
        deliveryMan: orderObj.deliveryMan,
        courierHistory: orderObj.courierHistory,
        orderStages: orderObj.orderStages,
        progressPercentage,
        stageTimeline,
        business: businessForApi,
        scheduledRetryAt: orderObj.scheduledRetryAt,
        createdAt: orderObj.createdAt,
        updatedAt: orderObj.updatedAt,
        canCancelOrder: canBusinessCancel(order),
        canChangeAddress: canBusinessChangeAddress(order),
        canDelete: order.orderStatus === 'new',
        waitingAction: orderWaitingActionPolicy.getWaitingActionFlags(order),
        selectedPickupAddressId: orderObj.selectedPickupAddressId,
        selectedPickupAddress: resolvedPickupAddress,
        resolvedPickupAddressId,
      }
    };

    res.status(200).json(responseData);
  } catch (error) {
    console.error('Error in get_orderDetailsAPI:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: error.message
    });
  }
};




const cancelOrder = async (req, res) => {
  const { orderId } = req.params;

  try {
    const order = await findOrderByIdOrNumber(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if business owns this order
    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Same rule as UI / order list: only if cancel API would proceed
    if (!canBusinessCancel(order)) {
      return res.status(400).json({
        error: 'This order cannot be canceled from its current status.',
        currentStatus: order.orderStatus,
        statusLabel: statusHelper.getOrderStatusLabel(order.orderStatus),
      });
    }

    const cancelOutcome = applyBusinessLikeCancellation(order, { canceledBy: 'business' });
    if (cancelOutcome.result === 'already_in_return') {
      return res.status(400).json({ error: cancelOutcome.message });
    }
    order.$locals = order.$locals || {};
    order.$locals.nextStatusHistoryNote = cancelOutcome.message;
    await order.save();

    if (cancelOutcome.notifyCourier && order.deliveryMan) {
      try {
        const reason =
          cancelOutcome.result === 'exchange_cancel'
            ? 'Exchange order canceled by business'
            : 'Order canceled by business before pickup';
        await firebase.sendOrderStatusNotification(
          order.deliveryMan,
          order.orderNumber,
          'canceled',
          {
            cancelledBy: 'Business',
            cancelledAt: new Date(),
            reason,
          }
        );
      } catch (notificationError) {
        console.error(
          `Failed to send push notification to courier ${order.deliveryMan}:`,
          notificationError
        );
      }
    }

    return res.status(200).json({ message: cancelOutcome.message });

  } catch (error) {
    console.error('Error in cancelOrder:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const deleteOrder = async (req, res) => {
  const { orderId } = req.params;

  try {
    const order = await findOrderByIdOrNumber(orderId);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'You do not have permission to delete this order' });
    }

    if (order.orderStatus !== 'new') {
      return res.status(400).json({
        error: 'This order can no longer be deleted — it has already been processed.',
        currentStatus: order.orderStatus,
      });
    }

    await order.deleteOne();
    res.status(200).json({ message: 'Order deleted successfully.' });
  } catch (error) {
    console.error('Error in deleteOrder:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Helper functions for PDF generation
async function generateBarcode(awbNumber) {
  // bwip-js is pure JS (no node-canvas). node-canvas often breaks on Linux VPS without Cairo build deps.
  const safe = awbNumber != null && String(awbNumber).trim() !== '' ? String(awbNumber) : '0';
  const png = await bwipjs.toBuffer({
    bcid: 'code128',
    text: safe,
    scale: 3,
    height: 12,
    includetext: false,
  });
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function generateQRCode(awbNumber) {
  const payload = awbNumber != null && String(awbNumber).trim() !== '' ? String(awbNumber) : '0';
  const qrCode = await QRCode.toDataURL(payload, {
    width: 150,
    margin: 1,
    color: { dark: '#000000', light: '#FFFFFF' }
  });
  return qrCode;
}

function getImageAsBase64(imagePath) {
  try {
    const fullPath = path.join(__dirname, '..', 'public', imagePath);
    const imageBuffer = fs.readFileSync(fullPath);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${base64Image}`;
  } catch (error) {
    console.error('Error reading image:', error);
    return '';
  }
}

function getDeliveryStatusText(orderType, amountType) {
  // Map order types to delivery status text
  const statusMap = {
    'Deliver': 'DELIVER',
    'Return': 'RETURN',
    'Exchange': 'EXCHANGE'
  };
  
  return statusMap[orderType] || 'DELIVER';
}

// Shared styles for all policy types
const getSharedStyles = () => `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: Arial, sans-serif;
    background-color: #fff;
    padding: 0;
    margin: 0;
  }

  .container {
    width: 100%;
    max-width: 100%;
    margin: 0;
    background-color: white;
    padding: 0;
    box-sizing: border-box;
    position: relative;
  }

  .watermark {
    position: absolute;
    right: -150px;
    top: 70%;
    transform: translateY(-50%);
    opacity: 0.1;
    width: 652px;
    height: auto;
    z-index: 0;
    pointer-events: none;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0;
    gap: 12px;
    position: relative;
    z-index: 1;
  }

  .logo {
    width: 150px;
    height: auto;
  }

  .logo img {
    width: 100%;
    height: auto;
    display: block;
  }

  .awb-section {
    text-align: center;
    flex: 1;
  }

  .awb-label {
    font-size: 20px;
    font-weight: 800;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .awb-number {
    font-size: 24px;
    font-weight: bold;
  }

  .barcode-qr {
    display: flex;
    gap: 64px;
    align-items: center;
  }

  .barcode-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .barcode-container {
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: #000;
    padding: 8px;
    border-radius: 4px;
  }

  .barcode-label-box {
    background-color: #000;
    color: #fff;
    padding: 20px 12px;
    font-size: 14px;
    font-weight: bold;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 50px;
  }

  .barcode-wrapper {
    background-color: #fff;
    padding: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .barcode-wrapper img {
    height: 64px;
  }

  .qr-code {
    width: 112px;
    height: 112px;
    border: 2px solid #d1d5db;
    border-radius: 4px;
    padding: 8px;
    background-color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .qr-code img {
    width: 100%;
    height: 100%;
  }

  .content {
    display: grid;
    grid-template-columns: 1fr 2.3fr;
    gap: 0;
    align-items: stretch;
    position: relative;
    z-index: 1;
  }

  .left-section {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .left-box {
    border: 1px solid #9ca3af;
  }

  .right-section {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .right-box {
    border: 1px solid #9ca3af;
  }

  .flex-1 {
    flex: 1;
  }

  .form-row {
    display: grid;
    border-bottom: 1px solid #9ca3af;
    min-height: 50px;
  }

  .form-row:last-child {
    border-bottom: none;
  }

  .form-row-cod {
    grid-template-columns: 1fr 1.5fr;
  }

  .form-row-reversed {
    grid-template-columns: 1.5fr 1fr;
  }

  .form-row-normal {
    grid-template-columns: 1.3fr 1.5fr;
  }

  .form-label {
    padding: 12px;
    font-weight: bold;
    font-size: 14px;
    text-transform: uppercase;
    border-right: 1px solid #9ca3af;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    background-color: #f9fafb;
    white-space: nowrap;
  }

  .cod-label {
    font-size: 20px;
    font-weight: 800;
    justify-content: center;
  }

  .arabic-label {
    font-size: 14px;
    font-weight: bold;
    text-align: center;
    justify-content: center;
    background-color: #f9fafb;
    padding: 12px;
    border-left: none;
    border-right: none;
  }

  .form-value {
    padding: 12px;
    font-size: 14px;
    display: flex;
    align-items: center;
    font-weight: 500;
    text-align: center;
    justify-content: center;
    border-right: 1px solid #9ca3af;
  }

  .form-value-no-border {
    border-right: none;
  }

  .description-value {
    min-height: 100px;
    align-items: flex-start;
    padding-top: 12px;
  }

  .info-row {
    display: grid;
    grid-template-columns: 1fr 110px;
    border-bottom: 1px solid #d1d5db;
  }

  .info-row:last-child {
    border-bottom: none;
  }

  .info-label {
    padding: 12px;
    font-weight: bold;
    background-color: #f9fafb;
    font-size: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    border-right: 1px solid #9ca3af;
    min-width: 110px;
  }

  .info-value {
    padding: 12px;
    font-size: 14px;
    display: flex;
    align-items: center;
    line-height: 1.4;
    text-align: center;
    justify-content: center;
  }

  .address-value {
    font-size: 14px;
    line-height: 1.625;
    min-height: 100px;
    align-items: flex-start;
  }

  .notes-value {
    min-height: 100px;
    align-items: center;
    justify-content: center;
    text-align: center;
  }

  .location-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .location-value {
    padding: 12px;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .location-value:last-child {
    border-right: 1px solid #9ca3af;
  }

  .highlight-box {
    background-color: #fef3c7;
    border: 2px solid #f59e0b;
    padding: 12px;
    margin: 12px 0;
    border-radius: 4px;
  }

  .highlight-label {
    font-weight: bold;
    font-size: 16px;
    color: #92400e;
    margin-bottom: 8px;
  }

  .highlight-value {
    font-size: 18px;
    font-weight: bold;
    color: #78350f;
  }

  .section-divider {
    border-top: 2px solid #9ca3af;
    margin: 16px 0;
    padding-top: 16px;
  }

  @media print {
    body {
      margin: 0;
      padding: 0;
    }
    .container {
      margin: 0;
      padding: 0;
      page-break-after: avoid;
    }
  }
`;

// Delivery Policy Template (Original design)
function getDeliveryPolicyTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Delivery Policy</title>
      <style>${getSharedStyles()}</style>
    </head>
    <body>
      <div class="container">
        ${watermarkDataUrl ? `<img src="${watermarkDataUrl}" class="watermark" alt="Watermark">` : ''}
        <div class="header">
          <div class="logo">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo">` : '<div style="font-size: 60px; font-weight: bold; color: #000;">now</div>'}
          </div>
          
          <div class="awb-section">
            <div class="awb-label">AWB NUMBER</div>
            <div class="awb-number">${data.awbNumber}</div>
          </div>

          <div class="barcode-qr">
            <div class="barcode-item">
              <div class="barcode-container">
                <div class="barcode-label-box">E-01</div>
                <div class="barcode-wrapper">
                  <img src="${barcodeDataUrl}" alt="Barcode">
                </div>
              </div>
            </div>
            
            <div class="barcode-item">
              <div class="qr-code">
                <img src="${qrCodeDataUrl}" alt="QR Code">
              </div>
            </div>
          </div>
        </div>

        <div class="content">
          <div class="left-section">
            <!-- Box 1: COD -->
            <div class="left-box">
              <div class="form-row form-row-cod">
                <div class="form-label cod-label">COD</div>
                <div class="form-value form-value-no-border">${data.cod}</div>
              </div>
            </div>

            <!-- Box 1.5: حالة الشحنه -->
            <div class="left-box">
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.deliveryStatus || 'DELIVER'}</div>
                <div class="arabic-label">حالة الشحنه</div>
              </div>
            </div>

            <!-- Box 2: عدد القطع + فتح الشحنه + وصف الشحنه -->
            <div class="left-box flex-1">
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.numPieces || '1'}</div>
                <div class="arabic-label">عدد القطع</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.openShipment || 'NO'}</div>
                <div class="arabic-label">فتح الشحنه</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value description-value">${data.shipmentDescription || 'N/A'}</div>
                <div class="arabic-label">وصف الشحنه</div>
              </div>
            </div>

            <!-- Box 3: ORDER REF + CREATED ON -->
            <div class="left-box">
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">ORDER REF</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.orderRef || 'N/A'}</div>
              </div>
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">CREATED ON</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.createdOn || ''}</div>
              </div>
            </div>
          </div>

          <div class="right-section">
            <!-- Box 1: من، الي، تليفون -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value">${data.shippingFrom}</div>
                <div class="info-label">من</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientName}</div>
                <div class="info-label">الي</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientPhone}</div>
                <div class="info-label">تليفون</div>
              </div>
            </div>

            <!-- Box 2: المدينة، المنطقة، العنوان -->
            <div class="right-box flex-1">
              <div class="info-row">
                <div class="location-row">
                  <div class="location-value">${data.city}</div>
                  <div class="location-value">${data.hub}</div>
                </div>
                <div class="info-label">المدينة</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.area}</div>
                <div class="info-label">المنطقة</div>
              </div>
              <div class="info-row">
                <div class="info-value address-value">${data.address}</div>
                <div class="info-label">العنوان</div>
              </div>
            </div>

            <!-- Box 3: الملاحظات -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.notes}</div>
                <div class="info-label">الملاحظات</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Return Policy Template (Different design with original order number)
function getReturnPolicyTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Return Policy</title>
      <style>${getSharedStyles()}</style>
    </head>
    <body>
      <div class="container">
        ${watermarkDataUrl ? `<img src="${watermarkDataUrl}" class="watermark" alt="Watermark">` : ''}
        <div class="header">
          <div class="logo">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo">` : '<div style="font-size: 60px; font-weight: bold; color: #000;">now</div>'}
          </div>
          
          <div class="awb-section">
            <div class="awb-label">RETURN AWB NUMBER</div>
            <div class="awb-number">${data.awbNumber}</div>
          </div>

          <div class="barcode-qr">
            <div class="barcode-item">
              <div class="barcode-container">
                <div class="barcode-label-box">R-01</div>
                <div class="barcode-wrapper">
                  <img src="${barcodeDataUrl}" alt="Barcode">
                </div>
              </div>
            </div>
            
            <div class="barcode-item">
              <div class="qr-code">
                <img src="${qrCodeDataUrl}" alt="QR Code">
              </div>
            </div>
          </div>
        </div>

        <div class="content">
          <div class="left-section">
            <!-- Box 1: COD -->
            <div class="left-box">
              <div class="form-row form-row-cod">
                <div class="form-label cod-label">COD</div>
                <div class="form-value form-value-no-border">${data.cod}</div>
              </div>
            </div>

            <!-- Box 1.5: حالة الشحنه -->
            <div class="left-box">
              <div class="form-row form-row-reversed">
                <div class="form-value">RETURN</div>
                <div class="arabic-label">حالة الشحنه</div>
              </div>
            </div>

            <!-- Box 2: عدد القطع + فتح الشحنه + وصف الشحنه -->
            <div class="left-box flex-1">
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.numPieces || '1'}</div>
                <div class="arabic-label">عدد القطع</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.openShipment || 'NO'}</div>
                <div class="arabic-label">فتح الشحنه</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value description-value">${data.shipmentDescription || 'N/A'}</div>
                <div class="arabic-label">وصف الشحنه</div>
              </div>
            </div>

            <!-- Box 3: ORDER REF + CREATED ON -->
            <div class="left-box">
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">ORDER REF</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.orderRef || 'N/A'}</div>
              </div>
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">CREATED ON</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.createdOn || ''}</div>
              </div>
            </div>
          </div>

          <div class="right-section">
            <!-- Box 1: من، الي، تليفون -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value">${data.shippingFrom}</div>
                <div class="info-label">من</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientName}</div>
                <div class="info-label">الي</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientPhone}</div>
                <div class="info-label">تليفون</div>
              </div>
            </div>

            <!-- Box 2: المدينة، المنطقة، العنوان -->
            <div class="right-box flex-1">
              <div class="info-row">
                <div class="location-row">
                  <div class="location-value">${data.city}</div>
                  <div class="location-value">${data.hub}</div>
                </div>
                <div class="info-label">المدينة</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.area}</div>
                <div class="info-label">المنطقة</div>
              </div>
              <div class="info-row">
                <div class="info-value address-value">${data.address}</div>
                <div class="info-label">العنوان</div>
              </div>
            </div>

            <!-- Box 3: سبب الإرجاع + الملاحظات -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.returnReason || 'N/A'}</div>
                <div class="info-label">سبب الإرجاع</div>
              </div>
              <div class="info-row">
                <div class="info-value notes-value">${data.notes}</div>
                <div class="info-label">الملاحظات</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Exchange Policy Template (Different design with exchange details)
function getExchangePolicyTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Exchange Policy</title>
      <style>${getSharedStyles()}</style>
    </head>
    <body>
      <div class="container">
        ${watermarkDataUrl ? `<img src="${watermarkDataUrl}" class="watermark" alt="Watermark">` : ''}
        <div class="header">
          <div class="logo">
            ${logoDataUrl ? `<img src="${logoDataUrl}" alt="Logo">` : '<div style="font-size: 60px; font-weight: bold; color: #000;">now</div>'}
          </div>
          
          <div class="awb-section">
            <div class="awb-label">EXCHANGE AWB NUMBER</div>
            <div class="awb-number">${data.awbNumber}</div>
          </div>

          <div class="barcode-qr">
            <div class="barcode-item">
              <div class="barcode-container">
                <div class="barcode-label-box">X-01</div>
                <div class="barcode-wrapper">
                  <img src="${barcodeDataUrl}" alt="Barcode">
                </div>
              </div>
            </div>
            
            <div class="barcode-item">
              <div class="qr-code">
                <img src="${qrCodeDataUrl}" alt="QR Code">
              </div>
            </div>
          </div>
        </div>

        <div class="content">
          <div class="left-section">
            <!-- Box 1: COD -->
            <div class="left-box">
              <div class="form-row form-row-cod">
                <div class="form-label cod-label">COD</div>
                <div class="form-value form-value-no-border">${data.cod}</div>
              </div>
            </div>

            <!-- Box 1.5: حالة الشحنه -->
            <div class="left-box">
              <div class="form-row form-row-reversed">
                <div class="form-value">EXCHANGE</div>
                <div class="arabic-label">حالة الشحنه</div>
              </div>
            </div>

            <!-- Box 2: عدد القطع + فتح الشحنه + وصف الشحنه -->
            <div class="left-box flex-1">
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.numPieces || '1'}</div>
                <div class="arabic-label">عدد القطع</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value">${data.openShipment || 'NO'}</div>
                <div class="arabic-label">فتح الشحنه</div>
              </div>
              <div class="form-row form-row-reversed">
                <div class="form-value description-value">${data.shipmentDescription || 'N/A'}</div>
                <div class="arabic-label">وصف الشحنه</div>
              </div>
            </div>

            <!-- Box 3: ORDER REF + CREATED ON -->
            <div class="left-box">
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">ORDER REF</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.orderRef || 'N/A'}</div>
              </div>
              <div class="form-row form-row-normal">
                <div class="form-label" style="font-size: 12px; font-weight: 700; border-right: none;">CREATED ON</div>
                <div class="form-value form-value-no-border" style="font-size: 15px; font-weight: 600;">${data.createdOn || ''}</div>
              </div>
            </div>
          </div>

          <div class="right-section">
            <!-- Box 1: من، الي، تليفون -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value">${data.shippingFrom}</div>
                <div class="info-label">من</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientName}</div>
                <div class="info-label">الي</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.recipientPhone}</div>
                <div class="info-label">تليفون</div>
              </div>
            </div>

            <!-- Box 2: المدينة، المنطقة، العنوان -->
            <div class="right-box flex-1">
              <div class="info-row">
                <div class="location-row">
                  <div class="location-value">${data.city}</div>
                  <div class="location-value">${data.hub}</div>
                </div>
                <div class="info-label">المدينة</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.area}</div>
                <div class="info-label">المنطقة</div>
              </div>
              <div class="info-row">
                <div class="info-value address-value">${data.address}</div>
                <div class="info-label">العنوان</div>
              </div>
            </div>

            <!-- Box 3: Products Being Returned -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.productDescription || 'N/A'}</div>
                <div class="info-label">المنتج المراد إرجاعه</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.numberOfItems || '1'}</div>
                <div class="info-label">عدد القطع المرجعة</div>
              </div>
            </div>

            <!-- Box 4: New Product for Exchange -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.productDescriptionReplacement || 'N/A'}</div>
                <div class="info-label">المنتج الجديد للاستبدال</div>
              </div>
              <div class="info-row">
                <div class="info-value">${data.numberOfItemsReplacement || '1'}</div>
                <div class="info-label">عدد القطع الجديدة</div>
              </div>
            </div>

            <!-- Box 5: الملاحظات -->
            <div class="right-box">
              <div class="info-row">
                <div class="info-value notes-value">${data.notes}</div>
                <div class="info-label">الملاحظات</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// Legacy function for backward compatibility
function getHtmlTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl) {
  return getDeliveryPolicyTemplate(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl);
}

const printPolicy = async (req, res) => {
  let browser = null;
  
  try {
    const { orderNumber, pageSize } = req.params;
    const order = await Order.findOne({ orderNumber }).populate('business');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Support both route params and query params for paper size (Puppeteer format names)
    const rawPaper = pageSize || req.query.paperSize || req.query.size || 'A4';
    const u = String(rawPaper).trim().toUpperCase();
    let paperSize = 'A4';
    if (u === 'A3' || u === 'A4' || u === 'A5') paperSize = u;
    else if (u === 'LETTER') paperSize = 'Letter';
    else if (u === 'LEGAL') paperSize = 'Legal';
    else if (u === 'TABLOID') paperSize = 'Tabloid';

    // Determine order type
    const orderType = order.orderShipping?.orderType || 'Deliver';

    // Prepare base data for PDF generation
    // Use referralNumber for orderRef if it exists, otherwise don't include it
    // Coerce government/zone with String() — DB may store numeric codes; optional chaining
    // does not prevent calling .toUpperCase on a number (throws TypeError).
    const baseData = {
      awbNumber: order.orderNumber != null ? String(order.orderNumber) : '',
      cod: order.orderShipping?.amountType === 'COD' || order.orderShipping?.amountType === 'CD'
        ? `${order.orderShipping?.amount || '0'} EGP`
        : 'N/A',
      deliveryStatus: getDeliveryStatusText(order.orderShipping?.orderType, order.orderShipping?.amountType),
      recipientName: order.orderCustomer?.fullName || 'N/A',
      recipientPhone: order.orderCustomer?.phoneNumber != null ? String(order.orderCustomer.phoneNumber) : 'N/A',
      city: String(order.orderCustomer?.government ?? '').toUpperCase() || 'N/A',
      hub: String(order.orderCustomer?.zone ?? '').toUpperCase() || 'N/A',
      area: String(order.orderCustomer?.zone ?? '').toUpperCase() || 'N/A',
      address: order.orderCustomer?.address || 'N/A',
      notes: order.orderShipping?.returnNotes || order.orderShipping?.returnReason || order.orderNotes || 'N/A',
      shippingFrom:
        order.business?.brandInfo?.brandName ||
        order.business?.name ||
        order.business?.businessName ||
        order.business?.fullName ||
        'Business',
      orderRef: order.referralNumber || null, // Use referralNumber if it exists, otherwise null (will show N/A)
      createdOn: order.orderDate ? new Date(order.orderDate).toLocaleDateString('en-GB') : '',
      numPieces: order.orderShipping?.numberOfItems?.toString() || '1',
      openShipment: 'NO',
      shipmentDescription: order.orderShipping?.productDescription || 'N/A'
    };

    // Prepare data based on order type
    let data = { ...baseData };
    let templateFunction = getDeliveryPolicyTemplate;
    let filenamePrefix = 'delivery';

    if (orderType === 'Return') {
      // Return order specific data
      data = {
        ...baseData,
        returnReason: order.orderShipping?.returnReason || 'N/A',
        notes: order.orderShipping?.returnNotes || order.orderShipping?.returnReason || order.orderNotes || 'N/A'
      };
      templateFunction = getReturnPolicyTemplate;
      filenamePrefix = 'return';
    } else if (orderType === 'Exchange') {
      // Exchange order specific data
      data = {
        ...baseData,
        productDescription: order.orderShipping?.productDescription || 'N/A',
        numberOfItems: order.orderShipping?.numberOfItems?.toString() || '1',
        productDescriptionReplacement: order.orderShipping?.productDescriptionReplacement || 'N/A',
        numberOfItemsReplacement: order.orderShipping?.numberOfItemsReplacement?.toString() || '1',
        notes: order.orderShipping?.returnNotes || order.orderShipping?.returnReason || order.orderNotes || 'N/A'
      };
      templateFunction = getExchangePolicyTemplate;
      filenamePrefix = 'exchange';
    }

    // Generate barcode and QR code
    const barcodeDataUrl = await generateBarcode(data.awbNumber);
    const qrCodeDataUrl = await generateQRCode(data.awbNumber);

    // Load logo and watermark images
    const logoDataUrl = getImageAsBase64('logo.png');
    const watermarkDataUrl = getImageAsBase64('watermark.png');

    // Create HTML template based on order type
    const htmlContent = templateFunction(data, barcodeDataUrl, qrCodeDataUrl, logoDataUrl, watermarkDataUrl);

    // Launch browser (system Chrome/Chromium when available — reliable on production Linux)
    const launchOpts = getPuppeteerLaunchOptions();
    console.log(
      'Launching Puppeteer browser...',
      launchOpts.executablePath ? `executable=${launchOpts.executablePath}` : 'executable=(puppeteer default)'
    );
    browser = await puppeteer.launch(launchOpts);

    console.log('Creating new page...');
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1400 });
    
    console.log('Setting page content...');
    await page.setContent(htmlContent, { 
      waitUntil: 'load',
      timeout: 30000 
    });

    // Generate PDF
    console.log('Generating PDF...');
    
    // Adjust scale for smaller paper sizes to fit content on one page
    let scale = 1.0;
    if (paperSize === 'A5') {
      scale = 0.7; // Scale down content for A5 to fit on one page
    }
    
    // Set the page scale if needed
    if (scale !== 1.0) {
      await page.evaluate((scaleValue) => {
        document.body.style.transform = `scale(${scaleValue})`;
        document.body.style.transformOrigin = 'top left';
        document.body.style.width = `${100 / scaleValue}%`;
      }, scale);
    }
    
    const pdfBuffer = await page.pdf({
      format: paperSize,
      margin: {
        top: '0',
        right: '0',
        bottom: '0',
        left: '0'
      },
      printBackground: true,
      preferCSSPageSize: false
    });

    console.log(`PDF generated successfully. Size: ${pdfBuffer.length} bytes`);

    // Validate PDF buffer
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('Generated PDF is empty');
    }

    // Return PDF as downloadable file with appropriate filename
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenamePrefix}-policy-${data.awbNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'no-cache');
    res.end(pdfBuffer, 'binary');
  } catch (error) {
    console.error('Error generating document:', error);
    console.error('Error stack:', error.stack);
    if (
      /Could not find Chrome|Failed to launch|Browser process|spawn .* ENOENT/i.test(
        String(error && error.message)
      )
    ) {
      console.error(
        '[printPolicy] Chrome/Chromium not usable on this host. Install chromium/google-chrome-stable, ' +
          'or set PUPPETEER_EXECUTABLE_PATH to the browser binary, or run: npx puppeteer browsers install chrome'
      );
      console.error('[printPolicy] Check server logs: pm2 logs nowShipping --lines 80');
    }
    
    // Make sure we don't try to send response twice
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        error: error.message || 'Failed to generate PDF document' 
      });
    }
  } finally {
    // Ensure browser is closed
    if (browser) {
      try {
        await browser.close();
        console.log('Browser closed successfully');
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
    }
  }
};

// ================= WaitingAction Actions ================= //
// See utils/orderWaitingActionPolicy.js for eligibility; :orderId may be Mongo _id or orderNumber.

function ensureInProgressStageDoc(order) {
  if (!order.orderStages) {
    order.orderStages = {};
  }
  if (!order.orderStages.inProgress) {
    order.orderStages.inProgress = {
      isCompleted: false,
      completedAt: null,
      notes: '',
    };
  }
}

function ensureOutForDeliveryStageDoc(order) {
  if (!order.orderStages) {
    order.orderStages = {};
  }
  if (!order.orderStages.outForDelivery) {
    order.orderStages.outForDelivery = {
      isCompleted: false,
      completedAt: null,
      notes: '',
    };
  }
}

function applyInProgressRetryTouch(order, notes) {
  ensureInProgressStageDoc(order);
  if (!order.orderStages.inProgress.isCompleted) {
    order.orderStages.inProgress.isCompleted = true;
    order.orderStages.inProgress.completedAt = new Date();
    order.orderStages.inProgress.notes = notes;
  }
  if (typeof order.markModified === 'function') {
    order.markModified('orderStages');
  }
}

const retryTomorrow = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await findOrderByIdOrNumber(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!orderWaitingActionPolicy.canRetryTomorrow(order)) {
      return res.status(400).json({
        error: 'This action is only available when the order is waiting for your action.',
        code: 'INVALID_STATUS',
        currentStatus: order.orderStatus,
      });
    }
    order.scheduledRetryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    applyInProgressRetryTouch(order, 'Retry scheduled for tomorrow');
    order.orderStatus = 'rescheduled';
    await order.save();
    return res.status(200).json({ message: 'Retry scheduled for tomorrow' });
  } catch (e) {
    console.error('retryTomorrow:', e);
    return res.status(500).json({ error: 'Failed to schedule retry' });
  }
};

const retryScheduled = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await findOrderByIdOrNumber(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!orderWaitingActionPolicy.canRetryScheduled(order)) {
      return res.status(400).json({
        error: 'Scheduling is only available for orders in waiting for action or rescheduled state.',
        code: 'INVALID_STATUS',
        currentStatus: order.orderStatus,
      });
    }
    const dateParsed = orderWaitingActionPolicy.validateRetryScheduledDate(req.body);
    if (!dateParsed.ok) {
      return res.status(400).json({
        error: dateParsed.error,
        code: dateParsed.code,
        currentStatus: order.orderStatus,
      });
    }
    order.scheduledRetryAt = dateParsed.when;
    applyInProgressRetryTouch(order, 'Retry rescheduled');
    order.orderStatus = 'rescheduled';
    await order.save();
    return res.status(200).json({ message: 'Retry scheduled' });
  } catch (e) {
    console.error('retryScheduled:', e);
    return res.status(500).json({ error: 'Failed to schedule retry' });
  }
};

const returnToWarehouseFromWaiting = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await findOrderByIdOrNumber(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!orderWaitingActionPolicy.canReturnToWarehouseFromWaiting(order)) {
      return res.status(400).json({
        error: 'This action is only available when the order is waiting for your action.',
        code: 'INVALID_STATUS',
        currentStatus: order.orderStatus,
      });
    }
    order.orderStatus = 'returnToWarehouse';
    applyInProgressRetryTouch(order, 'Business requested return to warehouse');
    await order.save();
    return res.status(200).json({ message: 'Order moved to return stock' });
  } catch (e) {
    console.error('returnToWarehouseFromWaiting:', e);
    return res.status(500).json({ error: 'Failed to move to return stock' });
  }
};

const cancelFromWaiting = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await findOrderByIdOrNumber(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!orderWaitingActionPolicy.canCancelFromWaiting(order)) {
      return res.status(400).json({
        error: 'This action is only available when the order is waiting for your action.',
        code: 'INVALID_STATUS',
        currentStatus: order.orderStatus,
      });
    }
    order.orderStatus = 'returnToWarehouse';
    if (!order.orderStages.returnInitiated || !order.orderStages.returnInitiated.isCompleted) {
      order.orderStages.returnInitiated = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Business canceled from waiting — moved to return flow',
        initiatedBy: 'business',
        reason: 'customer_canceled',
      };
    }
    ensureOutForDeliveryStageDoc(order);
    ensureInProgressStageDoc(order);
    order.orderStages.outForDelivery.isCompleted = false;
    order.orderStages.inProgress.isCompleted = false;
    if (typeof order.markModified === 'function') {
      order.markModified('orderStages');
    }
    await order.save();
    return res.status(200).json({ message: 'Order moved to return pipeline' });
  } catch (e) {
    console.error('cancelFromWaiting:', e);
    return res.status(500).json({ error: 'Failed to cancel order' });
  }
};

// Enhanced Return Flow Functions

// Calculate return fees based on order type and conditions
const calculateReturnFees = (orderType, government, isExpress, returnCondition = 'good') => {
  const baseFees = {
    'Deliver': 0,
    'Return': 15, // Base return fee
    'Exchange': 20, // Exchange fee
  };

  const expressMultiplier = isExpress ? 1.5 : 1;
  const conditionMultiplier = {
    'excellent': 1.0,
    'good': 1.0,
    'fair': 1.2,
    'poor': 1.5,
    'damaged': 2.0
  };

  const governmentMultiplier = {
    'Cairo': 1.0,
    'Giza': 1.0,
    'Alexandria': 1.2,
    'Other': 1.5
  };

  const baseFee = baseFees[orderType] || 0;
  const conditionFee = baseFee * (conditionMultiplier[returnCondition] || 1.0);
  const expressFee = conditionFee * expressMultiplier;
  const finalFee = expressFee * (governmentMultiplier[government] || 1.5);

  return {
    baseFee,
    conditionFee,
    expressFee: isExpress ? expressFee - conditionFee : 0,
    processingFee: finalFee * 0.1, // 10% processing fee
    inspectionFee: orderType === 'Return' ? 5 : 0,
    total: Math.round(finalFee + (finalFee * 0.1) + (orderType === 'Return' ? 5 : 0))
  };
};

// API endpoint for calculating return fees
const calculateReturnFeesAPI = async (req, res) => {
  try {
    const { orderType, government, isExpress, returnCondition } = req.body;

    // Validate inputs
    if (!orderType || !government) {
      return res.status(400).json({ error: 'Order type and government are required' });
    }

    // Calculate the return fees
    const fees = calculateReturnFees(
      orderType, 
      government, 
      isExpress === 'true' || isExpress === true,
      returnCondition || 'good'
    );

    res.json({ 
      success: true,
      fees: fees
    });
  } catch (error) {
    console.error('Error calculating return fees:', error);
    res.status(500).json({ error: 'Failed to calculate return fees' });
  }
};



// Get available return orders for linking
const getAvailableReturnOrders = async (req, res) => {
  try {
    const returnOrders = await Order.find({
      business: req.userData._id,
      'orderShipping.orderType': 'Return',
      'orderShipping.linkedDeliverOrder': { $exists: false },
      // Only return orders that have been picked up from customer
      orderStatus: { $in: ['returnPickedUp', 'returnAtWarehouse', 'returnToBusiness', 'returnCompleted'] }
    }).sort({ orderDate: -1 });

    res.status(200).json(returnOrders);
  } catch (error) {
    console.error('Error fetching return orders:', error);
    res.status(500).json({ error: 'Failed to fetch return orders' });
  }
};

// Get comprehensive return order details
const getReturnOrderDetails = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const returnOrder = await Order.findOne({
      _id: orderId,
      business: req.userData._id,
      'orderShipping.orderType': 'Return'
    }).populate('deliveryMan', 'name phone email')
      .populate('business', 'businessName email phone');

    if (!returnOrder) {
      return res.status(404).json({ error: 'Return order not found' });
    }

    // Calculate progress percentage
    const returnStages = [
      'returnInitiated', 'returnAssigned', 'returnPickedUp', 
      'returnAtWarehouse', 'returnInspection', 'returnProcessing', 
      'returnToBusiness', 'returnCompleted'
    ];
    
    const completedStages = returnStages.filter(stage => 
      returnOrder.orderStages[stage]?.isCompleted
    ).length;
    
    const progressPercentage = Math.round((completedStages / returnStages.length) * 100);

    // Get stage timeline
    const stageTimeline = returnStages.map(stage => ({
      stage,
      isCompleted: returnOrder.orderStages[stage]?.isCompleted || false,
      completedAt: returnOrder.orderStages[stage]?.completedAt || null,
      notes: returnOrder.orderStages[stage]?.notes || '',
      ...returnOrder.orderStages[stage]?.toObject()
    }));

    res.status(200).json({
      order: returnOrder,
      progressPercentage,
      stageTimeline,
      feeBreakdown: returnOrder.feeBreakdown
    });
  } catch (error) {
    console.error('Error fetching return order details:', error);
    res.status(500).json({ error: 'Failed to fetch return order details' });
  }
};

// Mark deliver order as returned when return process is completed
const markDeliverOrderAsReturned = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Find the deliver order
    const deliverOrder = await Order.findById(orderId);
    if (!deliverOrder) {
      return res.status(404).json({ error: 'Deliver order not found' });
    }
    
    if (deliverOrder.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    // Check if order is linked to a return order
    if (!deliverOrder.orderShipping.linkedReturnOrder) {
      return res.status(400).json({ error: 'Order is not linked to a return order' });
    }
    
    // Find the linked return order
    const returnOrder = await Order.findById(deliverOrder.orderShipping.linkedReturnOrder);
    if (!returnOrder) {
      return res.status(404).json({ error: 'Linked return order not found' });
    }
    
    // Check if return order is completed
    if (returnOrder.orderStatus !== 'returnCompleted') {
      return res.status(400).json({ 
        error: 'Return order must be completed before marking deliver order as returned',
        returnOrderStatus: returnOrder.orderStatus
      });
    }
    
    // Mark deliver order as returned
    deliverOrder.orderStatus = 'returned';
    deliverOrder.completedDate = new Date();
    
    // Update return stages
    deliverOrder.orderStages.returned = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Order marked as returned. Return order ${returnOrder.orderNumber} completed.`,
      returnOrderCompleted: true,
      returnOrderCompletedAt: returnOrder.orderStages.returnCompleted.completedAt
    };
    
    await deliverOrder.save();
    
    res.status(200).json({ 
      message: 'Deliver order marked as returned successfully',
      order: deliverOrder,
      returnOrder: returnOrder
    });
  } catch (error) {
    console.error('Error marking deliver order as returned:', error);
    res.status(500).json({ error: 'Failed to mark deliver order as returned' });
  }
};

// Get all return orders with filtering and pagination
const getReturnOrders = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status, 
      dateFrom, 
      dateTo,
      search 
    } = req.query;

    const query = {
      business: req.userData._id,
      'orderShipping.orderType': 'Return'
    };

    // Add status filter
    if (status && status !== 'all') {
      query.orderStatus = status;
    }

    // Add date range filter
    if (dateFrom || dateTo) {
      query.orderDate = {};
      if (dateFrom) query.orderDate.$gte = new Date(dateFrom);
      if (dateTo) query.orderDate.$lte = new Date(dateTo);
    }

    // Add search filter
    if (search) {
      query.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'orderCustomer.fullName': { $regex: search, $options: 'i' } },
        { 'orderCustomer.phoneNumber': { $regex: search, $options: 'i' } },
        { 'orderShipping.returnReason': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const returnOrders = await Order.find(query)
      .populate('deliveryMan', 'name phone')
      .sort({ orderDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await Order.countDocuments(query);

    res.status(200).json({
      orders: returnOrders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + returnOrders.length < totalCount,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Error fetching return orders:', error);
    res.status(500).json({ error: 'Failed to fetch return orders' });
  }
};

// Legacy initiate return request (kept for backward compatibility)
const initiateReturn = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { returnReason, returnNotes } = req.body;
    
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.business.toString() !== req.userData._id.toString()) return res.status(403).json({ error: 'Forbidden' });
    
    // Only allow returns for completed orders
    if (order.orderStatus !== 'completed') {
      return res.status(400).json({ error: 'Only completed orders can be returned' });
    }
    
    // Check if return already initiated (using status history since current status is 'completed')
    const alreadyInitiated = order.orderStatusHistory.some(h => h.status === 'returnInitiated');
    if (alreadyInitiated) {
      return res.status(400).json({ error: 'Return already initiated for this order' });
    }
    
    // Update order status and stages
    order.orderStatus = 'returnInitiated';
    order.orderShipping.orderType = 'Return';
    order.orderShipping.returnReason = returnReason;
    order.orderShipping.returnNotes = returnNotes;
    
    // Update return stages
    order.orderStages.returnInitiated.isCompleted = true;
    order.orderStages.returnInitiated.completedAt = new Date();
    order.orderStages.returnInitiated.notes = `Return initiated by business. Reason: ${returnReason}`;
    
    await order.save();
    
    return res.status(200).json({ 
      message: 'Return request initiated successfully. Admin will assign a courier for pickup.',
      order: order
    });
  } catch (error) {
    console.error('Error initiating return:', error);
    return res.status(500).json({ error: 'Failed to initiate return' });
  }
}




//================================================END Orders  ================================================= //

//================================================ Pickup ================================================= //


const get_pickupPage = (req, res) => {
  res.render('business/pickup' , {
    title: req.translations.business.pages.pickup.title,
    page_title: req.translations.business.pages.pickup.title,
    folder: req.translations.business.breadcrumb.pages,
    userData: req.userData
  });
  
}

const get_pickups = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 30,
      status, // picikupStatus or statusCategory mapping
      statusCategory,
      dateFrom,
      dateTo,
      search,
      pickupType // Upcoming / Completed
    } = req.query;

    const query = { business: req.userData._id };

    // Legacy pickupType handling to keep original UX
    if (pickupType === 'Upcoming') {
      query.statusCategory = { $in: [statusHelper.STATUS_CATEGORIES.NEW, statusHelper.STATUS_CATEGORIES.PROCESSING] };
    } else if (pickupType === 'Completed') {
      query.statusCategory = statusHelper.STATUS_CATEGORIES.SUCCESSFUL;
    }

    // Map status filters
    if (status && status !== 'all') {
      query.picikupStatus = status;
    }

    if (statusCategory && statusHelper.STATUS_CATEGORIES[statusCategory]) {
      query.statusCategory = statusCategory;
    }

    // Date range filter (pickupDate)
    if (dateFrom || dateTo) {
      query.pickupDate = {};
      if (dateFrom) query.pickupDate.$gte = new Date(dateFrom);
      if (dateTo) query.pickupDate.$lte = new Date(dateTo);
    }

    // Text search
    if (search && search.trim() !== '') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { pickupNumber: searchRegex },
        { phoneNumber: searchRegex }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const pickups = await Pickup.find(query)
      .sort({ pickupDate: -1, createdAt: -1 })
      .populate('business')
      .populate('assignedDriver')
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await Pickup.countDocuments(query);

    // Enhance pickups with status information
    const enhancedPickups = pickups.map(pickup => {
      const pickupObj = pickup.toObject();
      pickupObj.statusLabel = statusHelper.getPickupStatusLabel(pickup.picikupStatus);
      pickupObj.statusDescription = statusHelper.getPickupStatusDescription(pickup.picikupStatus);
      pickupObj.categoryClass = statusHelper.getCategoryClass(pickup.statusCategory);
      pickupObj.categoryColor = statusHelper.getCategoryColor(pickup.statusCategory);
      return pickupObj;
    });

    res.status(200).json({
      pickups: enhancedPickups || [],
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + pickups.length < totalCount,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Error in pickups:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Professional Excel Export for Pickups
const exportPickupsToExcel = async (req, res) => {
  try {
    // Get ALL pickups for the business (no filters)
    const pickups = await Pickup.find({ business: req.userData._id })
      .populate('assignedDriver', 'name phone')
      .populate('business', 'name brandInfo')
      .sort({ pickupDate: -1 });
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Pickups Report');
    
    // Define columns
    worksheet.columns = [
      { header: 'Pickup Number', key: 'pickupNumber', width: 18 },
      { header: 'Pickup Date', key: 'pickupDate', width: 18 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Number of Orders', key: 'numberOfOrders', width: 18 },
      { header: 'Pickup Fee (EGP)', key: 'pickupFees', width: 18 },
      { header: 'Phone Number', key: 'phoneNumber', width: 18 },
      { header: 'Pickup Location', key: 'pickupLocation', width: 30 },
      { header: 'Address Details', key: 'addressDetails', width: 30 },
      { header: 'City', key: 'city', width: 15 },
      { header: 'Zone', key: 'zone', width: 15 },
      { header: 'Fragile Items', key: 'fragileItems', width: 15 },
      { header: 'Large Items', key: 'largeItems', width: 15 },
      { header: 'Driver', key: 'driver', width: 20 },
      { header: 'Pickup Notes', key: 'pickupNotes', width: 30 },
      { header: 'Created At', key: 'createdAt', width: 18 }
    ];
    
    // Style header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '2A3950' }
    };
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
    
    // Add data rows
    pickups.forEach(pickup => {
      const statusLabel = statusHelper.getPickupStatusLabel(pickup.picikupStatus);
      const driverName = pickup.assignedDriver ? pickup.assignedDriver.name : 'Not Assigned';
      
      // Get pickup address information
      let addressDetails = 'N/A';
      let city = 'N/A';
      let zone = 'N/A';
      
      if (pickup.pickupAddressId && pickup.business?.pickUpAddresses) {
        const address = pickup.business.pickUpAddresses.find(a => a.addressId === pickup.pickupAddressId);
        if (address) {
          addressDetails = address.adressDetails || 'N/A';
          city = address.city || 'N/A';
          zone = address.zone || 'N/A';
        }
      } else if (pickup.business?.pickUpAddresses?.length > 0) {
        const defaultAddress = pickup.business.pickUpAddresses.find(a => a.isDefault) || pickup.business.pickUpAddresses[0];
        if (defaultAddress) {
          addressDetails = defaultAddress.adressDetails || 'N/A';
          city = defaultAddress.city || 'N/A';
          zone = defaultAddress.zone || 'N/A';
        }
      } else if (pickup.business?.pickUpAdress) {
        addressDetails = pickup.business.pickUpAdress.adressDetails || 'N/A';
        city = pickup.business.pickUpAdress.city || 'N/A';
        zone = pickup.business.pickUpAdress.zone || 'N/A';
      }
      
      const pickupLocation = pickup.pickupLocation || `${addressDetails}, ${zone}, ${city}`;
      
      worksheet.addRow({
        pickupNumber: pickup.pickupNumber,
        pickupDate: pickup.pickupDate ? new Date(pickup.pickupDate).toLocaleDateString() : 'N/A',
        status: statusLabel,
        numberOfOrders: pickup.numberOfOrders || 0,
        pickupFees: pickup.pickupFees || 0,
        phoneNumber: pickup.phoneNumber || 'N/A',
        pickupLocation: pickupLocation,
        addressDetails: addressDetails,
        city: city,
        zone: zone,
        fragileItems: pickup.isFragileItems ? 'Yes' : 'No',
        largeItems: pickup.isLargeItems ? 'Yes' : 'No',
        driver: driverName,
        pickupNotes: pickup.pickupNotes || '',
        createdAt: pickup.createdAt ? new Date(pickup.createdAt).toLocaleDateString() : 'N/A'
      });
    });
    
    // Style data rows
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 1) {
        row.alignment = { vertical: 'middle' };
        
        // Color code fees
        const feesCell = row.getCell('pickupFees');
        if (feesCell.value > 0) {
          feesCell.font = { color: { argb: 'EF4444' } };
        }
        
        // Color code fragile items
        const fragileCell = row.getCell('fragileItems');
        if (fragileCell.value === 'Yes') {
          fragileCell.font = { color: { argb: 'F59E0B' }, bold: true };
        }
        
        // Color code large items
        const largeCell = row.getCell('largeItems');
        if (largeCell.value === 'Yes') {
          largeCell.font = { color: { argb: '3B82F6' }, bold: true };
        }
      }
    });
    
    // Add borders
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });
    
    // Set response headers
    const filename = `pickups_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Write to response
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (error) {
    console.error('Error exporting pickups to Excel:', error);
    res.status(500).json({ error: 'Failed to export pickups' });
  }
};

const createPickup = async (req, res) => {
  const {
    numberOfOrders,
    pickupDate,
    phoneNumber,
    isFragileItems,
    isLargeItems,
    pickupNotes,
    pickupLocation,
    pickupAddressId
  } = req.body;

  try {
    // ✅ 1. Validate required fields
    if (!numberOfOrders || !pickupDate || !phoneNumber) {
      return res
        .status(400)
        .json({ error: 'All pickup info fields are required.' });
    }
    console.log(req.body);
    // ✅ 2. Compute pickup fee based on business zone/city and number of picked orders rule
    const business = await User.findById(req.userData._id);
    
    // Get pickup address - use selected address or default
    let selectedAddress = null;
    if (pickupAddressId && business.pickUpAddresses && business.pickUpAddresses.length > 0) {
      selectedAddress = business.pickUpAddresses.find(addr => addr.addressId === pickupAddressId);
    }
    if (!selectedAddress && business.pickUpAddresses && business.pickUpAddresses.length > 0) {
      selectedAddress = business.pickUpAddresses.find(addr => addr.isDefault) || business.pickUpAddresses[0];
    }
    
    const businessCity = selectedAddress?.city || business?.pickUpAdress?.city || 'Cairo';
    const initialPickedCount = 0;
    const computedPickupFee = calcPickupFee(businessCity, initialPickedCount);

    // ✅ 3. Create Pickup
    // Use selected address phone if available, otherwise use provided phoneNumber
    const pickupPhoneNumber = phoneNumber || selectedAddress?.pickupPhone || business.phoneNumber || '';
    
    const newPickup = new Pickup({
      business: req.userData._id,
      pickupNumber: `${
        Math.floor(Math.random() * (900000 - 100000 + 1)) + 100000
      }`,
      numberOfOrders,
      pickupDate,
      phoneNumber: pickupPhoneNumber,
      isFragileItems: isFragileItems === 'true',
      isLargeItems: isLargeItems === 'true',
      picikupStatus: 'new',
      pickupNotes,
      pickupFees: computedPickupFee,
      pickupAddressId: pickupAddressId || (selectedAddress?.addressId || null),
      pickupLocation: pickupLocation || (selectedAddress ? `${selectedAddress.adressDetails}, ${selectedAddress.city}, ${selectedAddress.country}` : '')
    });
    newPickup.pickupStages.push({
      stageName: 'Pickup Created',
      stageDate: new Date(),
      stageNotes: [{ text: 'Pickup has been created.', date: new Date() }],
    });

    const savedPickup = await newPickup.save();
    res
      .status(201)
      .json({ message: 'Pickup created successfully.', pickup: savedPickup });
  } catch (error) {
    console.error('Error in createPickup:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};


const get_pickupDetailsPage = async(req, res) => {
  const { pickupNumber } = req.params;  

    const pickup = await Pickup.findOne({ pickupNumber }).populate('business').populate('assignedDriver');
    
    const { address: selectedPickupAddress } = pickup
      ? resolvePickupAddressForOrder(
          { selectedPickupAddressId: pickup.pickupAddressId },
          pickup.business
        )
      : { address: null };
    
    console.log(pickup);  
    if (!pickup) {
    const wantsJsonNotFound =
      req.originalUrl.includes('/api/') ||
      req.query.json === '1' ||
      (req.headers.accept && req.headers.accept.includes('application/json'));
    if (wantsJsonNotFound) {
      return res.status(404).json({ error: 'Pickup not found' });
    } else {
      res.render('business/pickup-details', {
        title: req.translations.business.pages.pickupDetails.title,
        page_title: req.translations.business.pages.pickupDetails.title,
        folder: req.translations.business.breadcrumb.pages,
        pickup: null,
      });
      return;
    }
  }

  // Pickup found - render the page with pickup data
  const wantsJson =
    req.originalUrl.includes('/api/') ||
    req.query.json === '1' ||
    (req.headers.accept && req.headers.accept.includes('application/json'));
  if (wantsJson) {
    return res.status(200).json({ pickup, selectedPickupAddress });
  } else {
    res.render('business/pickup-details', {
      title: req.translations.business.pages.pickupDetails.title,
      page_title: req.translations.business.pages.pickupDetails.title,
      folder: req.translations.business.breadcrumb.pages,
      pickup,
      selectedPickupAddress: selectedPickupAddress
    });
  }
};

const get_pickedupOrders = async (req, res) => {
  const { pickupNumber } = req.params;
  const { search } = req.query;
  try {
    const pickedUpOrders = await Pickup.findOne(
      { pickupNumber },
      { ordersPickedUp: 1 }
    )
      .sort({ createdAt: -1 })
      .populate({
        path: 'ordersPickedUp',
        match: search ? { orderNumber: search } : {},
      });

    if (!pickedUpOrders) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    console.log(pickedUpOrders);
    res.status(200).json(pickedUpOrders || []);
  } catch (error) {
    console.error('Error in get_pickedupOrders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};


const ratePickup = async (req, res) => {
  const { pickupNumber } = req.params;
  const { driverRating,pickupRating, } = req.body;

  try {
    const pickup = await Pickup.findOne({ pickupNumber  });

    if (!pickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    pickup.driverRating = driverRating;
    pickup.pickupRating = pickupRating;

    const updatedPickup = await pickup.save();

    res.status(200).json({ message: 'Pickup rated successfully.', pickup: updatedPickup });
  }
  catch (error) {
    console.error('Error in ratePickup:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }

};

/**
 * Load pickup for business actions from req.params.pickupId or req.params.pickupNumber.
 * Mobile API uses pickupNumber on some routes; web uses Mongo _id.
 */
async function findPickupByIdOrNumberParam(req, extraPopulates = []) {
  const raw = req.params.pickupId ?? req.params.pickupNumber;
  if (!raw) {
    return null;
  }
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

/**
 * Resolve an order from a route param that may be Mongo _id or orderNumber.
 * Some clients (and URLs) use order number instead of _id.
 */
async function findOrderByIdOrNumber(orderId) {
  if (orderId == null || String(orderId).trim() === '') {
    return null;
  }
  const raw = String(orderId).trim();
  let order = null;
  if (mongoose.Types.ObjectId.isValid(raw)) {
    order = await Order.findById(raw);
  }
  if (!order) {
    order = await Order.findOne({ orderNumber: raw });
  }
  return order;
}

/** Soft-cancel pickup for business: status → canceled, with ownership + status guards. */
const cancelPickup = async (req, res) => {
  try {
    const pickup = await findPickupByIdOrNumberParam(req, ['assignedDriver']);

    if (!pickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    const businessId = pickup.business._id
      ? pickup.business._id.toString()
      : pickup.business.toString();
    if (businessId !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (pickup.picikupStatus === 'canceled') {
      return res.status(400).json({ error: 'This pickup is already cancelled.' });
    }

    if (!canBusinessCancelPickupStatus(pickup.picikupStatus)) {
      return res.status(400).json({
        error:
          'This pickup can no longer be cancelled — it is already in progress or completed.',
        currentStatus: pickup.picikupStatus,
      });
    }

    pickup.picikupStatus = 'canceled';
    pickup.pickupStages.push({
      stageName: 'Cancelled',
      stageDate: new Date(),
      stageNotes: [
        {
          text: 'Pickup cancelled by business',
          date: new Date(),
        },
      ],
    });

    await pickup.save();

    try {
      await firebase.sendPickupStatusNotification(
        pickup.business._id || pickup.business,
        pickup.pickupNumber,
        'canceled',
        {
          cancelledAt: new Date(),
          cancelledBy: 'Business',
        }
      );
    } catch (notificationError) {
      console.error(
        'Failed to send pickup cancellation notification to business:',
        notificationError
      );
    }

    if (pickup.assignedDriver) {
      try {
        await firebase.sendPickupStatusNotification(
          pickup.assignedDriver._id,
          pickup.pickupNumber,
          'canceled',
          {
            cancelledAt: new Date(),
            cancelledBy: 'Business',
          }
        );
      } catch (notificationError) {
        console.error(
          'Failed to send pickup cancellation notification to courier:',
          notificationError
        );
      }
    }

    res.status(200).json({ message: 'Pickup cancelled successfully.' });
  } catch (error) {
    console.error('Error in cancelPickup:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

/** Update editable pickup fields (only while status is new / pendingPickup). */
const updatePickup = async (req, res) => {
  const {
    numberOfOrders,
    pickupDate,
    phoneNumber,
    isFragileItems,
    isLargeItems,
    pickupNotes,
    pickupLocation,
    pickupAddressId,
  } = req.body;

  try {
    const pickup = await findPickupByIdOrNumberParam(req, []);

    if (!pickup) {
      return res.status(404).json({ error: 'Pickup not found.' });
    }

    const businessId = pickup.business._id
      ? pickup.business._id.toString()
      : pickup.business.toString();
    if (businessId !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    if (!canBusinessEditPickupStatus(pickup.picikupStatus)) {
      return res.status(400).json({
        error: 'This pickup can no longer be edited — it is already in progress.',
        currentStatus: pickup.picikupStatus,
      });
    }

    if (!numberOfOrders || !pickupDate || !phoneNumber) {
      return res.status(400).json({ error: 'numberOfOrders, pickupDate and phoneNumber are required.' });
    }

    // Re-resolve address and recompute fee
    const business = pickup.business;
    let selectedAddress = null;
    const addressId = pickupAddressId || pickup.pickupAddressId;
    if (addressId && business.pickUpAddresses && business.pickUpAddresses.length > 0) {
      selectedAddress = business.pickUpAddresses.find(addr => addr.addressId === addressId);
    }
    if (!selectedAddress && business.pickUpAddresses && business.pickUpAddresses.length > 0) {
      selectedAddress = business.pickUpAddresses.find(addr => addr.isDefault) || business.pickUpAddresses[0];
    }

    const businessCity = selectedAddress?.city || business?.pickUpAdress?.city || 'Cairo';
    const computedPickupFee = calcPickupFee(businessCity, 0);

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
    return res.status(200).json({ message: 'Pickup updated successfully.', pickup: saved });
  } catch (error) {
    console.error('Error in updatePickup:', error);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

/** Hard-delete a pickup. Business-side: only allowed while status is new / pendingPickup. */
const deletePickup = async (req, res) => {
  try {
    const pickup = await findPickupByIdOrNumberParam(req, []);

    if (!pickup) {
      return res.status(404).json({ error: 'Pickup not found.' });
    }

    // Ownership check (skip for admin routes that go through a different auth middleware)
    if (req.userData) {
      const businessId = pickup.business._id
        ? pickup.business._id.toString()
        : pickup.business.toString();
      if (businessId !== req.userData._id.toString()) {
        return res.status(403).json({ error: 'Forbidden.' });
      }

      if (!canBusinessHardDeletePickupStatus(pickup.picikupStatus)) {
        return res.status(400).json({
          error: 'This pickup can no longer be deleted — it is already in progress or has been assigned to a driver.',
          currentStatus: pickup.picikupStatus,
        });
      }
    }

    await Pickup.findByIdAndDelete(pickup._id);
    return res.status(200).json({ message: 'Pickup deleted successfully.' });
  } catch (error) {
    console.error('Error in deletePickup:', error);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};


//================================================END Pickup  ================================================= //


// ================================================= Wallet ================================================= //

const ledgerService = require('../utils/ledgerService');
const { ensureBusinessAccountCode } = require('../utils/businessAccountCode');

const get_walletPage = async (req, res) => {
  try {
    const balance = await ledgerService.getBalance(req.userData._id);
    const nextPayoutDate = ledgerService.nextWednesday();
    const businessAccountCode = await ensureBusinessAccountCode(req.userData._id);

    res.render('business/wallet', {
      title: req.translations.business.shell.myWallet,
      page_title: req.translations.business.pages.wallet.title,
      folder: req.translations.business.breadcrumb.pages,
      userData: req.userData,
      balance,
      businessAccountCode,
      nextPayoutDate: nextPayoutDate.toLocaleDateString(req.language === 'ar' ? 'ar-EG' : 'en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }),
    });
  } catch (error) {
    console.error('get_walletPage error:', error);
    res.status(500).render('errors/500');
  }
};

const get_walletEntries = async (req, res) => {
  try {
    const { type, settled, startDate, endDate, search, page = 1, limit = 50 } = req.query;

    const settledBool =
      settled === 'true' ? true :
      settled === 'false' ? false :
      undefined;

    const result = await ledgerService.getEntries(
      req.userData._id,
      { type, settled: settledBool, startDate, endDate, search },
      parseInt(page),
      parseInt(limit)
    );

    // Compute running balance summary stats
    const balance = await ledgerService.getBalance(req.userData._id);

    res.json({ success: true, ...result, balance });
  } catch (error) {
    console.error('get_walletEntries error:', error);
    res.status(500).json({ success: false, error: 'Failed to load wallet entries' });
  }
};

const exportWalletToExcel = async (req, res) => {
  try {
    const { type, settled, startDate, endDate } = req.query;
    const settledBool = settled === 'true' ? true : settled === 'false' ? false : undefined;

    const { entries } = await ledgerService.getEntries(
      req.userData._id,
      { type, settled: settledBool, startDate, endDate },
      1,
      10000
    );

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('Wallet');

    ws.columns = [
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Type', key: 'type', width: 18 },
      { header: 'Description', key: 'description', width: 45 },
      { header: 'Amount (EGP)', key: 'amount', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
    ];

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1A2C4E' } };

    entries.forEach(e => {
      ws.addRow({
        date: new Date(e.createdAt).toLocaleDateString('en-GB'),
        type: e.type.replace(/_/g, ' '),
        description: e.description,
        amount: e.amount,
        status: e.payoutId ? 'Settled' : 'Unsettled',
      });
    });

    const filename = `wallet_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('exportWalletToExcel error:', error);
    res.status(500).json({ error: 'Failed to export wallet' });
  }
};

// ================================================= END Wallet ================================================= //





// ================================================= Shop ================================================= //

const get_shopPage = (req, res) => {
  res.render('business/shop' , {
    title: req.translations.business.pages.shop.title,
    page_title: req.translations.business.pages.shop.title,
    folder: req.translations.business.breadcrumb.pages
   
  });
  
}




// ================================================= END Shop ================================================= //

// ================================================= Tickets ================================================= //


const get_ticketsPage = (req, res) => {
  res.render('business/tickets' , {
    title: req.translations.business.pages.tickets.title,
    page_title: req.translations.business.pages.tickets.title,
    folder: req.translations.business.breadcrumb.pages
   
  });
  
}

const logOut = (req, res) => {
  const cookieOpts = {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  };
  res.clearCookie('token', cookieOpts);
  res.redirect('/login');
};

const calculateFees = (government, orderType, isExpressShipping) => {
  return calculateOrderFee(government, orderType, isExpressShipping);
};

const calculateOrderFees = async (req, res) => {
  try {
    const { government, orderType, isExpressShipping } = req.body;

    // Validate inputs
    if (!government || !orderType) {
      return res.status(400).json({ error: 'Government and orderType are required' });
    }

    // Calculate the fee
    const fee = calculateFees(
      government, 
      orderType, 
      isExpressShipping === 'true' || isExpressShipping === true
    );

    // Return the calculated fee
    return res.json({ fee });
  } catch (error) {
    console.error('Error calculating fees:', error);
    return res.status(500).json({ error: 'An error occurred while calculating fees' });
  }
};

// Validate original order for return
const validateOriginalOrder = async (req, res) => {
  try {
    const { orderNumber } = req.body;
    
    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required' });
    }

    // Trim the order number
    const trimmedOrderNumber = orderNumber.trim();

    // Find the original order
    const originalOrder = await Order.findOne({ 
      orderNumber: trimmedOrderNumber,
      business: req.userData._id,
      orderStatus: 'completed',
      'orderShipping.orderType': 'Deliver'
    }).select('orderNumber orderCustomer orderShipping orderStatus');

    // Debug: If not found, try to find the order without the orderType restriction
    if (!originalOrder) {
      console.log('Order not found with Deliver type, searching without type restriction...');
      const debugOrder = await Order.findOne({ 
        orderNumber: trimmedOrderNumber,
        business: req.userData._id
      }).select('orderNumber orderCustomer orderShipping orderStatus business');
      
      if (debugOrder) {
        console.log('Debug - Found order:', {
          orderNumber: debugOrder.orderNumber,
          orderStatus: debugOrder.orderStatus,
          orderType: debugOrder.orderShipping.orderType,
          business: debugOrder.business,
          requestedBusiness: req.userData._id
        });
        
        return res.status(404).json({ 
          error: 'Order found but not eligible for return',
          message: `Order status: ${debugOrder.orderStatus}, Order type: ${debugOrder.orderShipping.orderType}. Only completed deliver orders can be returned.`,
          debug: {
            foundOrderStatus: debugOrder.orderStatus,
            foundOrderType: debugOrder.orderShipping.orderType,
            expectedStatus: 'completed',
            expectedType: 'Deliver'
          }
        });
      }
    }

    if (!originalOrder) {
      return res.status(404).json({ 
        error: 'Order not found or not eligible for return',
        message: 'Only completed deliver orders can be returned'
      });
    }

    // Check if this order is already linked to a return
    const existingReturn = await Order.findOne({
      'orderShipping.originalOrderNumber': trimmedOrderNumber,
      business: req.userData._id
    });

    if (existingReturn) {
      return res.status(400).json({ 
        error: 'Order already has a return request',
        message: 'This order already has an associated return order'
      });
    }

    // Check if order has multiple items (eligible for partial return)
    const hasMultipleItems = originalOrder.orderShipping.numberOfItems > 1;

    res.json({ 
      success: true, 
      order: {
        ...originalOrder.toObject(),
        hasMultipleItems: hasMultipleItems,
        itemCount: originalOrder.orderShipping.numberOfItems
      }
    });
  } catch (error) {
    console.error('Error validating original order:', error);
    res.status(500).json({ error: 'Failed to validate order' });
  }
};

// Calculate pickup fee (server-side) using centralized fees
const calculatePickupFee = async (req, res) => {
  try {
    const { numberOfOrders } = req.body;
    const user = await User.findById(req.userData._id);
    const city = user?.pickUpAdress?.city || 'Cairo';
    const count = parseInt(numberOfOrders || '0');
    const fee = calcPickupFee(city, count);
    return res.json({ fee });
  } catch (error) {
    console.error('Error calculating pickup fee:', error);
    return res.status(500).json({ error: 'Failed to calculate pickup fee' });
  }
}


// ================================================= Edit Profile ================================================= //

const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** express-fileupload may return a single file or an array for the same field */
function firstUploadedFile(raw) {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

function absoluteProfileImageUrl(req, imagePath) {
  if (!imagePath || typeof imagePath !== 'string') return null;
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  const host = req.get('host') || 'localhost';
  const base = `${req.protocol}://${host}`;
  return imagePath.startsWith('/') ? `${base}${imagePath}` : `${base}/${imagePath}`;
}

const editProfile = async (req, res) => {
  try {
    const userId = req.userData._id;
    const current = await User.findById(userId).select('profileImage email phoneNumber').lean();
    if (!current) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    const updateData = {};
    const { name, phoneNumber, profileImage, brandName, email, industry, monthlyOrders } =
      req.body;
    const removeProfileImage =
      req.body.removeProfileImage === 'true' ||
      req.body.removeProfileImage === true;

    if (name !== undefined && name !== null && String(name).trim() !== '') {
      updateData.name = String(name).trim();
    }

    if (email !== undefined && email !== null && String(email).trim() !== '') {
      const newEmail = String(email).trim().toLowerCase();
      const existingEmailUser = await User.findOne({ email: newEmail });
      if (existingEmailUser && existingEmailUser._id.toString() !== userId.toString()) {
        return res.status(400).json({
          status: 'error',
          code: 'EMAIL_IN_USE',
          message: 'This email is already registered to another account',
        });
      }
      updateData.email = newEmail;
    }

    if (phoneNumber !== undefined && phoneNumber !== null && String(phoneNumber).trim() !== '') {
      const newPhone = String(phoneNumber).trim();
      const existingPhoneUser = await User.findOne({ phoneNumber: newPhone });
      if (existingPhoneUser && existingPhoneUser._id.toString() !== userId.toString()) {
        return res.status(400).json({
          status: 'error',
          code: 'PHONE_IN_USE',
          message: 'This phone number is already registered to another account',
        });
      }
      updateData.phoneNumber = newPhone;
    }

    if (brandName !== undefined) {
      updateData['brandInfo.brandName'] =
        brandName === null || brandName === '' ? null : String(brandName).trim();
    }
    if (industry !== undefined) {
      updateData['brandInfo.industry'] =
        industry === null || industry === '' ? null : String(industry).trim();
    }
    if (monthlyOrders !== undefined) {
      updateData['brandInfo.monthlyOrders'] =
        monthlyOrders === null || monthlyOrders === '' ? null : String(monthlyOrders).trim();
    }
    if (req.body.sellingPoints !== undefined) {
      const sp = req.body.sellingPoints;
      const arr = Array.isArray(sp)
        ? sp
        : String(sp)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      updateData['brandInfo.sellingPoints'] = arr;
    }
    if (req.body.socialLinks !== undefined) {
      let parsed;
      try {
        const sl = req.body.socialLinks;
        parsed = typeof sl === 'string' ? JSON.parse(sl || '{}') : sl;
      } catch (e) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_JSON',
          message: 'socialLinks must be valid JSON (object) or a JSON string.',
        });
      }
      updateData['brandInfo.socialLinks'] = parsed;
    }
    if (req.body.notificationPreferences !== undefined) {
      let prefs;
      try {
        const np = req.body.notificationPreferences;
        prefs = typeof np === 'string' ? JSON.parse(np || '{}') : np;
      } catch (e) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_JSON',
          message: 'notificationPreferences must be valid JSON or a JSON string.',
        });
      }
      if (prefs && typeof prefs === 'object') {
        if (prefs.whatsapp !== undefined) {
          updateData['notificationPreferences.whatsapp'] = Boolean(prefs.whatsapp);
        }
        if (prefs.sms !== undefined) {
          updateData['notificationPreferences.sms'] = Boolean(prefs.sms);
        }
      }
    }

    if (removeProfileImage) {
      if (current.profileImage && String(current.profileImage).startsWith('/uploads/profiles/')) {
        try {
          await deleteFile(current.profileImage, 'profiles');
        } catch (e) {
          console.warn('editProfile: could not delete old profile file', e);
        }
      }
      updateData.profileImage = null;
    } else if (req.files && req.files.profileImage) {
      const file = firstUploadedFile(req.files.profileImage);
      if (!file) {
        return res.status(400).json({
          status: 'error',
          code: 'INVALID_IMAGE',
          message: 'No profile image file was received.',
        });
      }
      // Same as updateSettings / completion photo uploads: trust the client file; many send application/octet-stream or omit MIME.
      if (file.size > PROFILE_IMAGE_MAX_BYTES) {
        return res.status(400).json({
          status: 'error',
          code: 'FILE_TOO_LARGE',
          message: `Image must be ${PROFILE_IMAGE_MAX_BYTES / (1024 * 1024)} MB or smaller.`,
        });
      }
      if (current.profileImage && String(current.profileImage).startsWith('/uploads/profiles/')) {
        try {
          await deleteFile(current.profileImage, 'profiles');
        } catch (e) {
          console.warn('editProfile: could not delete old profile file', e);
        }
      }
      const result = await uploadFile(file, 'profiles');
      updateData.profileImage = result.url;
    } else if (profileImage !== undefined) {
      const s = String(profileImage).trim();
      if (s === '' || s === 'null') {
        updateData.profileImage = null;
      } else {
        updateData.profileImage = s;
      }
    }

    if (Object.keys(updateData).length === 0) {
      const unchanged = await User.findById(userId).select('-password').lean();
      const u = JSON.parse(JSON.stringify(unchanged));
      return res.status(200).json({
        status: 'success',
        message: 'No changes to apply',
        user: u,
        profileImageUrl: absoluteProfileImageUrl(req, u && u.profileImage),
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    )
      .select('-password')
      .lean();

    if (!user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      user,
      profileImageUrl: absoluteProfileImageUrl(req, user.profileImage),
    });
  } catch (error) {
    console.error('Error in editProfile:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: error.message || 'Validation failed',
      });
    }
    res.status(500).json({
      status: 'error',
      message: 'Internal server error. Please try again.',
    });
  }
};

// ================================================= Settings Page ================================================= //

const getSettingsPage = async (req, res) => {
  try {
    const user = await User.findById(req.userData._id).lean();
    
    if (!user) {
      return res.status(404).redirect('/business/dashboard');
    }

    res.render('business/settings', {
      title: req.translations.business.pages.settings.title,
      page_title: req.translations.business.pages.settings.title,
      folder: req.translations.business.breadcrumb.settings,
      user: user,
      userData: user
    });
  } catch (error) {
    console.error('Error in getSettingsPage:', error);
    res.status(500).redirect('/business/dashboard');
  }
}

// ================================================= OTP Verification for Settings ================================================= //

const sendEmailOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const crypto = require('crypto');
    const { emailService } = require('../utils/email');

    // Check if user is authenticated
    if (!req.userData || !req.userData._id) {
      console.error('sendEmailOtp: Authentication failed - req.userData:', req.userData);
      return res.status(401).json({ message: 'Authentication required' });
    }

    // Validate email input
    if (!email) {
      return res.status(400).json({ 
        message: 'Email address is required',
        code: 'EMAIL_REQUIRED',
        field: 'email'
      });
    }

    const emailTrimmed = email.trim().toLowerCase();
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailTrimmed)) {
      return res.status(400).json({ 
        message: 'Invalid email address format. Please enter a valid email address.',
        code: 'INVALID_EMAIL_FORMAT',
        field: 'email'
      });
    }

    // Check if user is trying to verify their current email
    const currentUserEmail = req.userData.email ? req.userData.email.trim().toLowerCase() : null;
    if (currentUserEmail && emailTrimmed === currentUserEmail) {
      // User is trying to verify their current email - this is allowed
      // We'll send OTP anyway to allow re-verification
    } else {
      // User is trying to change to a different email - check if it's available
      const existingUser = await User.findOne({ email: emailTrimmed });
      if (existingUser) {
        // Email exists and belongs to another user
        if (existingUser._id.toString() !== req.userData._id.toString()) {
          return res.status(400).json({ 
            message: 'This email is already registered to another account',
            code: 'EMAIL_ALREADY_EXISTS',
            field: 'email'
          });
        }
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    // Store OTP in OtpVerification model using email as identifier
    const OtpVerification = require('../models/OtpVerification');
    
    // Clear old OTPs for this email (using email as phoneNumber field for compatibility)
    await OtpVerification.deleteMany({ phoneNumber: emailTrimmed });

    // Save hashed OTP
    await OtpVerification.create({ phoneNumber: emailTrimmed, otpHash });

    // Send OTP via email
    try {
      const emailContent = `
        <h2>🔐 Email Verification Code</h2>
        <p>Your verification code to change your email address is:</p>
        <div style="font-size: 32px; font-weight: bold; color: #F39720; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 8px; margin: 20px 0;">
          ${otp}
        </div>
        <p>This code will expire in 6 minutes.</p>
        <p>If you did not request this code, please ignore this email.</p>
      `;
      
      await emailService.sendCustomEmail(
        emailTrimmed,
        'Email Verification Code - Now Shipping',
        emailContent
      );

      return res.status(200).json({ message: 'OTP sent successfully to ' + emailTrimmed });
    } catch (err) {
      console.error('Email send error:', err);
      console.error('Email send error details:', {
        message: err.message,
        stack: err.stack,
        email: emailTrimmed
      });
      return res.status(500).json({ 
        message: 'Failed to send OTP email. Please try again later.',
        code: 'EMAIL_SEND_FAILED',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  } catch (error) {
    console.error('Error in sendEmailOtp:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ 
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const crypto = require('crypto');
    const OtpVerification = require('../models/OtpVerification');

    // Check if user is authenticated
    if (!req.userData || !req.userData._id) {
      console.error('verifyEmailOtp: Authentication failed - req.userData:', req.userData);
      return res.status(401).json({ 
        message: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED'
      });
    }

    if (!email || !otp) {
      const missingFields = [];
      if (!email) missingFields.push('email');
      if (!otp) missingFields.push('otp');
      
      return res.status(400).json({ 
        message: `Missing required fields: ${missingFields.join(', ')}`,
        code: 'MISSING_REQUIRED_FIELDS',
        fields: missingFields
      });
    }

    if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ 
        message: 'OTP must be a 6-digit number',
        code: 'INVALID_OTP_FORMAT',
        field: 'otp'
      });
    }

    const emailTrimmed = email.trim().toLowerCase();
    const record = await OtpVerification.findOne({ phoneNumber: emailTrimmed });
    if (!record) {
      return res.status(400).json({ 
        message: 'OTP not found or expired. Please request a new OTP.',
        code: 'OTP_NOT_FOUND_OR_EXPIRED',
        field: 'otp'
      });
    }

    const hash = crypto.createHash('sha256').update(otp).digest('hex');
    if (hash !== record.otpHash) {
      return res.status(400).json({ 
        message: 'Invalid OTP. Please check the code and try again.',
        code: 'INVALID_OTP',
        field: 'otp'
      });
    }

    // Delete OTP after successful verification
    await OtpVerification.deleteOne({ _id: record._id });

    return res.status(200).json({ 
      message: 'Email OTP verified successfully',
      email: emailTrimmed
    });
  } catch (error) {
    console.error('Error in verifyEmailOtp:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ 
      message: 'Internal server error. Please try again later.',
      code: 'INTERNAL_SERVER_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const sendPhoneOtp = async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const crypto = require('crypto');
    const sms = require('../utils/sms');
    const OtpVerification = require('../models/OtpVerification');

    // Check if user is authenticated
    if (!req.userData || !req.userData._id) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!phoneNumber) {
      return res.status(400).json({ 
        message: 'Phone number is required',
        code: 'PHONE_REQUIRED',
        field: 'phoneNumber'
      });
    }

    if (!/^\d{11}$/.test(phoneNumber)) {
      return res.status(400).json({ 
        message: 'Invalid phone number format. Please enter an 11-digit phone number.',
        code: 'INVALID_PHONE_FORMAT',
        field: 'phoneNumber'
      });
    }

    // Check if user is trying to verify their current phone
    const currentUserPhone = req.userData.phoneNumber ? req.userData.phoneNumber.trim() : null;
    if (currentUserPhone && phoneNumber === currentUserPhone) {
      // User is trying to verify their current phone - this is allowed
      // We'll send OTP anyway to allow re-verification
    } else {
      // User is trying to change to a different phone - check if it's available
      const existingUser = await User.findOne({ phoneNumber });
      if (existingUser) {
        // Phone exists and belongs to another user
        if (existingUser._id.toString() !== req.userData._id.toString()) {
          return res.status(400).json({ 
            message: 'This phone number is already registered to another account',
            code: 'PHONE_ALREADY_EXISTS',
            field: 'phoneNumber'
          });
        }
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    // Clear old OTPs
    await OtpVerification.deleteMany({ phoneNumber });

    // Save hashed OTP
    await OtpVerification.create({ phoneNumber, otpHash });

    // Format phone number to international
    const internationalNumber = `20${phoneNumber.slice(1)}`; // Eg. "01123456789" -> "201123456789"

    const smsMessage = `Your NowShipping verification is: ${otp}`;

    try {
      await sms.sendSms({ recipient: internationalNumber, message: smsMessage });
      return res.status(200).json({ message: 'OTP sent successfully to ' + phoneNumber });
    } catch (err) {
      console.error('SMS error:', err.details || err.message);
      return res.status(500).json({ message: 'Failed to send OTP via SMS' });
    }
  } catch (error) {
    console.error('Error in sendPhoneOtp:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const verifyPhoneOtp = async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;
    const crypto = require('crypto');
    const OtpVerification = require('../models/OtpVerification');

    // Check if user is authenticated
    if (!req.userData || !req.userData._id) {
      console.error('verifyPhoneOtp: Authentication failed - req.userData:', req.userData);
      return res.status(401).json({ 
        message: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED'
      });
    }

    if (!phoneNumber || !otp) {
      const missingFields = [];
      if (!phoneNumber) missingFields.push('phoneNumber');
      if (!otp) missingFields.push('otp');
      
      return res.status(400).json({ 
        message: `Missing required fields: ${missingFields.join(', ')}`,
        code: 'MISSING_REQUIRED_FIELDS',
        fields: missingFields
      });
    }

    if (otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ 
        message: 'OTP must be a 6-digit number',
        code: 'INVALID_OTP_FORMAT',
        field: 'otp'
      });
    }

    const record = await OtpVerification.findOne({ phoneNumber });
    if (!record) {
      return res.status(400).json({ 
        message: 'OTP not found or expired. Please request a new OTP.',
        code: 'OTP_NOT_FOUND_OR_EXPIRED',
        field: 'otp'
      });
    }

    const hash = crypto.createHash('sha256').update(otp).digest('hex');
    if (hash !== record.otpHash) {
      return res.status(400).json({ 
        message: 'Invalid OTP. Please check the code and try again.',
        code: 'INVALID_OTP',
        field: 'otp'
      });
    }

    // Delete OTP after successful verification
    await OtpVerification.deleteOne({ _id: record._id });

          return res.status(200).json({ 
        message: 'Phone OTP verified successfully',
        phoneNumber: phoneNumber
      });
  } catch (error) {
    console.error('Error in verifyPhoneOtp:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ 
      message: 'Internal server error. Please try again later.',
      code: 'INTERNAL_SERVER_ERROR',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const updateSettings = async (req, res) => {
  try {
    const userId = req.userData._id;
    const updateData = {};

    // Basic Information
    if (req.body.name !== undefined) updateData.name = req.body.name;
    
    // Validate email if it's being updated
    if (req.body.email !== undefined) {
      const newEmail = req.body.email.trim();
      // Check if email is already in use by another user
      const existingEmailUser = await User.findOne({ email: newEmail });
      if (existingEmailUser && existingEmailUser._id.toString() !== userId.toString()) {
        return res.status(400).json({ 
          error: 'This email is already registered to another account',
          message: 'This email is already registered to another account'
        });
      }
      updateData.email = newEmail;
    }
    
    // Validate phone number if it's being updated
    if (req.body.phoneNumber !== undefined) {
      const newPhoneNumber = req.body.phoneNumber.trim();
      // Check if phone number is already in use by another user
      const existingPhoneUser = await User.findOne({ phoneNumber: newPhoneNumber });
      if (existingPhoneUser && existingPhoneUser._id.toString() !== userId.toString()) {
        return res.status(400).json({ 
          error: 'This phone number is already registered to another account',
          message: 'This phone number is already registered to another account'
        });
      }
      updateData.phoneNumber = newPhoneNumber;
    }
    
    // Handle profile image upload
    if (req.files && req.files.profileImage) {
      console.log('📤 Uploading profile image to local storage...');
      const result = await uploadFile(req.files.profileImage, 'profiles');
      updateData.profileImage = result.url;
      console.log('✅ Profile image uploaded:', result.url);
    } else if (req.body.profileImage !== undefined) {
      updateData.profileImage = req.body.profileImage;
    }

    // Brand Information
    if (req.body.brandName !== undefined) {
      if (!updateData.brandInfo) updateData.brandInfo = {};
      updateData.brandInfo.brandName = req.body.brandName;
    }
    if (req.body.industry !== undefined) {
      if (!updateData.brandInfo) updateData.brandInfo = {};
      updateData.brandInfo.industry = req.body.industry;
    }
    if (req.body.monthlyOrders !== undefined) {
      if (!updateData.brandInfo) updateData.brandInfo = {};
      updateData.brandInfo.monthlyOrders = req.body.monthlyOrders;
    }
    if (req.body.sellingPoints !== undefined) {
      if (!updateData.brandInfo) updateData.brandInfo = {};
      updateData.brandInfo.sellingPoints = Array.isArray(req.body.sellingPoints) 
        ? req.body.sellingPoints 
        : req.body.sellingPoints.split(',').map(s => s.trim());
    }
    if (req.body.socialLinks !== undefined) {
      if (!updateData.brandInfo) updateData.brandInfo = {};
      updateData.brandInfo.socialLinks = typeof req.body.socialLinks === 'string' 
        ? JSON.parse(req.body.socialLinks) 
        : req.body.socialLinks;
    }

    // Pickup Address
    if (req.body.pickupCountry !== undefined || req.body.pickupCity !== undefined || 
        req.body.pickupZone !== undefined || req.body.pickupAddressDetails !== undefined ||
        req.body.pickupNearbyLandmark !== undefined || req.body.pickupPhone !== undefined ||
        req.body.otherPickupPhone !== undefined || req.body.pickupCoordinates !== undefined || 
        req.body.pickupPointInMaps !== undefined) {
      if (!updateData.pickUpAdress) updateData.pickUpAdress = {};
      if (req.body.pickupCountry !== undefined) updateData.pickUpAdress.country = req.body.pickupCountry;
      if (req.body.pickupCity !== undefined) updateData.pickUpAdress.city = req.body.pickupCity;
      if (req.body.pickupZone !== undefined) updateData.pickUpAdress.zone = req.body.pickupZone;
      if (req.body.pickupAddressDetails !== undefined) updateData.pickUpAdress.adressDetails = req.body.pickupAddressDetails;
      if (req.body.pickupNearbyLandmark !== undefined) updateData.pickUpAdress.nearbyLandmark = req.body.pickupNearbyLandmark;
      if (req.body.pickupPhone !== undefined) updateData.pickUpAdress.pickupPhone = req.body.pickupPhone;
      if (req.body.otherPickupPhone !== undefined) updateData.pickUpAdress.otherPickupPhone = req.body.otherPickupPhone;
      if (req.body.pickupPointInMaps !== undefined) updateData.pickUpAdress.pickUpPointInMaps = req.body.pickupPointInMaps;
      if (req.body.pickupCoordinates !== undefined) {
        try {
          const coords = typeof req.body.pickupCoordinates === 'string' 
            ? JSON.parse(req.body.pickupCoordinates) 
            : req.body.pickupCoordinates;
          updateData.pickUpAdress.coordinates = coords;
        } catch (e) {
          console.error('Error parsing coordinates:', e);
        }
      }
    }

    // Payment Method
    if (req.body.paymentChoice !== undefined) {
      if (!updateData.paymentMethod) updateData.paymentMethod = {};
      updateData.paymentMethod.paymentChoice = req.body.paymentChoice;
      
      if (req.body.paymentDetails !== undefined) {
        const paymentDetails = typeof req.body.paymentDetails === 'string' 
          ? JSON.parse(req.body.paymentDetails) 
          : req.body.paymentDetails;
        updateData.paymentMethod.details = paymentDetails;
      }
    }

    // Brand Type
    if (req.body.brandTypeChoice !== undefined) {
      if (!updateData.brandType) updateData.brandType = {};
      updateData.brandType.brandChoice = req.body.brandTypeChoice;
      
      if (req.body.brandTypeDetails !== undefined) {
        const brandDetails = typeof req.body.brandTypeDetails === 'string' 
          ? JSON.parse(req.body.brandTypeDetails) 
          : req.body.brandTypeDetails;
        updateData.brandType.brandDetails = brandDetails;
      }
    }

    // Storage preference
    if (req.body.isNeedStorage !== undefined) {
      updateData.isNeedStorage = req.body.isNeedStorage === 'true' || req.body.isNeedStorage === true;
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      status: 'success',
      message: 'Settings updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Error in updateSettings:', error);
    res.status(500).json({ 
      error: 'Internal server error. Please try again.',
      details: error.message 
    });
  }
}

// Recovery function for orders that lost courier assignment
const recoverOrderCourier = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { courierId } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if business owns this order
    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check if order is in return process
    if (order.orderStatus !== 'returnToWarehouse') {
      return res.status(400).json({ error: 'Order is not in return process' });
    }

    // Find the courier
    const Courier = require('../models/courier');
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    // Assign the courier
    order.deliveryMan = courierId;

    // Add to courier history
    order.courierHistory.push({
      courier: courierId,
      assignedAt: new Date(),
      action: 'assigned',
      notes: 'Courier assigned during recovery process'
    });

    // Update return stages
    order.orderStages.returnAssigned = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Courier ${courier.name} assigned for return process`,
      courier: courierId
    };

    await order.save();

    return res.status(200).json({ 
      message: `Courier ${courier.name} successfully assigned to order`,
      order: order
    });

  } catch (error) {
    console.error('Error recovering order courier:', error);
    return res.status(500).json({ error: 'Failed to recover order courier' });
  }
};

// ======================================== MULTIPLE PICKUP ADDRESSES ======================================== //

// Add a new pickup address
const addPickupAddress = async (req, res) => {
  try {
    const user = await User.findById(req.userData._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const {
      addressName,
      country,
      city,
      zone,
      adressDetails,
      nearbyLandmark,
      pickupPhone,
      otherPickupPhone,
      pickUpPointInMaps,
      coordinates
    } = req.body;

    // Validate required fields
    if (!country || !city || !zone || !adressDetails) {
      return res.status(400).json({ error: 'Country, city, zone, and address details are required' });
    }

    // Parse coordinates if string
    let coords = null;
    if (coordinates) {
      try {
        coords = typeof coordinates === 'string' ? JSON.parse(coordinates) : coordinates;
      } catch (e) {
        console.error('Error parsing coordinates:', e);
      }
    }

    // Create new address
    const newAddress = {
      addressId: `addr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      addressName: addressName || `Address ${(user.pickUpAddresses?.length || 0) + 1}`,
      isDefault: (user.pickUpAddresses?.length || 0) === 0, // First address is default
      country,
      city,
      zone,
      adressDetails,
      nearbyLandmark: nearbyLandmark || '',
      pickupPhone: pickupPhone || user.phoneNumber,
      otherPickupPhone: otherPickupPhone || '',
      pickUpPointInMaps: pickUpPointInMaps || '',
      coordinates: coords || null
    };

    // If this is the first address, set as default
    if (!user.pickUpAddresses || user.pickUpAddresses.length === 0) {
      newAddress.isDefault = true;
    }

    // Add to array
    if (!user.pickUpAddresses) {
      user.pickUpAddresses = [];
    }
    user.pickUpAddresses.push(newAddress);

    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Pickup address added successfully',
      address: newAddress
    });
  } catch (error) {
    console.error('Error in addPickupAddress:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Update an existing pickup address
const updatePickupAddress = async (req, res) => {
  try {
    const user = await User.findById(req.userData._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { addressId } = req.params;
    const {
      addressName,
      country,
      city,
      zone,
      adressDetails,
      nearbyLandmark,
      pickupPhone,
      otherPickupPhone,
      pickUpPointInMaps,
      coordinates
    } = req.body;

    // Find the address
    const addressIndex = user.pickUpAddresses?.findIndex(addr => addr.addressId === addressId);
    if (addressIndex === -1 || addressIndex === undefined) {
      return res.status(404).json({ error: 'Address not found' });
    }

    // Update fields
    if (addressName !== undefined) user.pickUpAddresses[addressIndex].addressName = addressName;
    if (country !== undefined) user.pickUpAddresses[addressIndex].country = country;
    if (city !== undefined) user.pickUpAddresses[addressIndex].city = city;
    if (zone !== undefined) user.pickUpAddresses[addressIndex].zone = zone;
    if (adressDetails !== undefined) user.pickUpAddresses[addressIndex].adressDetails = adressDetails;
    if (nearbyLandmark !== undefined) user.pickUpAddresses[addressIndex].nearbyLandmark = nearbyLandmark;
    if (pickupPhone !== undefined) user.pickUpAddresses[addressIndex].pickupPhone = pickupPhone;
    if (otherPickupPhone !== undefined) user.pickUpAddresses[addressIndex].otherPickupPhone = otherPickupPhone;
    if (pickUpPointInMaps !== undefined) user.pickUpAddresses[addressIndex].pickUpPointInMaps = pickUpPointInMaps;
    if (coordinates !== undefined) {
      try {
        const coords = typeof coordinates === 'string' ? JSON.parse(coordinates) : coordinates;
        user.pickUpAddresses[addressIndex].coordinates = coords;
      } catch (e) {
        console.error('Error parsing coordinates:', e);
      }
    }

    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Pickup address updated successfully',
      address: user.pickUpAddresses[addressIndex]
    });
  } catch (error) {
    console.error('Error in updatePickupAddress:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Delete a pickup address
const deletePickupAddress = async (req, res) => {
  try {
    const user = await User.findById(req.userData._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { addressId } = req.params;

    // Find the address
    const addressIndex = user.pickUpAddresses?.findIndex(addr => addr.addressId === addressId);
    if (addressIndex === -1 || addressIndex === undefined) {
      return res.status(404).json({ error: 'Address not found' });
    }

    // Don't allow deleting if it's the only address
    if (user.pickUpAddresses.length === 1) {
      return res.status(400).json({ error: 'Cannot delete the only pickup address' });
    }

    // Remove the address
    const deletedAddress = user.pickUpAddresses[addressIndex];
    user.pickUpAddresses.splice(addressIndex, 1);

    // If deleted address was default, set first address as default
    if (deletedAddress.isDefault && user.pickUpAddresses.length > 0) {
      user.pickUpAddresses[0].isDefault = true;
    }

    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Pickup address deleted successfully'
    });
  } catch (error) {
    console.error('Error in deletePickupAddress:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Set default pickup address
const setDefaultPickupAddress = async (req, res) => {
  try {
    const user = await User.findById(req.userData._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { addressId } = req.params;

    // Find the address
    const addressIndex = user.pickUpAddresses?.findIndex(addr => addr.addressId === addressId);
    if (addressIndex === -1 || addressIndex === undefined) {
      return res.status(404).json({ error: 'Address not found' });
    }

    // Set all addresses to not default
    user.pickUpAddresses.forEach(addr => {
      addr.isDefault = false;
    });

    // Set selected address as default
    user.pickUpAddresses[addressIndex].isDefault = true;

    await user.save();

    res.status(200).json({
      status: 'success',
      message: 'Default pickup address updated successfully',
      address: user.pickUpAddresses[addressIndex]
    });
  } catch (error) {
    console.error('Error in setDefaultPickupAddress:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// ======================================== SHOP FUNCTIONS ======================================== //

// Get shop page for business
const getBusinessShopPage = async (req, res) => {
  try {
    // Find products with stock > 0 and are available
    console.log('Searching for products with isAvailable: true and stock > 0');
    let products = await ShopProduct.find({
      isAvailable: true,
      stock: { $gt: 0 },
    })
      .select(
        'name nameAr category price discount stock unit images description descriptionAr isAvailable sku'
      )
      .sort({ category: 1, name: 1 });

    console.log(
      `Found ${products.length} available products with isAvailable=true and stock > 0`
    );

    // If no products found, check if there are any products with stock but may not be marked as available
    if (products.length === 0) {
      console.log(
        'No products with isAvailable=true, checking for products with stock > 0'
      );
      products = await ShopProduct.find({ stock: { $gt: 0 } })
        .select(
          'name nameAr category price discount stock unit images description descriptionAr isAvailable sku'
        )
        .sort({ category: 1, name: 1 });

      console.log(
        `Found ${products.length} total products with stock > 0 regardless of availability flag`
      );

      // If still no products, log a sample of all products for debugging
      if (products.length === 0) {
        const allProducts = await ShopProduct.find({}).limit(5);
        console.log(
          'Sample of all products in database:',
          allProducts.map((p) => ({
            id: p._id,
            name: p.name,
            isAvailable: p.isAvailable,
            stock: p.stock,
          }))
        );
      }
    }

    // Convert to plain objects with virtuals
    const productsWithVirtuals = products.map((product) => {
      const plainProduct = product.toObject({ virtuals: true });
      // Add additional fields that may be expected by the template
      plainProduct.packQuantity = plainProduct.packQuantity || 1; // Default pack quantity if not defined

      // Ensure finalPrice is calculated correctly
      if (typeof plainProduct.finalPrice === 'undefined') {
        if (plainProduct.discount > 0) {
          plainProduct.finalPrice =
            plainProduct.price -
            (plainProduct.price * plainProduct.discount) / 100;
        } else {
          plainProduct.finalPrice = plainProduct.price;
        }
      }

      console.log(
        `Product ${plainProduct.name}: category=${plainProduct.category}, price=${plainProduct.price}, discount=${plainProduct.discount}, finalPrice=${plainProduct.finalPrice}, isAvailable=${plainProduct.isAvailable}, stock=${plainProduct.stock}`
      );
      return plainProduct;
    });

    // Group products with virtuals by category
    const productsByCategory = productsWithVirtuals.reduce((acc, product) => {
      if (!acc[product.category]) {
        acc[product.category] = [];
      }
      acc[product.category].push(product);
      return acc;
    }, {});

    // Define all available categories whether they have products or not
    const allCategories = [
      'Packaging',
      'Labels',
      'Boxes',
      'Bags',
      'Tape',
      'Bubble Wrap',
      'Other',
    ];

    const shopDeliverFees = Object.fromEntries(
      Object.entries(orderBaseFees).map(([cat, types]) => [cat, types.Deliver])
    );

    res.render('business/shop', {
      title: req.translations.business.pages.shop.title,
      page_title: req.translations.business.pages.shopProducts.title,
      folder: req.translations.business.breadcrumb.shop,
      products: productsWithVirtuals,
      productsByCategory: productsByCategory,
      allCategories: allCategories,
      user: req.userData,
      userData: req.userData, // Make sure userData is available for the template
      shopDeliverFees,
    });
  } catch (error) {
    console.error('Error loading shop page:', error);
    res.status(500).render('error', { message: 'Error loading shop page' });
  }
};

// Get available products for business
const getAvailableProducts = async (req, res) => {
  try {
    const {
      category,
      search,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const query = { isAvailable: true, stock: { $gt: 0 } };

    if (category && category !== 'all') {
      query.category = category;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const sortOrder = order === 'desc' ? -1 : 1;
    const sortOptions = { [sortBy]: sortOrder };

    const products = await ShopProduct.find(query)
      .select('-createdBy -updatedBy')
      .sort(sortOptions);

    // Convert to plain objects with virtuals
    const productsWithVirtuals = products.map((product) =>
      product.toObject({ virtuals: true })
    );

    res.status(200).json(productsWithVirtuals);
  } catch (error) {
    console.error('Error fetching available products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

// Create shop order from business
const createShopOrder = async (req, res) => {
  try {
    const {
      items,
      fullName,
      phoneNumber,
      address,
      government,
      zone,
      notes,
      pickupAddressId: pickupAddressIdRaw,
    } = req.body;
    const businessId = req.userData._id;
    const pickupAddressId = (pickupAddressIdRaw || '').trim();
    const shopOrderAddress = require('../utils/shopOrderAddress');
    const {
      MANUAL_SENTINEL,
      resolveShopDeliveryFromUser,
      mergeDeliveryWithOverrides,
      mergeSavedPickupContactOnly,
      isCompleteOrderCustomer,
    } = shopOrderAddress;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Validate and prepare order items
    const orderItems = [];
    let subtotal = 0;
    let totalTax = 0;

    for (const item of items) {
      const product = await ShopProduct.findById(item.productId);

      if (!product) {
        return res
          .status(404)
          .json({ error: `Product ${item.productId} not found` });
      }

      if (!product.isInStock(item.quantity)) {
        return res.status(400).json({
          error: `Product ${product.name} is out of stock or insufficient quantity`,
        });
      }

      const unitPrice = product.finalPrice;
      const itemSubtotal = unitPrice * item.quantity;
      const itemTax = (itemSubtotal * product.taxRate) / 100;

      orderItems.push({
        product: product._id,
        productName: product.name,
        productNameAr: product.nameAr,
        quantity: item.quantity,
        unitPrice: unitPrice,
        discount: product.discount,
        tax: itemTax,
        subtotal: itemSubtotal,
      });

      subtotal += itemSubtotal;
      totalTax += itemTax;

      // Reduce stock
      await product.reduceStock(item.quantity);
    }

    // Get business info (pickup addresses needed for saved delivery resolution)
    const business = await User.findById(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    const overrides = {
      fullName,
      phoneNumber,
      address,
      government,
      zone,
    };

    let savedPickupAddressId;
    let deliveryAddressSource = 'manual';
    let orderCustomerPayload;

    if (pickupAddressId && pickupAddressId !== MANUAL_SENTINEL) {
      const resolved = resolveShopDeliveryFromUser(business, pickupAddressId);
      if (!resolved.ok) {
        return res.status(400).json({ error: resolved.error || 'Invalid pickup address' });
      }
      deliveryAddressSource = 'saved_pickup';
      savedPickupAddressId = resolved.savedPickupAddressId;
      orderCustomerPayload = mergeSavedPickupContactOnly(resolved.base, {
        fullName,
        phoneNumber,
      });
    } else {
      orderCustomerPayload = {
        fullName: fullName != null ? String(fullName).trim() : '',
        phoneNumber: phoneNumber != null ? String(phoneNumber).trim() : '',
        address: address != null ? String(address).trim() : '',
        government: government != null ? String(government).trim() : '',
        zone: zone != null ? String(zone).trim() : '',
      };
    }

    if (!isCompleteOrderCustomer(orderCustomerPayload)) {
      return res.status(400).json({
        error: 'All delivery information fields are required',
      });
    }

    // Calculate delivery fee using the same logic as normal orders
    const { calculateOrderFee } = require('../utils/fees');
    const deliveryFee = calculateOrderFee(
      orderCustomerPayload.government,
      'Deliver',
      false
    );

    // Create shop order
    const shopOrder = new ShopOrder({
      business: businessId,
      businessName: business.brandInfo?.brandName || business.name,
      items: orderItems,
      subtotal,
      tax: totalTax,
      deliveryFee,
      totalAmount: subtotal + totalTax + deliveryFee,
      orderCustomer: orderCustomerPayload,
      savedPickupAddressId:
        deliveryAddressSource === 'saved_pickup' ? savedPickupAddressId : undefined,
      deliveryAddressSource,
      contactInfo: {
        name: orderCustomerPayload.fullName,
        phone: orderCustomerPayload.phoneNumber,
      },
      notes,
      createdBy: businessId,
    });

    await shopOrder.save();

    res.status(201).json({
      message: 'Order placed successfully',
      order: shopOrder,
    });
  } catch (error) {
    console.error('Error creating shop order:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
};

// Get business shop orders page
const getBusinessShopOrdersPage = (req, res) => {
  res.render('business/shop-orders', {
    title: req.translations.business.pages.shopOrders.title,
    page_title: req.translations.business.pages.shopOrders.title,
    folder: req.translations.business.breadcrumb.shop,
  });
};

// Get business shop order details page
const getBusinessShopOrderDetailsPage = async (req, res) => {
  try {
    const { id } = req.params;
    const userData = req.userData;
    
    if (!userData || !userData._id) {
      req.flash('error', 'Unauthorized');
      return res.redirect('/business/shop/orders');
    }

    const order = await ShopOrder.findOne({ _id: id, business: userData._id })
      .populate('items.product')
      .populate({
        path: 'courier',
        model: 'courier',
        select: 'name phone'
      })
      .populate({
        path: 'trackingHistory.updatedBy',
        model: 'users',
        select: 'name'
      });

    if (!order) {
      req.flash('error', 'Order not found');
      return res.redirect('/business/shop/orders');
    }

    // Enhance order with consistent data structure
    const enhancedOrder = {
      ...order.toObject(),
      // Ensure all required fields are present
      orderNumber: order.orderNumber || 'N/A',
      status: order.status || 'pending',
      createdAt: order.createdAt || new Date(),
      contactInfo: order.contactInfo || {},
      orderCustomer: order.orderCustomer || {},
      items: order.items || [],
      trackingHistory: order.trackingHistory || [],
      subtotal: order.subtotal || 0,
      discount: order.discount || 0,
      tax: order.tax || 0,
      deliveryFee: order.deliveryFee || 0,
      totalAmount: order.totalAmount || 0
    };

    res.render('business/shop-order-details', {
      title: req.translations.business.pages.shopOrderDetails.title,
      page_title: req.translations.business.pages.shopOrderDetails.title,
      folder: req.translations.business.breadcrumb.shop,
      order: enhancedOrder,
      userData: userData
    });
  } catch (error) {
    console.error('Error loading shop order details:', error);
    req.flash('error', 'Internal Server Error');
    res.redirect('/business/shop/orders');
  }
};

// Get business shop orders
const getBusinessShopOrders = async (req, res) => {
  try {
    const businessId = req.userData._id;
    const { status } = req.query;

    const query = { business: businessId };

    if (status) {
      query.status = status;
    }

    const orders = await ShopOrder.find(query)
      .populate('items.product', 'name nameAr images')
      .populate({
        path: 'courier',
        model: 'courier',
        select: 'name phone'
      })
      .sort({ createdAt: -1 });

    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching business shop orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

// Get business shop order details
const getBusinessShopOrderDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const businessId = req.userData._id;

    console.log(`Fetching order details for order ID: ${id}, business ID: ${businessId}`);

    const order = await ShopOrder.findOne({ _id: id, business: businessId })
      .populate('items.product')
      .populate({
        path: 'courier',
        model: 'courier',
        select: 'name phone'
      })
      .populate({
        path: 'trackingHistory.updatedBy',
        model: 'users',
        select: 'name'
      });

    if (!order) {
      console.log(`Order not found for ID: ${id}, business: ${businessId}`);
      return res.status(404).json({ error: 'Order not found or you do not have permission to view this order' });
    }

    console.log(`Order found: ${order.orderNumber}`);
    res.status(200).json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
};

// Cancel shop order
const cancelShopOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const businessId = req.userData._id;

    const order = await ShopOrder.findOne({ _id: id, business: businessId });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (!['pending', 'confirmed'].includes(order.status)) {
      return res.status(400).json({
        error: 'Order cannot be cancelled at this stage',
      });
    }

    // Restore stock
    for (const item of order.items) {
      const product = await ShopProduct.findById(item.product);
      if (product) {
        await product.increaseStock(item.quantity);
      }
    }

    order.status = 'cancelled';
    order.cancellationReason = reason;
    order.updatedBy = businessId;
    order.updatedByModel = 'User';

    await order.save();

    res.status(200).json({
      message: 'Order cancelled successfully',
      order,
    });
  } catch (error) {
    console.error('Error cancelling order:', error);
    res.status(500).json({ error: 'Failed to cancel order' });
  }
};

// ================================================= Smart Flyer Barcode ================================================= //


const scanSmartFlyerBarcode = async (req, res) => {
  try {
    const { orderNumber, smartFlyerBarcode } = req.body;

    // Validate required fields
    if (!orderNumber || !smartFlyerBarcode) {
      return res.status(400).json({ 
        error: 'Order number and Smart Flyer barcode are required' 
      });
    }

    // Validate barcode format (adjust regex as needed for your barcode format)
    const barcodeRegex = /^[A-Z0-9]+$/;
    if (!barcodeRegex.test(smartFlyerBarcode)) {
      return res.status(400).json({ 
        error: 'Invalid Smart Flyer barcode format' 
      });
    }

    // Find the order
    const order = await Order.findOne({ 
      orderNumber: orderNumber,
      business: req.userData._id 
    });

    if (!order) {
      return res.status(404).json({ 
        error: 'Order not found or does not belong to your business' 
      });
    }

    // Check if order already has a barcode
    if (order.smartFlyerBarcode) {
      return res.status(400).json({ 
        error: 'Order already has a Smart Flyer barcode assigned',
        existingBarcode: order.smartFlyerBarcode,
        message: `This order already has barcode: ${order.smartFlyerBarcode}`
      });
    }

    // Check if barcode is already assigned to another order
    const existingOrderWithBarcode = await Order.findOne({ 
      smartFlyerBarcode: smartFlyerBarcode 
    });

    if (existingOrderWithBarcode && existingOrderWithBarcode.orderNumber !== orderNumber) {
      return res.status(400).json({ 
        error: 'Barcode already assigned to another order',
        conflictingOrder: existingOrderWithBarcode.orderNumber,
        message: `This barcode is already assigned to order: ${existingOrderWithBarcode.orderNumber}`
      });
    }

    // Assign barcode to order
    order.smartFlyerBarcode = smartFlyerBarcode;
    await order.save();

    // Add to order notes if needed
    if (order.orderNotes) {
      order.orderNotes += `\nSmart Flyer barcode assigned: ${smartFlyerBarcode} at ${new Date().toISOString()}`;
    } else {
      order.orderNotes = `Smart Flyer barcode assigned: ${smartFlyerBarcode} at ${new Date().toISOString()}`;
    }

    await order.save();

    res.status(200).json({
      status: 'success',
      message: 'Smart Flyer barcode assigned successfully',
      order: {
        orderNumber: order.orderNumber,
        smartFlyerBarcode: order.smartFlyerBarcode,
        assignedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error scanning Smart Flyer barcode:', error);
    
    // Handle duplicate barcode error from model validation
    if (error.code === 'DUPLICATE_BARCODE' || error.code === 11000 || error.message.includes('duplicate key')) {
      return res.status(400).json({ 
        error: 'Barcode already assigned to another order',
        message: error.message || 'This Smart Flyer barcode is already in use by another order'
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error. Please try again.',
      details: error.message 
    });
  }
};

const getOrderBySmartBarcode = async (req, res) => {
  try {
    const { searchValue } = req.params;

    if (!searchValue) {
      return res.status(400).json({ 
        error: 'Order number or Smart Flyer barcode is required' 
      });
    }

    // Search in both orderNumber and smartFlyerBarcode fields
    const order = await Order.findOne({
      business: req.userData._id,
      $or: [
        { orderNumber: searchValue },
        { smartFlyerBarcode: searchValue }
      ]
    })
    .populate('deliveryMan', 'name phone email')
    .populate({
      path: 'courierHistory.courier',
      model: 'courier',
      select: 'name phone email'
    })
    .populate('business', 'name email phone brandInfo');

    if (!order) {
      return res.status(404).json({ 
        error: 'Order not found or does not belong to your business'
      });
    }

    // Enhance order with status information
    const orderObj = order.toObject();
    orderObj.statusLabel = statusHelper.getOrderStatusLabel(order.orderStatus);
    orderObj.statusDescription = statusHelper.getOrderStatusDescription(order.orderStatus);
    orderObj.categoryClass = statusHelper.getCategoryClass(order.statusCategory);
    orderObj.categoryColor = statusHelper.getCategoryColor(order.statusCategory);
    
    // Add fast shipping indicator
    orderObj.isFastShipping = order.orderShipping && order.orderShipping.isExpressShipping;

    res.status(200).json({
      status: 'success',
      message: 'Order found successfully',
      order: orderObj
    });

  } catch (error) {
    console.error('Error fetching order by Smart Flyer barcode or order number:', error);
    res.status(500).json({ 
      error: 'Internal server error. Please try again.',
      details: error.message 
    });
  }
};

const getBusinessLanguage = async (req, res) => {
  try {
    const businessId = req.userId || req.userData?._id;
    if (!businessId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const business = await User.findById(businessId).select('preferredLanguage');
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    return res.status(200).json({
      success: true,
      language: normalizeBusinessLanguage(business.preferredLanguage) || 'en',
    });
  } catch (error) {
    console.error('Error in getBusinessLanguage:', error);
    return res.status(500).json({ success: false, message: 'Failed to get language preference' });
  }
};

const updateBusinessLanguage = async (req, res) => {
  try {
    const businessId = req.userId || req.userData?._id;
    if (!businessId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const language = normalizeBusinessLanguage(req.body?.language);
    if (!language) {
      return res.status(400).json({
        success: false,
        message: 'Invalid language. Supported values are: en, ar.',
      });
    }

    const business = await User.findByIdAndUpdate(
      businessId,
      { preferredLanguage: language },
      { new: true, runValidators: true }
    ).select('preferredLanguage');

    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Business language updated successfully.',
      language: normalizeBusinessLanguage(business.preferredLanguage) || 'en',
    });
  } catch (error) {
    console.error('Error in updateBusinessLanguage:', error);
    return res.status(500).json({ success: false, message: 'Failed to update language preference' });
  }
};

module.exports = {
  getDashboardPage,
  getDashboardData,
  completionConfirm,
  requestVerification,


  // Orders
  get_ordersPage,
  get_orders,
  exportOrdersToExcel,
  getOrdersImportTemplate,
  postOrdersImportValidate,
  postOrdersImportCommit,
  get_createOrderPage,
  submitOrder,
  get_editOrderPage,
  get_orderDetailsPage,
  get_orderDetailsAPI,
  editOrder,
  cancelOrder,
  deleteOrder,
  printPolicy,
  initiateReturn,

  // Enhanced Return Flow
  getAvailableReturnOrders,
  getReturnOrderDetails,
  getReturnOrders,
  calculateReturnFees,
  calculateReturnFeesAPI,
  markDeliverOrderAsReturned,

  // Pickup
  get_pickupPage,
  get_pickups,
  exportPickupsToExcel,
  get_pickupDetailsPage,
  get_pickedupOrders,
  ratePickup,
  createPickup,
  updatePickup,
  cancelPickup,
  deletePickup,

  // Wallet
  get_walletPage,
  get_walletEntries,
  exportWalletToExcel,

  get_shopPage,

  // Tickets
  get_ticketsPage,


  // Edit Profil
  editProfile,

  logOut,

  calculateOrderFees,
  validateOriginalOrder,
  // expose pickup fee calculator
  calculatePickupFee,
  retryTomorrow,
  retryScheduled,
  returnToWarehouseFromWaiting,
  cancelFromWaiting,
  recoverOrderCourier,
  
  // Shop functions
  getBusinessShopPage,
  getAvailableProducts,
  createShopOrder,
  getBusinessShopOrdersPage,
  getBusinessShopOrderDetailsPage,
  getBusinessShopOrders,
  getBusinessShopOrderDetails,
  cancelShopOrder,
  
  // Smart Flyer Barcode functions
  scanSmartFlyerBarcode,
  getOrderBySmartBarcode,
  
  // Settings functions
  getSettingsPage,
  updateSettings,
  getBusinessLanguage,
  updateBusinessLanguage,
  sendEmailOtp,
  verifyEmailOtp,
  sendPhoneOtp,
  verifyPhoneOtp,
  
  // Multiple Pickup Addresses
  addPickupAddress,
  updatePickupAddress,
  deletePickupAddress,
  setDefaultPickupAddress,
  
};

