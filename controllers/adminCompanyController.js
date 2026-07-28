const mongoose = require('mongoose');
const User = require('../models/user');
const Order = require('../models/order');
const Pickup = require('../models/pickup');
const merchantService = require('../services/merchantService');
const businessPricingService = require('../utils/businessPricingService');
const { activeBusinessRoleFilter } = require('../utils/businessRoleQuery');

function isValidObjectId(id) {
  return id && /^[a-fA-F0-9]{24}$/.test(String(id));
}

function companyDisplayName(user) {
  return user.brandInfo?.brandName || user.name || 'Company';
}

async function aggregateStatsForBusinessIds(businessIds) {
  if (!businessIds.length) {
    return {
      totalOrders: 0,
      completedOrders: 0,
      totalPickups: 0,
      successRate: 0,
      revenue: 0,
    };
  }

  const objectIds = businessIds.map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id)
  );

  const [orderStats, pickupCount, revenueAgg] = await Promise.all([
    Order.aggregate([
      { $match: { business: { $in: objectIds } } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$statusCategory', 'SUCCESSFUL'] }, 1, 0] },
          },
        },
      },
    ]),
    Pickup.countDocuments({ business: { $in: objectIds } }),
    Order.aggregate([
      { $match: { business: { $in: objectIds } } },
      {
        $group: {
          _id: null,
          revenue: {
            $sum: { $ifNull: ['$feeBreakdown.total', '$orderFees'] },
          },
        },
      },
    ]),
  ]);

  const totalOrders = orderStats[0]?.totalOrders || 0;
  const completedOrders = orderStats[0]?.completedOrders || 0;
  const revenue = revenueAgg[0]?.revenue || 0;
  const successRate =
    totalOrders > 0 ? parseFloat(((completedOrders / totalOrders) * 100).toFixed(1)) : 0;

  return {
    totalOrders,
    completedOrders,
    totalPickups: pickupCount,
    successRate,
    revenue: Math.round(revenue * 100) / 100,
  };
}

async function enrichSubBusinessWithStats(merchant) {
  const stats = await aggregateStatsForBusinessIds([merchant._id]);
  return {
    id: merchant._id,
    businessAccountCode: merchant.businessAccountCode || null,
    externalMerchantId: merchant.externalMerchantId || null,
    name: merchant.name,
    brandName: merchant.brandInfo?.brandName || null,
    email: merchant.email,
    phoneNumber: merchant.phoneNumber,
    isCompleted: merchant.isCompleted,
    isVerified: merchant.isVerified,
    createdAt: merchant.createdAt,
    stats,
  };
}

const get_companiesPage = (req, res) => {
  res.render('admin/companies', {
    title: 'Companies',
    page_title: 'Companies',
    folder: 'Pages',
  });
};

const get_companyDetailsPage = async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!isValidObjectId(companyId)) {
      return res.status(404).render('auth/auth-404', {
        title: '404',
        page_title: 'Company Not Found',
        folder: 'Pages',
      });
    }

    const company = await User.findOne({
      _id: companyId,
      isCompanyAccount: true,
      isDeleted: { $ne: true },
    })
      .select('name brandInfo businessAccountCode')
      .lean();

    if (!company) {
      return res.status(404).render('auth/auth-404', {
        title: '404',
        page_title: 'Company Not Found',
        folder: 'Pages',
      });
    }

    res.render('admin/company-details', {
      title: companyDisplayName(company),
      page_title: 'Company Details',
      folder: 'Pages',
      companyId: company._id.toString(),
    });
  } catch (error) {
    console.error('[adminCompany] get_companyDetailsPage:', error);
    return res.status(500).render('auth/auth-404', {
      title: 'Error',
      page_title: 'Error',
      folder: 'Pages',
    });
  }
};

