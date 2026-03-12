const bcrypt = require('bcrypt');
const axios = require('axios');
const User = require('../models/user');
const Admin = require('../models/admin');
const Courier = require('../models/courier');
const crypto = require('crypto');
const OtpVerification = require('../models/OtpVerification');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const sms = require('../utils/sms');
const { emailService } = require('../utils/email');

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


//================================================= Authentication =========================================================

async function sendVerificationEmail(user, token) {
  try {
    await emailService.sendVerificationEmail(user, token);
  } catch (e) {
    console.log('Verification email send failed:', e.message);
  }
}

const verifyEmailBytoken = async (req, res) => {
    const token = req.query.token;
    try {
        const user = await User.findOne({ verificationToken: token });
        if (!user) {
            return res.status(400).redirect('/business/dashboard');
        }

        if (user.verifyEmail(token)) {
            await user.save();
            return res.status(200).redirect('/business/dashboard');
        }

        return res.status(400).redirect('/business/dashboard');

    } catch (err) {
        res.status(500).json({
            status: 'error',
            message: 'An error occurred'
        });
    }
}

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
}

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
        errorMessage = 'This email is already registered with us.';
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

    const smsMessage = `Your NowShipping verification code is: ${otp}`;
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

    // Use Promise.all to check both collections simultaneously for better performance
    const [businessUser, courierUser] = await Promise.all([
      User.findOne({ email }).select('+password'),
      Courier.findOne({ email }).select('+password')
    ]);

    let user = businessUser || courierUser;
    let role = businessUser ? 'Business' : 'Courier';

    // If no user found, return error
    if (!user) {
      return res.status(400).json({
        status: 'error',
        message: 'Email or password is incorrect',
      });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        status: 'error',
        message: 'Email or password is incorrect',
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
      role
    };

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

const courierLogin = (req, res) => {
    const lang = req.query.lang || req.cookies.language || 'en';
    return res.render('auth/courier-login', {
      title: 'Courier Login',
      layout: 'layouts/layout-without-nav',
        message: req.flash('message'),
        error: req.flash('error'),
        currentLang: lang,
        translation: res.locals.translation // Ensure translation is passed
    });
}

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
  //Auth
  loginPage,
  adminLogin,
  registerPage,
  signup,
  login,
  verifyEmailBytoken,
  sendOTP,
  createAdminAccount,
  loginAsAdmin,

  courierLogin,
  loginAsCourier,

};