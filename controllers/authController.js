const bcrypt = require('bcrypt');
const axios = require('axios');
const User = require('../models/user');
const Admin = require('../models/admin');
const Courier = require('../models/courier');
const crypto = require('crypto');
const OtpVerification = require('../models/OtpVerification');
const PasswordResetOtp = require('../models/PasswordResetOtp');
const PasswordResetSession = require('../models/PasswordResetSession');
const jwt = require('jsonwebtoken');
const sms = require('../utils/sms');
const { emailService } = require('../utils/email');
const Order = require('../models/order');

// Transporter moved to centralized emailService



//================================================= Landing Page =========================================================
const index = (req, res) => {
  const lang = req.query.lang || req.cookies.language || 'en';
  res.render('landing/index', { 
    title: 'Home', 
    layout: 'layouts/layout-without-nav',
    currentLang: lang
  });
};


const mobileAppPage = (req, res) => {
  const lang = req.query.lang || req.cookies.language || 'en';
  res.render('landing/mobileApp', { 
    title: 'Mobile App', 
    layout: 'layouts/layout-without-nav',
    currentLang: lang
  });
};

const pricingPage = (req, res) => {
  const lang = req.query.lang || req.cookies.language || 'en';
  res.render('landing/pricing', { 
    title: 'Pricing', 
    layout: 'layouts/layout-without-nav',
    currentLang: lang
  });
};

const aboutusPage = (req, res) => {
  const lang = req.query.lang || req.cookies.language || 'en';
  res.render('landing/aboutus', { 
    title: 'About Us', 
    layout: 'layouts/layout-without-nav',
    currentLang: lang
  });
};

const faqPage = (req, res) => {
  const lang = req.query.lang || req.cookies.language || 'en';
  res.render('landing/faq', { 
    title: 'FAQ', 
    layout: 'layouts/layout-without-nav',
    currentLang: lang
  });
};

const privacyPolicyPage = (req, res) => {
  const lang = req.query.lang || req.cookies.language || 'en';
  res.render('landing/privacy-policy', { 
    title: 'Privacy Policy', 
    layout: 'layouts/layout-without-nav',
    currentLang: lang
  });
};

/** Public order tracking (search + /t/:orderNumber for WhatsApp links) */
const trackingPage = async (req, res) => {
  const lang = req.query.lang || req.cookies.language || 'en';
  const fromParam = (req.params.orderNumber || '').trim();
  const fromQuery = (req.query.q || req.query.order || '').toString().trim();
  const raw = fromParam || fromQuery;
  const orderNumber = raw
    ? decodeURIComponent(raw).replace(/[^\w\-]/g, '')
    : '';

  let orderData = null;
  let trackingError = null;

  if (orderNumber) {
    try {
      const order = await Order.findOne({
        $or: [{ orderNumber }, { smartFlyerBarcode: orderNumber }],
      })
        .populate('business', 'name brandInfo')
        .populate('deliveryMan', 'name phoneNumber')
        .lean();

      if (!order) {
        trackingError = 'not_found';
      } else {
        const cust = order.orderCustomer || {};
        const full = (cust.fullName || '').trim();
        const firstName = full.split(/\s+/)[0] || 'Customer';

        const showCourier =
          order.orderStatus === 'headingToCustomer' &&
          order.deliveryMan &&
          typeof order.deliveryMan === 'object';

        orderData = {
          orderNumber: order.orderNumber,
          smartFlyerBarcode: order.smartFlyerBarcode || null,
          orderStatus: order.orderStatus,
          statusCategory: order.statusCategory || null,
          orderDate: order.orderDate,
          completedDate: order.completedDate || null,
          orderStatusHistory: (order.orderStatusHistory || [])
            .slice()
            .sort((a, b) => new Date(b.date) - new Date(a.date)),
          orderShipping: {
            productDescription: order.orderShipping?.productDescription || '',
            numberOfItems: order.orderShipping?.numberOfItems,
            orderType: order.orderShipping?.orderType || 'Deliver',
            amountType: order.orderShipping?.amountType,
            amount: order.orderShipping?.amount,
            isExpressShipping: !!order.orderShipping?.isExpressShipping,
          },
          orderCustomer: {
            firstName,
            government: cust.government || '',
            zone: cust.zone || '',
          },
          businessName:
            order.business?.brandInfo?.brandName ||
            order.business?.name ||
            null,
          deliveryMan: showCourier
            ? {
                name: order.deliveryMan.name,
                phoneNumber: order.deliveryMan.phoneNumber,
              }
            : null,
        };
      }
    } catch (e) {
      console.error('trackingPage:', e.message);
      trackingError = 'server';
    }
  }

  const host = req.get('host') || '';
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').toString().split(',')[0].trim();
  const trackingShareUrl =
    orderData && host
      ? `${proto}://${host}/t/${encodeURIComponent(orderData.orderNumber)}`
      : orderData
        ? `/t/${encodeURIComponent(orderData.orderNumber)}`
        : null;

  return res.render('landing/tracking', {
    title: 'Track Order',
    layout: 'layouts/layout-without-nav',
    currentLang: lang,
    orderData,
    trackingError,
    searchedNumber: orderNumber || null,
    trackingShareUrl,
  });
};

