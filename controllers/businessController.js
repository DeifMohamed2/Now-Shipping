const PDFDocument = require('pdfkit');
const Transaction = require('../models/transactions');
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

// Ensure all models are properly registered with Mongoose
require('../models/courier');
require('../models/shopProduct');
require('../models/shopOrder');
// Transporter is centralized in utils/email via emailService

//================================================ Dashboard  ================================================= //
// Simple in-memory cache for dashboard data
const dashboardCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const getDashboardPage = async (req, res) => {
  try {
    // Only load data if user has completed account setup
    let dashboardData = {};

    if (req.userData.isCompleted) {
      // Check cache first
      const cacheKey = `dashboard_${req.userData._id}`;
      const cachedData = dashboardCache.get(cacheKey);
      
      if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_DURATION) {
        dashboardData = cachedData.data;
      } else {
      // Use aggregation pipeline for optimal performance
      const businessId = req.userData._id;
      
      // Single aggregation query to get all order statistics
      const orderStatsPipeline = [
        { $match: { business: businessId } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            inProgressCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'inProgress'] }, 1, 0] }
            },
            headingToCustomerCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'headingToCustomer'] }, 1, 0] }
            },
            completedCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'completed'] }, 1, 0] }
            },
            awaitingActionCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'waitingAction'] }, 1, 0] }
            },
            headingToYouCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'returnToBusiness'] }, 1, 0] }
            },
            newOrdersCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'new'] }, 1, 0] }
            }
          }
        }
      ];

      // Financial data aggregation
      const financialStatsPipeline = [
        { $match: { business: businessId } },
        {
          $group: {
            _id: null,
            expectedCash: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ['$orderShipping.amountType', ['COD', 'CD', 'CC']] },
                      { $in: ['$orderStatus', ['headingToCustomer', 'inProgress']] }
                    ]
                  },
                  { $ifNull: ['$orderShipping.amount', 0] },
                  0
                ]
              }
            },
            collectedCash: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$orderShipping.amountType', 'COD'] },
                      { $eq: ['$orderStatus', 'completed'] },
                      {
                        $gte: ['$completedDate', new Date(new Date().setHours(0, 0, 0, 0))]
                      },
                      {
                        $lte: ['$completedDate', new Date(new Date().setHours(23, 59, 59, 999))]
                      }
                    ]
                  },
                  { $ifNull: ['$orderShipping.amount', 0] },
                  0
                ]
              }
            }
          }
        }
      ];

      // Monthly chart data aggregation (single query)
      const chartDataPipeline = [
        { $match: { business: businessId } },
        {
          $addFields: {
            orderMonth: {
              $dateToString: {
                format: "%Y-%m",
                date: "$orderDate"
              }
            },
            completedMonth: {
              $dateToString: {
                format: "%Y-%m",
                date: "$completedDate"
              }
            }
          }
        },
        {
          $group: {
            _id: "$orderMonth",
            orderCount: { $sum: 1 },
            completedRevenue: {
              $sum: {
                $cond: [
                  { $eq: ['$orderStatus', 'completed'] },
                  { $ifNull: ['$orderShipping.amount', 0] },
                  0
                ]
              }
            }
          }
        },
        { $sort: { _id: 1 } },
        { $limit: 9 }
      ];

      // Execute all queries in parallel
      const [orderStats, financialStats, chartData, recentOrders, recentPickups] = await Promise.all([
        Order.aggregate(orderStatsPipeline),
        Order.aggregate(financialStatsPipeline),
        Order.aggregate(chartDataPipeline),
        Order.find({ business: businessId })
        .sort({ orderDate: -1 })
          .limit(5)
          .select('orderNumber orderCustomer.fullName orderStatus')
          .lean(),
        Pickup.find({ business: businessId })
        .sort({ pickupDate: -1 })
          .limit(4)
          .select('pickupNumber pickupDate numberOfOrders picikupStatus')
          .lean()
      ]);

      // Process results
      const stats = orderStats[0] || {};
      const financial = financialStats[0] || {};
      
      const completionRate = stats.totalOrders > 0 
        ? Math.round((stats.completedCount / stats.totalOrders) * 100) 
        : 0;

      const collectionRate = financial.expectedCash > 0 
        ? Math.round((financial.collectedCash / financial.expectedCash) * 100) 
        : 0;

      // Process chart data
      const monthlyLabels = [];
      const monthlyRevenue = [];
      const monthlyOrderCounts = [];

      chartData.forEach(item => {
        const date = new Date(item._id + '-01');
        monthlyLabels.push(date.toLocaleString('default', { month: 'short' }));
        monthlyRevenue.push(item.completedRevenue);
        monthlyOrderCounts.push(item.orderCount);
      });

      // Compile all dashboard data
      dashboardData = {
        orderStats: {
          inProgressCount: stats.inProgressCount || 0,
          headingToCustomerCount: stats.headingToCustomerCount || 0,
          completedCount: stats.completedCount || 0,
          awaitingActionCount: stats.awaitingActionCount || 0,
          headingToYouCount: stats.headingToYouCount || 0,
          newOrdersCount: stats.newOrdersCount || 0,
          totalOrders: stats.totalOrders || 0,
          completionRate,
        },
        financialStats: {
          expectedCash: financial.expectedCash || 0,
          collectedCash: financial.collectedCash || 0,
          collectionRate,
        },
        recentData: {
          recentOrders,
          recentPickups,
        },
        chartData: {
          monthlyLabels,
          monthlyRevenue,
          monthlyOrderCounts,
        },
      };
      
      // Cache the data
      dashboardCache.set(cacheKey, {
        data: dashboardData,
        timestamp: Date.now()
      });
      
      // Clean old cache entries (keep only last 100 entries)
      if (dashboardCache.size > 100) {
        const oldestKey = dashboardCache.keys().next().value;
        dashboardCache.delete(oldestKey);
      }
    }
    }

    res.render('business/dashboard', {
      title: 'Dashboard',
      page_title: 'Overview',
      folder: 'Pages',
      user: req.userData,
      dashboardData,
    });
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.render('business/dashboard', {
      title: 'Dashboard',
      page_title: 'Overview',
      folder: 'Pages',
      user: req.userData,
      error: 'Failed to load dashboard data',
    });
  }
};
// get Dash Baord data For API 

const getDashboardData = async (req, res) => {
  try {
    // Only load data if user has completed account setup
    let dashboardData = {};

    if (req.userData.isCompleted) {
      const businessId = req.userData._id;
      
      // Single optimized aggregation query for all statistics
      const statsPipeline = [
        { $match: { business: businessId } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            inProgressCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'inProgress'] }, 1, 0] }
            },
            headingToCustomerCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'headingToCustomer'] }, 1, 0] }
            },
            inStockCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'inStock'] }, 1, 0] }
            },
            completedCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'completed'] }, 1, 0] }
            },
            unsuccessfulCount: {
              $sum: {
                $cond: [
                  { $in: ['$orderStatus', ['cancelled', 'rejected', 'returnCompleted', 'terminated', 'failed']] },
                  1,
                  0
                ]
              }
            },
            awaitingActionCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'waitingAction'] }, 1, 0] }
            },
            headingToYouCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'returnToBusiness'] }, 1, 0] }
            },
            newOrdersCount: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'new'] }, 1, 0] }
            },
            expectedCash: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $in: ['$orderShipping.amountType', ['COD', 'CD', 'CC']] },
                      { $in: ['$orderStatus', ['headingToCustomer', 'inProgress']] }
                    ]
                  },
                  { $ifNull: ['$orderShipping.amount', 0] },
                  0
                ]
              }
            },
            collectedCash: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$orderShipping.amountType', 'COD'] },
                      { $eq: ['$orderStatus', 'completed'] },
                      {
                        $gte: ['$completedDate', new Date(new Date().setHours(0, 0, 0, 0))]
                      },
                      {
                        $lte: ['$completedDate', new Date(new Date().setHours(23, 59, 59, 999))]
                      }
                    ]
                  },
                  { $ifNull: ['$orderShipping.amount', 0] },
                  0
                ]
              }
            }
          }
        }
      ];

      const [stats, revenueByMonth, ordersByMonth] = await Promise.all([
        Order.aggregate(statsPipeline),
        // Revenue by month for this business (completed & returnCompleted)
        Order.aggregate([
          { $match: { business: businessId, orderStatus: { $in: ['completed', 'returnCompleted'] } } },
          { $project: { m: { $month: { $ifNull: ['$completedDate', '$updatedAt'] } }, y: { $year: { $ifNull: ['$completedDate', '$updatedAt'] } }, amount: { $ifNull: ['$feeBreakdown.total', '$orderFees'] } } },
          { $group: { _id: { y: '$y', m: '$m' }, revenue: { $sum: '$amount' }, orders: { $sum: 1 } } },
          { $sort: { '_id.y': -1, '_id.m': -1 } },
          { $limit: 9 }
        ]),
        // Orders by month (all statuses)
        Order.aggregate([
          { $match: { business: businessId } },
          { $project: { m: { $month: '$orderDate' }, y: { $year: '$orderDate' } } },
          { $group: { _id: { y: '$y', m: '$m' }, count: { $sum: 1 } } },
          { $sort: { '_id.y': -1, '_id.m': -1 } },
          { $limit: 9 }
        ]),
      ]).then(results => [results[0][0], results[1], results[2]]);
      const result = stats || {};

      // Calculate rates
      const completionRate = result.totalOrders > 0 
        ? Math.round((result.completedCount / result.totalOrders) * 100) 
        : 0;

      const unsuccessfulRate = result.totalOrders > 0 
        ? Math.round((result.unsuccessfulCount / result.totalOrders) * 100) 
        : 0;

      const collectionRate = result.expectedCash > 0 
        ? Math.round((result.collectedCash / result.expectedCash) * 100) 
        : 0;

      // Compile all dashboard data
      dashboardData = {
        orderStats: {
          inProgressCount: result.inProgressCount || 0,
          headingToCustomerCount: result.headingToCustomerCount || 0,
          completedCount: result.completedCount || 0,
          awaitingActionCount: result.awaitingActionCount || 0,
          headingToYouCount: result.headingToYouCount || 0,
          newOrdersCount: result.newOrdersCount || 0,
          inStockCount: result.inStockCount || 0,
          totalOrders: result.totalOrders || 0,
          completionRate,
          unsuccessfulCount: result.unsuccessfulCount || 0,
          unsuccessfulRate,
        },
        financialStats: {
          expectedCash: result.expectedCash || 0,
          collectedCash: result.collectedCash || 0,
          collectionRate,
          revenueByMonth: revenueByMonth || [],
          ordersByMonth: ordersByMonth || [],
        },
      };
    }

    res.status(200).json({
      status: 'success',
      message: 'Dashboard data fetched successfully',
      dashboardData: dashboardData,
      userDate: req.userData,
    });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load dashboard data',
      error: error.message,
    });
  }
};





