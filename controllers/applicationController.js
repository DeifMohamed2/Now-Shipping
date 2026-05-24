const MerchantApplication = require('../models/merchantApplication');
const {
  PRODUCT_TYPES,
  MONTHLY_ORDERS,
  STATUSES,
} = require('../models/merchantApplication');

const PHONE_REGEX = /^01[0-9]{9}$/;

function normalizePhone(raw) {
  return String(raw || '')
    .trim()
    .replace(/\s/g, '');
}

function buildStatsAggregation() {
  return MerchantApplication.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);
}

function statsFromRows(rows) {
  const stats = {
    total: 0,
    new: 0,
    contacted: 0,
    qualified: 0,
    rejected: 0,
    converted: 0,
  };
  rows.forEach((row) => {
    if (stats[row._id] !== undefined) {
      stats[row._id] = row.count;
    }
    stats.total += row.count;
  });
  return stats;
}

const submitLandingApplication = async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const phone = normalizePhone(req.body.phone);
    const storeName = String(req.body.storeName || '').trim();
    const productType = String(req.body.productType || '').trim();
    const monthlyOrders = String(req.body.monthlyOrders || '').trim();

    if (!fullName || fullName.length < 2) {
      return res.status(400).json({ success: false, message: 'Invalid full name' });
    }
    if (!PHONE_REGEX.test(phone)) {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }
    if (!storeName || storeName.length < 2) {
      return res.status(400).json({ success: false, message: 'Invalid store name' });
    }
    if (!PRODUCT_TYPES.includes(productType)) {
      return res.status(400).json({ success: false, message: 'Invalid product type' });
    }
    if (!MONTHLY_ORDERS.includes(monthlyOrders)) {
      return res.status(400).json({ success: false, message: 'Invalid monthly orders range' });
    }

    const doc = await MerchantApplication.create({
      fullName,
      phone,
      storeName,
      productType,
      monthlyOrders,
      source: 'landing',
      meta: {
        ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim(),
        userAgent: (req.headers['user-agent'] || '').slice(0, 512),
      },
    });

    return res.status(201).json({ success: true, id: doc._id });
  } catch (err) {
    console.error('submitLandingApplication:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getApplicationsPage = (req, res) => {
  res.render('admin/applications', {
    title: 'Applications',
    page_title: 'Applications',
    folder: 'Pages',
  });
};

const getApplications = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      productType,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const query = {};

    if (search && String(search).trim()) {
      const re = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { fullName: re },
        { phone: re },
        { storeName: re },
      ];
    }

    if (status && STATUSES.includes(status)) {
      query.status = status;
    }

    if (productType && PRODUCT_TYPES.includes(productType)) {
      query.productType = productType;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const allowedSort = ['createdAt', 'fullName', 'storeName', 'status'];
    const sortField = allowedSort.includes(sortBy) ? sortBy : 'createdAt';
    const sort = { [sortField]: sortOrder === 'asc' ? 1 : -1 };

    const [applications, total, statsRows] = await Promise.all([
      MerchantApplication.find(query)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .populate('reviewedBy', 'name email')
        .lean(),
      MerchantApplication.countDocuments(query),
      buildStatsAggregation(),
    ]);

  return res.json({
      success: true,
      applications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
      stats: statsFromRows(statsRows),
    });
  } catch (err) {
    console.error('getApplications:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getApplicationById = async (req, res) => {
  try {
    const app = await MerchantApplication.findById(req.params.id)
      .populate('reviewedBy', 'name email')
      .lean();

    if (!app) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    return res.json({ success: true, application: app });
  } catch (err) {
    console.error('getApplicationById:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const updateApplication = async (req, res) => {
  try {
    const { status, adminNotes } = req.body || {};
    const update = {};

    if (status !== undefined) {
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status' });
      }
      update.status = status;
      update.reviewedBy = req.adminId;
      update.reviewedAt = new Date();
    }

    if (adminNotes !== undefined) {
      update.adminNotes = String(adminNotes).trim().slice(0, 2000);
      if (!update.reviewedAt) {
        update.reviewedBy = req.adminId;
        update.reviewedAt = new Date();
      }
    }

    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    const app = await MerchantApplication.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: true }
    )
      .populate('reviewedBy', 'name email')
      .lean();

    if (!app) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    return res.json({ success: true, application: app });
  } catch (err) {
    console.error('updateApplication:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  submitLandingApplication,
  getApplicationsPage,
  getApplications,
  getApplicationById,
  updateApplication,
};
