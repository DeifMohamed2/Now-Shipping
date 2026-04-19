const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Courier = require('../../models/courier.js');
const jwtSecret = process.env.JWT_SECRET;

const courierController = require('../../controllers/courierController.js');

async function authenticateCourier(req, res, next) {
  const token = req.cookies.token;
  if (!token) {
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    return res.status(401).redirect('/mobileApp');
  }

  try {
    const decode = jwt.verify(token, jwtSecret);
    req.courierId = decode.id;
    const courier = await Courier.findOne({ _id: decode.id });
    if (!courier) {
      res.clearCookie('token');
      if (
        req.headers.accept &&
        req.headers.accept.includes('application/json')
      ) {
        return res
          .status(401)
          .json({ message: 'Invalid authentication token' });
      }
      return res.status(401).redirect('/mobileApp');
    }
    req.courierData = courier;
    res.locals.courierData = courier;
    res.locals.courier = courier;

    next();
  } catch (error) {
    res.clearCookie('token');
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({ message: 'Authentication failed' });
    }
    return res.status(401).redirect('/mobileApp');
  }
}

router.use(authenticateCourier);

router.get('/logout', courierController.logOut);

/** All other /courier/* URLs are deprecated — courier operations are API-only. */
router.use((req, res) => courierController.respondCourierWebDeprecated(req, res));

module.exports = router;
