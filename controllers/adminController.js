const Order = require('../models/order');
const Courier = require('../models/courier');
const Pickup = require('../models/pickup');
const Release = require('../models/releases');
const User = require('../models/user');
const Transaction = require('../models/transactions');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET
const getDashboardPage = (req, res) => {
  res.render('admin/dashboard', {
    title: 'Dashboard',
    page_title: 'Dashboard',
    folder: 'Pages',
  });
};


// ======================================== Orders Page ======================================== //

const get_ordersPage = (req, res) => {
  res.render('admin/orders', {
    title: 'Orders',
    page_title: 'Orders',
    folder: 'Pages',
  });
};

const get_orders = async (req, res) => {
  const { orderType, status } = req.query;
  try {
    console.log(orderType, status);
    let orders = [];
    const query = {};

    if (orderType && (orderType === 'Deliver' || orderType === 'Return' || orderType === 'Exchange' || orderType === 'CashCollection')) {
      query['orderShipping.orderType'] = orderType;
    }

    if (status) {
      query.orderStatus = status;
    }

    console.log(query);
    orders = await Order.find(query).populate('business', 'brandInfo').populate('deliveryMan');
    res.status(200).json(orders || []);
  } catch (error) {
    console.error('Error in orders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}; 


const get_orderDetailsPage = async (req, res) => {
  const { orderNumber } = req.params;

  const order = await Order.findOne({ orderNumber }).populate('business').populate('deliveryMan');

  if (!order) {
    res.render('admin/order-details', {
      title: 'Order Details',
      page_title: 'Order Details',
      folder: 'Pages',
      order: null,
    });
    return;
  }

  console.log(order);
  res.render('admin/order-details', {
    title: 'Order Details',
    page_title: 'Order Details',
    folder: 'Pages',
    order,
  });
};


const get_deliveryMenByZone = async (req, res) => {
  const { zone } = req.query;
  try {
    const deliveryMen = await Courier.find({
      assignedZones: zone,
      isAvailable: true,
    });
    res.status(200).json(deliveryMen);
  } catch (error) {
    console.error('Error fetching delivery men:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};


// ========================================End Orders ======================================== //


const get_couriersPage = (req, res) => {
  res.render('admin/couriers', {
    title: 'Couriers',
    page_title: 'Couriers',
    folder: 'Pages',
  });
};

const get_couriers = async (req, res) => {
    const {status} = req.query;
    let couriers = [];
   
    try {
        // Get base courier query based on status
        let courierQuery;
        if (status === 'active') {
            courierQuery = Courier.find({ isAvailable: true });
        } else if (status === 'inactive') {
            courierQuery = Courier.find({ isAvailable: false }); 
        } else {
            courierQuery = Courier.find({});
        }

        // Get couriers
        couriers = await courierQuery;

        // Get additional stats for each courier
        let courierStats = await Promise.all(couriers.map(async courier => {
            // Get completed and cancelled/rejected orders
            const completedOrders = await Order.countDocuments({
                deliveryMan: courier._id,
                orderStatus: 'completed'
            });

            const cancelledOrders = await Order.countDocuments({
                deliveryMan: courier._id,
                orderStatus: {$in: ['canceled', 'rejected']}
            });

            // Calculate success percentage
            const totalOrders = completedOrders + cancelledOrders;
            const successPercentage = totalOrders > 0 ? 
                Math.round((completedOrders / totalOrders) * 100) : 0;

            // Get active orders
            const activeOrders = await Order.countDocuments({
                deliveryMan: courier._id,
                orderStatus: {$in: ['headingToCustomer', 'headingToYou']}
            });

            // Get active pickups
            const activePickups = await Pickup.countDocuments({
                assignedDriver: courier._id,
                picikupStatus: 'pickedUp'
            });

            // Get total assigned orders
            const totalAssignedOrders = await Order.countDocuments({
                deliveryMan: courier._id
            });

            // Get total assigned pickups 
            const totalAssignedPickups = await Pickup.countDocuments({
                assignedDriver: courier._id
            });

            return {
                ...courier.toObject(),
                successPercentage,
                activeOrders,
                activePickups,
                totalAssignedOrders,
                totalAssignedPickups
            };
        }));

        // Sort couriers by success percentage in descending order
        courierStats.sort((a, b) => b.successPercentage - a.successPercentage);

        res.status(200).json(courierStats || []);

    } catch (error) {
        console.error('Error in couriers:', error);
        res.status(500).json({ error: 'Internal server error. Please try again.' });
    }
}


const createCourier = async (req, res) => {
  const {
    fullName,
    personalEmail,
    phoneNumber,
    nationalId,
    dateOfBirth,
    vehicleType,
    vehiclePlateNumber,
    email,
    password,
    address,
    photo,
    zones,
  } = req.body;
try {
  console.log(req.body);
    if (!fullName || !phoneNumber || !nationalId || !dateOfBirth || !vehicleType || !vehiclePlateNumber || !email || !password || !address|| !photo) {
        return res.status(400).json({
        status: 'error',
        error: 'Please fill all the fields',
        });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const courier = new Courier({
      courierID:Math.floor(10000 + Math.random() * 90000),
      name: fullName,
      personalPhoto: photo,
      personalEmail,
      phoneNumber,
      nationalId,
      dateOfBirth,
      vehicleType,
      vehiclePlateNumber,
      email,
      password: hashedPassword,
      address,
      assignedZones : zones,
    });

    courier.save().then((courier) => {
        res.status(201).json({
            status: 'success',
            courier: {
            id: courier._id,
            name: courier.name,
            email: courier.email,
            role: courier.role,
            },
        });
    }).catch((err) => {
        console.log(err);
        if (err.code === 11000) {
            res.status(400).json({
                status: 'error',
                error: 'It looks like a courier with this email or national ID already exists. Please use a different email or national ID.',
            });
        } else if (err.name === 'ValidationError') {
            res.status(400).json({
                status: 'error',
                error: 'Validation error: ' + err.message,
            });
        } else {
            res.status(500).json({
                status: 'error',
                error: 'An internal server error occurred. Please try again.',
            });
        }
    });


}catch(err){
  console.log(err);
    res.status(500).json({
        status: 'error',
        error: 'An error occurred'
    });
}


}



// ======================================== Pickups Page ======================================== //



const get_pickupsPage = (req, res) => {
  res.render('admin/pickups', {
    title: 'Pickups',
    page_title: 'Pickups',
    folder: 'Pages',
  });
};

const get_pickups = async (req, res) => {
  try {
    const { pickupType } = req.query;
    let match = {};

    if (pickupType === 'Upcoming') {
      match = {
        picikupStatus: { $ne: 'Completed' },
      };
    } else if (pickupType === 'Completed' || pickupType === 'Cancelled' || pickupType === 'inStock') {
      match = {
        picikupStatus: pickupType,
      };
    }

    const pickups = await Pickup.aggregate([
      { $match: match },
      {
      $lookup: {
        from: 'users',
        localField: 'business',
        foreignField: '_id',
        as: 'business',
      },
      },
      { $unwind: '$business' },
      {
      $lookup: {
        from: 'couriers',
        localField: 'assignedDriver',
        foreignField: '_id',
        as: 'assignedDriver',
      },
      },
      { $unwind: { path: '$assignedDriver', preserveNullAndEmptyArrays: true } },
      {
      $group: {
        _id: '$business.pickUpAdress.city',
        pickups: { $push: '$$ROOT' },
      },
      },
      { $sort: { 'pickups.pickupDate': 1 } },
    ]);
    res.status(200).json(pickups || []);
  } catch (error) {
    console.error('Error in pickups:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};


const get_pickupMenByZone = async (req, res) => {
  const { city } = req.query;
  try {
    const deliveryMen = await Courier.find({
      assignedZones: city,
      isAvailable: true,
    });
    res.status(200).json(deliveryMen);
  } catch (error) {
    console.error('Error fetching delivery ', error);

    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

const assignPickupMan = async (req, res) => {
  const { pickupId, courierId } = req.body;
  try {
    const pickup = await Pickup.findOne({ _id: pickupId });
    if (!pickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    const courier = await Courier.findOne({ _id: courierId });

    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }
console.log('courier assig');
    pickup.assignedDriver = courierId;
    pickup.picikupStatus = 'driverAssigned';
    pickup.pickupStages.push({
      stageName: 'driverAssigned',
      stageDate: new Date(),
      stageNotes: [
        {
          text: `Pickup assigned to ${courier.name}`,
          date: new Date(),
        },
      ],
    });

    // courier.isAvailable = false;

    await pickup.save();
    res.status(200).json({ message: 'Pickup man assigned successfully' });
  } catch (error) {
    console.error('Error assigning pickup Man:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};



const get_pickupDetailsPage = async (req, res) => {
  const { pickupNumber } = req.params;

  const pickup = await Pickup.findOne({ pickupNumber }).populate('business').populate('assignedDriver');

  if (!pickup) {
    res.render('admin/pickup-details', {
      title: 'Pickup Details',
      page_title: 'Pickup Details',
      folder: 'Pages',
      pickup: null,
    });
    return;
  }

  res.render('admin/pickup-details', {
    title: 'Pickup Details',
    page_title: 'Pickup Details',
    folder: 'Pages',
    pickup,
  });
};

const get_pickedupOrders = async (req, res) => {
  const { pickupNumber } = req.params;
  const { search } = req.query;
  try {
    const pickedUpOrders = await Pickup.findOne(
      { pickupNumber },
      { ordersPickedUp: 1 }
    ).populate({
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


const cancelPickup = async (req, res) => {
  const { pickupId } = req.params;

  try {
    const pickup = await Pickup.findById(pickupId).populate(
      'assignedDriver'
    );

    if (!pickup) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    pickup.picikupStatus = 'canceled';
    // pickup.pickupStages.push({
    //   stageName: 'Cancelled',
    //   stageDate: new Date(),
    //   stageNotes: [
    //     {
    //       text: 'Pickup cancelled',
    //       date: new Date(),
    //     },
    //   ],
    // });

    // pickup.assignedDriver.isAvailable = true;

    await pickup.save();
    res.status(200).json({ message: 'Pickup cancelled successfully' });
  } catch (error) {
    console.error('Error in cancelPickup:', error);
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


// ========================================End Pickups ======================================== //


// ======================================== Stock Managment ======================================== //

const get_stockManagmentPage = (req, res) => {
  res.render('admin/stock-managment', {
    title: 'Stock Managment',
    page_title: 'Stock Managment',
    folder: 'Pages',
  });
}


const get_stock_orders = async (req, res) => {
    try {
        const orders = await Order.find({ orderStatus: { $in: ['inStock', 'inProgress'] } })
            .populate('business')
            .populate('deliveryMan')
        res.status(200).json(orders || []);
    } catch (error) {
        console.error('Error in get_stock_orders:', error);
        res.status(500).json({ error: 'Internal server error. Please try again.' });
    }
}



const add_to_stock = async (req, res) => {
  const { orderNumber } = req.body;
  try {
    const order = await Order.findOne({ orderNumber });
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }


    if(order.orderStatus==='inStock'){
        return res.status(400).json({ error: 'Order is already in stock' });
    }


    if(order.orderStatus !== 'pickedUp'){
        return res.status(400).json({ error: 'Order is not picked up' });
    }

    if(order.orderStatus === 'inProgress'){
      return res.status(400).json({ error: 'Order is already in progress' });
    }


    if(order.orderStatus === 'pickedUp'){
      order.orderStatus = 'inStock';
      if(order.orderStages.length === 2){
      order.orderStages.push({
        stageName: 'inStock',
        stageDate: new Date(),
        stageNotes: [
          { text: `Order added to stock`, date: new Date() },
        ],
      });
      }
      await order.save();
    }
    
    res.status(200).json({ message: 'Order added to stock successfully' });
  } catch (error) {
    console.error('Error in add_to_stock:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}


const get_couriers_by_zone = async (req, res) => {
  const { zone } = req.query;
  try {
    const couriers = await Courier.find({ assignedZones: zone });
    res.status(200).json(couriers || []);
  } catch (error) {
    console.error('Error in get_couriers_by_zone:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}

const assignCourierToStock = async (req, res) => {
  const { orderNumbers, courierId } = req.body;
  try {
    console.log(orderNumbers, courierId);
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orders = await Order.find({ orderNumber: { $in: orderNumbers } });
    if (orders.length !== orderNumbers.length) {
      return res.status(404).json({ error: 'Some orders not found' });
    }

    // Validate all orders before making any changes
    for (const order of orders) {
      if(order.orderStatus !== 'inProgress'){
          
        if (order.orderStatus !== 'inStock' && order.orderStatus !== 'pickedUp') {
          return res.status(400).json({ error: `Order ${order.orderNumber} is not in stock` });
        }
        if (order.orderStatus === 'headingToCustomer' || order.orderStatus === 'headingToYou') {
          return res.status(400).json({ error: `Order ${order.orderNumber} Can\'t be assigned to courier because it is on the way to customer` });
        }
      }
    }

    // Update all orders after validation passes
    const updatePromises = orders.map(order => {
      order.deliveryMan = courierId;
      order.orderStatus = 'inProgress';
      return order.save();
    });

    await Promise.all(updatePromises);

    res.status(200).json({ message: 'Orders assigned to courier successfully' });
  } catch (error) {
    console.error('Error in assignCourierToStock:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}

const courier_received = async (req, res) => {
  const { courierId } = req.body;
  try {
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orders = await Order.find({ deliveryMan: courierId, orderStatus: 'inProgress' });
    if (!orders.length) {
      return res.status(404).json({ error: 'No orders found for this courier' });
    }

    const updatePromises = orders.map(order => {
      order.orderStatus = 'headingToCustomer';
      if(order.orderStages.length === 3) {
        order.orderStages.push({
          stageName: 'headingToCustomer', 
          stageDate: new Date(),
          stageNotes: [
            { text: `Order assigned to courier ${courier.name}`, date: new Date() },
          ],
        });
      }
      return order.save();
    });

    await Promise.all(updatePromises);

    res.status(200).json({ message: 'Orders marked as received by courier successfully' });
  } catch (error) {
    console.error('Error in courier_received:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}





// ======================================== Wallet Overview ======================================== //

const get_releaseAmountsPage = (req, res) => {
  res.render('admin/release-amounts', {
    title: 'Release Amounts',
    page_title: 'Release Amounts',
    folder: 'Pages',
  });
} 


const get_releasesAllData = async (req, res) => {
  const { filter } = req.query;
  try {
    // Fetch all releases
    let query = {};

    if (filter === 'pending') {
      query.releaseStatus = 'pending';
    } else if (filter === 'scheduled') {
      query.releaseStatus = 'scheduled';
    }else if (filter === 'released') {
      query.releaseStatus = 'released';
    } else if (filter === 'all') {
      query = {};
    }
    // Fetch all releases with the specified status
    const releases = await Release.find(query).populate('business', 'brandInfo')
    console.log(releases);
    // Calculate Total Funds Available
    const totalFundsAvailable = releases.reduce((sum, release) => {
      if (release.releaseStatus === 'pending' || release.releaseStatus === 'scheduled') {
        return sum + release.amount;
      }
      return sum;
    }, 0);

    // Calculate Next Release Date (always the next Wednesday)
    const today = new Date();
    const nextWednesday = new Date(today);
    nextWednesday.setDate(today.getDate() + ((3 - today.getDay() + 7) % 7 || 7));
    // Calculate Total Payments Released
    const totalPaymentsReleased = releases
      .filter(release => release.releaseStatus === 'released')
      .reduce((sum, release) => sum + release.amount, 0);

    // Calculate Payments Pending
    const paymentsPending = releases
      .filter(release => release.releaseStatus === 'pending')
      .reduce((sum, release) => sum + release.amount, 0);

    // Calculate Scheduled Releases
    const scheduledReleases = releases
      .filter(release => release.releaseStatus === 'scheduled')
      .reduce((sum, release) => sum + release.amount, 0);

    // Calculate the number of releases for each category
    const totalPaymentsReleasedCount = releases.filter(release => release.releaseStatus === 'released').length;
    const paymentsPendingCount = releases.filter(release => release.releaseStatus === 'pending').length;
    const scheduledReleasesCount = releases.filter(release => release.releaseStatus === 'scheduled').length;

    // Send response
    res.status(200).json({
      totalFundsAvailable,
      nextReleaseDate: nextWednesday.toDateString(),
      totalPaymentsReleased,
      paymentsPending,
      scheduledReleases,
      totalPaymentsReleasedCount,
      paymentsPendingCount,
      scheduledReleasesCount,
      releases,
    });
  } catch (error) {
    console.error('Error in get_releasesAllData:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};


const rescheduleRelease = async (req, res) => {
  const { releaseId , newDate, reason, notes} = req.body;
  try {
    const release = await Release.findById(releaseId);
    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }
    release.scheduledReleaseDate = newDate;
    release.reason = reason||'';
    release.releaseNotes = notes||'';
    release.releaseStatus = 'scheduled';
    await release.save();
    res.status(200).json({ message: 'Release rescheduled successfully' });
  } catch (error) {
    console.error('Error in rescheduleRelease:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}

const releaseFunds = async (req, res) => {
  const {releaseId,notes} = req.body;
  try {
    const release = await Release.findById(releaseId).populate('business');
    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }

    if (release.releaseStatus === 'released') {
      return res.status(400).json({ error: 'Release already released' });
    }

    release.releaseStatus = 'released';
    release.scheduledReleaseDate = null;
    release.reason = null;
    release.releaseNotes = notes||'';
    await release.save();

    // Create a transaction record
    const transaction = new Transaction({
      transactionId: Math.floor(100000 + Math.random() * 900000).toString(),
      transactionType: 'withdrawal',
      transactionAmount: -release.amount,
      transactionNotes: `Funds released` ,
      business: release.business._id,
    });

    await transaction.save();

    res.status(200).json({ message: 'Funds released successfully' });

  } catch (error) {
    console.error('Error in releaseFunds:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}
    




// ======================================== End Wallet Overview ======================================== //



// ======================================== Businesses ======================================== //

const get_businessesPage = (req, res) => {
  res.render('admin/businesses', {
    title: 'Businesses',
    page_title: 'Businesses',
    folder: 'Pages',
  });
}



// ======================================== Logout ======================================== //


// ======================================== Tickets ======================================== //
const get_ticketsPage = (req, res) => {
  res.render('admin/tickets', {
    title: 'Tickets',
    page_title: 'Tickets',
    folder: 'Pages',
  });
}


const logOut = (req, res) => {
  req.session.destroy();
  res.clearCookie('token');
  res.redirect('/admin-login');
}


module.exports = {
  getDashboardPage,
  get_deliveryMenByZone,

  // Orders
  get_ordersPage,
  get_orders,
  get_orderDetailsPage,

  get_couriersPage,
  get_couriers,
  createCourier,

  get_pickupsPage,
  get_pickups,
  get_pickupMenByZone,
  assignPickupMan,
  get_pickupDetailsPage,
  cancelPickup,
  deletePickup,
  get_pickedupOrders,


  // Stock Managment
  get_stockManagmentPage,
  add_to_stock, 
  get_stock_orders,
  get_couriers_by_zone,
  assignCourierToStock,
  courier_received,

  // Wallet Overview
  get_releaseAmountsPage,
  get_releasesAllData,
  rescheduleRelease,
  releaseFunds,

  get_businessesPage,


  // Tickets
  get_ticketsPage,
  // Logout
  logOut,
};
