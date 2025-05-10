const PDFDocument = require('pdfkit');
const Transaction = require('../models/transactions');
const User = require('../models/user');
const Order = require('../models/order');
const Pickup = require('../models/pickup');
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'deifm81@gmail.com',
    pass: 'yduu pmtg shyb kapc',
  },
});

//================================================ Dashboard  ================================================= //
const getDashboardPage = async (req, res) => {
  try {
    // Only load data if user has completed account setup
    let dashboardData = {};

    if (req.userData.isCompleted) {
      // Get today's date range
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0));
      const endOfDay = new Date(today.setHours(23, 59, 59, 999));

      // Get order statistics
      const inProgressCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'processing',
      });

      const headingToCustomerCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'headingToCustomer',
      });

      const completedCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'completed',
      });

      const totalOrders = await Order.countDocuments({
        business: req.userData._id,
      });

      const awaitingActionCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'awaitingAction',
      });

      const headingToYouCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'headingToYou',
      });

      const newOrdersCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'new',
      });

      // Financial statistics
      const ordersWithCOD = await Order.find({
        business: req.userData._id,
        'orderShipping.amountType': { $in: ['COD', 'CD', 'CC'] },
        orderStatus: { $in: ['headingToCustomer', 'processing'] },
      });

      const expectedCash = ordersWithCOD.reduce((total, order) => {
        return total + (order.orderShipping.amount || 0);
      }, 0);

      const collectedOrders = await Order.find({
        business: req.userData._id,
        'orderShipping.amountType': 'COD',
        orderStatus: 'completed',
        completedDate: { $gte: startOfDay, $lte: endOfDay },
      });

      const collectedCash = collectedOrders.reduce((total, order) => {
        return total + (order.orderShipping.amount || 0);
      }, 0);

      // Get recent orders and pickups
      const recentOrders = await Order.find({
        business: req.userData._id,
      })
        .sort({ orderDate: -1 })
        .limit(5);

      const recentPickups = await Pickup.find({
        business: req.userData._id,
      })
        .sort({ pickupDate: -1 })
        .limit(4);

      // Calculate completion rate
      const completionRate =
        totalOrders > 0 ? Math.round((completedCount / totalOrders) * 100) : 0;

      const collectionRate =
        expectedCash > 0 ? Math.round((collectedCash / expectedCash) * 100) : 0;

      // Monthly data for charts (last 9 months)
      const monthlyData = [];
      const monthlyLabels = [];
      const monthlyOrderCounts = [];

      for (let i = 8; i >= 0; i--) {
        const monthDate = new Date();
        monthDate.setMonth(monthDate.getMonth() - i);
        const monthName = monthDate.toLocaleString('default', {
          month: 'short',
        });

        const firstDay = new Date(
          monthDate.getFullYear(),
          monthDate.getMonth(),
          1
        );
        const lastDay = new Date(
          monthDate.getFullYear(),
          monthDate.getMonth() + 1,
          0
        );

        const monthlyCompleted = await Order.find({
          business: req.userData._id,
          orderStatus: 'completed',
          completedDate: { $gte: firstDay, $lte: lastDay },
        });

        const monthlyRevenue = monthlyCompleted.reduce((total, order) => {
          return total + (order.orderShipping.amount || 0);
        }, 0);

        const monthlyOrderCount = await Order.countDocuments({
          business: req.userData._id,
          orderDate: { $gte: firstDay, $lte: lastDay },
        });

        monthlyData.push(monthlyRevenue);
        monthlyOrderCounts.push(monthlyOrderCount);
        monthlyLabels.push(monthName);
      }

      // Compile all dashboard data
      dashboardData = {
        orderStats: {
          inProgressCount,
          headingToCustomerCount,
          completedCount,
          awaitingActionCount,
          headingToYouCount,
          newOrdersCount,
          totalOrders,
          completionRate,
        },
        financialStats: {
          expectedCash,
          collectedCash,
          collectionRate,
        },
        recentData: {
          recentOrders,
          recentPickups,
        },
        chartData: {
          monthlyLabels,
          monthlyRevenue: monthlyData,
          monthlyOrderCounts,
        },
      };
    }


    console.log(dashboardData);
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
      // Get today's date range
      const today = new Date();
      const startOfDay = new Date(today.setHours(0, 0, 0, 0));
      const endOfDay = new Date(today.setHours(23, 59, 59, 999));

      // Get order statistics
      const inProgressCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'processing',
      });

      const headingToCustomerCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'headingToCustomer',
      });

      const inStockCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'inStock',
      });

      const completedCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'completed',
      });

      const unsuccessfulCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: { $in: ['cancelled', 'rejected', 'returned', 'terminated', 'failed'] },
      });

      const totalOrders = await Order.countDocuments({
        business: req.userData._id,
      });

      const awaitingActionCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'awaitingAction',
      });

      const headingToYouCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'headingToYou',
      });

      const newOrdersCount = await Order.countDocuments({
        business: req.userData._id,
        orderStatus: 'new',
      });

      // Financial statistics
      const ordersWithCOD = await Order.find({
        business: req.userData._id,
        'orderShipping.amountType': { $in: ['COD', 'CD', 'CC'] },
        orderStatus: { $in: ['headingToCustomer', 'processing'] },
      });

      const expectedCash = ordersWithCOD.reduce((total, order) => {
        return total + (order.orderShipping.amount || 0);
      }, 0);

      const collectedOrders = await Order.find({
        business: req.userData._id,
        'orderShipping.amountType': 'COD',
        orderStatus: 'completed',
        completedDate: { $gte: startOfDay, $lte: endOfDay },
      });

      const collectedCash = collectedOrders.reduce((total, order) => {
        return total + (order.orderShipping.amount || 0);
      }, 0);

      // Calculate completion rate
      const completionRate =
        totalOrders > 0 ? Math.round((completedCount / totalOrders) * 100) : 0;

      // Calculate unsuccessful rate
      const unsuccessfulRate =
        unsuccessfulCount > 0
          ? Math.round((unsuccessfulCount / totalOrders) * 100)
          : 0;

      const collectionRate =
        expectedCash > 0 ? Math.round((collectedCash / expectedCash) * 100) : 0;

      // Compile all dashboard data
      dashboardData = {
        orderStats: {
          inProgressCount,
          headingToCustomerCount,
          completedCount,
          awaitingActionCount,
          headingToYouCount,
          newOrdersCount,
          inStockCount,
          totalOrders,
          completionRate,
          unsuccessfulCount,
          unsuccessfulRate,
        },
        financialStats: {
          expectedCash,
          collectedCash,
          collectionRate,
        },
      };
    }

    console.log(dashboardData);

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


