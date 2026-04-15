// routes/pricing.js
const express = require('express');
const { pool } = require('../config/db');
const auth    = require('../middleware/auth');

const router  = express.Router();

// Logger
const log = {
  info:  (...args) => console.log(`[${new Date().toISOString()}] [INFO] [pricing]`, ...args),
  warn:  (...args) => console.warn(`[${new Date().toISOString()}] [WARN] [pricing]`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR] [pricing]`, ...args),
};

// ── GET /api/pricing ─────────────────────────────────────────
// Public — frontend fetches current price to display
router.get('/', async (req, res) => {
  try {
    log.info('Pricing fetch request');
    const [rows] = await pool.query(
      'SELECT original_price, current_price, currency, course_name FROM course_pricing WHERE is_active = 1 LIMIT 1'
    );
    log.info('Pricing query complete | found=' + (rows.length > 0));
    if (!rows.length) {
      log.warn('Pricing not found in DB');
      return res.status(404).json({ success: false, error: 'Pricing not found' });
    }

    const p = rows[0];
    log.info('Pricing data retrieved | course=' + p.course_name + ' | price=' + p.current_price);
    return res.json({
      success:        true,
      course_name:    p.course_name,
      original_price: p.original_price,           // paise
      current_price:  p.current_price,            // paise
      original_display: `₹${(p.original_price / 100).toLocaleString('en-IN')}`,
      current_display:  `₹${(p.current_price  / 100).toLocaleString('en-IN')}`,
      discount_percent: Math.round((1 - p.current_price / p.original_price) * 100),
      currency:       p.currency,
    });
  } catch (err) {
    log.error('pricing fetch error:', err.message);
    console.error('pricing fetch error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch pricing' });
  }
});


// ── PUT /api/pricing ─────────────────────────────────────────
// Admin only — update pricing
// Requires JWT + is_admin flag (add is_admin col to users if needed)
router.put('/', auth, async (req, res) => {
  try {
    log.info('Pricing update request | userId=' + req.user.id);
    // Simple admin check — add is_admin to your users table
    if (!req.user.is_admin) {
      log.warn('Non-admin attempted pricing update | userId=' + req.user.id);
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { original_price, current_price } = req.body;
    log.info('Update params | original=' + original_price + ' | current=' + current_price);

    if (!original_price || !current_price) {
      log.warn('Missing pricing parameters');
      return res.status(400).json({ success: false, error: 'Both original_price and current_price required (in paise)' });
    }
    if (current_price > original_price) {
      log.warn('Invalid pricing: current > original');
      return res.status(400).json({ success: false, error: 'current_price cannot be more than original_price' });
    }
    if (current_price < 100) {
      log.warn('Price below minimum');
      return res.status(400).json({ success: false, error: 'Minimum price is ₹1' });
    }

    await pool.query(
      'UPDATE course_pricing SET original_price = ?, current_price = ? WHERE is_active = 1',
      [original_price, current_price]
    );
    log.info('Pricing updated successfully | original=' + original_price + ' | current=' + current_price);
    return res.json({
      success:          true,
      original_price,
      current_price,
      original_display: `₹${(original_price / 100).toLocaleString('en-IN')}`,
      current_display:  `₹${(current_price  / 100).toLocaleString('en-IN')}`,
      discount_percent: Math.round((1 - current_price / original_price) * 100),
    });
  } catch (err) {
    log.error('pricing update error:', err.message);
    console.error('pricing update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update pricing' });
  }
});

module.exports = router;