const comingSoonPage = (req, res) => {
  const lang = req.query.lang || req.cookies.language || 'en';
  res.render('landing/comingsoon', {
    title: 'Coming Soon',
    layout: 'layouts/layout-without-nav',
    currentLang: lang,
  });
};


//================================================= Authentication =========================================================

async function sendVerificationEmail(user, token) {
  try {
    await emailService.sendVerificationEmail(user, token);
  } catch (e) {
    console.log('Verification email send failed:', e.message);
  }
}

const EMAIL_VERIFIED_STATUSES = new Set(['success', 'invalid', 'expired', 'error']);

const verifyEmailBytoken = async (req, res) => {
    const token = req.query.token;
    if (!token || typeof token !== 'string' || token.length > 128) {
        return res.redirect('/email-verified?status=invalid');
    }
    try {
        const user = await User.findOne({ verificationToken: token });
        if (!user) {
            return res.redirect('/email-verified?status=invalid');
        }

        if (user.verifyEmail(token)) {
            await user.save();
            return res.redirect('/email-verified?status=success');
        }

        return res.redirect('/email-verified?status=expired');
    } catch (err) {
        console.error('verifyEmailBytoken:', err);
        return res.redirect('/email-verified?status=error');
    }
};

/** Public result page after clicking the email verification link (works without a session). */
const emailVerifiedPage = (req, res) => {
    const lang = req.query.lang || req.cookies.language || 'en';
    const raw = (req.query.status || '').toString().toLowerCase();
    const status = EMAIL_VERIFIED_STATUSES.has(raw) ? raw : 'invalid';

    let sessionContinue = null;
    if (status === 'success' && req.cookies.token) {
        try {
            const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
            const role = (decoded.role || '').toString();
            if (decoded.userId && /^business$/i.test(role)) {
                sessionContinue = { href: '/business/dashboard' };
            }
        } catch (_) {
            /* not a valid business session */
        }
    }

    const ev = (res.locals.translation && res.locals.translation.auth && res.locals.translation.auth.emailVerified) || {};
    const titleMap = {
        success: ev.pageTitleSuccess || 'Email verified',
        invalid: ev.pageTitleInvalid || 'Verification link',
        expired: ev.pageTitleExpired || 'Link expired',
        error: ev.pageTitleError || 'Something went wrong',
    };

    return res.render('auth/email-verified', {
        title: titleMap[status] || titleMap.invalid,
        layout: 'layouts/layout-without-nav',
        currentLang: lang,
        verificationStatus: status,
        sessionContinue,
        translation: res.locals.translation,
    });
};

const loginPage = (req, res) => {
    const lang = req.query.lang || req.cookies.language || 'en';
    return res.render('auth/login', {
      title: 'Login',
      layout: 'layouts/layout-without-nav',
      message: req.flash('message'),
      error: req.flash('error'),
      currentLang: lang,
      translation: res.locals.translation // Ensure translation is passed
    });
};

const adminLogin = (req, res) => {
    const lang = req.query.lang || req.cookies.language || 'en';
    return res.render('auth/admin-login', {
      title: 'Admin Login',
      layout: 'layouts/layout-without-nav',
        message: req.flash('message'),
        error: req.flash('error'),
        currentLang: lang,
        translation: res.locals.translation // Ensure translation is passed
    });
};

