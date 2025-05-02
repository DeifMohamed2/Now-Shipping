const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../../../models/user.js');

const jwtSecret = process.env.JWT_SECRET;

const businessController = require('../../../controllers/businessController.js');


async function authenticateUser(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('Authorization header not found or invalid');
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decode = jwt.verify(token, jwtSecret);
        req.userId = decode.userId;
        const user = await User.findOne({ _id: decode.userId });
        req.userData = user; // Attach user data to request object
        if (!user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        next(); // Move to the next middleware
    } catch (error) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}

router.use(authenticateUser);

//dashboard

router.post('/complete-confirmation-form', businessController.completionConfirm);



module.exports = router;