const completionConfirm = async (req, res) => {
  try {
    const {
      IPAorPhoneNumber,
      mobileWalletNumber,
      accountName,
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

    // ✅ 1. Validate required fields
    if (!brandName || !brandType || !industry || !monthlyOrders || !sellingPoints.length) {
      return res.status(400).json({ error: "All brand info fields are required." });
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
      if (!accountName || !IBAN || !bankName) {
        return res.status(400).json({ error: "Account Name, IBAN, and Bank Name are required for Bank Transfer." });
      }
      paymentDetails = { accountName, IBAN, bankName };
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

    // Process coordinates - they could be coming from different properties
    let locationCoords = null;
    if (pickUpPointCoordinates) {
      locationCoords = pickUpPointCoordinates;
    } else if (coordinates && typeof coordinates === 'string') {
      try {
     
        const coordParts = coordinates.split(',');
        if (coordParts.length === 2) {
          locationCoords = {
            lat: parseFloat(coordParts[0]),
            lng: parseFloat(coordParts[1])
          };
        }
      } catch (e) {
        console.error("Error parsing coordinates:", e);
      }
    }

    // ✅ 4. Update Existing User
    const updatedUser = await User.findByIdAndUpdate(
      req.userData._id,
      {
        brandInfo: {
          brandName,
          industry,
          monthlyOrders,
          sellingPoints,
          socialLinks,
        },
        pickUpAdress: {
          country,
          city,
          adressDetails,
          nearbyLandmark: nearbyLandmark || '',
          pickupPhone,
          pickUpPointInMaps: pickUpPointInMaps || '',
          coordinates: locationCoords,
          zone  
        },
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
    title: "Orders",
    page_title: 'Orders',
    folder: 'Pages',
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
      paymentType, // amountType (e.g. COD, CD, CC, NA)
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
        { 'orderShipping.productDescription': searchRegex }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find(query)
      .sort({ orderDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const totalCount = await Order.countDocuments(query);

    // Enhance orders with status info
    const enhancedOrders = orders.map(order => {
      const orderObj = order.toObject();
      orderObj.statusLabel = statusHelper.getOrderStatusLabel(order.orderStatus);
      orderObj.statusDescription = statusHelper.getOrderStatusDescription(order.orderStatus);
      orderObj.categoryClass = statusHelper.getCategoryClass(order.statusCategory);
      orderObj.categoryColor = statusHelper.getCategoryColor(order.statusCategory);
      orderObj.isFastShipping = order.orderShipping && order.orderShipping.isExpressShipping;
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


const get_createOrderPage = (req, res) => {
  res.render('business/create-order' , {
    title: "Create Order",
    page_title: 'Create Order',
    folder: 'Pages'
   
  });
}


/**
 * Submit a new order with proper status categorization
 */
const submitOrder = async (req, res) => {
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
    amountCashCollection,
    previewPermission,
    referralNumber,
    Notes,
    isExpressShipping,
    // Return order specific fields
    originalOrderNumber,
    returnReason,
    returnNotes
  } = req.body;

  // Check if this is a partial return
  const isPartialReturn = req.body.isPartialReturn === 'true' || req.body.isPartialReturn === true;

  // Determine the number of items for the order
  let numberOfItemsForOrder = numberOfItems;

  try {
    console.log(req.body);

  // ✅ 1. Validate required fields
  if (
    !fullName ||
    !phoneNumber ||
    !address ||
    !government ||
    !zone ||
    !orderType
  ) {
    return res
      .status(400)
      .json({ error: 'All customer info fields are required.' });
  }

  // ✅ 2. Validate product fields based on order type
  if (orderType === 'Deliver') {
    if (!productDescription || !numberOfItems) {
      return res
        .status(400)
        .json({
          error: 'Deliver orders require product description and number of items.',
        });
    }
  } else if (orderType === 'Return') {
    if (isPartialReturn) {
      // For partial returns, validate standard fields plus partial return item count
      if (!req.body.partialReturnItemCount || !productDescription || !originalOrderNumber || !returnReason) {
        return res
          .status(400)
          .json({
            error: 'Partial return orders require partial return item count, product description, original order number, and return reason.',
          });
      }
      // Set numberOfItems from partialReturnItemCount for partial returns
      numberOfItemsForOrder = req.body.partialReturnItemCount;
    } else {
      // For full returns, validate standard fields
      if (!productDescription || !numberOfItems || !originalOrderNumber || !returnReason) {
        return res
          .status(400)
          .json({
            error: 'Return orders require product description, number of items, original order number, and return reason.',
          });
      }
    }
    
    // Validate that the original order exists and is eligible for return
    const originalOrder = await Order.findOne({ 
      orderNumber: originalOrderNumber,
      business: req.userData._id,
      orderStatus: 'completed',
      'orderShipping.orderType': 'Deliver'
    });
    console.log('Original order found:', originalOrder);
    
    // Debug: If not found, try to find the order without restrictions
    if (!originalOrder) {
      console.log('Order not found in submitOrder, searching without restrictions...');
      const debugOrder = await Order.findOne({ 
        orderNumber: originalOrderNumber,
        business: req.userData._id
      }).select('orderNumber orderCustomer orderShipping orderStatus business');
      
      if (debugOrder) {
        console.log('Debug - Found order in submitOrder:', {
          orderNumber: debugOrder.orderNumber,
          orderStatus: debugOrder.orderStatus,
          orderType: debugOrder.orderShipping.orderType,
          business: debugOrder.business,
          requestedBusiness: req.userData._id
        });
        
        return res.status(400).json({ 
          error: 'Original order found but not eligible for return',
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
      return res.status(400).json({ 
        error: 'Original order not found or not eligible for return. Only completed deliver orders can be returned.' 
      });
    }

    // Check if this order is already linked to a return
    const existingReturn = await Order.findOne({
      'orderShipping.originalOrderNumber': originalOrderNumber,
      business: req.userData._id
    });

    if (existingReturn) {
      return res.status(400).json({ 
        error: 'This order already has an associated return request.' 
        });
    }
  } else if (orderType === 'Exchange') {
    if (
      !currentPD ||
      !numberOfItemsCurrentPD ||
      !newPD ||
      !numberOfItemsNewPD
    ) {
      return res
        .status(400)
        .json({
          error: 'Exchange orders require current and new product details.',
        });
    }
    

    // Cash Difference amount is optional for Exchange orders
    // No validation required for amountCashDifference
  } else if (orderType === 'Cash Collection') {
    if (!amountCashCollection) {
      return res
        .status(400)
        .json({ error: 'Cash collection amount is required.' });
    }
    
    // Cash Collection doesn't need product description or number of items
    // But we'll validate the amount is positive
    if (parseFloat(amountCashCollection) <= 0) {
      return res
        .status(400)
        .json({ error: 'Cash collection amount must be greater than zero.' });
    }
  }

  // ✅ 3. Calculate order fees using server-side calculator
  const expressShippingValue = isExpressShipping === 'on' || isExpressShipping === true;
  const orderFees = calculateFees(government, orderType, expressShippingValue);

  // ✅ 3. Create Order
  const newOrder = new Order({
    orderNumber: `${
      Math.floor(Math.random() * (900000 - 100000 + 1)) + 100000
    }`,
    orderDate: new Date(),
    orderStatus: 'new',
    statusCategory: statusHelper.STATUS_CATEGORIES.NEW,
    orderFees: orderFees,
    orderCustomer: {
      fullName,
      phoneNumber,
      otherPhoneNumber: otherPhoneNumber || null,
      address,
      government,
      zone,
      deliverToWorkAddress: deliverToWorkAddress === 'on' || deliverToWorkAddress === true,
    },
    orderShipping: {
      productDescription: productDescription || currentPD || '',
      numberOfItems: numberOfItemsForOrder || numberOfItemsCurrentPD || 0,
      productDescriptionReplacement: newPD || '',
      numberOfItemsReplacement: numberOfItemsNewPD || 0,
      orderType: orderType,
      amountType: COD ? 'COD' : CashDifference ? 'CD' : amountCashCollection ? 'CC' : 'NA',
      amount: amountCOD || amountCashDifference || amountCashCollection,
      isExpressShipping: isExpressShipping === 'on' || isExpressShipping === true,
      // Return order specific fields
      originalOrderNumber: originalOrderNumber || null,
      returnReason: returnReason || null,
      returnNotes: returnNotes || null,
      // Partial return fields
      isPartialReturn: isPartialReturn === 'true' || isPartialReturn === true,
      originalOrderItemCount: req.body.originalOrderItemCount || null,
      partialReturnItemCount: req.body.partialReturnItemCount || null,
    },
    isOrderAvailableForPreview: previewPermission === 'on',
    orderNotes: Notes || '',
    referralNumber: referralNumber || '',
    orderStages: {
      orderPlaced: {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Order has been created.'
      },
      packed: {
        isCompleted: false,
        completedAt: null,
        notes: ''
      },
      shipping: {
        isCompleted: false,
        completedAt: null,
        notes: ''
      },
      inProgress: {
        isCompleted: false,
        completedAt: null,
        notes: ''
      },
      outForDelivery: {
        isCompleted: false,
        completedAt: null,
        notes: ''
      },
      delivered: {
        isCompleted: false,
        completedAt: null,
        notes: ''
      },
      // Return-specific stages (only for return orders)
      ...(orderType === 'Return' && {
        returnInitiated: {
          isCompleted: true,
          completedAt: new Date(),
          notes: 'Return order initiated by business.',
          initiatedBy: 'business',
          reason: returnReason
        },
        returnAssigned: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          assignedCourier: null,
          assignedBy: null
        },
        returnPickedUp: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          pickedUpBy: null,
          pickupLocation: null,
          pickupPhotos: []
        },
        returnAtWarehouse: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          receivedBy: null,
          warehouseLocation: null,
          conditionNotes: ''
        },
        returnInspection: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          inspectedBy: null,
          inspectionResult: null,
          inspectionPhotos: []
        },
        returnProcessing: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          processedBy: null,
          processingType: null
        },
        returnToBusiness: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          assignedCourier: null,
          assignedBy: null
        },
        returnCompleted: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          completedBy: null,
          deliveryLocation: null,
          businessSignature: null
        }
      }),
      // Exchange-specific stages (only for exchange orders)
      ...(orderType === 'Exchange' && {
        exchangePickup: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          pickedUpBy: null,
          pickupLocation: null,
          originalItemPhotos: []
        },
        exchangeDelivery: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          deliveredBy: null,
          deliveryLocation: null,
          replacementItemPhotos: []
        }
      }),
      // Cash Collection-specific stages
      ...(orderType === 'Cash Collection' && {
        collectionComplete: {
          isCompleted: false,
          completedAt: null,
          notes: '',
          collectedBy: null,
          collectionAmount: amountCashCollection || 0,
          collectionReceipt: null
        }
      })
    },
    business: req.userData._id,
  });


    const savedOrder = await newOrder.save();
    res.status(201).json({ message: "Order created successfully.", order: savedOrder });
  }

  catch (error) {
    console.error("Error in submitOrder:", error);
    res.status(500).json({ error: "Internal server error. Please try again." });
  }

};



const get_editOrderPage = async (req, res) => {
  const { orderNumber } = req.params;

  try{
    const order = await Order
    .findOne({ orderNumber })
    .populate('business');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    console.log(order);
    res.render('business/edit-order' , {
      title: "Edit Order",
      page_title: 'Edit Order',
      folder: 'Pages',
      order
    });


  }catch (error) {
    console.error("Error in get_editOrderPage:", error);
    res.render('business/edit-order', {
      title: 'Edit Order',
      page_title: 'Edit Order',
      folder: 'Pages',
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
    amountCashCollection,
    previewPermission,
    referralNumber,
    Notes,
    isExpressShipping
  } = req.body;

  try {
    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify the order belongs to the user's business
    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'You do not have permission to edit this order' });
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
    } else if (amountCashCollection) {
      amountType = 'CC';
      amountFromConditions = parseFloat(amountCashCollection) || 0;
    }

    // Get the shipping fee (either from the frontend or calculate it here)
    const calculatedOrderFees = orderFees ? Number(orderFees) : 120; // Default fee if not provided

    // ✅ 3. Update Order
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
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
      .populate({
        path: 'courierHistory.courier',
        model: 'courier',
        select: 'name'
      });

    if (!order) {
      req.flash('error', 'Order not found');
      return res.redirect('/business/orders');
    }

    res.render('business/order-details', {
      title: 'Order Details',
      page_title: 'Order Details',
      folder: 'Orders',
      order: order
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
      .populate('business', 'name email phone brandInfo');

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
    const orderStages = [
      'orderPlaced', 'packed', 'shipping', 'inProgress', 
      'outForDelivery', 'delivered'
    ];
    
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
      ...order.orderStages[stage]?.toObject()
    }));

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
        business: orderObj.business,
        scheduledRetryAt: orderObj.scheduledRetryAt,
        createdAt: orderObj.createdAt,
        updatedAt: orderObj.updatedAt
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
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if business owns this order
    if (order.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Determine cancellation behavior based on order status and stage
    const isOrderPickedUp = order.orderStages.packed && order.orderStages.packed.isCompleted;
    const isOrderInProgress = order.orderStages.shipping && order.orderStages.shipping.isCompleted;
    const isOrderOutForDelivery = order.orderStages.outForDelivery && order.orderStages.outForDelivery.isCompleted;
    const hasCourierAssigned = order.deliveryMan && order.deliveryMan.toString().length > 0;

    console.log('Cancellation Debug:', {
      orderNumber: order.orderNumber,
      isOrderPickedUp,
      isOrderInProgress,
      isOrderOutForDelivery,
      hasCourierAssigned,
      deliveryMan: order.deliveryMan,
      orderStatus: order.orderStatus
    });

    // If order is just created (not picked up yet), cancel directly
    if (!isOrderPickedUp && !isOrderInProgress && !isOrderOutForDelivery) {
      order.orderStatus = 'canceled';
      order.orderStages.canceled = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Order canceled by business before pickup',
        canceledBy: 'business'
      };
      await order.save();

      // Send push notification to courier about order cancellation (if assigned)
      if (order.deliveryMan) {
        try {
          await firebase.sendOrderStatusNotification(
            order.deliveryMan,
            order.orderNumber,
            'canceled',
            {
              cancelledBy: 'Business',
              cancelledAt: new Date(),
              reason: 'Order canceled by business before pickup'
            }
          );
          console.log(`📱 Push notification sent to courier ${order.deliveryMan} about order ${order.orderNumber} cancellation`);
        } catch (notificationError) {
          console.error(`❌ Failed to send push notification to courier ${order.deliveryMan}:`, notificationError);
          // Don't fail the cancellation if notification fails
        }
      }

      return res.status(200).json({ message: 'Order canceled successfully.' });
    }

    // If order status is 'pickedUp', update to returnPickedUp and change status to returnToWarehouse
    // Validate the status transition
    if (!statusHelper.isValidStatusTransition(order.orderStatus, 'canceled')) {
      return res.status(400).json({
        error: `Cannot cancel order from current status: ${order.orderStatus}`,
        currentStatus: order.orderStatus,
        statusLabel: statusHelper.getOrderStatusLabel(order.orderStatus)
      });
    }
    
    if (order.orderStatus === 'pickedUp') {
      order.orderStatus = 'returnToWarehouse';
      
      // Ensure order is treated as a Return type going forward
      if (order.orderShipping && order.orderShipping.orderType !== 'Return') {
        order.orderShipping.returnReason = 'business_canceled';
        order.orderShipping.orderType = 'Return';
      }
      
      // Initialize return stages properly
      order.orderStages.returnInitiated = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Order canceled by business after pickup — moved to return flow',
        initiatedBy: 'business',
        reason: 'business_canceled'
      };
      
      // Mark returnPickedUp as completed since order was already picked up
      order.orderStages.returnPickedUp = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Return picked up (courier already has the order from original pickup)',
        pickedUpBy: order.deliveryMan
      };
      
      await order.save();
      return res.status(200).json({ message: 'Order moved to return to warehouse.' });
    }
    
    // If order status is 'inStock', update to returnAtWarehouse
    if (order.orderStatus === 'inStock') {
      order.orderStatus = 'returnAtWarehouse';
      
      // Ensure order is treated as a Return type going forward
      if (order.orderShipping && order.orderShipping.orderType !== 'Return') {
        order.orderShipping.returnReason = 'business_canceled';
        order.orderShipping.orderType = 'Return';
      }
      
      // Initialize return stages
      order.orderStages.returnInitiated = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Order canceled by business while in stock — moved to return flow',
        initiatedBy: 'business',
        reason: 'business_canceled'
      };
      
      // Mark returnPickedUp and returnAtWarehouse as completed since order is already at warehouse
      order.orderStages.returnPickedUp = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Return picked up (order was already at warehouse)',
        pickedUpBy: order.deliveryMan
      };
      
      order.orderStages.returnAtWarehouse = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Return at warehouse (order was already at warehouse)',
        receivedBy: null,
        warehouseLocation: 'main_warehouse',
        conditionNotes: 'Order was already in stock before cancellation'
      };
      
      await order.save();
      return res.status(200).json({ message: 'Order moved to return at warehouse.' });
    }
    
    // If order status is 'headingToCustomer', update to returnToWarehouse
    if (order.orderStatus === 'headingToCustomer') {
      order.orderStatus = 'returnToWarehouse';
      
      // Ensure order is treated as a Return type going forward
      if (order.orderShipping && order.orderShipping.orderType !== 'Return') {
        order.orderShipping.returnReason = 'business_canceled';
        order.orderShipping.orderType = 'Return';
      }
      
      // Initialize return stages
      order.orderStages.returnInitiated = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Order canceled by business while heading to customer — moved to return flow',
        initiatedBy: 'business',
        reason: 'business_canceled'
      };
      
      // If courier is assigned, preserve for return
      if (order.deliveryMan) {
        order.courierHistory.push({
          courier: order.deliveryMan,
          assignedAt: new Date(),
          action: 'assigned',
          notes: 'Courier reassigned for return process after cancellation'
        });
        
        order.orderStages.returnAssigned = {
          isCompleted: true,
          completedAt: new Date(),
          notes: 'Same courier assigned for return (preserved from original delivery)',
          assignedCourier: order.deliveryMan,
          assignedBy: null
        };
      }
      
      await order.save();
      return res.status(200).json({ message: 'Order heading to customer has been recalled to warehouse.' });
    }

    // If order is in any other stage that involves courier, handle the return flow
    if (isOrderPickedUp || isOrderInProgress || isOrderOutForDelivery) {
      order.orderStatus = 'returnToWarehouse';
      
      // Ensure order is treated as a Return type going forward
      if (order.orderShipping && order.orderShipping.orderType !== 'Return') {
        order.orderShipping.returnReason = 'business_canceled';
        order.orderShipping.orderType = 'Return';
      }
      
      // Initialize return stages properly
      if (!order.orderStages.returnInitiated || !order.orderStages.returnInitiated.isCompleted) {
        order.orderStages.returnInitiated = {
          isCompleted: true,
          completedAt: new Date(),
          notes: 'Order canceled by business after processing — moved to return flow',
          initiatedBy: 'business',
          reason: 'business_canceled'
        };
      }

      // If order has a courier assigned, preserve the assignment for return
      if (order.deliveryMan) {
        // Add courier to history for return process
        order.courierHistory.push({
          courier: order.deliveryMan,
          assignedAt: new Date(),
          action: 'assigned',
          notes: 'Courier preserved for return process after cancellation'
        });
        
        // Mark return assigned as completed (same courier)
        order.orderStages.returnAssigned = {
          isCompleted: true,
          completedAt: new Date(),
          notes: 'Same courier assigned for return (preserved from original delivery)',
          assignedCourier: order.deliveryMan,
          assignedBy: null
        };

        // Mark return picked up as completed if courier already has the order
        if (order.orderStatus === 'outForDelivery' || order.orderStatus === 'headingToCustomer') {
          order.orderStages.returnPickedUp = {
            isCompleted: true,
            completedAt: new Date(),
            notes: 'Return picked up (courier already has the order from delivery)',
            pickedUpBy: order.deliveryMan,
            pickupLocation: 'with_courier',
            pickupPhotos: []
          };
        }
      } else {
        // SAFETY CHECK: If order has stages completed but no courier assigned, log this issue
        console.warn(`Order ${order.orderNumber} has completed stages but no courier assigned:`, {
          isOrderPickedUp,
          isOrderInProgress,
          isOrderOutForDelivery,
          orderStages: order.orderStages
        });
        
        // Initialize return stages without courier (admin will need to assign)
        order.orderStages.returnAssigned = {
          isCompleted: false,
          completedAt: null,
          notes: 'No courier assigned - admin needs to assign courier for return',
          assignedCourier: null,
          assignedBy: null
        };
      }
      
      // Mark forward delivery stages inactive
      order.orderStages.outForDelivery.isCompleted = false;
      order.orderStages.inProgress.isCompleted = false;
      
      await order.save();
      return res.status(200).json({ message: 'Order moved to return pipeline for processing.' });
    }

    // For any other status, just mark as canceled
    order.orderStatus = 'canceled';
    await order.save();
    return res.status(200).json({ message: 'Order canceled successfully.' });

  } catch (error) {
    console.error('Error in cancelOrder:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const deleteOrder = async (req, res) => {
  const { orderId } = req.params;

  try {
    const deletedOrder = await Order.findByIdAndDelete(orderId);

    if (!deletedOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.status(200).json({ message: 'Order deleted successfully.' });
  } catch (error) {
    console.error('Error in deleteOrder:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }

};

const printPolicy = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const order = await Order.findOne({ orderNumber });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Create PDF document
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40, // Add safe margins
      layout: 'portrait'
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="order.pdf"');

    // Pipe PDF to response
    doc.pipe(res);

    // Simple header
    doc.fontSize(20).text('E-01', { align: 'left' });
    doc.moveDown(0.5);

    // Main content table
    const table = {
      headers: ["3", "2", "6", "8", "6", "1", "2"],
      rows: [
        ["Customer Name:", order.orderCustomer?.fullName || 'N/A'],
        ["Phone:", order.orderCustomer?.phoneNumber || 'N/A'],
        ["Address:", order.orderCustomer?.address || 'N/A'],
        ["City:", order.orderCustomer?.government || 'N/A'],
        ["Zone:", order.orderCustomer?.zone || 'N/A'],
        ["Product:", order.orderShipping?.productDescription || 'N/A'],
        ["Items:", order.orderShipping?.numberOfItems?.toString() || '0'],
        ["Amount:", `${order.orderShipping?.amount || '0'} ${order.orderShipping?.amountType || ''}`]
      ]
    };

    // Draw table
    let y = doc.y;
    doc.font('Helvetica-Bold');
    table.headers.forEach((header, i) => {
      doc.text(header, 40 + (i * 70), y, { width: 70, align: 'center' });
    });
    
    y += 20;
    doc.font('Helvetica');
    table.rows.forEach((row, rowIndex) => {
      doc.text(row[0], 40, y);
      doc.text(row[1], 150, y);
      y += 20;
    });

    // Add order details
    doc.moveTo(40, y).lineTo(550, y).stroke();
    y += 20;
    
    doc.text(`Order REF: ${order.orderNumber}`, 40, y);
    doc.text(`Created At: ${order.createdAt?.toISOString().split('T')[0] || ''}`, 300, y);
    
    // Finalize PDF
    doc.end();
  } catch (error) {
    console.error('PDF Generation Error:', error);
    res.status(500).json({ 
      error: 'PDF Generation Failed',
      details: error.message
    });
  }
};

// ================= WaitingAction Actions ================= //

const retryTomorrow = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.business.toString() !== req.userData._id.toString()) return res.status(403).json({ error: 'Forbidden' });
    if (order.orderStatus !== 'waitingAction') return res.status(400).json({ error: 'Order not in waitingAction' });
    order.scheduledRetryAt = new Date(Date.now() + 24*60*60*1000);
    // Update inProgress stage for rescheduled
    if (!order.orderStages.inProgress.isCompleted) {
      order.orderStages.inProgress.isCompleted = true;
      order.orderStages.inProgress.completedAt = new Date();
      order.orderStages.inProgress.notes = 'Retry scheduled for tomorrow';
    }
    order.orderStatus = 'rescheduled';
    await order.save();
    return res.status(200).json({ message: 'Retry scheduled for tomorrow' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to schedule retry' });
  }
}

const retryScheduled = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { date } = req.body; // ISO date string
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.business.toString() !== req.userData._id.toString()) return res.status(403).json({ error: 'Forbidden' });
    if (!['waitingAction','rescheduled'].includes(order.orderStatus)) return res.status(400).json({ error: 'Order not eligible for scheduling' });
    const when = new Date(date);
    if (isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid date' });
    order.scheduledRetryAt = when;
    // Update inProgress stage for rescheduled
    if (!order.orderStages.inProgress.isCompleted) {
      order.orderStages.inProgress.isCompleted = true;
      order.orderStages.inProgress.completedAt = new Date();
      order.orderStages.inProgress.notes = 'Retry rescheduled';
    }
    order.orderStatus = 'rescheduled';
    await order.save();
    return res.status(200).json({ message: 'Retry scheduled' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to schedule retry' });
  }
}

const returnToWarehouseFromWaiting = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.business.toString() !== req.userData._id.toString()) return res.status(403).json({ error: 'Forbidden' });
    if (order.orderStatus !== 'waitingAction') return res.status(400).json({ error: 'Order not in waitingAction' });
    order.orderStatus = 'returnToWarehouse';
    // Update inProgress stage for return to warehouse
    if (!order.orderStages.inProgress.isCompleted) {
      order.orderStages.inProgress.isCompleted = true;
      order.orderStages.inProgress.completedAt = new Date();
      order.orderStages.inProgress.notes = 'Business requested return to warehouse';
    }
    await order.save();
    return res.status(200).json({ message: 'Order moved to return stock' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to move to return stock' });
  }
}

