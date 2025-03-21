const Order = require('../models/order');
const Courier = require('../models/Courier');
const Pickup = require('../models/pickup');
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
    orders = await Order.find(query).populate('business', 'brandInfo');
    res.status(200).json(orders || []);
  } catch (error) {
    console.error('Error in orders:', error);
    res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}; 


const get_orderDetailsPage = async (req, res) => {
  const { orderNumber } = req.params;

  const order = await Order.findOne({ orderNumber }).populate('business');

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
    if (status === 'active') {
        couriers = await Courier.find({ isAvailable: true });
    } else if (status === 'inactive') {
        couriers = await Courier.find({ isAvailable: false });
    } else {
        couriers = await Courier.find({});
    }
    
    res.status(200).json(couriers || []);
}catch (error) { 
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
};
