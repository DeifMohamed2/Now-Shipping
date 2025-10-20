const Order = require('../models/order');
const Courier = require('../models/courier');
const Pickup = require('../models/pickup');
const Release = require('../models/releases');
const User = require('../models/user');
const Transaction = require('../models/transactions');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const statusHelper = require('../utils/statusHelper');
const FinancialReconciliation = require('../utils/financialReconciliation');
const { dailyOrderProcessing, recoverFailedProcessing, processSpecificOrders } = require('../jobs/dailyOrderProcessing');
const JWT_SECRET = process.env.JWT_SECRET
const ExcelJS = require('exceljs');
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
  const { orderType, status, statusCategory } = req.query;
  try {
    console.log(orderType, status, statusCategory);
    const query = {};

    // Filter by order type
    if (orderType && statusHelper.ORDER_TYPES[orderType]) {
      query['orderShipping.orderType'] = orderType;
    }

    // Filter by specific status
    if (status) {
      query.orderStatus = status;
    }
    
    // Filter by status category
    if (statusCategory && statusHelper.STATUS_CATEGORIES[statusCategory]) {
      query.statusCategory = statusCategory;
    }

    console.log(query);
    const orders = await Order.find(query)
      .populate('business', 'brandInfo')
      .sort({orderDate:-1, createdAt:-1})
      .populate('deliveryMan');
      
    // Enhance orders with status information
    const enhancedOrders = orders.map(order => {
      const orderObj = order.toObject();
      orderObj.statusLabel = statusHelper.getOrderStatusLabel(order.orderStatus);
      orderObj.statusDescription = statusHelper.getOrderStatusDescription(order.orderStatus);
      orderObj.categoryClass = statusHelper.getCategoryClass(order.statusCategory);
      orderObj.categoryColor = statusHelper.getCategoryColor(order.statusCategory);
      orderObj.nextPossibleStatuses = statusHelper.getNextPossibleStatuses(order.orderStatus);
      
      // Add fast shipping indicator
      orderObj.isFastShipping = order.orderShipping && order.orderShipping.isExpressShipping;
      
      // For fast shipping orders, determine if they're ready for courier assignment
      if (orderObj.isFastShipping) {
        // Fast shipping orders are ready for assignment when they are new (before pickup)
        orderObj.readyForCourierAssignment = order.orderStatus === 'new';
      }
      
      // Add order type specific information
      if (order.orderShipping.orderType === 'Exchange') {
        orderObj.isExchange = true;
        orderObj.exchangeDetails = {
          originalProduct: order.orderShipping.productDescription,
          originalCount: order.orderShipping.numberOfItems,
          replacementProduct: order.orderShipping.productDescriptionReplacement,
          replacementCount: order.orderShipping.numberOfItemsReplacement
        };
      } else if (order.orderShipping.orderType === 'Cash Collection') {
        orderObj.isCashCollection = true;
        orderObj.collectionAmount = order.orderShipping.amount;
      }
      
      return orderObj;
    });
    
    res.status(200).json(enhancedOrders || []);
  } catch (error) {
    console.error('Error in orders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}; 


const get_orderDetailsPage = async (req, res) => {
  try {
    const { orderNumber } = req.params;
    const order = await Order.findOne({ orderNumber: orderNumber })
      .populate('business')
      .populate('deliveryMan')
      .populate({
        path: 'courierHistory.courier',
        model: 'courier',
        select: 'name'
      });

    if (!order) {
      req.flash('error', 'Order not found');
      return res.redirect('/admin/orders');
    }

    res.render('admin/order-details', {
      title: 'Order Details',
      page_title: 'Order Details',
      folder: 'Orders',
      order: order
    });
  } catch (error) {
    console.log(error);
    req.flash('error', 'Internal Server Error');
    res.redirect('/admin/orders');
  }
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
    allPapers
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
      courierID: String(Math.floor(10000 + Math.random() * 90000)),
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
      allPapers: Array.isArray(allPapers) ? allPapers : [],
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



// ========================================= Couriers Follow Up Page ======================================== //


const get_couriersFollowUp = async(req, res) => {
    try {

    // Get all couriers
    const couriers = await Courier.find({});
    
    // Prepare courier statistics
    const courierStats = await Promise.all(couriers.map(async courier => {
      // Get money with courier
      const moneyWithCourier = await Order.aggregate([
        {
          $match: {
            deliveryMan: courier._id,
            isMoneyRecivedFromCourier: false,
            orderStatus: { $in: ['completed', 'headingToCustomer'] },
            'orderShipping.orderType': { $ne: 'Return' },
            'orderShipping.amountType': { $in: ['COD', 'CD', 'CC'] }, // Cash on Delivery, Cash Difference, Cash Collection
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$orderShipping.amount' },
          },
        },
      ]);
      
      // Get orders to return count
      const ordersToReturn = await Order.countDocuments({
        deliveryMan: courier._id,
        orderStatus: { $in: ['returnToWarehouse', 'waitingAction'] }
      });
      
      // Get active orders count
      const activeOrders = await Order.countDocuments({
        deliveryMan: courier._id,
        orderStatus: { $in: ['headingToCustomer', 'headingToYou', 'inProgress'] }
      });
      
      // Calculate performance based on completed orders today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const completedToday = await Order.countDocuments({
        deliveryMan: courier._id,
        orderStatus: 'completed',
        completedDate: { $gte: today }
      });
      
      // Assuming each courier has a daily target of 10 orders
      const dailyTarget = 10;
      const performance = Math.min(100, (completedToday / dailyTarget) * 100);
      
      // Get assigned zones
      const zones = courier.assignedZones || [];
      
      // Determine courier status badge
      let statusBadge = 'bg-success-subtle text-success';
      let statusText = 'Active';
      
      if (!courier.isAvailable) {
        statusBadge = 'bg-danger-subtle text-danger';
        statusText = 'Inactive';
      } else if (courier.onLeave) {
        statusBadge = 'bg-warning-subtle text-warning';
        statusText = 'On Leave';
      }
      
      return {
        id: courier._id,
        courierId: courier.courierID,
        name: courier.name,
        photo: courier.personalPhoto || '/placeholder.svg?height=70&width=70',
        status: statusText,
        statusBadge: statusBadge,
        moneyWithCourier: (moneyWithCourier[0]?.total || 0),
        ordersToReturn: ordersToReturn,
        activeOrders: activeOrders,
        zones: zones,
        performance: performance,
      };
    }));
    
    // Calculate summary statistics
    const activeCouriersCount = couriers.filter(c => c.isAvailable && !c.onLeave).length;
    const totalMoneyWithCouriers = courierStats.reduce((sum, courier) => sum + courier.moneyWithCourier, 0);
    const totalOrdersToReturn = courierStats.reduce((sum, courier) => sum + courier.ordersToReturn, 0);
    const totalActiveDeliveries = courierStats.reduce((sum, courier) => sum + courier.activeOrders, 0);
    


    console.log('active couriers count:', activeCouriersCount);
    console.log('total money with couriers:', totalMoneyWithCouriers);
    console.log('total orders to return:', totalOrdersToReturn);
    console.log('total active deliveries:', totalActiveDeliveries);

    console.log('courier stats:', courierStats);


    res.render('admin/couriers-follow-up', {  
    title: 'Couriers Follow Up',
    page_title: 'Couriers Follow Up',
    folder: 'Pages',
       summaryStats: {
        activeCouriersCount,
        totalMoneyWithCouriers,
        totalOrdersToReturn,
        totalActiveDeliveries
      },
      couriers: courierStats
    
  })
  } catch (error) {
    console.error('Error in get_couriersFollowUp:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }

};

const get_courierDetailsPage = async (req, res) => {
  const { courierId } = req.params;
  try {
    const courier = await Courier.findOne({ courierID: courierId });

    if (!courier) {
      return res.render('admin/courier-details', {
        title: 'Courier Details',
        page_title: 'Courier Details',
        folder: 'Pages',
        courier: null,
      });
    }

    // Fetch additional stats for the courier
    const moneyWithCourier = await Order.aggregate([
      {
        $match: {
          deliveryMan: courier._id,
          isMoneyRecivedFromCourier: false,

          orderStatus: { $in: ['completed', 'headingToCustomer'] },
          'orderShipping.orderType': { $ne: 'Return' },

          'orderShipping.amountType': { $in: ['COD', 'CD', 'CC'] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$orderShipping.amount' },
        },
      },
    ]);

    const ordersToReturn = await Order.countDocuments({
      deliveryMan: courier._id,
      orderStatus: { $in: ['returnToWarehouse', 'waitingAction'] },
    });

    const activeOrders = await Order.countDocuments({
      deliveryMan: courier._id,
      orderStatus: { $in: ['headingToCustomer', 'headingToYou', 'inProgress'] },
    });

    const totalDeliveries = await Order.countDocuments({
      deliveryMan: courier._id,
    });

    const completedOrders = await Order.countDocuments({
      deliveryMan: courier._id,
      orderStatus: 'completed',
    });

    const totalPickups = await Pickup.countDocuments({
      assignedDriver: courier._id,
      picikupStatus: 'completed',
    });

    const cancelledOrders = await Order.countDocuments({
      deliveryMan: courier._id,
      orderStatus: { $in: ['canceled', 'rejected'] },
    });

    const successRate =
      totalDeliveries > 0
        ? Math.round((completedOrders / totalDeliveries) * 100)
        : 0;

    const customerRating = 4.8; // Placeholder for customer rating

    const deliveryHistory = await Order.find({
      deliveryMan: courier._id,
    })
      .sort({ updatedAt: -1 })
      .populate('business');

    const pickupHistory = await Pickup.find({
      assignedDriver: courier._id,
    })
      .sort({ updatedAt: -1 })
      .populate('business');

    res.render('admin/courier-details', {
      title: 'Courier Details',
      page_title: 'Courier Details',
      folder: 'Pages',
      courier: {
        id: courier._id,
        courierId: courier.courierID,
        name: courier.name,
        nationalId: courier.nationalId,
        dateOfBirth: courier.dateOfBirth,
        allPapers: courier.allPapers,
        zones: courier.assignedZones,
        photo: courier.personalPhoto || '/placeholder.svg?height=100&width=100',
        status: courier.isAvailable ? 'Active' : 'Inactive',
        statusBadge: courier.isAvailable
          ? 'bg-success-subtle text-success'
          : 'bg-danger-subtle text-danger',
        moneyWithCourier: moneyWithCourier[0]?.total || 0,
        ordersToReturn,
        activeOrders,
        totalDeliveries,
        totalPickups,
        successRate,
        customerRating,
        assignedZones: courier.assignedZones || [],
        phone: courier.phoneNumber,
        email: courier.personalEmail,
        address: courier.address,
        vehicle: `${courier.vehicleType} (${courier.vehiclePlateNumber})`,
        joinedDate: courier.createdAt,
      },
      deliveryHistory,
      pickupHistory,
    });
  } catch (error) {
    console.error('Error in get_courierDetailsPage:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

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
    const { pickupType, statusCategory } = req.query;
    let match = {};

    // Handle legacy pickupType parameter
    if (pickupType === 'Upcoming') {
      match = {
        statusCategory: { $in: [statusHelper.STATUS_CATEGORIES.NEW, statusHelper.STATUS_CATEGORIES.PROCESSING] }
      };
    } else if (pickupType === 'Completed') {
      match = { statusCategory: statusHelper.STATUS_CATEGORIES.SUCCESSFUL };
    } else if (pickupType === 'Cancelled') {
      match = { statusCategory: statusHelper.STATUS_CATEGORIES.UNSUCCESSFUL, picikupStatus: 'canceled' };
    } else if (pickupType === 'inStock') {
      match = { picikupStatus: 'inStock' };
    }
    
    // Override with direct status category if provided
    if (statusCategory && statusHelper.STATUS_CATEGORIES[statusCategory]) {
      match.statusCategory = statusCategory;
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
      $sort: { pickupTime: -1, pickupDate: -1, createdAt: -1 }
      },
      {
      $group: {
      _id: '$business.pickUpAdress.city',
      pickups: { $push: '$$ROOT' },
      },
      }
    ]);
    
    // Add status information to each pickup
    const enhancedPickups = pickups.map(group => {
      const enhancedGroup = {
        _id: group._id,
        pickups: group.pickups.map(pickup => {
          return {
            ...pickup,
            statusLabel: statusHelper.getPickupStatusLabel(pickup.picikupStatus),
            statusDescription: statusHelper.getPickupStatusDescription(pickup.picikupStatus),
            categoryClass: statusHelper.getCategoryClass(pickup.statusCategory),
            categoryColor: statusHelper.getCategoryColor(pickup.statusCategory)
          };
        })
      };
      return enhancedGroup;
    });
    
    res.status(200).json(enhancedPickups || []);
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

const get_stockManagementPage = (req, res) => {
  res.render('admin/stock-management', {
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

    if(order.orderStatus === 'inProgress'){
      return res.status(400).json({ error: 'Order is already in progress' });
    }

    if(order.Attemps==2){
      return res.status(400).json({ error: 'Order has exceeded its attempts.' });
    }

    let pickupCompleted = false;
    let completedPickup = null;

    if(order.orderStatus === 'pickedUp'){
      order.orderStatus = 'inStock';
      if (!order.orderStages.packed.isCompleted) {
        order.orderStages.packed.isCompleted = true;
        order.orderStages.packed.completedAt = new Date();
        order.orderStages.packed.notes = 'Order added to stock';
      }
    
    }else if (order.orderStatus === 'waitingAction') {
      order.orderStatus = 'inStock';
      if (!order.orderStages.packed.isCompleted) {
        order.orderStages.packed.isCompleted = true;
        order.orderStages.packed.completedAt = new Date();
        order.orderStages.packed.notes = 'Order added to stock';
      }
    }else{
      return res.status(400).json({error: 'Order can\'t be added to stock'});
    }

    await order.save();

    // Check if this order was part of a pickup and if all orders in that pickup are now in stock
    const pickup = await Pickup.findOne({ 
      ordersPickedUp: order._id 
    }).populate('ordersPickedUp');

    if (pickup && pickup.picikupStatus !== 'completed') {
      // Check if all orders in this pickup are now in stock
      const allOrdersInStock = pickup.ordersPickedUp.every(order => 
        order.orderStatus === 'inStock' || order.orderStatus === 'inProgress'
      );

      if (allOrdersInStock) {
        // Mark pickup as completed
        pickup.picikupStatus = 'completed';
        pickup.pickupStages.push({
          stageName: 'completed',
          stageDate: new Date(),
          stageNotes: [
            {
              text: 'All orders from pickup added to stock - pickup completed',
              date: new Date(),
            },
          ],
        });

        await pickup.save();
        
        pickupCompleted = true;
        completedPickup = pickup;
      }
    }

    res.status(200).json({ 
      message: 'Order added to stock successfully',
      pickupCompleted: pickupCompleted,
      pickup: pickupCompleted ? completedPickup : null
    });
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

/**
 * Assign courier to stock orders with proper status transition
 */
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
        // Allow assignment for orders in stock, picked up, Exchange orders, or fast shipping orders
        const validStatuses = ['inStock', 'pickedUp'];
        
        // For Exchange orders or fast shipping orders, allow assignment regardless of status
        const isExchangeOrder = order.orderShipping.orderType === 'Exchange';
        const isFastShipping = order.orderShipping && order.orderShipping.isExpressShipping;
        
        if (!isExchangeOrder && !isFastShipping && !validStatuses.includes(order.orderStatus)) {
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
      
      // Handle Exchange orders differently based on their current status
      if (order.orderShipping.orderType === 'Exchange') {
        // For new Exchange orders, set status to pickedUp to start the flow
        if (order.orderStatus === 'new') {
          order.orderStatus = 'pickedUp';
          order.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;
          
          // Update packed stage for pickup
          if (!order.orderStages.packed.isCompleted) {
            order.orderStages.packed.isCompleted = true;
            order.orderStages.packed.completedAt = new Date();
            order.orderStages.packed.notes = `Order assigned to courier ${courier.name} for pickup from business`;
          }
          
          // Add to courier history with specific Exchange pickup note
          order.courierHistory.push({
            courier: courierId,
            assignedAt: new Date(),
            action: 'assigned',
            notes: `Courier ${courier.name} assigned to pick up replacement item for Exchange order (${order.orderShipping.productDescriptionReplacement})`
          });
        } 
        // For Exchange orders in pickedUp status, move to inStock
        else if (order.orderStatus === 'pickedUp') {
          order.orderStatus = 'inStock';
          order.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;
          
          // Update shipping stage
          if (!order.orderStages.shipping.isCompleted) {
            order.orderStages.shipping.isCompleted = true;
            order.orderStages.shipping.completedAt = new Date();
            order.orderStages.shipping.notes = `Replacement item received in stock for Exchange order`;
          }
          
          // Add to courier history
          order.courierHistory.push({
            courier: courierId,
            assignedAt: new Date(),
            action: 'delivered_to_warehouse',
            notes: `Courier ${courier.name} delivered replacement item to warehouse`
          });
        }
        // For Exchange orders in inStock, assign for delivery
        else if (order.orderStatus === 'inStock') {
          order.orderStatus = 'inProgress';
          order.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;
          
          // Update inProgress stage
          if (!order.orderStages.inProgress.isCompleted) {
            order.orderStages.inProgress.isCompleted = true;
            order.orderStages.inProgress.completedAt = new Date();
            order.orderStages.inProgress.notes = `Order assigned to courier ${courier.name} for delivery to customer`;
          }
          
          // Add to courier history
          order.courierHistory.push({
            courier: courierId,
            assignedAt: new Date(),
            action: 'assigned',
            notes: `Courier ${courier.name} assigned to deliver Exchange order to customer (${order.orderShipping.productDescription} → ${order.orderShipping.productDescriptionReplacement})`
          });
        }
      } else {
        // Handle fast shipping vs standard flow for non-Exchange orders
        const isFastShipping = order.orderShipping && order.orderShipping.isExpressShipping;
        
        order.orderStatus = 'inProgress';
        order.statusCategory = statusHelper.STATUS_CATEGORIES.PROCESSING;
        
        if (isFastShipping) {
          // For fast shipping orders, only mark inProgress stage as completed
          if (!order.orderStages.inProgress.isCompleted) {
            order.orderStages.inProgress.isCompleted = true;
            order.orderStages.inProgress.completedAt = new Date();
            order.orderStages.inProgress.notes = `Fast shipping order assigned to courier ${courier.name} - ready for pickup from business`;
          }
          
          // Add to courier history with fast shipping note
          order.courierHistory.push({
            courier: courierId,
            assignedAt: new Date(),
            action: 'assigned',
            notes: `Fast shipping order assigned to courier ${courier.name} - proceed to business for pickup`
          });
        } else {
          // For regular orders, update shipping stage
          if (!order.orderStages.shipping.isCompleted) {
            order.orderStages.shipping.isCompleted = true;
            order.orderStages.shipping.completedAt = new Date();
            order.orderStages.shipping.notes = `Order assigned to courier ${courier.name}`;
          }
          
          // Add to courier history
          order.courierHistory.push({
            courier: courierId,
            assignedAt: new Date(),
            action: 'assigned',
            notes: `Courier ${courier.name} assigned to deliver ${order.orderShipping.orderType} order`
          });
        }
        
        // For Cash Collection orders, add special note
        if (order.orderShipping.orderType === 'Cash Collection') {
          order.courierHistory[order.courierHistory.length - 1].notes += ` (Amount to collect: ${order.orderShipping.amount} EGP)`;
        }
      }
      
      // For Cash Collection orders, add amount in note
      if (order.orderShipping.orderType === 'Cash Collection') {
        order.courierHistory[order.courierHistory.length - 1].notes += ` (Amount to collect: ${order.orderShipping.amount})`;
      }
      
      return order.save();
    });

    await Promise.all(updatePromises);

    res.status(200).json({ message: 'Orders assigned to courier successfully' });
  } catch (error) {
    console.error('Error in assignCourierToStock:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

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
      
      // Update inProgress stage
      if (!order.orderStages.inProgress.isCompleted) {
        order.orderStages.inProgress.isCompleted = true;
        order.orderStages.inProgress.completedAt = new Date();
        order.orderStages.inProgress.notes = `Order assigned to courier ${courier.name}`;
      }
      if (!order.orderStages.outForDelivery.isCompleted) {
        order.orderStages.outForDelivery.isCompleted = true;
        order.orderStages.outForDelivery.completedAt = new Date();
        order.orderStages.outForDelivery.notes = `Order marked as received by courier ${courier.name}`;
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



// ================ Stock Returns =================== //  

const get_stockReturnsPage = (req, res) => {
  res.render('admin/stock-returns', {
    title: 'Stock Returns',
    page_title: 'Stock Returns',
    folder: 'Pages',
  });

}


const getReturnedOrders = async (req, res) => {
  try {
    const orders = await Order.find({ 
      $or: [
        { orderStatus: { $in: ['returnAtWarehouse', 'inReturnStock'] } },
        { 'orderShipping.orderType': 'Return' }
      ]
    })
      .populate('business', 'brandInfo')
      .populate('deliveryMan')
      .sort({ orderDate: -1, createdAt: -1 });
      
    console.log(orders);    
    res.status(200).json(orders || []);
  }
  catch (error) {
    console.error('Error in getReturnedOrders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}


// Note: Removed approveReturn and rejectReturn functions as admin no longer needs to approve returns

/**
 * Add a return to stock with proper status categorization
 */
const add_return_to_stock = async (req, res) => {
  const { orderNumber, returnReason, returnNotes } = req.body;

  try {
    const order = await Order.findOne({ orderNumber });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.orderStatus === 'inReturnStock') {
      return res.status(400).json({ error: 'Order is already in return stock' });
    }

    if (order.orderStatus === 'inProgress') {
      return res.status(400).json({ error: 'Order is in progress' });
    }

    // ensure order not heading to customer
    if (order.orderStatus === 'headingToCustomer' || order.orderStatus === 'headingToYou') {
      return res.status(400).json({ error: 'Order is on the way to customer' });
    }

    // Case 1: Order comes from waitingAction, returnToWarehouse, or rejected status
    // This happens when delivery attempts fail
    if (order.orderStatus === 'waitingAction' || order.orderStatus === 'returnToWarehouse' || order.orderStatus === 'rejected') { 
      order.orderStatus = 'inReturnStock';
      
      // If it's not already a return type, change it to a return
      if (order.orderShipping.orderType !== 'Return') {
        order.orderShipping.orderType = 'Return';
      }
      
      // Add return reason if provided
      if (returnReason) {
        order.orderShipping.returnReason = returnReason;
      }
      
      // Add return notes if provided
      if (returnNotes) {
        order.orderShipping.returnNotes = returnNotes;
      }
      
      // Update inProgress stage for return
      if (!order.orderStages.inProgress.isCompleted) {
        order.orderStages.inProgress.isCompleted = true;
        order.orderStages.inProgress.completedAt = new Date();
        order.orderStages.inProgress.notes = 'Order added to return stock after failed delivery attempt';
      }
      
      // Update returnAtWarehouse stage to mark it as completed
      order.orderStages.returnAtWarehouse.isCompleted = true;
      order.orderStages.returnAtWarehouse.completedAt = new Date();
      order.orderStages.returnAtWarehouse.notes = 'Order received at warehouse and added to return stock';
    } 
    // Case 2: Order is a new return initiated by the business
    else if (order.orderStatus === 'returnInitiated') {
      order.orderStatus = 'returnAtWarehouse';
      
      // Add return reason if provided
      if (returnReason) {
        order.orderShipping.returnReason = returnReason;
      }
      
      // Add return notes if provided
      if (returnNotes) {
        order.orderShipping.returnNotes = returnNotes;
      }
      
      // Update returnAtWarehouse stage
      order.orderStages.returnAtWarehouse.isCompleted = true;
      order.orderStages.returnAtWarehouse.completedAt = new Date();
      order.orderStages.returnAtWarehouse.notes = 'Return order added to warehouse by admin';
    }
    // Case 3: Order is completed and needs to be returned
    else if (order.orderStatus === 'completed') {
      order.orderStatus = 'returnAtWarehouse';
      
      // Change order type to return
      order.orderShipping.orderType = 'Return';
      
      // Add return reason if provided
      if (returnReason) {
        order.orderShipping.returnReason = returnReason;
      }
      
      // Add return notes if provided
      if (returnNotes) {
        order.orderShipping.returnNotes = returnNotes;
      }
      
      // Update returnAtWarehouse stage
      order.orderStages.returnAtWarehouse.isCompleted = true;
      order.orderStages.returnAtWarehouse.completedAt = new Date();
      order.orderStages.returnAtWarehouse.notes = 'Completed order added to return warehouse by admin';
    }
    // Case 4: Order is already at warehouse but needs to be processed as return
    else if (order.orderStatus === 'returnAtWarehouse') {
      // Order is already at warehouse, just update the return details
      if (returnReason) {
        order.orderShipping.returnReason = returnReason;
      }
      
      if (returnNotes) {
        order.orderShipping.returnNotes = returnNotes;
      }
      
      // Update returnAtWarehouse stage
      order.orderStages.returnAtWarehouse.isCompleted = true;
      order.orderStages.returnAtWarehouse.completedAt = new Date();
      order.orderStages.returnAtWarehouse.notes = 'Return order details updated by admin';
    }
    else {
      return res.status(400).json({ error: `Order status '${order.orderStatus}' cannot be changed to return stock. Allowed statuses: completed, returnInitiated, waitingAction, returnToWarehouse, rejected` });
    }

    await order.save();

    res.status(200).json({ message: 'Order added to return stock successfully' });

  } catch (error) {
    console.error('Error in add_return_to_stock:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}

    
    
// Enhanced Assign courier to pick up return from customer
const assignCourierToReturn = async (req, res) => {
  const { orderNumbers, courierId } = req.body;

  try {
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orderIds = orderNumbers;
    const orders = await Order.find({ orderNumber: { $in: orderIds } });

    if (orders.length !== orderIds.length) {
      return res.status(404).json({ error: 'Some orders not found' });
    }

    for (const order of orders) {
      // Enhanced validation for new return flow
      const validReturnStatuses = ['new', 'returnInitiated', 'inReturnStock', 'returnLinked'];
      
      if (!validReturnStatuses.includes(order.orderStatus)) {
        return res.status(400).json({ 
          error: `Order ${order.orderNumber} (${order.orderStatus}) is not ready for courier assignment. Valid statuses: ${validReturnStatuses.join(', ')}` 
        });
      }

      if (order.orderStatus === 'headingToCustomer' || order.orderStatus === 'headingToYou') {
        return res.status(400).json({ error: `Order ${order.orderNumber} is already assigned to a courier` });
      }

      // Check if this is a Return order type
      if (order.orderShipping.orderType !== 'Return') {
        return res.status(400).json({ error: `Order ${order.orderNumber} is not a return order` });
      }

      order.deliveryMan = courierId;
      order.orderStatus = 'returnAssigned';
      
      // Update return stages
      order.orderStages.returnAssigned.isCompleted = true;
      order.orderStages.returnAssigned.completedAt = new Date();
      order.orderStages.returnAssigned.notes = `Return order assigned to courier ${courier.name} for pickup from customer`;
      
      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'assigned',
        notes: `Courier ${courier.name} assigned to pick up return order from customer`
      });

      // If this return order is linked to a deliver order, update the deliver order status too
      if (order.orderShipping.linkedDeliverOrder) {
        const linkedDeliverOrder = await Order.findById(order.orderShipping.linkedDeliverOrder);
        if (linkedDeliverOrder) {
          linkedDeliverOrder.orderStatus = 'returnAssigned';
          linkedDeliverOrder.orderStages.returnAssigned.isCompleted = true;
          linkedDeliverOrder.orderStages.returnAssigned.completedAt = new Date();
          linkedDeliverOrder.orderStages.returnAssigned.notes = `Return pickup assigned to courier ${courier.name}`;
          await linkedDeliverOrder.save();
        }
      }
    }

    await Promise.all(orders.map(order => order.save()));

    res.status(200).json({ 
      message: 'Courier assigned to return orders successfully',
      assignedOrders: orders.length,
      courierName: courier.name
    });

  } catch (error) {
    console.error('Error in assignCourierToReturn:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};

// Scenario 2: Automatic Return Conversion for Failed Deliveries
const convertFailedDeliveryToReturn = async (req, res) => {
  const { orderId, reason } = req.params;
  
  try {
    const deliverOrder = await Order.findById(orderId);
    if (!deliverOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Only allow conversion for failed deliver orders
    if (deliverOrder.orderStatus !== 'deliveryFailed' && 
        deliverOrder.orderStatus !== 'rejected' && 
        deliverOrder.orderStatus !== 'canceled' &&
        deliverOrder.orderShipping.orderType !== 'Deliver') {
      return res.status(400).json({ error: 'Order is not eligible for automatic return conversion' });
    }

    // Create a new Return order (R2) automatically
    const returnOrder = new Order({
      orderNumber: `${Math.floor(Math.random() * (900000 - 100000 + 1)) + 100000}`,
      orderDate: new Date(),
      orderStatus: 'autoReturnInitiated',
      orderFees: deliverOrder.orderFees, // Use same fees
      orderCustomer: deliverOrder.orderCustomer,
      orderShipping: {
        productDescription: deliverOrder.orderShipping.productDescription,
        numberOfItems: deliverOrder.orderShipping.numberOfItems,
        orderType: 'Return',
        amountType: deliverOrder.orderShipping.amountType,
        amount: deliverOrder.orderShipping.amount,
        isExpressShipping: deliverOrder.orderShipping.isExpressShipping,
        returnReason: reason || 'Delivery failed - automatic return',
        returnNotes: `Automatic return created due to delivery failure. Original order: ${deliverOrder.orderNumber}`,
        linkedDeliverOrder: deliverOrder._id,
        originalOrderNumber: deliverOrder.orderNumber,
      },
      orderStages: {
        orderPlaced: {
          isCompleted: true,
          completedAt: new Date(),
          notes: 'Automatic return order created due to delivery failure.'
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
        }
      },
      business: deliverOrder.business,
    });

    // Link the deliver order to the return order
    deliverOrder.orderShipping.linkedReturnOrder = returnOrder._id;
    deliverOrder.orderShipping.returnOrderCode = returnOrder.orderNumber;
    deliverOrder.orderStatus = 'autoReturnInitiated';

    // Update deliver order stages
    deliverOrder.orderStages.returnInitiated = {
      isCompleted: true,
      completedAt: new Date(),
      notes: `Automatic return initiated due to delivery failure. Return order: ${returnOrder.orderNumber}`
    };

    await Promise.all([returnOrder.save(), deliverOrder.save()]);

    res.status(201).json({
      message: 'Failed delivery automatically converted to return order',
      deliverOrder: deliverOrder,
      returnOrder: returnOrder,
      returnOrderCode: returnOrder.orderNumber
    });

  } catch (error) {
    console.error('Error converting failed delivery to return:', error);
    res.status(500).json({ error: 'Failed to convert delivery to return' });
  }
};

// Get all return orders with comprehensive filtering and management
const getAllReturnOrders = async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      status, 
      dateFrom, 
      dateTo,
      search,
      businessId,
      courierId,
      sortBy = 'orderDate',
      sortOrder = 'desc'
    } = req.query;

    const query = {
      'orderShipping.orderType': 'Return'
    };

    // Add status filter
    if (status && status !== 'all') {
      query.orderStatus = status;
    }

    // Add business filter
    if (businessId) {
      query.business = businessId;
    }

    // Add courier filter
    if (courierId) {
      query.deliveryMan = courierId;
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
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    
    const returnOrders = await Order.find(query)
      .populate('business', 'businessName email phone')
      .populate('deliveryMan', 'name phone email')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await Order.countDocuments(query);

    // Get return statistics
    const stats = await Order.aggregate([
      { $match: { 'orderShipping.orderType': 'Return' } },
      {
        $group: {
          _id: '$orderStatus',
          count: { $sum: 1 },
          totalFees: { $sum: '$totalFees' }
        }
      }
    ]);

    res.status(200).json({
      orders: returnOrders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNext: skip + returnOrders.length < totalCount,
        hasPrev: parseInt(page) > 1
      },
      statistics: stats
    });
  } catch (error) {
    console.error('Error fetching return orders:', error);
    res.status(500).json({ error: 'Failed to fetch return orders' });
  }
};

// Get return order details for admin
const getReturnOrderDetailsAdmin = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    const returnOrder = await Order.findOne({
      _id: orderId,
      'orderShipping.orderType': 'Return'
    }).populate('deliveryMan', 'name phone email')
      .populate('business', 'businessName email phone')
      .populate('orderShipping.linkedDeliverOrder', 'orderNumber orderStatus orderCustomer');

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
      feeBreakdown: returnOrder.feeBreakdown,
      linkedDeliverOrder: returnOrder.orderShipping.linkedDeliverOrder
    });
  } catch (error) {
    console.error('Error fetching return order details:', error);
    res.status(500).json({ error: 'Failed to fetch return order details' });
  }
};

// Update return order inspection
const updateReturnInspection = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { 
      inspectionResult, 
      inspectionNotes, 
      inspectionPhotos, 
      conditionNotes,
      returnValue 
    } = req.body;

    const returnOrder = await Order.findOne({
      _id: orderId,
      'orderShipping.orderType': 'Return'
    });

    if (!returnOrder) {
      return res.status(404).json({ error: 'Return order not found' });
    }

    // Update inspection stage
    returnOrder.orderStages.returnInspection = {
      isCompleted: true,
      completedAt: new Date(),
      notes: inspectionNotes || '',
      inspectedBy: req.userData._id,
      inspectionResult: inspectionResult,
      inspectionPhotos: inspectionPhotos || []
    };

    // Update return condition and value
    if (returnOrder.orderShipping) {
      returnOrder.orderShipping.returnCondition = req.body.returnCondition || returnOrder.orderShipping.returnCondition;
      returnOrder.orderShipping.returnValue = returnValue || returnOrder.orderShipping.returnValue;
      returnOrder.orderShipping.returnInspectionNotes = inspectionNotes || '';
    }

    // Update warehouse stage if inspection is completed
    if (inspectionResult === 'approved') {
      returnOrder.orderStages.returnAtWarehouse = {
        isCompleted: true,
        completedAt: new Date(),
        notes: 'Return received and inspected at warehouse',
        receivedBy: req.userData._id,
        warehouseLocation: req.body.warehouseLocation || 'Main Warehouse',
        conditionNotes: conditionNotes || ''
      };
      returnOrder.orderStatus = 'returnAtWarehouse';
    }

    await returnOrder.save();

    res.status(200).json({ 
      message: 'Return inspection updated successfully',
      order: returnOrder
    });
  } catch (error) {
    console.error('Error updating return inspection:', error);
    res.status(500).json({ error: 'Failed to update return inspection' });
  }
};

// Update return processing
const updateReturnProcessing = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { 
      processingType, 
      processingNotes, 
      refundAmount,
      exchangeOrderNumber 
    } = req.body;

    const returnOrder = await Order.findOne({
      _id: orderId,
      'orderShipping.orderType': 'Return'
    });

    if (!returnOrder) {
      return res.status(404).json({ error: 'Return order not found' });
    }

    // Update processing stage
    returnOrder.orderStages.returnProcessing = {
      isCompleted: true,
      completedAt: new Date(),
      notes: processingNotes || '',
      processedBy: req.userData._id,
      processingType: processingType
    };

    // Update processing details
    if (returnOrder.orderShipping) {
      returnOrder.orderShipping.returnProcessingNotes = processingNotes || '';
      returnOrder.orderShipping.refundAmount = refundAmount || 0;
      returnOrder.orderShipping.exchangeOrderNumber = exchangeOrderNumber || '';
    }

    await returnOrder.save();

    res.status(200).json({ 
      message: 'Return processing updated successfully',
      order: returnOrder
    });
  } catch (error) {
    console.error('Error updating return processing:', error);
    res.status(500).json({ error: 'Failed to update return processing' });
  }
};

// Assign courier to deliver return back to business
const assignCourierToReturnToBusiness = async (req, res) => {
  const { orderNumbers, courierId } = req.body;

  try {
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orderIds = orderNumbers;
    const orders = await Order.find({ orderNumber: { $in: orderIds } });

    if (orders.length !== orderIds.length) {
      return res.status(404).json({ error: 'Some orders not found' });
    }

    for (const order of orders) {
      // Allow returns at warehouse or in return stock to be assigned back to business
      if (order.orderStatus !== 'returnAtWarehouse' && order.orderStatus !== 'inReturnStock') {
        return res.status(400).json({ error: `Order ${order.orderNumber} is not at warehouse or in return stock` });
      }

      order.deliveryMan = courierId;
      order.orderStatus = 'returnToBusiness';
      
      // Update return stages
      order.orderStages.returnToBusiness.isCompleted = true;
      order.orderStages.returnToBusiness.completedAt = new Date();
      order.orderStages.returnToBusiness.notes = `Return assigned to courier ${courier.name} for delivery to business`;
      
      // Add to courier history
      order.courierHistory.push({
        courier: courierId,
        assignedAt: new Date(),
        action: 'pickup_from_warehouse',
        notes: `Courier ${courier.name} assigned to deliver return to business`
      });
    }

    await Promise.all(orders.map(order => order.save()));

    res.status(200).json({ message: 'Courier assigned to deliver returns to business successfully' });

  } catch (error) {
    console.error('Error in assignCourierToReturnToBusiness:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
};


const return_courier_received = async (req, res) => {
  const { courierId } = req.body;
  try {
    const courier = await Courier.findById(courierId);
    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    const orders = await Order.find({ deliveryMan: courierId, orderStatus: 'returnToWarehouse' });
    if (!orders.length) {
      return res.status(404).json({ error: 'No orders found for this courier' });
    }
    const updatePromises = orders.map(order => {
      order.orderStatus = 'inReturnStock';
      return order.save();
    }

    );
    await Promise.all(updatePromises);
    res.status(200).json({ message: 'Orders marked as received in return warehouse' });
  } catch (error) {
    console.error('Error in return_courier_received:', error);
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
    // Fetch all releases with the specified status and full business details
    const releases = await Release.find(query)
      .populate('business', 'brandInfo name email phoneNumber paymentMethod brandType pickUpAdress')
      .populate('transactionReferences');
    console.log('Releases found:', releases.length);
    
    // Get all releases for accurate statistics (not filtered)
    const allReleases = await Release.find({}).populate('business', 'brandInfo name email phone');
    
    // Calculate Total Funds Available (from all pending and scheduled releases)
    const totalFundsAvailable = allReleases.reduce((sum, release) => {
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
    const totalPaymentsReleased = allReleases
      .filter(release => release.releaseStatus === 'released')
      .reduce((sum, release) => sum + release.amount, 0);

    // Calculate Payments Pending
    const paymentsPending = allReleases
      .filter(release => release.releaseStatus === 'pending')
      .reduce((sum, release) => sum + release.amount, 0);

    // Calculate Scheduled Releases
    const scheduledReleases = allReleases
      .filter(release => release.releaseStatus === 'scheduled')
      .reduce((sum, release) => sum + release.amount, 0);

    // Calculate the number of releases for each category
    const totalPaymentsReleasedCount = allReleases.filter(release => release.releaseStatus === 'released').length;
    const paymentsPendingCount = allReleases.filter(release => release.releaseStatus === 'pending').length;
    const scheduledReleasesCount = allReleases.filter(release => release.releaseStatus === 'scheduled').length;

    // Send response
    res.status(200).json({
      totalFundsAvailable,
      nextReleaseDate: nextWednesday.toISOString(),
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
    const release = await Release.findById(releaseId)
      .populate('business')
      .populate('transactionReferences');
    
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

    // Mark all transactions included in this release as settled
    if (release.transactionReferences && release.transactionReferences.length > 0) {
      const transactionIds = release.transactionReferences.map(transaction => transaction._id);
      console.log(`Attempting to mark ${transactionIds.length} transactions as settled:`, transactionIds);
      
      // First, let's check the current status of these transactions
      const currentTransactions = await Transaction.find({ _id: { $in: transactionIds } });
      console.log('Current transaction statuses:', currentTransactions.map(t => ({
        id: t._id,
        transactionId: t.transactionId,
        type: t.transactionType,
        settlementStatus: t.settlementStatus,
        settled: t.settled
      })));
      
      // Update each transaction individually to trigger pre-save hooks
      const updatePromises = currentTransactions.map(async (transaction) => {
        transaction.settlementStatus = 'settled';
        // The pre-save hook will automatically set settled = true
        return transaction.save();
      });
      
      await Promise.all(updatePromises);
      console.log(`Marked ${currentTransactions.length} transactions as settled for release ${release.releaseId}`);
      
      // Verify the update worked
      const updatedTransactions = await Transaction.find({ _id: { $in: transactionIds } });
      console.log('Updated transaction statuses:', updatedTransactions.map(t => ({
        id: t._id,
        transactionId: t.transactionId,
        type: t.transactionType,
        settlementStatus: t.settlementStatus,
        settled: t.settled
      })));
    }

    // Create a withdrawal transaction record
    const transaction = new Transaction({
      transactionId: Math.floor(100000 + Math.random() * 900000).toString(),
      transactionType: 'withdrawal',
      transactionAmount: -release.amount,
      settlementStatus: 'settled', // This withdrawal transaction is settled immediately
      transactionNotes: `Funds released${notes ? ` - ${notes}` : ''}`,
      ordersDetails: {
        releaseId: release.releaseId,
        releaseType: release.releaseType,
        releaseAmount: release.amount,
        releaseDate: new Date(),
        businessName: release.business.name || release.business.brandInfo?.brandName || 'Unknown Business',
        notes: notes || '',
        transactionCount: release.transactionReferences.length
      },
      business: release.business._id
    });

    await transaction.save();

    console.log(`Funds released successfully for business ${release.business._id}. Amount: ${release.amount} EGP`);

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

// ================= WaitingAction Admin Overrides ================= //
const adminRetryTomorrow = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.orderStatus !== 'waitingAction') return res.status(400).json({ error: 'Order not in waitingAction' });
    order.scheduledRetryAt = new Date(Date.now() + 24*60*60*1000);
    await order.save();
    return res.status(200).json({ message: 'Retry scheduled for tomorrow' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to schedule retry' });
  }
}

const adminRetryScheduled = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { date } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.orderStatus !== 'waitingAction') return res.status(400).json({ error: 'Order not in waitingAction' });
    const when = new Date(date);
    if (isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid date' });
    order.scheduledRetryAt = when;
    await order.save();
    return res.status(200).json({ message: 'Retry scheduled' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to schedule retry' });
  }
}

const adminReturnToWarehouseFromWaiting = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.orderStatus !== 'waitingAction') return res.status(400).json({ error: 'Order not in waitingAction' });
    
    // Update order status to returnToWarehouse
    order.orderStatus = 'returnToWarehouse';
    order.statusCategory = 'PROCESSING';
    
    // Add to status history
    order.orderStatusHistory.push({
      status: 'returnToWarehouse',
      date: new Date(),
      category: 'PROCESSING'
    });
    
    await order.save();
    return res.status(200).json({ message: 'Order moved to return stock' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to move to return stock' });
  }
}

const adminCancelFromWaiting = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.orderStatus !== 'waitingAction') return res.status(400).json({ error: 'Order not in waitingAction' });
    
    // Update order status to canceled
    order.orderStatus = 'canceled';
    order.statusCategory = 'UNSUCCESSFUL';
    
    // Add to status history
    order.orderStatusHistory.push({
      status: 'canceled',
      date: new Date(),
      category: 'UNSUCCESSFUL'
    });
    
    await order.save();
    return res.status(200).json({ message: 'Order canceled' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to cancel order' });
  }
}

const adminCancelOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if order is already canceled
    if (order.orderStatus === 'canceled') {
      return res.status(400).json({ error: 'Order is already canceled' });
    }

    // Cancel the order regardless of current status
    order.orderStatus = 'canceled';
    order.statusCategory = 'UNSUCCESSFUL';
    
    // Add to status history
    order.orderStatusHistory.push({
      status: 'canceled',
      date: new Date(),
      category: 'UNSUCCESSFUL'
    });
    
    await order.save();
    
    return res.status(200).json({ message: 'Order canceled successfully' });
  } catch (error) {
    console.error('Error in adminCancelOrder:', error);
    return res.status(500).json({ error: 'Failed to cancel order' });
  }
}

const changeReturnCourier = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { newCourierId } = req.body;
    
    if (!newCourierId) {
      return res.status(400).json({ error: 'New courier ID is required' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Check if this is a return order
    if (order.orderShipping.orderType !== 'Return') {
      return res.status(400).json({ error: 'Order is not a return order' });
    }

    // Check if order is in a state where courier can be changed
    const validStatusesForCourierChange = ['returnAssigned', 'returnPickedUp', 'headingToYou', 'returnToBusiness'];
    if (!validStatusesForCourierChange.includes(order.orderStatus)) {
      return res.status(400).json({ 
        error: `Order status ${order.orderStatus} does not allow courier change` 
      });
    }

    // Verify new courier exists
    const newCourier = await Courier.findById(newCourierId);
    if (!newCourier) {
      return res.status(404).json({ error: 'New courier not found' });
    }

    // Store previous courier info
    const previousCourierId = order.deliveryMan;
    const previousCourier = await Courier.findById(previousCourierId);

    // Update courier assignment
    order.deliveryMan = newCourierId;
    
    // Add to courier history
    order.courierHistory.push({
      courier: newCourierId,
      assignedAt: new Date(),
      action: 'courier_changed',
      notes: `Courier changed from ${previousCourier?.name || 'Unknown'} to ${newCourier.name} by admin`,
      previousCourier: previousCourierId
    });

    // Update relevant stage notes
    if (order.orderStatus === 'returnAssigned') {
      order.orderStages.returnAssigned.notes = `Return order reassigned to courier ${newCourier.name} by admin`;
    } else if (order.orderStatus === 'returnPickedUp') {
      order.orderStages.returnPickedUp.notes = `Return picked up - courier changed to ${newCourier.name} by admin`;
    }

    await order.save();
    
    return res.status(200).json({ 
      message: `Return courier changed successfully from ${previousCourier?.name || 'Unknown'} to ${newCourier.name}` 
    });
  } catch (error) {
    console.error('Error in changeReturnCourier:', error);
    return res.status(500).json({ error: 'Failed to change return courier' });
  }
}

// Courier Tracking Page
const getCourierTrackingPage = (req, res) => {
    res.render('admin/courier-tracking', {
        title: "Courier Tracking",
        page_title: 'Courier Tracking',
        folder: 'Pages',
        breadcrumb: [
            { title: 'Dashboard', link: '/admin' },
            { title: 'Courier Tracking', active: true }
        ]
    });
};

// Courier Tracking
const courierTracking = (req, res) => {
    res.render('admin/courier-tracking', {
        title: 'Courier Tracking',
        page_title: 'Courier Tracking',
        folder: 'Pages',
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY
    });
};

// Get all courier locations
const getCourierLocations = async (req, res) => {
    try {
        // Get all couriers with location tracking enabled and have a valid location
        const couriers = await Courier.find({
            isLocationTrackingEnabled: true,
            'currentLocation.coordinates.0': { $ne: 0 },
            'currentLocation.coordinates.1': { $ne: 0 }
        }).select('name courierID vehicleType isAvailable currentLocation isLocationTrackingEnabled personalPhoto');

        // Process couriers to add photoUrl
        const processedCouriers = couriers.map(courier => {
            const courierObj = courier.toObject();
            if (courierObj.personalPhoto) {
                courierObj.photoUrl = `/uploads/couriers/${courierObj.personalPhoto}`;
            }
            return courierObj;
        });
        console.log(processedCouriers)
        res.json({
            success: true,
            couriers: processedCouriers
        });
    } catch (error) {
        console.error('Error getting courier locations:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get courier locations',
            error: error.message
        });
    }
};

// Get a specific courier's location
const getCourierLocation = async (req, res) => {
    try {
        const courierId = req.params.id;
        const courier = await Courier.findById(courierId).select('name courierID vehicleType isAvailable currentLocation phoneNumber email isLocationTrackingEnabled personalPhoto');

        if (!courier) {
            return res.status(404).json({
                success: false,
                message: 'Courier not found'
            });
        }

        // Add photoUrl if personalPhoto exists
        const courierObj = courier.toObject();
        if (courierObj.personalPhoto) {
            courierObj.photoUrl = `/uploads/couriers/${courierObj.personalPhoto}`;
        }

        res.json({
            success: true,
            courier: courierObj
        });
    } catch (error) {
        console.error('Error getting courier location:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get courier location',
            error: error.message
        });
    }
};

// Excel Export Function for Releases
const exportReleasesToExcel = async (req, res) => {
  try {
    // Fetch all releases with full business details
    const releases = await Release.find({})
      .populate('business', 'brandInfo name email phoneNumber paymentMethod brandType pickUpAdress')
      .sort({ createdAt: -1 });

    // Create a new workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Business Payments Report');

    // Define columns with professional headers
    worksheet.columns = [
      { header: 'Release ID', key: 'releaseId', width: 15 },
      { header: 'Business Name', key: 'businessName', width: 25 },
      { header: 'Business Owner', key: 'businessOwner', width: 25 },
      { header: 'Business Type', key: 'businessType', width: 15 },
      { header: 'Industry', key: 'industry', width: 20 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone Number', key: 'phoneNumber', width: 20 },
      { header: 'Payment Method', key: 'paymentMethod', width: 20 },
      { header: 'Payment Details', key: 'paymentDetails', width: 35 },
      { header: 'Amount (EGP)', key: 'amount', width: 15 },
      { header: 'Release Status', key: 'status', width: 15 },
      { header: 'Scheduled Date', key: 'scheduledDate', width: 20 },
      { header: 'Created Date', key: 'createdDate', width: 20 },
      { header: 'Release Notes', key: 'notes', width: 30 }
    ];

    // Style the header row
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '405189' }
    };
    worksheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

    // Add data rows
    releases.forEach((release, index) => {
      const business = release.business;
      const paymentMethod = business.paymentMethod;
      
      let paymentMethodText = 'Not Set';
      let paymentDetails = 'N/A';
      
      if (paymentMethod && paymentMethod.paymentChoice) {
        switch (paymentMethod.paymentChoice) {
          case 'instaPay':
            paymentMethodText = 'InstaPay';
            paymentDetails = paymentMethod.details?.IPAorPhoneNumber || 'N/A';
            break;
          case 'mobileWallet':
            paymentMethodText = 'Mobile Wallet';
            paymentDetails = paymentMethod.details?.mobileWalletNumber || 'N/A';
            break;
          case 'bankTransfer':
            paymentMethodText = 'Bank Transfer';
            paymentDetails = `Bank: ${paymentMethod.details?.bankName || 'N/A'}, IBAN: ${paymentMethod.details?.IBAN || 'N/A'}, Account: ${paymentMethod.details?.accountName || 'N/A'}`;
            break;
        }
      }

      const row = worksheet.addRow({
        releaseId: release.releaseId,
        businessName: business.brandInfo?.brandName || business.name || 'N/A',
        businessOwner: business.name || 'N/A',
        businessType: business.brandType?.brandChoice || 'N/A',
        industry: business.brandInfo?.industry || 'N/A',
        email: business.email || 'N/A',
        phoneNumber: business.phoneNumber || 'N/A',
        paymentMethod: paymentMethodText,
        paymentDetails: paymentDetails,
        amount: release.amount,
        status: release.releaseStatus,
        scheduledDate: release.scheduledReleaseDate ? new Date(release.scheduledReleaseDate).toLocaleDateString() : 'Pending',
        createdDate: new Date(release.createdAt).toLocaleDateString(),
        notes: release.releaseNotes || ''
      });

      // Alternate row colors for better readability
      if (index % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F8F9FA' }
        };
      }

      // Format amount column
      row.getCell('amount').numFmt = '#,##0.00';
      row.getCell('amount').alignment = { horizontal: 'right' };
      
      // Make business owner name bold
      row.getCell('businessOwner').font = { bold: true };
    });

    // Add summary section
    const summaryRow = releases.length + 3;
    worksheet.getCell(`A${summaryRow}`).value = 'SUMMARY';
    worksheet.getCell(`A${summaryRow}`).font = { bold: true, size: 14 };
    worksheet.getCell(`A${summaryRow}`).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'E3F2FD' }
    };

    // Calculate totals
    const totalAmount = releases.reduce((sum, release) => sum + release.amount, 0);
    const pendingAmount = releases.filter(r => r.releaseStatus === 'pending').reduce((sum, release) => sum + release.amount, 0);
    const scheduledAmount = releases.filter(r => r.releaseStatus === 'scheduled').reduce((sum, release) => sum + release.amount, 0);
    const releasedAmount = releases.filter(r => r.releaseStatus === 'released').reduce((sum, release) => sum + release.amount, 0);

    worksheet.getCell(`A${summaryRow + 1}`).value = 'Total Releases:';
    worksheet.getCell(`B${summaryRow + 1}`).value = releases.length;
    worksheet.getCell(`A${summaryRow + 2}`).value = 'Total Amount:';
    worksheet.getCell(`B${summaryRow + 2}`).value = totalAmount;
    worksheet.getCell(`B${summaryRow + 2}`).numFmt = '#,##0.00';
    worksheet.getCell(`A${summaryRow + 3}`).value = 'Pending Amount:';
    worksheet.getCell(`B${summaryRow + 3}`).value = pendingAmount;
    worksheet.getCell(`B${summaryRow + 3}`).numFmt = '#,##0.00';
    worksheet.getCell(`A${summaryRow + 4}`).value = 'Scheduled Amount:';
    worksheet.getCell(`B${summaryRow + 4}`).value = scheduledAmount;
    worksheet.getCell(`B${summaryRow + 4}`).numFmt = '#,##0.00';
    worksheet.getCell(`A${summaryRow + 5}`).value = 'Released Amount:';
    worksheet.getCell(`B${summaryRow + 5}`).value = releasedAmount;
    worksheet.getCell(`B${summaryRow + 5}`).numFmt = '#,##0.00';

    // Style summary section
    for (let i = summaryRow + 1; i <= summaryRow + 5; i++) {
      worksheet.getRow(i).font = { bold: true };
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Business_Payments_Export_${new Date().toISOString().split('T')[0]}.xlsx"`);

    // Write the workbook to response
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Error exporting to Excel:', error);
    res.status(500).json({ error: 'Failed to export data to Excel' });
  }
};

// PDF Export Function for Releases
const exportReleasesToPDF = async (req, res) => {
  try {
    // Fetch all releases with full business details
    const releases = await Release.find({})
      .populate('business', 'brandInfo name email phoneNumber paymentMethod brandType pickUpAdress')
      .sort({ createdAt: -1 });

    // For now, return a simple JSON response
    // In a real implementation, you would use a PDF library like puppeteer or pdfkit
    res.json({
      message: 'PDF export functionality will be implemented with a PDF library',
      data: releases.map(release => ({
        releaseId: release.releaseId,
        businessName: release.business.brandInfo?.brandName || release.business.name,
        amount: release.amount,
        status: release.releaseStatus,
        paymentMethod: release.business.paymentMethod?.paymentChoice || 'Not Set'
      }))
    });

  } catch (error) {
    console.error('Error exporting to PDF:', error);
    res.status(500).json({ error: 'Failed to export data to PDF' });
  }
};

// Get single release details
const getReleaseDetails = async (req, res) => {
  try {
    const { releaseId } = req.params;
    
    const release = await Release.findById(releaseId)
      .populate({
        path: 'business',
        select: 'brandInfo name email phoneNumber paymentMethod brandType pickUpAdress',
        options: { strictPopulate: false }
      })
      .populate('transactionReferences');

    if (!release) {
      return res.status(404).json({ error: 'Release not found' });
    }

    console.log('Release found:', {
      id: release._id,
      releaseId: release.releaseId,
      business: release.business ? 'populated' : 'not populated',
      businessId: release.business?._id || 'no business ID'
    });

    res.json({
      success: true,
      data: release
    });
  } catch (error) {
    console.error('Error fetching release details:', error);
    res.status(500).json({ error: 'Failed to fetch release details' });
  }
};

// ======================================== Financial Processing Management ======================================== //

// Get financial processing management page
const get_financialProcessingPage = (req, res) => {
  res.render('admin/financial-processing', {
    title: 'Financial Processing',
    page_title: 'Financial Processing Management',
    folder: 'Financial Management',
  });
};

// Run daily processing manually
const runDailyProcessing = async (req, res) => {
  try {
    console.log('Manual daily processing triggered by admin');
    await dailyOrderProcessing();
    res.json({ 
      success: true, 
      message: 'Daily processing completed successfully' 
    });
  } catch (error) {
    console.error('Error in manual daily processing:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to run daily processing',
      details: error.message 
    });
  }
};

// Get processing statistics
const getProcessingStatistics = async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await FinancialReconciliation.getProcessingStatistics(parseInt(days));
    res.json({ 
      success: true, 
      data: stats 
    });
  } catch (error) {
    console.error('Error getting processing statistics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get processing statistics' 
    });
  }
};

