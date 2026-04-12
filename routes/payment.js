// routes/payment.js
const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const auth = require('../middleware/auth');
const { sendMailBackground, courseEnrollmentEmailTemplate } = require('../utils/mailer');
const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Fetch current price from DB
async function getCurrentPrice() {
  const [rows] = await pool.query(
    'SELECT current_price FROM course_pricing WHERE is_active = 1 LIMIT 1'
  );
  if (!rows.length) throw new Error('Pricing not configured');
  return rows[0].current_price;
}

// ── POST /api/payment/create-order ───────────────────────────
router.post('/create-order', auth, async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query(
      'SELECT is_paid FROM users WHERE id = ?', [userId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    if (rows[0].is_paid) return res.status(400).json({ success: false, error: 'Already enrolled' });

    const amountPaise = await getCurrentPrice();

    const rzOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `receipt_user_${userId}_${Date.now()}`,
      notes: { user_id: String(userId), email: req.user.email },
    });

    await pool.query(
      `INSERT INTO orders (user_id, razorpay_order_id, amount, currency, status)
       VALUES (?, ?, ?, 'INR', 'created')`,
      [userId, rzOrder.id, amountPaise]
    );

    return res.json({
      success: true,
      order_id: rzOrder.id,
      amount: amountPaise,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
      user: {
        name: req.user.name,
        email: req.user.email,
      },
    });
  } catch (err) {
    console.error('create-order error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});


// ── POST /api/payment/verify ──────────────────────────────────
router.post('/verify', auth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const userId = req.user.id;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: 'Missing payment details' });
  }

  try {
    // Verify HMAC signature
    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, error: 'Payment verification failed' });
    }

    // Get order record
    const [orderRows] = await pool.query(
      'SELECT id, amount FROM orders WHERE razorpay_order_id = ? AND user_id = ?',
      [razorpay_order_id, userId]
    );
    if (!orderRows.length) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    const orderId = orderRows[0].id;
    const orderAmount = orderRows[0].amount;

    // Save payment record
    await pool.query(
      `INSERT INTO payments
         (order_id, user_id, razorpay_payment_id, razorpay_order_id, razorpay_signature, amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'captured')`,
      [orderId, userId, razorpay_payment_id, razorpay_order_id, razorpay_signature, orderAmount]
    );

    // Mark order as paid
    await pool.query("UPDATE orders SET status = 'paid' WHERE id = ?", [orderId]);

    // Mark user as paid
    await pool.query('UPDATE users SET is_paid = 1 WHERE id = ?', [userId]);

    // Issue fresh JWT with is_paid = 1
    const [userRows] = await pool.query(
      'SELECT id, name, email, is_paid FROM users WHERE id = ?', [userId]
    );
    const user = userRows[0];

    sendMailBackground(
      user.email,
      user.name,
      "You're in! 🎉 Welcome to The Artpreneur Series",
      courseEnrollmentEmailTemplate(user.name)
    );

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, is_paid: user.is_paid },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({ success: true, token, user });
  } catch (err) {
    console.error('verify error:', err);
    return res.status(500).json({ success: false, error: 'Payment verification error' });
  }
});

module.exports = router;