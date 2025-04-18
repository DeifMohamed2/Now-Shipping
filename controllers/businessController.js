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
const getDashboardPage = (req, res) => {
  
  res.render('business/dashboard' , {
    title: "Dashboard",
    page_title: 'Overview',
    folder: 'Pages',
    user: req.userData
  });
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
    } = req.body;

    // ✅ 1. Validate required fields
    if (!brandName || !brandType || !industry || !monthlyOrders || !sellingPoints.length) {
      return res.status(400).json({ error: "All brand info fields are required." });
    }
    if (!country || !city || !adressDetails) {
      return res.status(400).json({ error: "All address fields are required." });
    }
    if (!paymentMethod) {
      return res.status(400).json({ error: "Payment method is required." });
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

If you didn’t create this account, you can safely ignore this email.

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
  <p style="font-size: 14px; color: #888;">If the button above doesn’t work, copy and paste this link into your browser:</p>
  <p style="font-size: 14px; color: #888;">${verificationLink}</p>
  <hr style="margin: 20px 0;">
  <p style="font-size: 12px; color: #999;">If you didn’t create an account, you can ignore this email.</p>
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

  const user = req.userData;


  const verificationToken = user.generateVerificationToken();
  sendVerificationEmail(user, verificationToken);
  user.save();
  res.status(200).json({
    status: 'success',
    message: 'Verification email sent successfully',
  });
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
      });
  }else if(orderType=='All'){
       orders = await Order.find({ business: req.userData._id });
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
    government ,
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
    Notes
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

  // ✅ 2. Validate Shipping Info tab based on order type
  console.log(orderType);
  if (orderType === "Deliver" || orderType === "Return") {
    if (!productDescription || !numberOfItems) {
      return res.status(400).json({ error: "All fields in the Deliver section are required." });
    }
  }
  if (orderType === "Exchange") {
    if (!currentPD || !numberOfItemsCurrentPD || !newPD || !numberOfItemsNewPD) {
      return res.status(400).json({ error: "All fields in the Exchange section are required." });
    }
  }

  if (orderType === "Cash Collection") {
    if (!amountCashCollection) {
      return res.status(400).json({ error: "All fields in the Cash Collection section are required." });
    }
  }

  // ✅ 3. Create Order
  const newOrder = new Order({
    orderNumber: `${
      Math.floor(Math.random() * (900000 - 100000 + 1)) + 100000
    }`,
    orderDate: new Date(),
    orderStatus: 'new',
    orderFees: 120,
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
  } = req.body;

  try {

    console.log(amountCOD, amountCashCollection);

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


    // ✅ 2. Validate Shipping Info tab based on order type
    if (orderType === "Deliver") {
 
      if (!productDescription || !numberOfItems) {
        return res.status(400).json({ error: "All fields in the Deliver section are required." });
      }
    }
    if (orderType === "Exchange") {
      if (!currentPD || !numberOfItemsCurrentPD || !newPD || !numberOfItemsNewPD) {
        return res.status(400).json({ error: "All fields in the Exchange section are required." });
      }
    }

    if (orderType === "Return") {
      if (!CashDifference || !amountCashDifference) {
        return res.status(400).json({ error: "All fields in the Cash Difference section are required." });
      }

    }

    if (orderType === "Cash Collection") {
     
      if (!amountCashCollection) {
        return res.status(400).json({ error: "All fields in the Cash Collection section are required." });
      }
    }
      console.log(amountCOD, amountCashDifference, amountCashCollection);

    let amountFromConditons = 0 

    if(!COD||!CashDifference||!amountCashCollection){
      amountFromConditons = amountCOD || amountCashDifference || amountCashCollection ;
    }

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
      orderShipping: {
        productDescription: productDescription || currentPD || '',
        numberOfItems: numberOfItems || numberOfItemsCurrentPD || 0,
        productDescriptionReplacement: newPD || '',
        numberOfItemsReplacement: numberOfItemsNewPD || 0,
        orderType: orderType,
        amountType: COD ? 'COD' : CashDifference ? 'CD' : amountCashCollection ? 'CC' : 'NA',
        amount: amountFromConditons,
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
  res.render('business/order-details', {
    title: 'Order Details',
    page_title: 'Order Details',
    folder: 'Pages',
    order,
  });
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

const get_pickupDetailsPage = async(req, res) => {
  const { pickupNumber } = req.params;  

  const pickup = await Pickup.findOne({ pickupNumber }).populate('business');

  if (!pickup) {
    res.render('business/pickup-details', {
      title: 'Pickup Details',
      page_title: 'Pickup Details',
      folder: 'Pages',
      pickup: null,
    });
    return;
  }

  res.render('business/pickup-details', {
    title: 'Pickup Details',
    page_title: 'Pickup Details',
    folder: 'Pages',
    pickup,
  });
};


const get_pickedupOrders = async (req, res) => {
  const { pickupNumber } = req.params;
  const {search} = req.query;
  try {
    const pickedUpOrders = await Pickup.findOne(
      { pickupNumber },
      { 'ordersPickedUp': 1 }
    )
      .populate({
      path: 'ordersPickedUp',
      match: search ? { orderNumber: search } : {}
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

const createPickup = async (req, res) => {
  const {
    numberOfOrders,
    pickupDate,
    phoneNumber,
    isFragileItems,
    isLargeItems,
    pickupNotes,
  } = req.body;

  try {

    // ✅ 1. Validate required fields
    if (!numberOfOrders || !pickupDate || !phoneNumber) {
      return res.status(400).json({ error: 'All pickup info fields are required.' });
    }
    console.log(req.body);
    // ✅ 2. Create Pickup
    const newPickup = new Pickup({
      business: req.userData._id,
      pickupNumber: `${
        Math.floor(Math.random() * (900000 - 100000 + 1)) + 100000
      }`,
      business: req.userData._id,
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
    res.status(201).json({ message: 'Pickup created successfully.', pickup: savedPickup });
  } catch (error) {
    console.error('Error in createPickup:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
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
        .populate('business')
        .populate('assignedDriver');
      
    } else if (pickupType === 'Completed') {
      pickups = await Pickup.find({
        business: req.userData._id,
        picikupStatus: 'Completed',
      }).populate('business')
       .populate('assignedDriver');
    }
 
    res.status(200).json(pickups || []);
  } catch (error) {
    console.error('Error in pickups:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}

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
        console.log(`Week from ${weekStart.toLocaleDateString()} to ${weekEnd.toLocaleDateString()}`);
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


module.exports = {
  getDashboardPage,
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
};