// Generate reconciliation report
const generateReconciliationReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: 'Start date and end date are required' 
      });
    }
    
    const report = await FinancialReconciliation.generateReconciliationReport(
      new Date(startDate), 
      new Date(endDate)
    );
    
    res.json({ 
      success: true, 
      data: report 
    });
  } catch (error) {
    console.error('Error generating reconciliation report:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to generate reconciliation report' 
    });
  }
};

// Reset orphaned processing flags
const resetOrphanedProcessingFlags = async (req, res) => {
  try {
    const { batchId } = req.query;
    const result = await FinancialReconciliation.resetOrphanedProcessingFlags(batchId);
    res.json({ 
      success: true, 
      data: result 
    });
  } catch (error) {
    console.error('Error resetting orphaned processing flags:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to reset orphaned processing flags' 
    });
  }
};

// Validate business balances
const validateBusinessBalances = async (req, res) => {
  try {
    const result = await FinancialReconciliation.validateBusinessBalances();
    res.json({ 
      success: true, 
      data: result 
    });
  } catch (error) {
    console.error('Error validating business balances:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to validate business balances' 
    });
  }
};

// Fix balance discrepancies
const fixBalanceDiscrepancies = async (req, res) => {
  try {
    const { validationResults } = req.body;
    
    if (!validationResults || !Array.isArray(validationResults)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Validation results array is required' 
      });
    }
    
    const result = await FinancialReconciliation.fixBalanceDiscrepancies(validationResults);
    res.json({ 
      success: true, 
      data: result 
    });
  } catch (error) {
    console.error('Error fixing balance discrepancies:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fix balance discrepancies' 
    });
  }
};

