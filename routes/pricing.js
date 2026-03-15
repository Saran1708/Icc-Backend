// routes/pricing.js
const express = require('express');
const { pool } = require('../config/db');
const auth    = require('../middleware/auth');

const router  = express.Router();

// ── GET /api/pricing ─────────────────────────────────────────
// Public — frontend fetches current price to display
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT original_price, current_price, currency, course_name FROM course_pricing WHERE is_active = 1 LIMIT 1'
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Pricing not found' });

    const p = rows[0];
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
    console.error('pricing fetch error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch pricing' });
  }
});


// ── PUT /api/pricing ─────────────────────────────────────────
// Admin only — update pricing
// Requires JWT + is_admin flag (add is_admin col to users if needed)
router.put('/', auth, async (req, res) => {
  // Simple admin check — add is_admin to your users table
  if (!req.user.is_admin) {
    return res.status(403).json({ success: false, error: 'Admin access required' });
  }

  const { original_price, current_price } = req.body;

  if (!original_price || !current_price) {
    return res.status(400).json({ success: false, error: 'Both original_price and current_price required (in paise)' });
  }
  if (current_price > original_price) {
    return res.status(400).json({ success: false, error: 'current_price cannot be more than original_price' });
  }
  if (current_price < 100) {
    return res.status(400).json({ success: false, error: 'Minimum price is ₹1' });
  }

  try {
    await pool.query(
      'UPDATE course_pricing SET original_price = ?, current_price = ? WHERE is_active = 1',
      [original_price, current_price]
    );
    return res.json({
      success:          true,
      original_price,
      current_price,
      original_display: `₹${(original_price / 100).toLocaleString('en-IN')}`,
      current_display:  `₹${(current_price  / 100).toLocaleString('en-IN')}`,
      discount_percent: Math.round((1 - current_price / original_price) * 100),
    });
  } catch (err) {
    console.error('pricing update error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update pricing' });
  }
});

module.exports = router;