const registerPage = (req, res) => {
    const lang = req.query.lang || req.cookies.language || 'en';
    return res.render('auth/register', {
      title: 'Register',
      layout: 'layouts/layout-without-nav',
      message: req.flash('message'),
      error: req.flash('error'),
      currentLang: lang,
      translation: res.locals.translation // Ensure translation is passed
    });
};

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEmailKey(email) {
  return String(email || '').trim().toLowerCase();
}

async function findBusinessUserByEmailInput(emailInput) {
  const key = normalizeEmailKey(emailInput);
  if (!key) return null;
  return User.findOne({
    email: new RegExp(`^${escapeRegex(key)}$`, 'i'),
    role: { $regex: /^business$/i },
  });
}

const forgotPasswordPage = (req, res) => {
  const lang = req.query.lang || req.cookies.language || 'en';
  return res.render('auth/forgot-password', {
    title: res.locals.translation?.auth?.forgotPassword?.pageTitle || 'Forgot password',
    layout: 'layouts/layout-without-nav',
    currentLang: lang,
    translation: res.locals.translation,
  });
};

const forgotPasswordSendOtp = async (req, res) => {
  const rawEmail = req.body && req.body.email;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!rawEmail || !emailRegex.test(String(rawEmail).trim())) {
    return res.status(400).json({
      status: 'error',
      message: 'Please enter a valid email address',
    });
  }

  const emailKey = normalizeEmailKey(rawEmail);
  const genericOk = {
    status: 'success',
    message:
      'If an account exists for this email, a verification code has been sent.',
  };

  try {
    const user = await findBusinessUserByEmailInput(rawEmail);
    if (!user) {
      return res.status(200).json(genericOk);
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    await PasswordResetOtp.deleteMany({ email: emailKey });
    await PasswordResetOtp.create({ email: emailKey, otpHash });

    const businessName =
      (user.brandInfo && user.brandInfo.brandName && String(user.brandInfo.brandName).trim()) ||
      (user.name && String(user.name).trim()) ||
      'Now Shipping';

    await emailService.sendPasswordResetOtp(user.email, otp, businessName);

    return res.status(200).json(genericOk);
  } catch (err) {
    console.error('forgotPasswordSendOtp:', err);
    try {
      await PasswordResetOtp.deleteMany({ email: emailKey });
    } catch (_) {
      /* ignore */
    }
    return res.status(500).json({
      status: 'error',
      message: 'Could not send email. Please try again later.',
    });
  }
};

const forgotPasswordVerifyOtp = async (req, res) => {
  const { email, otp } = req.body || {};
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || !otp) {
    return res.status(400).json({
      status: 'error',
      message: 'Please fill all the fields',
    });
  }

  if (!emailRegex.test(String(email).trim())) {
    return res.status(400).json({
      status: 'error',
      message: 'Please enter a valid email address',
    });
  }

  const emailKey = normalizeEmailKey(email);

  try {
    const record = await PasswordResetOtp.findOne({ email: emailKey });
    if (!record) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired verification code',
      });
    }

    const hash = crypto.createHash('sha256').update(String(otp).trim()).digest('hex');
    if (hash !== record.otpHash) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired verification code',
      });
    }

    const user = await findBusinessUserByEmailInput(email);
    if (!user) {
      await PasswordResetOtp.deleteOne({ _id: record._id });
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired verification code',
      });
    }

    await PasswordResetOtp.deleteOne({ _id: record._id });
    await PasswordResetSession.deleteMany({ email: emailKey });

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    await PasswordResetSession.create({ email: emailKey, tokenHash });

    return res.status(200).json({
      status: 'success',
      message: 'Code verified. You can set your new password.',
      resetToken,
    });
  } catch (err) {
    console.error('forgotPasswordVerifyOtp:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Something went wrong. Please try again.',
    });
  }
};