function sendVerificationEmail(user, token) {
  console.log('Sending verification email to:', user.email);

  const verificationLink = `http://localhost:6098/verify-email?token=${token}`;

  const mailOptions = {
    from: '"NowShipping" <no-reply@nowshipping.com>', // Use a real domain if possible
    to: user.email,
    subject: 'Verify your NowShipping email address',
    text: `
Hello ${user.name},

Thank you for registering with NowShipping!

Please verify your email by clicking the link below:

${verificationLink}

If you didn't create this account, you can safely ignore this email.

Regards,  
The NowShipping Team
    `,
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
  <h2 style="color: #333;">Welcome to NowShipping, ${user.name}!</h2>
  <p style="font-size: 16px; color: #555;">
    Thanks for signing up. To get started, please verify your email address by clicking the button below:
  </p>
  <div style="text-align: center; margin: 30px 0;">
    <a href="${verificationLink}" style="background-color: #4CAF50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-size: 16px;">Verify Email</a>
  </div>
  <p style="font-size: 14px; color: #888;">If the button above doesn't work, copy and paste this link into your browser:</p>
  <p style="font-size: 14px; color: #888;">${verificationLink}</p>
  <hr style="margin: 20px 0;">
  <p style="font-size: 12px; color: #999;">If you didn't create an account, you can ignore this email.</p>
</div>
    `,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Email send failed:', error);
    } else {
      console.log('Verification email sent:', info.response || info);
    }
  });
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
  const { orderType } = req.query;
  try {
  let orders = [];
    if (orderType=='Deliver' || orderType=='Return' || orderType=='Exchange' || orderType=='Cash Collection') {
       orders = await Order.find({
        business: req.userData._id,
        'orderShipping.orderType': orderType,
        
      }).sort({ orderDate: -1 ,createdAt: -1});
  }else{
       orders = await Order.find({ business: req.userData._id }).sort({ orderDate: -1 ,createdAt: -1});
    }
    res.status(200).json(orders || []);
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


const submitOrder = async (req, res) => {
  const {
    fullName,
    phoneNumber,
    address,
    government,
    zone,
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
  if (orderType === 'Deliver' || orderType === 'Return') {
    if (!productDescription || !numberOfItems) {
      return res
        .status(400)
        .json({
          error: `${orderType} orders require product description and number of items.`,
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
  } else if (orderType === 'Cash Collection') {
    if (!amountCashCollection) {
      return res
        .status(400)
        .json({ error: 'Cash collection amount is required.' });
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
    orderFees: orderFees,
    orderCustomer: {
      fullName,
      phoneNumber,
      address,
      government,
      zone,
    },
    orderShipping: {
      productDescription: productDescription || currentPD || '',
      numberOfItems: numberOfItems || numberOfItemsCurrentPD || 0,
      productDescriptionReplacement: newPD || '',
      numberOfItemsReplacement: numberOfItemsNewPD || 0,
      orderType: orderType,
      amountType: COD ? 'COD' : CashDifference ? 'CD' : amountCashCollection ? 'CC' : 'NA',
      amount: amountCOD || amountCashDifference || amountCashCollection,
      isExpressShipping: isExpressShipping === 'on' || isExpressShipping === true,
    },
    isOrderAvailableForPreview: previewPermission === 'on',
    orderNotes: Notes || '',
    referralNumber: referralNumber || '',
    orderStages: [
      {
        stageName: 'Order Created',
        stageDate: new Date(),
        stageNotes: [
          {
            text: 'Order has been created.',
            date: new Date()
          }
        ],
      },
    ],
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
    address,
    government,
    zone,
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
        address,
        government,
        zone,
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



const get_orderDetailsPage = async(req, res) => {

  const { orderNumber } = req.params;

  const order = await Order
  .findOne({ orderNumber })
  .populate('business');


  
  if (!order) {
    res.render('business/order-details', {
      title: 'Order Details',
      page_title: 'Order Details',
      folder: 'Pages',
      order: null,
    });
    return;
  }

  if(order.business._id.toString() !== req.userData._id.toString()){
       res.render('business/order-details', {
         title: 'Order Details',
         page_title: 'Order Details',
         folder: 'Pages',
         order: null,
       });
       return;
  }

  console.log(order);
  // Check if the request is from API or web
  if (req.originalUrl.includes('/api/')) {
    // API request - return JSON response
    return res.status(200).json({
      status: 'success',
      order
    });
  } else {
    // Web request - render the page
    res.render('business/order-details', {
      title: 'Order Details',
      page_title: 'Order Details',
      folder: 'Pages',
      order,
    });
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
        ["City:", order.orderCustomer?.governmant || 'N/A'],
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
    const { pickupType } = req.query;
    let pickups = [];
    if (pickupType === 'Upcoming') {
      pickups = await Pickup.find({
        business: req.userData._id,
        picikupStatus: { $ne: 'Completed' },
      })
        .sort({ createdAt: -1 })
        .populate('business')
        .populate('assignedDriver');
    } else if (pickupType === 'Completed') {
      pickups = await Pickup.find({
        business: req.userData._id,
        picikupStatus: 'Completed',
      }).sort({createdAt:-1})
        .populate('business')
        .populate('assignedDriver');
    }

    res.status(200).json(pickups || []);
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
    // ✅ 2. Create Pickup
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
    }else{
    res.render('business/pickup-details', {
      title: 'Pickup Details',
      page_title: 'Pickup Details',
      folder: 'Pages',
      pickup: null,
    });
    return;
    }
  }

    if (req.originalUrl.includes('/api/')) {
      // API request - return JSON response
      return res.status(404).json({ error: 'Pickup not found' });
    }else{
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


  const get_totalBalancePage  = (req, res) => {
      const now = new Date();
    const daysUntilWednesday = (3 - now.getDay() + 7) % 7; // Calculate days until next Wednesday
    const nextWednesday = new Date(now.setDate(now.getDate() + daysUntilWednesday));
    const weeklyWithdrawDate = nextWednesday.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }); // Format the date to show as Wednesday with full date
  res.render('business/total-balance' , {
    title: "Total Balance",
    page_title: 'Total Balance',
    folder: 'Pages',
    userData :req.userData,
    weeklyWithdrawDate,
  });
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
        dateFilter = {
          createdAt: {
            $gte: new Date(now.setHours(0, 0, 0, 0)),
            $lt: new Date(now.setHours(23, 59, 59, 999))
          }
        };
        break;
      case 'week':
        const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
        const weekEnd = new Date(now);
        weekEnd.setDate(weekStart.getDate() + 6);
        dateFilter = {
          createdAt: {
            $gte: new Date(weekStart.setHours(0, 0, 0, 0)),
            $lt: new Date(weekEnd.setHours(23, 59, 59, 999))
          }
        };
        // console.log(`Week from ${weekStart.toLocaleDateString()} to ${weekEnd.toLocaleDateString()}`);
        break;
      case 'month':
        dateFilter = {
          createdAt: {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lt: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
          }
        };
        break;
      case 'year':
        dateFilter = {
          createdAt: {
            $gte: new Date(now.getFullYear(), 0, 1),
            $lt: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
          }
        };
        break;
      case 'all':
        dateFilter = {
          createdAt: {
            $gte: new Date(0), // Start of time
            $lt: new Date() // Current date
          }
        };
        break;
      default:
        dateFilter = {};
    }

    const transactions = await Transaction.find({
      ...dateFilter,
      business: req.userData._id,
    })
    console.log(transactions);
    res.status(200).json(transactions || []);
  } catch (error) {
    console.error('Error in get_allTransactionsByDate:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
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
    const { timePeriod } = req.query;
    let dateFilter = {};
    const now = new Date();
    console.log(now,timePeriod);
    // Set date filter based on time period
    switch(timePeriod) {
      case 'today':
        dateFilter = {
          completedDate: {
            $gte: new Date(now.setHours(0,0,0,0)),
            $lt: new Date(now.setHours(23,59,59,999))
          }
        };
        break;
      case 'week':
        const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));
        const weekEnd = new Date(now);
        weekEnd.setDate(weekStart.getDate() + 6);
        dateFilter = {
          completedDate: {
            $gte: new Date(weekStart.setHours(0,0,0,0)),
            $lt: new Date(weekEnd.setHours(23,59,59,999))
          }
        };
        console.log(`Week from ${weekStart.toLocaleDateString()} to ${weekEnd.toLocaleDateString()}`);
        break;
      case 'month':
        dateFilter = {
          completedDate: {
            $gte: new Date(now.getFullYear(), now.getMonth(), 1),
            $lt: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
          }
        };
        break;
      case 'year':
        dateFilter = {
          completedDate: {
            $gte: new Date(now.getFullYear(), 0, 1),
            $lt: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
          }
        };
        break;
      case 'all':
        dateFilter = {
          completedDate: {
            $gte: new Date(0), // Start of time
            $lt: new Date() // Current date
          }
        };
        break;
      default:
        dateFilter = {};
    }
    console.log(dateFilter.completedDate);
    const orders = await Order.find({ 
      business: req.userData._id,
      orderStatus: 'completed',
      completedDate: dateFilter.completedDate
    });
    console.log(orders);
    const inProgressCount = await Order.countDocuments({
      business: req.userData._id,
      orderStatus: { $in: ['headingToCustomer', 'headingToYou'] },
      completedDate: dateFilter.completedDate
    });

    const totalIncome = orders.reduce((acc, order) => acc + order.orderShipping.amount, 0);
    const totalFees = orders.reduce((acc, order) => acc + order.orderFees, 0);

    console.log(inProgressCount, totalIncome, totalFees, orders.length);
    res.status(200).json({ 
      totalIncome, 
      totalFees,
      orders,
      inProgressCount, 
      completedCount: orders.length 
    });

  } catch (error) {
    console.error('Error in get_totalBalanceData:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
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
  editOrder,
  deleteOrder,
  printPolicy,

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

  // Cash Cycles
  get_cashCyclesPage,
  get_totalCashCycleByDate,

  get_shopPage,

  // Tickets
  get_ticketsPage,

  logOut,

  calculateOrderFees,
};
