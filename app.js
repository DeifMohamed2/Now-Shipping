require('dotenv').config();
const mongoose = require('mongoose');
mongoose.set('strictQuery', false);
const express = require('express');
const app = express();
const path = require('path');
const http = require('http');
const server = http.createServer(app);
const socketController = require('./controllers/socketController');

// Initialize Firebase Admin SDK
require('./config/firebase');

// Initialize Socket.IO
socketController.initializeSocket(server);

// Web Routes
const adminRouter = require('./routes/web/adminRoutes');
const courierRouter = require('./routes/web/courierRoutes');
const businessRouter = require('./routes/web/businessRoutes');
const manageRouter = require('./routes/web/manageRoutes');
const authRouter = require('./routes/web/authRoutes');

// Mobile Routes
const AuthRouterApi = require('./routes/api/v1/auth');
const businessRouterApi = require('./routes/api/v1/business');
const assistantRouterApi = require('./routes/api/v1/assistant');
const courierRouterApi = require('./routes/api/v1/courier');

// Import jobs
const { dailyOrderProcessing } = require('./jobs/dailyOrderProcessing');
const releasesProccessing = require('./jobs/releasesProccessing');

// dailyOrderProcessing();
// releasesProccessing();

const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const upload = require('express-fileupload');

const flash = require('connect-flash');
var i18n = require('i18n-express');
var bodyParser = require('body-parser');
const {
  languageMiddleware,
  handleLanguageSwitch,
} = require('./middleware/languageMiddleware');
var urlencodeParser = bodyParser.urlencoded({
  extended: true,
});
app.use(urlencodeParser);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(upload());

app.use(express.json());
app.use(
  session({
    resave: false,
    saveUninitialized: true,
    secret: 'nodedemo',
  })
);
app.use(cookieParser());

app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) {
    app.set('layout', 'layouts/admin-layout');
  } else if (req.path.startsWith('/courier')) {
    app.set('layout', 'layouts/courier-layout');
  } else if (req.path.startsWith('/business')) {
    app.set('layout', 'layouts/layout');
  } else {
    // No layout is set for paths that don't match the specified prefixes
  }
  next();
});
app.use(expressLayouts);
app.use(flash());

app.use(express.static(__dirname + '/public'));

// Language middleware
app.use(languageMiddleware);
app.use(handleLanguageSwitch);

/* ---------for Local database connection---------- */
const DB = process.env.DATABASE_URL;

// Connect to database first, then start server
mongoose
  .connect(DB)
  .then((con) => {
    console.log('DB connection successfully..!');

    // Start server after successful database connection
    server.listen(process.env.PORT, () =>
      console.log(`Server running on port ${process.env.PORT}`)
    );
  })
  .catch((err) => {
    console.error('Database connection failed:', err);
    process.exit(1);
  });

// for i18 use
app.use(
  i18n({
    translationsPath: path.join(__dirname, 'i18n'), // <--- use here. Specify translations files path.
    siteLangs: ['ar', 'ch', 'en', 'fr', 'ru', 'it', 'gr', 'sp'],
    textsVarName: 'translation',
  })
);

app.use((err, req, res, next) => {
  let error = {
    err,
  };
  if (error.name === 'JsonWebTokenError') {
    err.message = 'please login again';
    err.statusCode = 401;
    return res.status(401).redirect('views/auth/login');
  }
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'errors';

  res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
  });
});

// Define All Route
app.use('/', authRouter);
app.use('/admin', adminRouter);
app.use('/business', businessRouter);
app.use('/manage', manageRouter);
app.use('/courier', courierRouter);

// Emergency FCM token cleanup route (public, no auth required)
const notificationController = require('./controllers/notificationController');
app.get('/emergency-cleanup/:courierId', notificationController.emergencyCleanupCourier);

// Mobile app routes V1
app.use('/api/v1/auth', AuthRouterApi);
app.use('/api/v1/business', businessRouterApi);
app.use('/api/v1/assistant', assistantRouterApi);
app.use('/api/v1/courier', courierRouterApi);

// Catch-all 404 handler (use app.use to avoid path-to-regexp parsing issues)
app.use(function (req, res) {
  res.status(404);
  res.locals = {
    title: 'Error 404',
  };
  res.render('auth/auth-404', {
    layout: 'layouts/layout-without-nav',
  });
});

// Server is now started inside the mongoose.connect().then() callback