const forgotPasswordReset = async (req, res) => {
  const { resetToken, newPassword } = req.body || {};

  if (!resetToken || !newPassword) {
    return res.status(400).json({
      status: 'error',
      message: 'Please fill all the fields',
    });
  }

  if (String(newPassword).length < 8) {
    return res.status(400).json({
      status: 'error',
      message: 'Password must be at least 8 characters',
    });
  }

  const tokenHash = crypto.createHash('sha256').update(String(resetToken).trim()).digest('hex');

  try {
    const session = await PasswordResetSession.findOne({ tokenHash });
    if (!session) {
      return res.status(400).json({
        status: 'error',
        message: 'This reset link has expired. Please start again.',
      });
    }

    const user = await findBusinessUserByEmailInput(session.email);
    if (!user) {
      await PasswordResetSession.deleteOne({ _id: session._id });
      return res.status(400).json({
        status: 'error',
        message: 'This reset link has expired. Please start again.',
      });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    await PasswordResetSession.deleteOne({ _id: session._id });

    return res.status(200).json({
      status: 'success',
      message: 'Your password has been updated. You can sign in now.',
    });
  } catch (err) {
    console.error('forgotPasswordReset:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Something went wrong. Please try again.',
    });
  }
};

const signup = async (req, res) => {
  const { email, fullName, password, phoneNumber, storageCheck, termsCheck ,otp } =
    req.body;

  if (
    !email ||
    !password ||
    !fullName ||
    !phoneNumber ||
    !termsCheck ||
    !otp
  ) {
    return res.status(400).json({
      status: 'error',
      message: 'Please fill all the fields',
    });
  }

  const isOTPVerified = await verifyOTP(phoneNumber, otp);
  console.log('isOTPVerified:', isOTPVerified);
  if (!isOTPVerified){
     return res.status(400).json({
       status: 'error',
       message: 'OTP is incorrect or expired',
     });
  }


    try {
      // 🔍 Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({
          status: 'error',
          message: 'This email is already registered with us.',
        });
      }

      const [phoneUsedUser, phoneUsedCourier] = await Promise.all([
        User.findOne({ phoneNumber }),
        Courier.findOne({ phoneNumber }),
      ]);
      if (phoneUsedUser || phoneUsedCourier) {
        return res.status(400).json({
          status: 'error',
          message: 'This phone number is already registered with us.',
        });
      }

      // ✅ Proceed to create new user
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = new User({
        email,
        password: hashedPassword,
        name: fullName,
        phoneNumber,
        role: 'Business',
        isNeedStorage: !!storageCheck,
      });

      const verificationToken = user.generateVerificationToken();

      await user.save(); // ✅ only once

      // 📧 Send verification email after successful save
      sendVerificationEmail(user, verificationToken);

      res.status(201).json({
        status: 'success',
        message: 'User created successfully',
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isNeedStorage: user.isNeedStorage,
        },
      });
    } catch (error) {
      console.error('Signup Error:', error);
      let errorMessage = 'An error occurred';

      if (error.code === 11000) {
        const dupField = error.keyValue && Object.keys(error.keyValue)[0];
        errorMessage =
          dupField === 'phoneNumber'
            ? 'This phone number is already registered with us.'
            : 'This email is already registered with us.';
      } else if (error.name === 'ValidationError') {
        errorMessage = 'Validation error';
      }

      res.status(400).json({
        status: 'error',
        message: errorMessage,
      });
    }
};