const get_companies = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const query = {
      ...activeBusinessRoleFilter(),
      isCompanyAccount: true,
      isDeleted: { $ne: true },
    };

    if (search && String(search).trim()) {
      const searchRegex = new RegExp(String(search).trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { businessAccountCode: searchRegex },
        { 'brandInfo.brandName': searchRegex },
      ];
    }

    const totalCount = await User.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalCount / limitNum));
    const skip = (pageNum - 1) * limitNum;

    const computedSortFields = new Set(['subAccountCount', 'totalOrders', 'successRate', 'revenue']);
    const useComputedSort = computedSortFields.has(sortBy);

    let companies;
    if (useComputedSort) {
      companies = await User.find(query).select('-password').lean();
    } else {
      const sort = {};
      if (sortBy === 'name') {
        sort['brandInfo.brandName'] = sortOrder === 'desc' ? -1 : 1;
        sort.name = sortOrder === 'desc' ? -1 : 1;
      } else {
        sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
      }
      companies = await User.find(query).select('-password').sort(sort).skip(skip).limit(limitNum).lean();
    }

    const enriched = await Promise.all(
      companies.map(async (company) => {
        const merchants = await User.find({
          parentCompany: company._id,
          isDeleted: { $ne: true },
        })
          .select('_id')
          .lean();
        const merchantIds = merchants.map((m) => m._id);
        const stats = await aggregateStatsForBusinessIds(merchantIds);
        return {
          id: company._id,
          name: company.name,
          brandName: company.brandInfo?.brandName || null,
          email: company.email,
          phoneNumber: company.phoneNumber,
          businessAccountCode: company.businessAccountCode || null,
          isVerified: company.isVerified,
          createdAt: company.createdAt,
          subAccountCount: merchantIds.length,
          stats,
        };
      })
    );

    let companiesWithStats = enriched;
    if (useComputedSort) {
      const dir = sortOrder === 'asc' ? 1 : -1;
      companiesWithStats = [...enriched].sort((a, b) => {
        let av;
        let bv;
        if (sortBy === 'subAccountCount') {
          av = a.subAccountCount;
          bv = b.subAccountCount;
        } else {
          av = a.stats?.[sortBy] ?? 0;
          bv = b.stats?.[sortBy] ?? 0;
        }
        return (av - bv) * dir;
      });
      companiesWithStats = companiesWithStats.slice(skip, skip + limitNum);
    }

    res.status(200).json({
      companies: companiesWithStats,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        limit: limitNum,
      },
    });
  } catch (error) {
    console.error('[adminCompany] get_companies:', error);
    res.status(500).json({ success: false, error: 'Failed to load companies' });
  }
};

const get_companyDetails = async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!isValidObjectId(companyId)) {
      return res.status(400).json({ success: false, error: 'Invalid company ID' });
    }

    const company = await User.findOne({
      _id: companyId,
      isCompanyAccount: true,
      isDeleted: { $ne: true },
    })
      .select('-password')
      .lean();

    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    const merchants = await User.find({
      parentCompany: companyId,
      isDeleted: { $ne: true },
    })
      .select(
        'name email phoneNumber brandInfo businessAccountCode externalMerchantId isCompleted isVerified createdAt'
      )
      .lean();

    const subBusinesses = await Promise.all(merchants.map(enrichSubBusinessWithStats));
    subBusinesses.sort((a, b) => (b.stats.totalOrders || 0) - (a.stats.totalOrders || 0));

    const merchantIds = merchants.map((m) => m._id);
    const rollupStats = await aggregateStatsForBusinessIds(merchantIds);

    let pricingSummary = null;
    try {
      const pricingPayload = await businessPricingService.getBusinessPricing(companyId);
      pricingSummary = pricingPayload.customPricing;
    } catch {
      pricingSummary = null;
    }

    res.status(200).json({
      success: true,
      company: {
        id: company._id,
        name: company.name,
        brandName: company.brandInfo?.brandName || null,
        email: company.email,
        phoneNumber: company.phoneNumber,
        businessAccountCode: company.businessAccountCode || null,
        isVerified: company.isVerified,
        createdAt: company.createdAt,
      },
      rollupStats: {
        ...rollupStats,
        subAccountCount: merchantIds.length,
      },
      pricingSummary,
      subBusinesses,
    });
  } catch (error) {
    console.error('[adminCompany] get_companyDetails:', error);
    res.status(500).json({ success: false, error: 'Failed to load company details' });
  }
};

const createCompanyMerchant = async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!isValidObjectId(companyId)) {
      return res.status(400).json({ success: false, error: 'Invalid company ID' });
    }

    const company = await User.findOne({
      _id: companyId,
      isCompanyAccount: true,
      isDeleted: { $ne: true },
    });

    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }

    const result = await merchantService.createMerchantForCompany(company, req.body || {});
    if (!result.ok) {
      return res.status(result.status || 400).json({
        success: false,
        code: result.code || 'VALIDATION_ERROR',
        error: result.error,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Sub-business onboarded successfully.',
      merchant: result.merchant,
    });
  } catch (error) {
    console.error('[adminCompany] createCompanyMerchant:', error);
    res.status(500).json({ success: false, error: 'Failed to create sub-business' });
  }
};

module.exports = {
  get_companiesPage,
  get_companyDetailsPage,
  get_companies,
  get_companyDetails,
  createCompanyMerchant,
};
