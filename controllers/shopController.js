const ShopProduct = require('../models/shopProduct');
const ShopOrder = require('../models/shopOrder');
const User = require('../models/user');
const Courier = require('../models/courier');
const Admin = require('../models/admin');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ======================================== ADMIN - Product Management ======================================== //

// Get shop products management page
const getShopProductsPage = (req, res) => {
  res.render('admin/shop-products', {
    title: 'Shop Products',
    page_title: 'Shop Products Management',
    folder: 'Shop',
  });
};

// Get all products
const getProducts = async (req, res) => {
  try {
    const {
      category,
      isAvailable,
      search,
      sortBy = 'createdAt',
      order = 'desc',
    } = req.query;

    const query = {};

    if (category) {
      query.category = category;
    }

    if (isAvailable !== undefined) {
      query.isAvailable = isAvailable === 'true';
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }

    const sortOrder = order === 'desc' ? -1 : 1;
    const sortOptions = { [sortBy]: sortOrder };

    const products = await ShopProduct.find(query)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort(sortOptions);

    res.status(200).json(products);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
};

// Get single product
const getProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await ShopProduct.findById(id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.status(200).json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
};

// Create product
const createProduct = async (req, res) => {
  try {
    // Parse request body if it's a string (from form submission)
    let data = req.body;
    if (typeof req.body === 'string') {
      data = JSON.parse(req.body);
    }

    // Parse images from JSON string if needed
    let images = [];
    if (data.images) {
      // If images is a JSON string, parse it
      if (typeof data.images === 'string') {
        try {
          images = JSON.parse(data.images);
        } catch (e) {
          console.error('Error parsing images JSON:', e);
          images = [];
        }
      } else {
        // If images is already an array
        images = data.images;
      }
    }

    // Create product data object
    const productData = {
      ...data,
      createdBy: req.admin._id,
      images: images,
    };

    // Parse specifications if sent as JSON string
    if (typeof productData.specifications === 'string') {
      productData.specifications = JSON.parse(productData.specifications);
    }
    if (typeof productData.specificationsAr === 'string') {
      productData.specificationsAr = JSON.parse(productData.specificationsAr);
    }

    const product = new ShopProduct(productData);
    await product.save();

    res.status(201).json({
      message: 'Product created successfully',
      product,
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Failed to create product' });
  }
};

// Update product
const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Parse request body if it's a string (from form submission)
    let data = req.body;
    if (typeof req.body === 'string') {
      data = JSON.parse(req.body);
    }

    // Parse images from JSON string if needed
    let images = [];
    if (data.images) {
      // If images is a JSON string, parse it
      if (typeof data.images === 'string') {
        try {
          images = JSON.parse(data.images);
        } catch (e) {
          console.error('Error parsing images JSON:', e);
          images = [];
        }
      } else {
        // If images is already an array
        images = data.images;
      }
    }

    const updateData = {
      ...data,
      updatedBy: req.admin._id,
      images: images,
    };

    // Parse specifications if sent as JSON string
    if (typeof updateData.specifications === 'string') {
      updateData.specifications = JSON.parse(updateData.specifications);
    }
    if (typeof updateData.specificationsAr === 'string') {
      updateData.specificationsAr = JSON.parse(updateData.specificationsAr);
    }

    const product = await ShopProduct.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.status(200).json({
      message: 'Product updated successfully',
      product,
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({ error: 'Failed to update product' });
  }
};

// Delete product
const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await ShopProduct.findByIdAndDelete(id);

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Delete product images
    product.images.forEach((imagePath) => {
      const fullPath = path.join(__dirname, '..', 'public', imagePath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    });

    res.status(200).json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ error: 'Failed to delete product' });
  }
};