const sendOTP = async (req, res) => {
  const { phoneNumber } = req.body;

  console.log('\n========== OTP SEND REQUEST ==========');
  console.log('Received phone number:', phoneNumber);

  if (!phoneNumber || !/^\d{11}$/.test(phoneNumber)) {
    console.error('❌ Invalid phone number format:', phoneNumber);
    return res.status(400).json({ message: 'Invalid phone number' });
  }

  const [phoneTakenUser, phoneTakenCourier] = await Promise.all([
    User.findOne({ phoneNumber }),
    Courier.findOne({ phoneNumber }),
  ]);
  if (phoneTakenUser || phoneTakenCourier) {
    return res.status(400).json({
      message: 'This phone number is already registered. Please use a different number.',
    });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
  console.log('✅ OTP generated:', otp);
  console.log('✅ OTP hash created');

  try {
    // Clear old OTPs
    console.log('🗑️  Clearing old OTPs for:', phoneNumber);
    await OtpVerification.deleteMany({ phoneNumber });
    console.log('✅ Old OTPs cleared');

    // Save hashed OTP
    console.log('💾 Saving OTP to database...');
    await OtpVerification.create({ phoneNumber, otpHash });
    console.log('✅ OTP saved to database');

    // Format phone number to international
    const internationalNumber = `20${phoneNumber.slice(1)}`; // Eg. "01123456789" -> "201123456789"
    console.log('📱 Formatted international number:', internationalNumber);

    const smsMessage = `Your NowShipping verification is: ${otp}`;
    console.log('📧 SMS message prepared:', smsMessage);

    console.log('📤 Attempting to send SMS...');
    const smsResult = await sms.sendSms({ 
      recipient: internationalNumber, 
      message: smsMessage 
    });
    
    console.log('✅ SMS sent successfully!');
    console.log('SMS API Response:', JSON.stringify(smsResult, null, 2));
    console.log('======================================\n');

    return res.status(200).json({ 
      message: `OTP sent successfully to ${phoneNumber}`,
      otp: otp // Remove this in production
    });
    
  } catch (err) {
    console.error('\n❌ ========== SMS SEND FAILED ==========');
    console.error('Error type:', err.constructor.name);
    console.error('Error message:', err.message);
    
    if (err.details) {
      console.error('Error details:', JSON.stringify(err.details, null, 2));
    }
    
    if (err.response) {
      console.error('Error response status:', err.response.status);
      console.error('Error response data:', JSON.stringify(err.response.data, null, 2));
    }
    
    if (err.stack) {
      console.error('Error stack trace:', err.stack);
    }
    
    // Clean up the OTP from database since SMS failed
    console.log('🗑️  Cleaning up OTP from database due to SMS failure...');
    try {
      await OtpVerification.deleteMany({ phoneNumber });
      console.log('✅ OTP cleaned up from database');
    } catch (cleanupErr) {
      console.error('❌ Failed to cleanup OTP:', cleanupErr.message);
    }
    
    console.error('======================================\n');
    
    return res.status(500).json({ 
      message: 'Failed to send SMS. Please try again or contact support.',
      error: err.message,
      details: err.details || 'No additional details available'
    });
  }
};

const verifyOTP = async (phoneNumber, otp) => { 

  if (!phoneNumber || !otp) {
    return false
  }

  const record = await OtpVerification.findOne({ phoneNumber });
  if (!record) {
    return false
  }

  const hash = crypto.createHash('sha256').update(otp).digest('hex');
  if (hash !== record.otpHash) {
    return false
  }

  await OtpVerification.deleteOne({ _id: record._id });


  return true
};


const login = async (req, res) => {
  const { email, password } = req.body;
  
  try {
    // Input validation (field is still `email` for clients; may hold email or phone)
    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Please fill all the fields',
      });
    }

    const identifier = String(email).trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const digitsOnly = identifier.replace(/\D/g, '');
    const isPhone = digitsOnly.length === 11 && /^\d{11}$/.test(digitsOnly);
    if (!isPhone && !emailRegex.test(identifier)) {
      return res.status(400).json({
        status: 'error',
        message: 'Please enter a valid email address or 11-digit phone number',
      });
    }

    // Use Promise.all to check both collections simultaneously for better performance
    const [businessUser, courierUser] = isPhone
      ? await Promise.all([
          User.findOne({ phoneNumber: digitsOnly }).select('+password'),
          Courier.findOne({ phoneNumber: digitsOnly }).select('+password'),
        ])
      : await Promise.all([
          User.findOne({ email: identifier }).select('+password'),
          Courier.findOne({ email: identifier }).select('+password'),
        ]);

    let user = businessUser || courierUser;
    let role = businessUser ? 'Business' : 'Courier';

    // If no user found, return error
    if (!user) {
      return res.status(400).json({
        status: 'error',
        message: 'Email, phone number, or password is incorrect',
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        status: 'error',
        message: 'Email, phone number, or password is incorrect',
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, role },
      process.env.JWT_SECRET,
      { expiresIn: '365d' }
    );

    // Set secure cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 365 * 24 * 60 * 60 * 1000 // 365 days
    });

    // Prepare user data (exclude password)
    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      role,
    };
    if (user.phoneNumber) {
      userData.phoneNumber = user.phoneNumber;
    }

    // Add role-specific data
    if (role === 'Business') {
      userData.isCompleted = user.isCompleted;
    }

    return res.status(200).json({
      status: 'success',
      message: 'Login successful',
      token,
      user: userData
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'An error occurred during login',
    });
  }
};


