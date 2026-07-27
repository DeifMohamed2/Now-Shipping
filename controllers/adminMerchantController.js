const User = require('../models/user');
const mongoose = require('mongoose');

function isValidObjectId(id) {
  return id && /^[a-fA-F0-9]{24}$/.test(String(id));
}

/**
 * Toggle isCompanyAccount on a business (admin).
 */
const updateAccountType = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { isCompanyAccount } = req.body;

    if (!isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: 'Invalid business ID' });
    }

    const business = await User.findById(businessId);
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    if (isCompanyAccount === true && business.parentCompany) {
      return res.status(400).json({
        success: false,
        message: 'A merchant sub-account cannot be marked as a company account. Remove parent company first.',
      });
    }

    business.isCompanyAccount = Boolean(isCompanyAccount);
    if (business.isCompanyAccount) {
      business.parentCompany = null;
    }
    await business.save();

    return res.json({
      success: true,
      message: business.isCompanyAccount
        ? 'Account marked as company (integrator).'
        : 'Company account flag removed.',
      business: {
        id: business._id,
        isCompanyAccount: business.isCompanyAccount,
      },
    });
  } catch (error) {
    console.error('[adminMerchant] updateAccountType:', error);
    return res.status(500).json({ success: false, message: 'Failed to update account type' });
  }
};

/**
 * Assign or clear parent company on a merchant business (admin).
 */
const updateParentCompany = async (req, res) => {
  try {
    const { businessId } = req.params;
    const { parentCompanyId } = req.body;

    if (!isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: 'Invalid business ID' });
    }

    const business = await User.findById(businessId);
    if (!business) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    if (business.isCompanyAccount) {
      return res.status(400).json({
        success: false,
        message: 'Company accounts cannot be assigned to a parent company.',
      });
    }

    if (parentCompanyId === null || parentCompanyId === '' || parentCompanyId === undefined) {
      business.parentCompany = null;
      await business.save();
      return res.json({
        success: true,
        message: 'Parent company removed.',
        business: { id: business._id, parentCompany: null },
      });
    }

    if (!isValidObjectId(parentCompanyId)) {
      return res.status(400).json({ success: false, message: 'Invalid parent company ID' });
    }

    if (String(parentCompanyId) === String(businessId)) {
      return res.status(400).json({ success: false, message: 'Business cannot be its own parent.' });
    }

    const parent = await User.findById(parentCompanyId);
    if (!parent || !parent.isCompanyAccount) {
      return res.status(400).json({
        success: false,
        message: 'Parent must be an existing company account (isCompanyAccount = true).',
      });
    }

    business.parentCompany = parent._id;
    await business.save();

    return res.json({
      success: true,
      message: 'Parent company assigned.',
      business: {
        id: business._id,
        parentCompany: business.parentCompany,
        parentCompanyName: parent.name,
      },
    });
  } catch (error) {
    console.error('[adminMerchant] updateParentCompany:', error);
    return res.status(500).json({ success: false, message: 'Failed to update parent company' });
  }
};

/**
 * Search company accounts for admin typeahead.
 */
const searchCompanies = async (req, res) => {
  try {
    const q = (req.query.q || req.query.search || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const filter = {
      isCompanyAccount: true,
      isDeleted: { $ne: true },
      role: { $in: ['business', 'Business'] },
    };

    if (q) {
      const regex = new RegExp(q, 'i');
      filter.$or = [
        { name: regex },
        { email: regex },
        { businessAccountCode: regex },
        { 'brandInfo.brandName': regex },
      ];
      if (mongoose.Types.ObjectId.isValid(q)) {
        filter.$or.push({ _id: q });
      }
    }

    const companies = await User.find(filter)
      .sort({ name: 1 })
      .limit(limit)
      .select('name email brandInfo businessAccountCode isCompanyAccount');

    return res.json({
      success: true,
      companies: companies.map((c) => ({
        id: c._id,
        name: c.name,
        brandName: c.brandInfo?.brandName || null,
        businessAccountCode: c.businessAccountCode || null,
        email: c.email,
      })),
    });
  } catch (error) {
    console.error('[adminMerchant] searchCompanies:', error);
    return res.status(500).json({ success: false, message: 'Failed to search companies' });
  }
};

/**
 * List merchant sub-accounts for a company (admin view).
 */
const listCompanyMerchants = async (req, res) => {
  try {
    const { businessId } = req.params;
    if (!isValidObjectId(businessId)) {
      return res.status(400).json({ success: false, message: 'Invalid business ID' });
    }

    const company = await User.findById(businessId);
    if (!company) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    const merchants = await User.find({
      parentCompany: businessId,
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: -1 })
      .select('name email phoneNumber brandInfo businessAccountCode isCompleted isVerified createdAt');

    return res.json({
      success: true,
      company: {
        id: company._id,
        name: company.name,
        isCompanyAccount: company.isCompanyAccount,
      },
      merchants: merchants.map((m) => ({
        id: m._id,
        businessAccountCode: m.businessAccountCode,
        name: m.name,
        brandName: m.brandInfo?.brandName || null,
        email: m.email,
        phoneNumber: m.phoneNumber,
        isCompleted: m.isCompleted,
        isVerified: m.isVerified,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    console.error('[adminMerchant] listCompanyMerchants:', error);
    return res.status(500).json({ success: false, message: 'Failed to list merchants' });
  }
};

module.exports = {
  updateAccountType,
  updateParentCompany,
  searchCompanies,
  listCompanyMerchants,
};
