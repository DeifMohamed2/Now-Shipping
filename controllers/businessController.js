const getDashboardPage = (req, res) => {
  res.render('business/dashboard' , {
    title: "Dashboard",
    page_title: 'Overview',
    folder: 'Pages'
   
  });
};

const get_ordersPage = (req, res) => {
  res.render('business/orders' , {
    title: "Orders",
    page_title: 'Orders',
    folder: 'Pages'
   
  });
};

const get_createOrderPage = (req, res) => {
  res.render('business/create-order' , {
    title: "Create Order",
    page_title: 'Create Order',
    folder: 'Pages'
   
  });
}

const get_pickupPage = (req, res) => {
  res.render('business/pickup' , {
    title: "Pickup",
    page_title: 'Pickup',
    folder: 'Pages'
   
  });
  
}


const get_walletOverviewPage  = (req, res) => {
  res.render('business/wallet-overview' , {
    title: "Wallet Overview",
    page_title: 'Wallet Overview',
    folder: 'Pages'
   
  });
}

const get_walletTransactionsPage = (req, res) => {
  res.render('business/wallet-transactions' , {
    title: "Wallet Transaction",
    page_title: 'Wallet Transaction',
    folder: 'Pages'
   
  });
}


const get_shopPage = (req, res) => {
  res.render('business/shop' , {
    title: "Shop",
    page_title: 'Shop',
    folder: 'Pages'
   
  });
  
}


const get_orderDetailsPage = (req, res) => {
  res.render('business/order-details' , {
    title: "Order Details",
    page_title: 'Order Details',
    folder: 'Pages'
   
  });
  
}

const get_pickupDetailsPage = (req, res) => {
  res.render('business/pickup-details' , {
    title: "Pickup Details",
    page_title: 'Pickup Details',
    folder: 'Pages'
   
  });
  
}


module.exports = {
  getDashboardPage,
  get_ordersPage,
  get_createOrderPage,
  get_pickupPage,
  get_walletOverviewPage,
  get_walletTransactionsPage,
  get_shopPage,
  get_orderDetailsPage,
  get_pickupDetailsPage,
};
