const bcrypt = require('bcrypt');
const User = require('../models/user');
const Admin = require('../models/admin');
const Courier = require('../models/Courier');
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



// index 
const index = (req, res) => {
  res.render('index', { title: 'Home', layout: 'layouts/layout-without-nav' });
};







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
  const { email, fullName, password, phoneNumber, storageCheck, termsCheck } =
    req.body;

  if (
    !email ||
    !password ||
    !fullName ||
    !phoneNumber ||
    !storageCheck ||
    !termsCheck
  ) {
    return res.status(400).json({
      status: 'error',
      message: 'Please fill all the fields',
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



const login = async (req, res) => {
    const { email, password } = req.body;
try{
    if (!email || !password) {
        return res.status(400).json({
            status: 'error',
            message: 'Please fill all the fields'
        });
    }

    const user = await User.findOne({ email });
    if (!user) {
        return res.status(400).json({
            status: 'error',
            message: 'Email or password is incorrect'
        });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        return res.status(400).json({
            status: 'error',
            message: 'Email or password is incorrect'
        });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: '1d'
    });

    res.cookie('token', token, {
        httpOnly: true
    });
    
    

    res.status(200).json({
        status: 'success',
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            isNeedStorage: user.isNeedStorage
        }
    });
}catch(err){
        res.status(500).json({
            status: 'error',
            message: 'An error occurred'
        });
    }

}



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

    const token = jwt.sign({ courierId: courier._id }, process.env.JWT_SECRET, {
        expiresIn: '1d'
    });

    res.cookie('token', token, {
        httpOnly: true
    });

    res.status(200).json({
        status: 'success',
        user: {
            id: courier._id,
            name: courier.name,
            email: courier.email,
            role: courier.role,
            isNeedStorage: courier.isNeedStorage
        }
    });

}
catch(err){
    res.status(500).json({
        status: 'error',
        message: 'An error occurred'
    });
}
}


// request for onther verification





module.exports = {
  index,
  loginPage,
  adminLogin,
  registerPage,
  signup,
  login,
  verifyEmailBytoken,
  createAdminAccount,
  loginAsAdmin,

  courierLogin,
  loginAsCourier,

};