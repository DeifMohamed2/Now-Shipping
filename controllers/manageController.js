const getDashboardPage = (req, res) => {
    res.render('manage/dashboard', {
        title: "Dashboard",
        page_title: 'Dashboard',
        folder: 'Pages'
    
    });
    
}

const get_ordersPage = (req, res) => {
    res.render('manage/orders', {
        title: "Orders",
        page_title: 'Orders',
        folder: 'Pages'
    
    });
    
}

const get_pickupsPage = (req, res) => {
    res.render('manage/pickups', {
        title: "Pickups",
        page_title: 'Pickups',
        folder: 'Pages'
    
    });
    
}

module.exports = {
    getDashboardPage,
    get_ordersPage,
    get_pickupsPage
}