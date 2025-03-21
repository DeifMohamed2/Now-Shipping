const Order = require('../models/order');
const Courier = require('../models/Courier');
const Pickup = require('../models/pickup');
const User = require('../models/user');


const getDashboardPage = (req, res) => {
    res.render('courier/dashboard', {
        title: "Dashboard",
        page_title: 'Dashboard',
        folder: 'Pages'
    
    });
    
}


//=============================================== Orders =============================================== //
const get_ordersPage = (req, res) => {
    res.render('courier/orders', {
        title: "Orders",
        page_title: 'Orders',
        folder: 'Pages'
    
    });
    
}


const get_orders = async(req, res) => {
    const { courierId } = req
    try {
        const orders = await Order.find({ deliveryMan: courierId })
        .populate('deliveryMan')
        .populate('business')
        .exec();
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }

    
}


//=============================================== PickUps =============================================== //

const get_pickupsPage = (req, res) => {
    res.render('courier/pickups', {
        title: "Pickups",
        page_title: 'Pickups',
        folder: 'Pages'
    
    });
    
}


const get_pickups = async(req, res) => {
    const { courierId } = req
    try {
        const pickups = await Pickup.find({ assignedDriver: courierId })
          .populate('assignedDriver')
          .populate('business')
          .exec();
        res.status(200).json(pickups);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }

    
}


const get_pickupDetailsPage = async(req, res) => {
    const { pickupNumber } = req.params;
    try {
        const pickup = await Pickup .findOne({
            pickupNumber: pickupNumber
        })
        .populate('assignedDriver')
        .populate('business')
        .exec();
        res.render('courier/courier-pickup-details', {
          title: 'Pickup Details',
          page_title: 'Pickup Details',
          folder: 'Pages',
          pickup: pickup,
        });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }

}


module.exports = {
  getDashboardPage,
  get_ordersPage,
  get_orders,

  get_pickupsPage,
  get_pickups,
  get_pickupDetailsPage,
};