// Bulk update stock
const bulkUpdateStock = async (req, res) => {
  try {
    const { updates } = req.body; // Array of { productId, stock }

    const updatePromises = updates.map(async ({ productId, stock }) => {
      // Set isAvailable based on stock
      const isAvailable = stock > 0;

      // Find the product first
      const product = await ShopProduct.findById(productId);
      if (product) {
        // Log stock change
        console.log(
          `Updating product ${product.name} (${productId}) stock: ${product.stock} -> ${stock} (isAvailable: ${isAvailable})`
        );

        // Update with new values
        return ShopProduct.findByIdAndUpdate(
          productId,
          {
            stock,
            isAvailable,
            updatedBy: req.admin._id,
          },
          { new: true }
        );
      }
      return null;
    });

    const updatedProducts = await Promise.all(updatePromises);

    res.status(200).json({
      message: 'Stock updated successfully',
      updatedCount: updatedProducts.filter((p) => p !== null).length,
    });
  } catch (error) {
    console.error('Error updating stock:', error);
    res.status(500).json({ error: 'Failed to update stock' });
  }
};

// ======================================== ADMIN - Shop Orders Management ======================================== //

// Get shop orders management page
const getShopOrdersPage = (req, res) => {
  res.render('admin/shop-orders', {
    title: 'Shop Orders',
    page_title: 'Shop Orders Management',
    folder: 'Shop',
  });
};

// Get all shop orders
const getShopOrders = async (req, res) => {
  try {
    const { status, paymentStatus, business, courier, startDate, endDate } =
      req.query;

    const query = {};

    if (status) {
      query.status = status;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (business) {
      query.business = business;
    }

    if (courier) {
      query.courier = courier;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    const orders = await ShopOrder.find(query)
      .populate('business', 'brandInfo email phone')
      .populate('courier', 'name phone')
      .populate('items.product', 'name nameAr images')
      .sort({ createdAt: -1 });

    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching shop orders:', error);
    res.status(500).json({ error: 'Failed to fetch shop orders' });
  }
};

// Get single shop order
const getShopOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await ShopOrder.findById(id)
      .populate('business', 'brandInfo email phone')
      .populate('courier', 'name phone')
      .populate('items.product')
      .populate('trackingHistory.updatedBy', 'name');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.status(200).json(order);
  } catch (error) {
    console.error('Error fetching shop order:', error);
    res.status(500).json({ error: 'Failed to fetch shop order' });
  }
};

// Update shop order status
const updateShopOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, packagingDetails } = req.body;

    const order = await ShopOrder.findById(id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    order.status = status;
    order.updatedBy = req.admin._id;
    order.updatedByModel = 'Admin';

    if (notes) {
      order.adminNotes = notes;
    }

    if (packagingDetails) {
      order.packagingDetails = packagingDetails;
    }

    // Set specific timestamps
    if (status === 'ready') {
      order.estimatedDeliveryDate = new Date(
        Date.now() + 2 * 24 * 60 * 60 * 1000
      ); // 2 days
    }

    await order.save();

    res.status(200).json({
      message: 'Order status updated successfully',
      order,
    });
  } catch (error) {
    console.error('Error updating shop order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

// Assign courier to shop order
const assignCourierToShopOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { courierId } = req.body;

    const order = await ShopOrder.findById(id);

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const courier = await Courier.findById(courierId);

    if (!courier) {
      return res.status(404).json({ error: 'Courier not found' });
    }

    order.courier = courierId;
    order.courierName = courier.name;
    order.courierPhone = courier.phone;
    order.status = 'assigned';
    order.assignedAt = new Date();
    order.updatedBy = req.admin._id;
    order.updatedByModel = 'Admin';

    await order.save();

    res.status(200).json({
      message: 'Courier assigned successfully',
      order,
    });
  } catch (error) {
    console.error('Error assigning courier:', error);
    res.status(500).json({ error: 'Failed to assign courier' });
  }
};

