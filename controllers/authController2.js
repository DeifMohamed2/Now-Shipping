const bcrypt = require('bcrypt');
const axios = require('axios');
const User = require('../models/user');
const Admin = require('../models/admin');
const Courier = require('../models/courier');
const crypto = require('crypto');
const OtpVerification = require('../models/OtpVerification');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,   
    auth: {
        user: 'deifm81@gmail.com',
        pass: 'wqxm esqo vfvh bsjl'
    }
});



//================================================= Landing Page =========================================================
const index = (req, res) => {
  res.render('landing/comingsoon', { title: 'Home', layout: 'layouts/layout-without-nav' });
};


const mobileAppPage = (req, res) => {
  res.render('landing/mobileApp', { title: 'Home', layout: 'layouts/layout-without-nav' });
};

const pricingPage = (req, res) => {
  res.render('landing/pricing', { title: 'Home', layout: 'layouts/layout-without-nav' });
};

const aboutusPage = (req, res) => {
  res.render('landing/aboutus', { title: 'Home', layout: 'layouts/layout-without-nav' });
};

const faqPage = (req, res) => {
  res.render('landing/faq', { title: 'Home', layout: 'layouts/layout-without-nav' });
};

const privacyPolicyPage = (req, res) => {
  res.render('landing/privacy-policy', { title: 'Privacy Policy', layout: 'layouts/layout-without-nav' });
};


//================================================= Authentication =========================================================