const createAdminAccount = async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({
            status: 'error',
            message: 'Please fill all the fields',
        });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = new Admin({
        name,
        email,
        password: hashedPassword,
    });

    admin.save()
        .then((admin) => {
            res.status(201).json({
                status: 'success',
                admin: {
                    id: admin._id,
                    name: admin.name,
                    email: admin.email,
                    role: admin.role,
                },
            });
        })
        .catch((err) => {
            console.log(err);
            let errorMessage = 'An error occurred';
            if (err.code === 11000) {
                errorMessage = 'This Email is already registered with us';
            } else if (err.name === 'ValidationError') {
                errorMessage = 'Validation error';
            }
            res.status(400).json({
                status: 'error',
                message: errorMessage,
            });
        });

}

const loginAsAdmin = async (req, res) => {
    const { email, password } = req.body;
    
    try {
        // Input validation
        if (!email || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Please fill all the fields',
            });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: 'error',
                message: 'Please enter a valid email address',
            });
        }

        // Find admin with password field
        const admin = await Admin.findOne({ email, role: 'admin' }).select('+password');
        
        if (!admin) {
            return res.status(400).json({
                status: 'error',
                message: 'Email or password is incorrect',
            });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(400).json({
                status: 'error',
                message: 'Email or password is incorrect',
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { adminId: admin._id, role: 'admin' }, 
            process.env.JWT_SECRET, 
            { expiresIn: '1d' }
        );

        // Set secure cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 24 * 60 * 60 * 1000 // 1 day
        });

        return res.status(200).json({
            status: 'success',
            message: 'Login successful',
            token,
            user: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
                isNeedStorage: admin.isNeedStorage,
            },
        });
    } catch (err) {
        console.error('Admin login error:', err);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred during login',
        });
    }
};

/** Courier web login page removed — mobile app + POST /api/v1/auth/courier-login (JWT). */
const courierLogin = (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(410).json({
      status: 'deprecated',
      code: 'COURIER_WEB_LOGIN_REMOVED',
      message:
        'Courier web login is discontinued. Use the mobile app, or POST /api/v1/auth/courier-login with JSON { email, password } to receive a JWT for /api/v1/courier.',
    });
  }
  return res.redirect(302, '/mobileApp');
};

const loginAsCourier = async (req, res) => {
    const { email, password } = req.body;
    
    try {
        // Input validation
        if (!email || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Please fill all the fields'
            });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: 'error',
                message: 'Please enter a valid email address'
            });
        }

        // Find courier with password field
        const courier = await Courier.findOne({ email }).select('+password');

        if (!courier) {
            return res.status(400).json({
                status: 'error',
                message: 'Email or password is incorrect'
            });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, courier.password);
        if (!isMatch) {
            return res.status(400).json({
                status: 'error',
                message: 'Email or password is incorrect'
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: courier._id, userType: 'courier' }, 
            process.env.JWT_SECRET, 
            { expiresIn: '365d' }
        );

        // Set secure cookie
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 365 * 24 * 60 * 60 * 1000 // 365 days
        });

        return res.status(200).json({
            status: 'success',
            message: 'Login successful',
            token,
            user: {
                id: courier._id,
                name: courier.name,
                email: courier.email,
                role: 'courier',
            }
        });

    } catch (err) {
        console.error('Courier login error:', err);
        return res.status(500).json({
            status: 'error',
            message: 'An error occurred during login'
        });
    }
};


// request for onther verification





module.exports = {
  //Landing Page
  index,
  mobileAppPage,
  pricingPage,
  aboutusPage,
  faqPage,
  privacyPolicyPage,
  trackingPage,
  comingSoonPage,
  //Auth
  loginPage,
  adminLogin,
  registerPage,
  signup,
  login,
  verifyEmailBytoken,
  emailVerifiedPage,
  sendOTP,
  createAdminAccount,
  loginAsAdmin,

  courierLogin,
  loginAsCourier,

  forgotPasswordPage,
  forgotPasswordSendOtp,
  forgotPasswordVerifyOtp,
  forgotPasswordReset,
};