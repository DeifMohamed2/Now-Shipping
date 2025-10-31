const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../../middleware/authMiddleware');

// Business ticket page
router.get('/tickets', isAuthenticated, async (req, res) => {
  try {
    res.render('business/tickets', {
      title: 'Support Tickets',
      user: req.user,
      layout: 'layouts/business-layout',
    });
  } catch (error) {
    console.error('Error rendering tickets page:', error);
    res.status(500).send('Error loading tickets page');
  }
});

module.exports = router;