const cancelFromWaiting = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.business.toString() !== req.userData._id.toString()) return res.status(403).json({ error: 'Forbidden' });
    if (order.orderStatus !== 'waitingAction') return res.status(400).json({ error: 'Order not in waitingAction' });
    // Transition to return pipeline instead of final cancel
    order.orderStatus = 'returnToWarehouse';
    // Initialize return stages
    if (!order.orderStages.returnInitiated || !order.orderStages.returnInitiated.isCompleted) {
      order.orderStages.returnInitiated = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Business canceled from waiting — moved to return flow',
        initiatedBy: 'business',
        reason: 'customer_canceled'
      };
    }
    // Mark forward delivery stages inactive
    order.orderStages.outForDelivery.isCompleted = false;
    order.orderStages.inProgress.isCompleted = false;
    await order.save();
    return res.status(200).json({ message: 'Order moved to return pipeline' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to cancel order' });
  }
}

// Enhanced Return Flow Functions

// Calculate return fees based on order type and conditions
const calculateReturnFees = (orderType, government, isExpress, returnCondition = 'good') => {
  const baseFees = {
    'Deliver': 0,
    'Return': 15, // Base return fee
    'Exchange': 20, // Exchange fee
    'Cash Collection': 0
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
    deliverOrder.orderStatus = 'returnCompleted';
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
    
    // Check if return already initiated
    if (order.orderStatus === 'returnInitiated') {
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
    title: "Pickup",
    page_title: 'Pickup',
    folder: 'Pages',
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

const createPickup = async (req, res) => {
  const {
    numberOfOrders,
    pickupDate,
    phoneNumber,
    isFragileItems,
    isLargeItems,
    pickupNotes,
    pickupLocation
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
    const businessCity = business?.pickUpAdress?.city || '';

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

    function getPickupBaseFeeByCity(city){
      let category = 'Cairo';
      for (const [cat, govs] of Object.entries(governmentCategories)) {
        if (govs.includes(city)) { category = cat; break; }
      }
      // Base pickup fees by category (tunable)
      const baseByCategory = {
        'Cairo': 50,
        'Alexandria': 55,
        'Delta-Canal': 60,
        'Upper-RedSea': 80,
      };
      return baseByCategory[category] || 50;
    }

    const basePickupFee = getPickupBaseFeeByCity(businessCity);
    // Initially 0 picked orders, so apply < 3 rule
    const initialPickedCount = 0;
    const computedPickupFee = initialPickedCount < 3 ? Math.round(basePickupFee * 1.3) : basePickupFee;

    // ✅ 3. Create Pickup
    const newPickup = new Pickup({
      business: req.userData._id,
      pickupNumber: `${
        Math.floor(Math.random() * (900000 - 100000 + 1)) + 100000
      }`,
      numberOfOrders,
      pickupDate,
      phoneNumber,
      isFragileItems: isFragileItems === 'true',
      isLargeItems: isLargeItems === 'true',
      picikupStatus: 'new',
      pickupNotes,
      pickupFees: computedPickupFee,
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
  console.log(pickup);  
  if (!pickup) {
    // Check if the request is from API or web
    if (req.originalUrl.includes('/api/')) {
      // API request - return JSON response
      return res.status(404).json({ error: 'Pickup not found' });
    } else {
      res.render('business/pickup-details', {
        title: 'Pickup Details',
        page_title: 'Pickup Details',
        folder: 'Pages',
        pickup: null,
      });
      return;
    }
  }

  // Pickup found - render the page with pickup data
  if (req.originalUrl.includes('/api/')) {
    // API request - return JSON response
    return res.status(200).json({ pickup });
  } else {
    res.render('business/pickup-details', {
      title: 'Pickup Details',
      page_title: 'Pickup Details',
      folder: 'Pages',
      pickup,
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

const deletePickup  = async (req, res) => {
  const { pickupId } = req.params;

  try {
    const deletedPickup = await Pickup.findByIdAndDelete(pickupId);

    if (!deletedPickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    res.status(200).json({ message: 'Pickup deleted successfully.' });
  } catch (error) {
    console.error('Error in deletePickup:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}


//================================================END Pickup  ================================================= //


  // Function to recalculate user balance from all transactions
const recalculateUserBalance = async (userId) => {
  try {
    // Get all transactions for the user (both settled and unsettled)
    const allTransactions = await Transaction.find({
      business: userId
    }).sort({ createdAt: 1 }); // Sort by creation date to maintain chronological order

    // Calculate balance from all transactions
    let calculatedBalance = 0;
    console.log(`Recalculating balance for user ${userId}. Found ${allTransactions.length} transactions:`);
    allTransactions.forEach(transaction => {
      console.log(`  - ${transaction.transactionId} (${transaction.transactionType}): ${transaction.transactionAmount} EGP`);
      calculatedBalance += (transaction.transactionAmount || 0);
    });
    console.log(`Total calculated balance: ${calculatedBalance} EGP`);

    // Update user balance
    const user = await User.findById(userId);
    if (user) {
      const previousBalance = user.balance || 0;
      user.balance = calculatedBalance;
      await user.save();
      
      console.log(`Balance recalculated for user ${user.name}: ${previousBalance} -> ${calculatedBalance}`);
      return {
        previousBalance,
        newBalance: calculatedBalance,
        transactionCount: allTransactions.length,
        unsettledCount: allTransactions.filter(t => !t.settled).length
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error recalculating user balance:', error);
    throw error;
  }
};

const get_totalBalancePage  = async (req, res) => {
  try {
    // Recalculate balance from all transactions before rendering
    const balanceInfo = await recalculateUserBalance(req.userData._id);
    
    // Refresh user data to get updated balance
    const updatedUser = await User.findById(req.userData._id);
    req.userData = updatedUser; // Update the user data with fresh balance
    
    const now = new Date();
    const daysUntilWednesday = (3 - now.getDay() + 7) % 7; // Calculate days until next Wednesday
    const nextWednesday = new Date(now.setDate(now.getDate() + daysUntilWednesday));
    const weeklyWithdrawDate = nextWednesday.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); // Format the date to show as Wednesday with full date
    
    res.render('business/total-balance' , {
      title: "Total Balance",
      page_title: 'Total Balance',
      folder: 'Pages',
      userData: updatedUser, // Use the updated user data with recalculated balance
      weeklyWithdrawDate,
      balanceRecalculated: balanceInfo // Pass balance info for debugging/logging
    });
  } catch (error) {
    console.error('Error in get_totalBalancePage:', error);
    // Fallback to original behavior if recalculation fails
    const now = new Date();
    const daysUntilWednesday = (3 - now.getDay() + 7) % 7;
    const nextWednesday = new Date(now.setDate(now.getDate() + daysUntilWednesday));
    const weeklyWithdrawDate = nextWednesday.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    
    res.render('business/total-balance' , {
      title: "Total Balance",
      page_title: 'Total Balance',
      folder: 'Pages',
      userData: req.userData,
      weeklyWithdrawDate,
      error: 'Failed to recalculate balance'
    });
  }
}
const get_allTransactionsByDate = async (req, res) => {
  try {
    const { timePeriod } = req.query;
    let dateFilter = {};
    const now = new Date();
    console.log('Time Period:', timePeriod);
    console.log(now, timePeriod);
    
    // Set date filter based on time period
    switch (timePeriod) {
      case 'today':
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        dateFilter = {
          createdAt: {
            $gte: todayStart,
            $lte: todayEnd
          }
        };
        break;
      case 'week':
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        dateFilter = {
          createdAt: {
            $gte: weekStart,
            $lte: weekEnd
          }
        };
        console.log(`Week from ${weekStart.toLocaleDateString()} to ${weekEnd.toLocaleDateString()}`);
        break;
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        dateFilter = {
          createdAt: {
            $gte: monthStart,
            $lte: monthEnd
          }
        };
        break;
      case 'year':
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        dateFilter = {
          createdAt: {
            $gte: yearStart,
            $lte: yearEnd
          }
        };
        break;
      case 'all':
        dateFilter = {}; // No date filter for all time
        break;
      default:
        dateFilter = {};
    }

    const transactions = await Transaction.find({
      ...dateFilter,
      business: req.userData._id,
      transactionType: { $in: ['cashCycle', 'fees', 'pickupFees', 'refund', 'deposit', 'withdrawal', 'shopOrderDelivery'] },
    })
    .populate('orderReferences.orderId', 'orderNumber orderShipping orderFees completedDate')
    .populate('pickupReferences.pickupId', 'pickupNumber pickupFees')
    .populate('shopOrderReferences.shopOrderId', 'orderNumber totalAmount status deliveredDate')
    .sort({ createdAt: -1 });
    
    console.log('Transactions found:', transactions.length);
    
    // Enhance transactions with better data structure
    const enhancedTransactions = transactions.map(transaction => ({
      _id: transaction._id,
      transactionId: transaction.transactionId,
      transactionType: transaction.transactionType,
      transactionAmount: transaction.transactionAmount,
      transactionNotes: transaction.transactionNotes,
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      ordersDetails: transaction.ordersDetails,
      orderReferences: transaction.orderReferences || [],
      pickupReferences: transaction.pickupReferences || [],
      shopOrderReferences: transaction.shopOrderReferences || [],
      totalCashCycleOrders: transaction.totalCashCycleOrders,
      settled: transaction.settled || false,
      settlementStatus: transaction.settlementStatus || 'pending',
      // Calculate summary data
      orderCount: transaction.orderReferences ? transaction.orderReferences.length : 0,
      pickupCount: transaction.pickupReferences ? transaction.pickupReferences.length : 0,
      shopOrderCount: transaction.shopOrderReferences ? transaction.shopOrderReferences.length : 0,
      totalOrderAmount: transaction.orderReferences ? 
        transaction.orderReferences.reduce((sum, ref) => sum + (ref.orderAmount || 0), 0) : 0,
      totalOrderFees: transaction.orderReferences ? 
        transaction.orderReferences.reduce((sum, ref) => sum + (ref.orderFees || 0), 0) : 0,
      totalPickupFees: transaction.pickupReferences ? 
        transaction.pickupReferences.reduce((sum, ref) => sum + (ref.pickupFees || 0), 0) : 0,
      totalShopOrderAmount: transaction.shopOrderReferences ? 
        transaction.shopOrderReferences.reduce((sum, ref) => sum + (ref.totalAmount || 0), 0) : 0
    }));
    
    res.status(200).json(enhancedTransactions || []);
  } catch (error) {
    console.error('Error in get_allTransactionsByDate:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}

// Get single transaction details
const getTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const transaction = await Transaction.findById(transactionId)
      .populate('orderReferences.orderId', 'orderNumber orderShipping orderFees completedDate')
      .populate('pickupReferences.pickupId', 'pickupNumber pickupFees completedDate');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Check if transaction belongs to the requesting user
    if (transaction.business.toString() !== req.userData._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.status(200).json(transaction);
  } catch (error) {
    console.error('Error in getTransactionDetails:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}

// API endpoint to manually recalculate balance
const recalculateBalanceAPI = async (req, res) => {
  try {
    const balanceInfo = await recalculateUserBalance(req.userData._id);
    
    if (balanceInfo) {
      res.status(200).json({
        status: 'success',
        message: 'Balance recalculated successfully',
        balanceInfo: balanceInfo,
        currentBalance: balanceInfo.newBalance
      });
    } else {
      res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
  } catch (error) {
    console.error('Error in recalculateBalanceAPI:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to recalculate balance',
      error: error.message
    });
  }
}

// Professional Excel Export for Transactions
const exportTransactionsToExcel = async (req, res) => {
  try {
    const { timePeriod, statusFilter, dateFrom, dateTo, transactionType } = req.query;
    
    // Build query based on filters
    let query = { business: req.userData._id };
    let dateFilter = {};
    
    // Date filtering
    if (dateFrom && dateTo) {
      dateFilter = {
        createdAt: {
          $gte: new Date(dateFrom),
          $lte: new Date(dateTo)
        }
      };
    } else if (timePeriod && timePeriod !== 'all') {
      const now = new Date();
      switch (timePeriod) {
        case 'today':
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date();
          todayEnd.setHours(23, 59, 59, 999);
          dateFilter = { createdAt: { $gte: todayStart, $lte: todayEnd } };
          break;
        case 'week':
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
          dateFilter = { createdAt: { $gte: weekStart, $lte: weekEnd } };
          break;
        case 'month':
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
          dateFilter = { createdAt: { $gte: monthStart, $lte: monthEnd } };
          break;
        case 'year':
          const yearStart = new Date(now.getFullYear(), 0, 1);
          const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
          dateFilter = { createdAt: { $gte: yearStart, $lte: yearEnd } };
          break;
      }
    }
    
    // Status filtering
    if (statusFilter && statusFilter !== 'all') {
      query.settled = statusFilter === 'settled';
    }
    
    // Transaction type filtering
    if (transactionType && transactionType !== 'all') {
      query.transactionType = transactionType;
    }
    
    // Combine filters
    query = { ...query, ...dateFilter };
    
    // Get transactions
    const transactions = await Transaction.find(query)
      .populate('orderReferences.orderId', 'orderNumber orderShipping orderFees completedDate')
      .populate('pickupReferences.pickupId', 'pickupNumber pickupFees completedDate')
      .populate('shopOrderReferences.shopOrderId', 'orderNumber totalAmount status deliveredDate')
      .sort({ createdAt: -1 });
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Transaction History');
    
    // Define columns
    worksheet.columns = [
      { header: 'Transaction ID', key: 'transactionId', width: 15 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Amount (EGP)', key: 'amount', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Notes', key: 'notes', width: 30 },
      { header: 'Orders Count', key: 'ordersCount', width: 12 },
      { header: 'Pickups Count', key: 'pickupsCount', width: 12 }
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
    transactions.forEach(transaction => {
      const isPositive = ['cashCycle', 'refund', 'deposit'].includes(transaction.transactionType);
      const status = transaction.settled ? 'Settled' : 'Pending';
      
      worksheet.addRow({
        transactionId: transaction.transactionId,
        date: new Date(transaction.createdAt).toLocaleDateString(),
        type: getTransactionTypeLabel(transaction.transactionType),
        amount: transaction.transactionAmount,
        status: status,
        notes: transaction.transactionNotes || '',
        ordersCount: transaction.orderReferences ? transaction.orderReferences.length : 0,
        pickupsCount: transaction.pickupReferences ? transaction.pickupReferences.length : 0
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
        } else {
          amountCell.font = { color: { argb: 'EF4444' } };
        }
        
        // Color code status
        const statusCell = row.getCell('status');
        if (statusCell.value === 'Settled') {
          statusCell.font = { color: { argb: '10B981' } };
        } else {
          statusCell.font = { color: { argb: 'F59E0B' } };
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
    const filename = `transactions_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Write to response
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (error) {
    console.error('Error exporting transactions to Excel:', error);
    res.status(500).json({ error: 'Failed to export transactions' });
  }
}


// Helper function for transaction type labels
const getTransactionTypeLabel = (type) => {
  const labels = {
    'cashCycle': 'Cash Cycle',
    'fees': 'Service Fees',
    'pickupFees': 'Pickup Fees',
    'refund': 'Refund',
    'deposit': 'Deposit',
    'withdrawal': 'Withdrawal'
  };
  return labels[type] || type;
}
// ================================================= Cash Cycles ================================================= //

const get_cashCyclesPage = (req, res) => {
  res.render('business/cash-cycles' , {
    title: "Cash Cycles",
    page_title: 'Cash Cycles',
    folder: 'Pages'
   
  });
}


const get_totalCashCycleByDate = async (req, res) => {
  try {
    const { timePeriod, orderType, shippingType, releaseStatus, searchTerm } = req.query;
    let dateFilter = {};
    const now = new Date();
    
    // Ensure business ID is properly formatted
    const businessId = req.userData._id;
    
    console.log('Filter parameters:', { timePeriod, orderType, releaseStatus, searchTerm });

    // Set date filter based on time period
    switch(timePeriod) {
      case 'today':
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        dateFilter = {
          completedDate: {
            $gte: todayStart,
            $lte: todayEnd
          }
        };
        break;
      case 'week':
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        dateFilter = {
          completedDate: {
            $gte: weekStart,
            $lte: weekEnd
          }
        };
        console.log(`Week from ${weekStart.toLocaleDateString()} to ${weekEnd.toLocaleDateString()}`);
        break;
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        dateFilter = {
          completedDate: {
            $gte: monthStart,
            $lte: monthEnd
          }
        };
        break;
      case 'year':
        const yearStart = new Date(now.getFullYear(), 0, 1);
        const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        dateFilter = {
          completedDate: {
            $gte: yearStart,
            $lte: yearEnd
          }
        };
        break;
      case 'all':
        dateFilter = {}; // No date filter for all time
        break;
      default:
        dateFilter = {};
    }
    
    console.log('Date filter:', dateFilter);
    console.log('Business ID:', req.userData._id);
    
    // Get all processed orders with enhanced data (completed, returned, canceled, returnCompleted)
    let orders = [];
    
    // Get all order types that need financial processing
    const orderStatusesToProcess = ['completed', 'returned', 'canceled', 'returnCompleted'];
    
    // First try with all relevant statuses and date filter
    // Build additional filters
    let additionalFilters = {};
    
    // Order type filter
    if (orderType && orderType !== 'all') {
      additionalFilters['orderShipping.orderType'] = orderType;
    }
    
    // Shipping type filter
    if (shippingType && shippingType !== 'all') {
      if (shippingType === 'express') {
        additionalFilters['orderShipping.isExpressShipping'] = true;
      } else if (shippingType === 'standard') {
        additionalFilters['orderShipping.isExpressShipping'] = false;
      }
    }
    
    // Release status filter
    if (releaseStatus && releaseStatus !== 'all') {
      if (releaseStatus === 'released') {
        additionalFilters.moneyReleaseDate = { $exists: true, $ne: null };
      } else if (releaseStatus === 'pending') {
        additionalFilters.moneyReleaseDate = { $exists: false };
      }
    }
    
    // Search term filter
    if (searchTerm && searchTerm.trim() !== '') {
      const searchRegex = new RegExp(searchTerm.trim(), 'i');
      additionalFilters.$or = [
        { orderNumber: searchRegex },
        { 'orderCustomer.fullName': searchRegex },
        { 'orderCustomer.government': searchRegex },
        { 'orderCustomer.zone': searchRegex }
      ];
    }
    
    console.log('Additional filters applied:', additionalFilters);
    
    orders = await Order.find({ 
      business: businessId,
      orderStatus: { $in: orderStatusesToProcess },
      ...dateFilter,
      ...additionalFilters
    }).populate('deliveryMan', 'name phone')
      .sort({ completedDate: -1 });
    
    console.log('Processed orders found with date filter:', orders.length);
    
    // If no orders found, try without date filter to see if there are any processed orders at all
    if (orders.length === 0) {
      const allProcessedOrders = await Order.find({ 
        business: businessId,
        orderStatus: { $in: orderStatusesToProcess }
      }).populate('deliveryMan', 'name phone')
        .sort({ completedDate: -1 });
      
      console.log('Total processed orders for business:', allProcessedOrders.length);
      
      // If there are processed orders but none in the date range, show them anyway
      if (allProcessedOrders.length > 0) {
        console.log('No orders in date range, showing all processed orders');
        orders = allProcessedOrders;
      }
    }
    
    console.log('Final orders to return:', orders.length);

    // Debug: Check if there are any orders at all for this business
    const totalOrdersForBusiness = await Order.countDocuments({
      business: businessId
    });
    console.log('Total orders for business (any status):', totalOrdersForBusiness);
    
    // Get all order statuses for this business
    const orderStatuses = await Order.aggregate([
      { $match: { business: businessId } },
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    console.log('Order statuses for business:', orderStatuses);

    // Get in-progress orders count
    const inProgressCount = await Order.countDocuments({
      business: businessId,
      orderStatus: { $in: ['headingToCustomer', 'returnToBusiness', 'inProgress'] }
    });

    // Calculate totals for all order types
    const totalIncome = orders.reduce((acc, order) => {
      // Only completed orders generate positive income
      if (order.orderStatus === 'completed') {
        return acc + (order.orderShipping.amount || 0);
      }
      return acc;
    }, 0);

    const totalFees = orders.reduce((acc, order) => {
      let orderFees = order.orderFees || 0;
      
      // Add return fees for returned orders
      if (order.orderStatus === 'returned' && order.returnFees) {
        orderFees += order.returnFees;
      }
      
      // Add cancellation fees for canceled orders
      if (order.orderStatus === 'canceled' && order.totalFees) {
        orderFees += order.totalFees;
      }
      
      // Add return fees for return completed orders
      if (order.orderStatus === 'returnCompleted' && order.returnFees) {
        orderFees += order.returnFees;
      }
      
      return acc + orderFees;
    }, 0);

    const netTotal = totalIncome - totalFees;

    // Calculate order counts by status
    const completedCount = orders.filter(o => o.orderStatus === 'completed').length;
    const returnedCount = orders.filter(o => o.orderStatus === 'returned').length;
    const canceledCount = orders.filter(o => o.orderStatus === 'canceled').length;
    const returnCompletedCount = orders.filter(o => o.orderStatus === 'returnCompleted').length;

    // Get transaction data for better insights (include all transaction types)
    const transactions = await Transaction.find({
      business: businessId,
      transactionType: { $in: ['cashCycle', 'fees', 'pickupFees', 'returnFees', 'cancellationFees', 'returnCompletedFees', 'shopOrderDelivery'] },
      ...dateFilter
    }).sort({ createdAt: -1 });
    
    console.log('Transactions found:', transactions.length);

    // Calculate transaction totals
    const transactionIncome = transactions
      .filter(t => t.transactionType === 'cashCycle')
      .reduce((acc, t) => acc + (t.transactionAmount || 0), 0);
    
    const transactionFees = transactions
      .filter(t => ['fees', 'pickupFees', 'returnFees', 'cancellationFees', 'returnCompletedFees', 'shopOrderDelivery'].includes(t.transactionType))
      .reduce((acc, t) => acc + Math.abs(t.transactionAmount || 0), 0);

    console.log('Orders found:', orders.length, 'Total income:', totalIncome, 'Total fees:', totalFees);
    
    // Get release information for each order to determine money release status
    const Release = require('../models/releases');
    const releases = await Release.find({
      business: businessId,
      releaseStatus: { $in: ['pending', 'scheduled', 'released'] }
    });

    // Create a map of release status by order reference
    const releaseStatusMap = {};
    releases.forEach(release => {
      if (release.ordersDetails && release.ordersDetails.orderCount) {
        // This is a cash cycle release, mark all orders in that period as having this release status
        orders.forEach(order => {
          if (order.completedDate >= release.ordersDetails.dateRange?.from && 
              order.completedDate <= release.ordersDetails.dateRange?.to) {
            releaseStatusMap[order._id.toString()] = release.releaseStatus;
          }
        });
      }
    });

    // Always return data, even if empty
    const responseData = { 
      totalIncome, 
      totalFees,
      transactionFees, // Include transaction fees separately
      netTotal,
      orders: orders.map(order => ({
        _id: order._id,
        orderNumber: order.orderNumber,
        orderDate: order.orderDate,
        completedDate: order.completedDate,
        orderStatus: order.orderStatus,
        orderCustomer: order.orderCustomer,
        orderShipping: order.orderShipping,
        orderFees: order.orderFees,
        deliveryMan: order.deliveryMan,
        moneyReleaseDate: order.moneyReleaseDate || null,
        releaseStatus: releaseStatusMap[order._id.toString()] || 'pending'
      })),
      inProgressCount, 
      completedCount: orders.length,
      completedOrdersCount: completedCount,
      returnedOrdersCount: returnedCount,
      canceledOrdersCount: canceledCount,
      returnCompletedOrdersCount: returnCompletedCount,
      transactions: transactions.map(t => ({
        _id: t._id,
        transactionId: t.transactionId,
        transactionType: t.transactionType,
        transactionAmount: t.transactionAmount,
        transactionNotes: t.transactionNotes,
        createdAt: t.createdAt,
        orderReferences: t.orderReferences || [],
        pickupReferences: t.pickupReferences || [],
        ordersDetails: t.ordersDetails
      })),
      debug: {
        totalOrdersForBusiness,
        orderStatuses,
        timePeriod,
        dateFilter,
        releases: releases.map(r => ({
          id: r._id,
          status: r.releaseStatus,
          amount: r.amount,
          dateRange: r.ordersDetails?.dateRange
        }))
      }
    };
    
    console.log('Sending response:', responseData);
    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error in get_totalCashCycleByDate:', error);
    res.status(500).json({ 
      error: 'Internal server error. Please try again.',
      details: error.message,
      stack: error.stack
    });
  }
}


// Professional Excel Export for Cash Cycles
const exportCashCyclesToExcel = async (req, res) => {
  try {
    const { timePeriod, dateFrom, dateTo, orderStatus } = req.query;
    
    // Build query based on filters
    let query = { business: req.userData._id, orderStatus: 'completed' };
    let dateFilter = {};
    
    // Date filtering
    if (dateFrom && dateTo) {
      dateFilter = {
        completedDate: {
          $gte: new Date(dateFrom),
          $lte: new Date(dateTo)
        }
      };
    } else if (timePeriod && timePeriod !== 'all') {
      const now = new Date();
      switch (timePeriod) {
        case 'today':
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayEnd = new Date();
          todayEnd.setHours(23, 59, 59, 999);
          dateFilter = { completedDate: { $gte: todayStart, $lte: todayEnd } };
          break;
        case 'week':
          const weekStart = new Date();
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          weekStart.setHours(0, 0, 0, 0);
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          weekEnd.setHours(23, 59, 59, 999);
          dateFilter = { completedDate: { $gte: weekStart, $lte: weekEnd } };
          break;
        case 'month':
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
          dateFilter = { completedDate: { $gte: monthStart, $lte: monthEnd } };
          break;
        case 'year':
          const yearStart = new Date(now.getFullYear(), 0, 1);
          const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
          dateFilter = { completedDate: { $gte: yearStart, $lte: yearEnd } };
          break;
      }
    }
    
    // Combine filters
    query = { ...query, ...dateFilter };
    
    // Get orders
    const orders = await Order.find(query)
      .populate('deliveryMan', 'name phone')
      .sort({ completedDate: -1 });
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Cash Cycles Report');
    
    // Define columns
    worksheet.columns = [
      { header: 'Order ID', key: 'orderNumber', width: 15 },
      { header: 'Order Date', key: 'orderDate', width: 12 },
      { header: 'Completed Date', key: 'completedDate', width: 15 },
      { header: 'Order Type', key: 'orderType', width: 15 },
      { header: 'Customer', key: 'customer', width: 20 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Order Value (EGP)', key: 'orderValue', width: 18 },
      { header: 'Service Fee (EGP)', key: 'serviceFee', width: 18 },
      { header: 'Net Amount (EGP)', key: 'netAmount', width: 18 },
      { header: 'Delivery Man', key: 'deliveryMan', width: 20 },
      { header: 'Release Status', key: 'releaseStatus', width: 15 }
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
      const orderValue = order.orderShipping.amount || 0;
      const serviceFee = order.orderFees || 0;
      const netAmount = orderValue - serviceFee;
      
      worksheet.addRow({
        orderNumber: order.orderNumber,
        orderDate: new Date(order.orderDate).toLocaleDateString(),
        completedDate: new Date(order.completedDate).toLocaleDateString(),
        orderType: order.orderShipping.orderType,
        customer: order.orderCustomer.fullName,
        location: `${order.orderCustomer.government}, ${order.orderCustomer.zone}`,
        orderValue: orderValue,
        serviceFee: serviceFee,
        netAmount: netAmount,
        deliveryMan: order.deliveryMan ? order.deliveryMan.name : 'N/A',
        releaseStatus: order.moneyReleaseDate ? 'Released' : 'Pending'
      });
    });
    
    // Add summary row
    const totalRow = worksheet.addRow({});
    totalRow.getCell('orderNumber').value = 'TOTAL';
    totalRow.getCell('orderNumber').font = { bold: true };
    totalRow.getCell('orderValue').value = orders.reduce((sum, order) => sum + (order.orderShipping.amount || 0), 0);
    totalRow.getCell('serviceFee').value = orders.reduce((sum, order) => sum + (order.orderFees || 0), 0);
    totalRow.getCell('netAmount').value = totalRow.getCell('orderValue').value - totalRow.getCell('serviceFee').value;
    
    // Style summary row
    totalRow.font = { bold: true };
    totalRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'F3F4F6' }
    };
    
    // Style data rows
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 1 && rowNumber < worksheet.rowCount) {
        row.alignment = { vertical: 'middle' };
        
        // Color code amounts
        const orderValueCell = row.getCell('orderValue');
        const serviceFeeCell = row.getCell('serviceFee');
        const netAmountCell = row.getCell('netAmount');
        
        orderValueCell.font = { color: { argb: '10B981' } };
        serviceFeeCell.font = { color: { argb: 'EF4444' } };
        netAmountCell.font = { color: { argb: '3B82F6' } };
        
        // Color code release status
        const releaseStatusCell = row.getCell('releaseStatus');
        if (releaseStatusCell.value === 'Released') {
          releaseStatusCell.font = { color: { argb: '10B981' } };
        } else {
          releaseStatusCell.font = { color: { argb: 'F59E0B' } };
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
    const filename = `cash_cycles_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Write to response
    await workbook.xlsx.write(res);
    res.end();
    
  } catch (error) {
    console.error('Error exporting cash cycles to Excel:', error);
    res.status(500).json({ error: 'Failed to export cash cycles' });
  }
}



// ================================================= END Cash Cycles ================================================= //




// ================================================= Shop ================================================= //

const get_shopPage = (req, res) => {
  res.render('business/shop' , {
    title: "Shop",
    page_title: 'Shop',
    folder: 'Pages'
   
  });
  
}




// ================================================= END Shop ================================================= //

// ================================================= Tickets ================================================= //


const get_ticketsPage = (req, res) => {
  res.render('business/tickets' , {
    title: "Tickets",
    page_title: 'Tickets',
    folder: 'Pages'
   
  });
  
}

const logOut = (req, res) => {
  res.clearCookie('token');
  res.redirect('/login');
}

const calculateFees = (government, orderType, isExpressShipping) => {
  // Define fee configuration
  const feeConfig = {
    governments: {
      'Cairo': {
        Deliver: 80,
        Return: 70,
        CashCollection: 70,
        Exchange: 95,
      },
      'Alexandria': {
        Deliver: 85,
        Return: 75,
        CashCollection: 75,
        Exchange: 100,
      },
      'Delta-Canal': {
        Deliver: 91,
        Return: 81,
        CashCollection: 81,
        Exchange: 106,
      },
      'Upper-RedSea': {
        Deliver: 116,
        Return: 106,
        CashCollection: 106,
        Exchange: 131,
      }
    },
    governmentCategories: {
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
    }
  };

  // Find the category for the government
  let category = 'Cairo'; // Default
  for (const [cat, govs] of Object.entries(feeConfig.governmentCategories)) {
    if (govs.includes(government)) {
      category = cat;
      break;
    }
  }

  // Get base fee from config
  let fee = feeConfig.governments[category][orderType] || 0;

  // Apply express shipping multiplier if needed
  if (isExpressShipping) {
    fee *= 2;
  }

  return fee;
};

// Helper function to generate a unique order number
const generateOrderNumber = () => {
  // Generate a 6-digit number
  const randomPart = Math.floor(100000 + Math.random() * 900000);
  // Add a timestamp component for uniqueness (last 4 digits of current timestamp)
  const timestampPart = Date.now().toString().slice(-4);
  return `${randomPart}${timestampPart}`;
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

    // Find the original order
    const originalOrder = await Order.findOne({ 
      orderNumber: orderNumber,
      business: req.userData._id,
      orderStatus: 'completed',
      'orderShipping.orderType': 'Deliver'
    }).select('orderNumber orderCustomer orderShipping orderStatus');

    // Debug: If not found, try to find the order without the orderType restriction
    if (!originalOrder) {
      console.log('Order not found with Deliver type, searching without type restriction...');
      const debugOrder = await Order.findOne({ 
        orderNumber: orderNumber,
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
      'orderShipping.originalOrderNumber': orderNumber,
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

// Calculate pickup fee (server-side) based on user's city and number of orders (<3 => 1.3x)
const calculatePickupFee = async (req, res) => {
  try {
    const { numberOfOrders } = req.body;
    const user = await User.findById(req.userData._id);
    const city = user?.pickUpAdress?.city || '';

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

    let category = 'Cairo';
    for (const [cat, govs] of Object.entries(governmentCategories)) {
      if (govs.includes(city)) { category = cat; break; }
    }
    const baseByCategory = {
      'Cairo': 50,
      'Alexandria': 55,
      'Delta-Canal': 60,
      'Upper-RedSea': 80,
    };
    const base = baseByCategory[category] || 50;
    const count = parseInt(numberOfOrders || '0');
    const fee = (isNaN(count) || count < 3) ? Math.round(base * 1.3) : base;
    return res.json({ fee });
  } catch (error) {
    console.error('Error calculating pickup fee:', error);
    return res.status(500).json({ error: 'Failed to calculate pickup fee' });
  }
}


// ================================================= Edit Profile ================================================= //

const editProfile = async (req, res) => {
  try {
    const { name, phoneNumber, profileImage, brandName, email } = req.body;

    // Create an update object with only the fields that need to be updated
    const updateData = {};
    
    if (name) updateData.name = name;
    if (phoneNumber) updateData.phoneNumber = phoneNumber;
    if (profileImage) updateData.profileImage = profileImage;
    if (email) updateData.email = email;
    if (brandName) updateData['brandInfo.brandName'] = brandName;
    
    const user = await User.findByIdAndUpdate(
      req.userData._id,
      updateData,
      { new: true }
    );

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      user
    }); 

  } catch (error) {
    console.error('Error in editProfile:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
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

    res.render('business/shop', {
      title: 'Shop',
      page_title: 'Shop Products',
      folder: 'Shop',
      products: productsWithVirtuals,
      productsByCategory: productsByCategory,
      allCategories: allCategories,
      user: req.userData,
      userData: req.userData, // Make sure userData is available for the template
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
    const { items, fullName, phoneNumber, address, government, zone, notes } =
      req.body;
    const businessId = req.userData._id;

    // Validate required delivery information
    if (!fullName || !phoneNumber || !address || !government || !zone) {
      return res.status(400).json({
        error: 'All delivery information fields are required',
      });
    }

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

    // Get business info
    const business = await User.findById(businessId);
    if (!business) {
      return res.status(404).json({ error: 'Business not found' });
    }

    // Calculate delivery fee using the same logic as normal orders
    const { calculateOrderFee } = require('../utils/fees');
    const deliveryFee = calculateOrderFee(government, 'Deliver', false);

    // Create shop order
    const shopOrder = new ShopOrder({
      business: businessId,
      businessName: business.brandInfo?.brandName || business.name,
      items: orderItems,
      subtotal,
      tax: totalTax,
      deliveryFee,
      totalAmount: subtotal + totalTax + deliveryFee,
      orderCustomer: {
        fullName,
        phoneNumber,
        address,
        government,
        zone,
      },
      contactInfo: {
        name: fullName,
        phone: phoneNumber,
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
    title: 'Shop Orders',
    page_title: 'My Shop Orders',
    folder: 'Shop',
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
      title: 'Shop Order Details',
      page_title: 'Order Details',
      folder: 'Shop',
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

module.exports = {
  getDashboardPage,
  getDashboardData,
  completionConfirm,
  requestVerification,


  // Orders
  get_ordersPage,
  get_orders,
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
  get_pickupDetailsPage,
  get_pickedupOrders,
  ratePickup,
  createPickup,
  deletePickup,

  get_totalBalancePage,
  get_allTransactionsByDate,
  getTransactionDetails,
  recalculateBalanceAPI,
  exportTransactionsToExcel,
  exportCashCyclesToExcel,

  // Cash Cycles
  get_cashCyclesPage,
  get_totalCashCycleByDate,

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
  
};