// ======================================== BUSINESS - Shop Page ======================================== //

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
    const businessId = req.user._id;

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

    // Calculate delivery fee using the same logic as normal orders
    const { calculateOrderFee } = require('../utils/fees');
    const deliveryFee = calculateOrderFee(government, 'Deliver', false);

    // Create shop order
    const shopOrder = new ShopOrder({
      business: businessId,
      businessName: business.brandInfo.brandName,
      items: orderItems,
      subtotal,
      tax: totalTax,
      deliveryFee,
      totalAmount: subtotal + totalTax + deliveryFee,
      deliveryAddress: {
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

// Get business shop orders
const getBusinessShopOrders = async (req, res) => {
  try {
    const businessId = req.user._id;
    const { status } = req.query;

    const query = { business: businessId };

    if (status) {
      query.status = status;
    }

    const orders = await ShopOrder.find(query)
      .populate('items.product', 'name nameAr images')
      .populate('courier', 'name phone')
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
    const businessId = req.user._id;

    const order = await ShopOrder.findOne({ _id: id, business: businessId })
      .populate('items.product')
      .populate('courier', 'name phone')
      .populate('trackingHistory.updatedBy', 'name');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

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
    const businessId = req.user._id;

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

// ======================================== COURIER - Shop Orders ======================================== //

// Get courier shop orders page
const getCourierShopOrdersPage = (req, res) => {
  res.render('courier/shop-orders', {
    title: 'Shop Orders',
    page_title: 'Shop Deliveries',
    folder: 'Shop',
  });
};

// Get courier shop orders
const getCourierShopOrders = async (req, res) => {
  try {
    const courierId = req.courier._id;
    const { status } = req.query;

    const query = { courier: courierId };

    if (status) {
      query.status = status;
    }

    const orders = await ShopOrder.find(query)
      .populate('business', 'brandInfo phone')
      .populate('items.product', 'name nameAr images')
      .sort({ assignedAt: -1 });

    res.status(200).json(orders);
  } catch (error) {
    console.error('Error fetching courier shop orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
};

// Get courier shop order details
const getCourierShopOrderDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const courierId = req.courier._id;

    const order = await ShopOrder.findOne({ _id: id, courier: courierId })
      .populate('business', 'brandInfo phone email')
      .populate('items.product')
      .populate('trackingHistory.updatedBy', 'name');

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.status(200).json(order);
  } catch (error) {
    console.error('Error fetching order details:', error);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
};

// Update courier shop order status
const updateCourierShopOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, location, notes } = req.body;
    const courierId = req.courier._id;

    const order = await ShopOrder.findOne({ _id: id, courier: courierId });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Validate status transition
    const validTransitions = {
      assigned: ['picked_up'],
      picked_up: ['in_transit', 'returned'],
      in_transit: ['delivered', 'returned'],
    };

    if (!validTransitions[order.status]?.includes(status)) {
      return res.status(400).json({
        error: 'Invalid status transition',
      });
    }

    order.status = status;
    order.updatedBy = courierId;
    order.updatedByModel = 'Courier';

    if (status === 'picked_up') {
      order.pickedUpAt = new Date();
    } else if (status === 'delivered') {
      order.deliveredAt = new Date();
      order.paymentStatus = 'paid';
    }

    // Add location to tracking if provided
    if (location && order.trackingHistory.length > 0) {
      order.trackingHistory[order.trackingHistory.length - 1].location =
        location;
    }

    if (notes) {
      order.notes =
        (order.notes ? order.notes + '\n' : '') + `[Courier] ${notes}`;
    }

    await order.save();

    res.status(200).json({
      message: 'Order status updated successfully',
      order,
    });
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
};

module.exports = {
  // Admin - Products
  getShopProductsPage,
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkUpdateStock,

  // Admin - Shop Orders
  getShopOrdersPage,
  getShopOrders,
  getShopOrder,
  updateShopOrderStatus,
  assignCourierToShopOrder,

  // Business
  getBusinessShopPage,
  getAvailableProducts,
  createShopOrder,
  getBusinessShopOrdersPage,
  getBusinessShopOrders,
  getBusinessShopOrderDetails,
  cancelShopOrder,

  // Courier
  getCourierShopOrdersPage,
  getCourierShopOrders,
  getCourierShopOrderDetails,
  updateCourierShopOrderStatus,
};