// Process specific orders manually
const processSpecificOrdersAdmin = async (req, res) => {
  try {
    const { orderIds, batchId } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Order IDs array is required' 
      });
    }
    
    await processSpecificOrders(orderIds, batchId);
    res.json({ 
      success: true, 
      message: `Successfully processed ${orderIds.length} orders` 
    });
  } catch (error) {
    console.error('Error processing specific orders:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process specific orders' 
    });
  }
};

// Recover failed processing
const recoverFailedProcessingAdmin = async (req, res) => {
  try {
    const { batchId } = req.query;
    await recoverFailedProcessing(batchId);
    res.json({ 
      success: true, 
      message: 'Recovery process completed successfully' 
    });
  } catch (error) {
    console.error('Error in recovery process:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to recover failed processing' 
    });
  }
};

// Get Transaction Details for Admin
const getTransactionDetails = async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    const transaction = await Transaction.findById(transactionId)
      .populate('business', 'name email phoneNumber brandInfo brandType pickUpAdress balance paymentMethod')
      .lean();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      transaction
    });
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transaction details'
    });
  }
};

// Get Detailed Transaction Information for Admin
const getDetailedTransactionInfo = async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    // Get transaction with all related data
    const transaction = await Transaction.findById(transactionId)
      .populate('business', 'name email phoneNumber brandInfo brandType pickUpAdress balance paymentMethod')
      .lean();

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: 'Transaction not found'
      });
    }

    // Get related orders
    let orders = [];
    if (transaction.orderReferences && transaction.orderReferences.length > 0) {
      const orderIds = transaction.orderReferences.map(ref => ref.orderId).filter(id => id);
      if (orderIds.length > 0) {
        orders = await Order.find({ _id: { $in: orderIds } })
          .populate('business', 'name brandInfo')
          .populate('deliveryMan', 'name phoneNumber')
          .lean();
      }
    }

    // Get related pickups
    let pickups = [];
    if (transaction.pickupReferences && transaction.pickupReferences.length > 0) {
      const pickupIds = transaction.pickupReferences.map(ref => ref.pickupId).filter(id => id);
      if (pickupIds.length > 0) {
        const Pickup = require('../models/pickup');
        pickups = await Pickup.find({ _id: { $in: pickupIds } })
          .populate('courierAssigned', 'name phoneNumber')
          .lean();
      }
    }


    res.json({
      success: true,
      data: {
        transaction,
        orders,
        pickups,
        business: transaction.business
      }
    });
  } catch (error) {
    console.error('Error fetching detailed transaction information:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch detailed transaction information'
    });
  }
};

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

  get_couriersFollowUp,
  get_courierDetailsPage,

  get_pickupsPage,
  get_pickups,
  get_pickupMenByZone,
  assignPickupMan,
  get_pickupDetailsPage,
  cancelPickup,
  deletePickup,
  get_pickedupOrders,

  // Stock Managment from Pickups
  get_stockManagementPage,
  add_to_stock,
  get_stock_orders,
  get_couriers_by_zone,
  assignCourierToStock,
  courier_received,

  // Stock Managment from Returns
  get_stockReturnsPage,
  getReturnedOrders,
  add_return_to_stock,
  assignCourierToReturn,
  assignCourierToReturnToBusiness,
  convertFailedDeliveryToReturn,
  getAllReturnOrders,
  getReturnOrderDetailsAdmin,
  updateReturnInspection,
  updateReturnProcessing,
  return_courier_received,

  // Wallet Overview
  get_releaseAmountsPage,
  get_releasesAllData,
  getReleaseDetails,
  rescheduleRelease,
  releaseFunds,

  get_businessesPage,

  // Tickets
  get_ticketsPage,
  // Logout
  logOut,
  getCourierTrackingPage,
  getCourierLocations,
  getCourierLocation,
  courierTracking
  ,adminRetryTomorrow
  ,adminRetryScheduled
  ,adminReturnToWarehouseFromWaiting
  ,adminCancelFromWaiting
  ,adminCancelOrder
  ,changeReturnCourier
  ,assignCourierToReturnToBusiness
  ,exportReleasesToExcel
  ,exportReleasesToPDF

  // Financial Processing Management
  ,get_financialProcessingPage
  ,runDailyProcessing
  ,getProcessingStatistics
  ,generateReconciliationReport
  ,resetOrphanedProcessingFlags
  ,validateBusinessBalances
  ,fixBalanceDiscrepancies
  ,processSpecificOrdersAdmin
  ,recoverFailedProcessingAdmin

  // Transaction Details Management
  ,getTransactionDetails
  ,getDetailedTransactionInfo
};
