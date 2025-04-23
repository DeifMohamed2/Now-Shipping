const Order = require('../models/order');
const Courier = require('../models/courier');
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
        folder: 'Pages',
        
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


const get_orderDetailsPage = async(req, res) => {
    const { orderNumber } = req.params;
    const { courierId } = req;
    try {
        const order = await Order.findOne({ orderNumber: orderNumber, deliveryMan: courierId })
          .populate('deliveryMan')
            .populate('business')
            .exec();
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.render('courier/order-details', {
            title: 'Order Details',
            page_title: 'Order Details',
            folder: 'Pages',
            order: order,
        });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }

}


const completeOrder = async (req, res) => {
    const { orderNumber } = req.params;
    const { courierId } = req;
    try {
        const order = await Order.findOne({ orderNumber: orderNumber, deliveryMan: courierId });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (['completed', 'canceled', 'rejected', 'returned', 'terminated'].includes(order.orderStatus)) {
            return res.status(400).json({ message: `Order is ${order.orderStatus === 'completed' ? 'already delivered' : order.orderStatus}` });
        }

        if (!['inStock','headingToCustomer','headingToYou'].includes(order.orderStatus)) {
            return res.status(400).json({ message: `Order status ${order.orderStatus} is not valid for completion` });
        }
        order.orderStatus = 'completed';

        if(order.orderStages.length === 4){
            order.orderStages.push({
                stageName: 'completed',
                stageDate: new Date(),
                stageNotes: [
                    { text: `Order completed by courier ${req.courierData.name}`, date: new Date() },
                ],
            });
        }

        await order.save();
        res.status(200).json({ message: 'Order completed successfully' });
    } catch (error) {
        console.log(error.message);
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
           .sort({createdAt:-1})
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
        res.render('courier/pickup-details', {
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


const get_picked_up_orders = async (req, res) => {
  const { pickupNumber } = req.params;
  const { courierId } = req;
  try {
    const pickup = await Pickup.findOne({
      pickupNumber: pickupNumber,
      assignedDriver: courierId,
    })
      .populate('assignedDriver')
      .populate('business')
      .populate({
        path: 'ordersPickedUp',
        populate: { path: 'deliveryMan business' },
      })
      .exec();
    if (!pickup) {
      return res.status(404).json({ message: 'Pickup not found' });
    }
    res.status(200).json({ orders: pickup.ordersPickedUp });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getAndSet_orderDetails = async (req, res) => {
    const { orderNumber, pickupNumber } = req.params;
    const { courierId } = req;
    try {
        console.log(orderNumber, pickupNumber);
        const pickup = await Pickup.findOne({ pickupNumber: pickupNumber })
          .populate('assignedDriver')
          .populate('business')
          .populate({
            path: 'ordersPickedUp',
            populate: { path: 'deliveryMan business' },
          })
          .exec();

        if (!pickup) {
            return res.status(404).json({ message: 'Pickup not found' });
        }

        if(pickup.ordersPickedUp.length === pickup.numberOfOrders){
            return res.status(400).json({ message: 'Maximum number of orders reached for this pickup' });
        }

        if(pickup.picikupStatus === 'pickedUp'|| pickup.picikupStatus === 'completed' || pickup.picikupStatus === 'inStock' || pickup.picikupStatus === 'canceled' || pickup.picikupStatus === 'rejected'){
            return res.status(400).json({ message: 'You cannot add a pickup order at this moment.' });
        }

        if (pickup.assignedDriver._id.toString() !== courierId) {
            return res
                .status(403)
                .json({ message: 'You are not authorized to view this order' });
        }

        const order = await Order.findOne({
            orderNumber: orderNumber,
            business: pickup.business,
        })
            .populate('deliveryMan')
            .populate('business')
            .exec();

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (!pickup.ordersPickedUp.includes(order._id)) {
            pickup.ordersPickedUp.push(order._id);
        }
        await pickup.save();
        const populatedPickup = await Pickup.findOne({ pickupNumber: pickupNumber })
            .populate('assignedDriver')
            .populate('business')
            .populate({
                path: 'ordersPickedUp',
                populate: { path: 'deliveryMan business' },
            })
            .exec();

        res.status(200).json({ orders: populatedPickup.ordersPickedUp, message: 'Order picked up successfully' });
    } catch (error) {
        console.log(error.message);
        if (error.name === 'ValidationError' && error.errors.ordersPickedUp) {
            res.status(400).json({ message: 'Order is already picked up' });
        } else {
            res.status(500).json({ message: error.message });
        }
    }
};




const removePickedUpOrder = async (req, res) => {
    const { orderNumber, pickupNumber } = req.params;
    const { courierId } = req;
    try {
        const pickup = await Pickup
          .findOne({ pickupNumber: pickupNumber , assignedDriver: courierId })
          .populate('assignedDriver')
          .populate('business')
          .exec();
        if (!pickup) {
            return res.status(404).json({ message: 'Pickup not found' });
        }
        const order = await Order.findOne({ orderNumber: orderNumber, business: pickup.business })
        .populate('deliveryMan')
        .populate('business')
        .exec();

        if(pickup.picikupStatus === 'pickedUp'|| pickup.picikupStatus === 'completed' || pickup.picikupStatus === 'inStock' || pickup.picikupStatus === 'canceled' || pickup.picikupStatus === 'rejected' || pickup.picikupStatus === 'returned' || pickup.picikupStatus === 'terminated'){
            return res.status(400).json({ message: 'You Cannot delete it at this moment' });
        }


        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        if (!pickup.ordersPickedUp.includes(order._id)) {
            return res.status(400).json({ message: 'Order is not picked up' });
        }

        const index = pickup.ordersPickedUp.indexOf(order._id);
        pickup.ordersPickedUp.splice(index, 1);
        // order.orderStatus = 'new';
        // order.orderStages = order.orderStages.filter(
        //   (stage) => stage.stageName !== 'pickedUp'
        // );
        await pickup.save();
        // await order.save();
        res.status(200).json({ message: 'Order removed successfully' });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }

}


const completePickup = async (req, res) => {
    const { pickupNumber } = req.params;
    const { courierId } = req;
    try {
        const pickup = await Pickup.findOne({ pickupNumber: pickupNumber, assignedDriver: courierId })
            .populate('assignedDriver')
            .populate('business')
            .populate({ path: 'ordersPickedUp', populate: { path: 'deliveryMan business' } })
            .exec();
        if (!pickup) {
            return res.status(404).json({ message: 'Pickup not found' });
        }

        if (pickup.picikupStatus === 'canceled') {
            return res.status(400).json({ message: 'Pickup is canceled' });
        }

        if (pickup.picikupStatus === 'rejected') {
            return res.status(400).json({ message: 'Pickup is already rejected' });
        }

        if (pickup.picikupStatus === 'completed') {
            return res.status(400).json({ message: 'Pickup is already completed' });
        }

        if (pickup.picikupStatus === 'inStock') {
            return res.status(400).json({ message: 'Pickup is in stock' });
        }

        if (pickup.picikupStatus === 'pickedUp') {
            return res.status(400).json({ message: 'Pickup is already Completed' });
        }

        if (pickup.ordersPickedUp.length === 0) {
            return res.status(400).json({ message: 'No orders picked up' });
        }


        pickup.picikupStatus = 'pickedUp';

        if(pickup.pickupStages.length === 2){
            pickup.pickupStages.push({
                stageName: 'pickedUp',
                stageDate: new Date(),
                stageNotes: [
                    { text: `Order picked up by courier ${req.courierData.name}`, date: new Date() },
                ],
            });
        }

        for (const order of pickup.ordersPickedUp) {
             order.orderStatus = 'pickedUp';
             if (order.orderStages.length === 1) {
               order.orderStages.push({
                 stageName: 'pickedUp',
                 stageDate: new Date(),
                 stageNotes: [
                   {
                     text: `Order picked up by courier ${req.courierData.name}`,
                     date: new Date(),
                   },
                 ],
               });
             }
            await order.save();
        }
        

        await pickup.save();

        res.status(200).json({ message: 'Pickup completed successfully' });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }

}



const logOut = (req, res) => {
  req.session.destroy();
  res.clearCookie('token');
  res.redirect('/courier-login');
}


module.exports = {
  getDashboardPage,
  get_ordersPage,
  get_orders,
  get_orderDetailsPage,
  completeOrder,

  get_pickupsPage,
  get_pickups,
  get_pickupDetailsPage,
  getAndSet_orderDetails,
  get_picked_up_orders,
  removePickedUpOrder,
  completePickup,
  logOut,
};