function sendVerificationEmail(user, token) {
    console.log(user.email);
  const mailOptions = {
    to: user.email,
    subject: 'Email Verification',
    html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="text-align: center; color: #333;">Email Verification</h2>
            <p style="font-size: 16px; color: #555;">Hello ${user.name},</p>
            <p style="font-size: 16px; color: #555;">Thank you for registering. Please click the button below to verify your email address:</p>
            <div style="text-align: center; margin: 20px 0;">
                <a href="http://localhost:6098/verify-email?token=${token}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-size: 16px;">Verify Email</a>
            </div>
            <p style="font-size: 16px; color: #555;">If you did not create an account, no further action is required.</p>
            <p style="font-size: 16px; color: #555;">Regards,<br>Your Company</p>
            </div>
        `,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log(error);
    } else {
      console.log('Email sent: ' + info.response);
    }
  });
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
    return res.render('auth/login', {
      title: 'Login',
      layout: 'layouts/layout-without-nav',
      message: req.flash('message'),
      error: req.flash('error'),
    });
};

const adminLogin = (req, res) => {
    return res.render('auth/admin-login', {
      title: 'Admin Login',
      layout: 'layouts/layout-without-nav',
        message: req.flash('message'),
        error: req.flash('error'),
    });
};

const registerPage = (req, res) => {
    return res.render('auth/register', {
      title: 'Register',
      layout: 'layouts/layout-without-nav',
      message: req.flash('message'),
      error: req.flash('error'),
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
    !storageCheck ||
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

  if (!phoneNumber || !/^\d{11}$/.test(phoneNumber)) {
    return res.status(400).json({ message: 'Invalid phone number' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

  // Clear old OTPs
  await OtpVerification.deleteMany({ phoneNumber });

  // Save hashed OTP
  await OtpVerification.create({ phoneNumber, otpHash });

  // Format phone number to international
  const internationalNumber = `20${phoneNumber.slice(1)}`; // Eg. "01123456789" -> "201123456789"

  const smsMessage = `Your NowShipping verification code is: ${otp}`;

  try {
    // const response = await axios.post(
    //   'https://bulk.whysms.com/api/v3/sms/send',
    //   {
    //     recipient: internationalNumber,
    //     sender_id: 'WhySMS Test', 
    //     type: 'plain',
    //     message: smsMessage,
    //   },
    //   {
    //     headers: {
    //       Authorization:
    //         'Bearer 555|eouTObaho6DFjDs5S9mLojMI4lNi7VDmqMLMRcrKe5373dd8',
    //       'Content-Type': 'application/json',
    //       Accept: 'application/json',
    //     },
    //   }
    // );

    // const data = response.data;

    // if (data.status !== 'success') {
    //   console.error('WhySMS API error:', data);
    //   return res.status(500).json({ message: 'Failed to send OTP via SMS' });
    // }

    return res.status(200).json({ message: `OTP sent successfully: ${otp}` });
  } catch (err) {
    console.error('SMS error:', err.response?.data || err.message);
    return res.status(500).json({ message: 'SMS service error' });
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
    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Please fill all the fields',
      });
    }

    // Check if the user exists in the User collection
    let user = await User.findOne({ email });
    let role = 'Business';

    // If not found, check in the Courier collection
    if (!user) {
      user = await Courier.findOne({ email });
      role = 'Courier';
    }

    // If still not found, return an error
    if (!user) {
      return res.status(400).json({
        status: 'error',
        message: 'Email or password is incorrect',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        status: 'error',
        message: 'Email or password is incorrect',
      });
    }

    const token = jwt.sign(
      { userId: user._id, role },
      process.env.JWT_SECRET,
      {
        expiresIn: '1d',
      }
    );

    res.cookie('token', token, {
      httpOnly: true,
    });

    if(role === 'Courier') {
      return res.status(200).json({
        status: 'success',
        message: 'Login successful',
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role,
        },
      });
    }else{
      res.status(200).json({
        status: 'success',
        message: 'Login successful',
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role,
          isCompleted: user.isCompleted,
        },
      });
    }


  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: 'An error occurred',
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
        console.log('email:', email);
        console.log('password :', password);
        if (!email || !password) {
            return res.status(400).json({
                status: 'error',
                message: 'Please fill all the fields',
            });
        }

        const admin = await Admin.findOne({ email, role: 'admin' });
        if (!admin) {
          return res.status(400).json({
            status: 'error',
            message: 'Email or password is incorrect',
          });
        }

        const isMatch = await bcrypt.compare(password, admin.password);

        if (!isMatch) {
            return res.status(400).json({
                status: 'error',
                message: 'Email or password is incorrect',
            });
        }

        const token = jwt.sign({ adminId: admin._id }, process.env.JWT_SECRET, {
          expiresIn: '1d',
        });

        res.cookie('token', token, {
            httpOnly: true,
        });

        res.status(200).json({
          status: 'success',
          user: {
            id: admin._id,
            name: admin.name,
            email: admin.email,
            role: admin.role,
            isNeedStorage: admin.isNeedStorage,
          },
        });
    } catch (err) {
        res.status(500).json({
            status: 'error',
            message: 'An error occurred',
        });
    }
};

const courierLogin = (req, res) => {
    return res.render('auth/courier-login', {
      title: 'Courier Login',
      layout: 'layouts/layout-without-nav',
        message: req.flash('message'),
        error: req.flash('error'),
    });
}

const loginAsCourier  = async (req, res) => {
    const { email, password } = req.body;
    try{
    if (!email || !password) {
        return res.status(400).json({
            status: 'error',
            message: 'Please fill all the fields'
        });
    }

    const courier = await Courier.findOne({ email });

    if (!courier) {
        return res.status(400).json({
            status: 'error',
            message: 'Email or password is incorrect'
        });
    }

    const isMatch = await bcrypt.compare(password, courier.password);

    if (!isMatch) {
        return res.status(400).json({
            status: 'error',
            message: 'Email or password is incorrect'
        });
    }

    const token = jwt.sign({ id: courier._id, userType: 'courier' }, process.env.JWT_SECRET, {
        expiresIn: '1d'
    });

    res.cookie('token', token, {
        httpOnly: true
    });


    console.log('token:', token);
    res.status(200).json({
        status: 'success',
        token: token,
        user: {
            id: courier._id,
            name: courier.name,
            email: courier.email,
            role: 'courier',
        }
    });

}
catch(err){
    console.error('Error in loginAsCourier:', err);
    res.status(500).json({
        status: 'error',
        message: 'An error occurred'
    });
}
}


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