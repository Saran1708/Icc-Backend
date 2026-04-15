// routes/payment.js
const express  = require('express');
const crypto   = require('crypto');
const Razorpay = require('razorpay');
const jwt      = require('jsonwebtoken');
const { pool } = require('../config/db');
const auth     = require('../middleware/auth');
const { sendMailBackground, courseEnrollmentEmailTemplate } = require('../utils/mailer');

const router  = express.Router();
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Logger ────────────────────────────────────────────────────
const log = {
  info:  (ctx, ...args) => console.log( `[${new Date().toISOString()}] [INFO]  [${ctx}]`, ...args),
  warn:  (ctx, ...args) => console.warn( `[${new Date().toISOString()}] [WARN]  [${ctx}]`, ...args),
  error: (ctx, ...args) => console.error(`[${new Date().toISOString()}] [ERROR] [${ctx}]`, ...args),
};

const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─────────────────────────────────────────────
//  Helper — fetch current price from DB
// ─────────────────────────────────────────────
async function getCurrentPrice() {
  const [rows] = await pool.query(
    'SELECT current_price FROM course_pricing WHERE is_active = 1 LIMIT 1'
  );
  if (!rows.length) throw new Error('Pricing not configured');
  return rows[0].current_price;
}

// ─────────────────────────────────────────────
//  Helper — enroll user (mark paid + send mail)
// ─────────────────────────────────────────────
async function enrollUser({ userId, orderId, razorpay_payment_id, razorpay_order_id, razorpay_signature, amount, source = 'unknown' }) {
  const [[existing]] = await pool.query('SELECT is_paid FROM users WHERE id = ?', [userId]);

  if (existing?.is_paid) {
    log.warn('enrollUser', `User ${userId} already enrolled — skipping (source: ${source})`);
    return null;
  }

  log.info('enrollUser', `Enrolling user ${userId} | orderId=${orderId} | paymentId=${razorpay_payment_id} | amount=${amount} | source=${source}`);

  await pool.query(
    `INSERT INTO payments
       (order_id, user_id, razorpay_payment_id, razorpay_order_id, razorpay_signature, amount, status)
     VALUES (?, ?, ?, ?, ?, ?, 'captured')
     ON DUPLICATE KEY UPDATE status = 'captured'`,
    [orderId, userId, razorpay_payment_id, razorpay_order_id, razorpay_signature ?? 'webhook', amount]
  );
  log.info('enrollUser', `Payment record saved | userId=${userId}`);

  await pool.query("UPDATE orders SET status = 'paid' WHERE id = ?", [orderId]);
  await pool.query('UPDATE users SET is_paid = 1 WHERE id = ?', [userId]);
  log.info('enrollUser', `Order and user marked as paid | userId=${userId}`);

  const [[user]] = await pool.query(
    'SELECT id, name, email, is_paid FROM users WHERE id = ?', [userId]
  );

  sendMailBackground(
    user.email,
    user.name,
    "You're in! 🎉 Welcome to The Artpreneur Series",
    courseEnrollmentEmailTemplate(user.name)
  );
  log.info('enrollUser', `Welcome email queued | userId=${userId} | email=${user.email}`);

  return user;
}


// ── POST /api/payment/create-order ───────────────────────────
router.post('/create-order', auth, async (req, res) => {
  const userId = req.user.id;
  log.info('create-order', `Request received | userId=${userId}`);

  try {
    const [[userRow]] = await pool.query('SELECT is_paid FROM users WHERE id = ?', [userId]);

    if (!userRow) {
      log.warn('create-order', `User not found | userId=${userId}`);
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (userRow.is_paid) {
      log.warn('create-order', `User already enrolled — rejecting order | userId=${userId}`);
      return res.status(400).json({ success: false, error: 'Already enrolled' });
    }

    const amountPaise = await getCurrentPrice();
    log.info('create-order', `Fetched price | amount=${amountPaise} paise | userId=${userId}`);

    const rzOrder = await razorpay.orders.create({
      amount:   amountPaise,
      currency: 'INR',
      receipt:  `receipt_user_${userId}_${Date.now()}`,
      notes:    { user_id: String(userId), email: req.user.email },
    });
    log.info('create-order', `Razorpay order created | rzOrderId=${rzOrder.id} | userId=${userId}`);

    await pool.query(
      `INSERT INTO orders (user_id, razorpay_order_id, amount, currency, status)
       VALUES (?, ?, ?, 'INR', 'created')`,
      [userId, rzOrder.id, amountPaise]
    );
    log.info('create-order', `Order saved to DB | rzOrderId=${rzOrder.id} | userId=${userId}`);

    return res.json({
      success:  true,
      order_id: rzOrder.id,
      amount:   amountPaise,
      currency: 'INR',
      key_id:   process.env.RAZORPAY_KEY_ID,
      user: { name: req.user.name, email: req.user.email },
    });
  } catch (err) {
    log.error('create-order', `Failed | userId=${userId} | ${err.message}`, err.stack);
    return res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});


// ── POST /api/payment/verify ──────────────────────────────────
router.post('/verify', auth, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const userId = req.user.id;

  log.info('verify', `Request received | userId=${userId} | rzOrderId=${razorpay_order_id} | rzPaymentId=${razorpay_payment_id}`);

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    log.warn('verify', `Missing payment details | userId=${userId}`);
    return res.status(400).json({ success: false, error: 'Missing payment details' });
  }

  try {
    const body     = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      log.warn('verify', `HMAC signature mismatch — possible tampered request | userId=${userId} | rzOrderId=${razorpay_order_id}`);
      return res.status(400).json({ success: false, error: 'Payment verification failed' });
    }
    log.info('verify', `Signature verified | userId=${userId}`);

    const [[orderRow]] = await pool.query(
      'SELECT id, amount FROM orders WHERE razorpay_order_id = ? AND user_id = ?',
      [razorpay_order_id, userId]
    );
    if (!orderRow) {
      log.warn('verify', `Order not found in DB | rzOrderId=${razorpay_order_id} | userId=${userId}`);
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    await enrollUser({
      userId,
      orderId:              orderRow.id,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      amount:               orderRow.amount,
      source:               'verify',
    });

    const [[freshUser]] = await pool.query(
      'SELECT id, name, email, is_paid FROM users WHERE id = ?', [userId]
    );

    const token = jwt.sign(
      { id: freshUser.id, email: freshUser.email, name: freshUser.name, is_paid: freshUser.is_paid },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    log.info('verify', `Payment verified and user enrolled | userId=${userId} | rzOrderId=${razorpay_order_id}`);
    return res.json({ success: true, token, user: freshUser });

  } catch (err) {
    log.error('verify', `Failed | userId=${userId} | rzOrderId=${razorpay_order_id} | ${err.message}`, err.stack);
    return res.status(500).json({ success: false, error: 'Payment verification error' });
  }
});


// ── POST /api/payment/webhook ─────────────────────────────────
if (IS_PROD) {
  router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const reqId = `wh_${Date.now()}`; // Unique ID per webhook call for tracing

    log.info('webhook', `[${reqId}] Received`);

    try {
      // Stage 1 — Signature check
      const signature     = req.headers['x-razorpay-signature'];
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

      if (!webhookSecret) {
        log.error('webhook', `[${reqId}] RAZORPAY_WEBHOOK_SECRET not set — rejecting`);
        return res.status(500).end();
      }

      const expectedSig = crypto
        .createHmac('sha256', webhookSecret)
        .update(req.body)
        .digest('hex');

      if (expectedSig !== signature) {
        log.warn('webhook', `[${reqId}] Signature mismatch — possible fake/replayed request | received=${signature?.slice(0, 10)}...`);
        return res.status(400).json({ error: 'Invalid signature' });
      }
      log.info('webhook', `[${reqId}] Signature verified`);

      // Stage 2 — Parse event
      const event   = JSON.parse(req.body.toString());
      const payload = event?.payload?.payment?.entity;

      log.info('webhook', `[${reqId}] Event: ${event.event}`);

      if (event.event !== 'payment.captured') {
        log.info('webhook', `[${reqId}] Ignoring non-capture event: ${event.event}`);
        return res.status(200).json({ status: 'ignored' });
      }

      if (!payload) {
        log.error('webhook', `[${reqId}] Missing payment entity in payload for event: ${event.event}`);
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const razorpay_order_id   = payload.order_id;
      const razorpay_payment_id = payload.id;
      const amount              = payload.amount;

      log.info('webhook', `[${reqId}] payment.captured | rzPaymentId=${razorpay_payment_id} | rzOrderId=${razorpay_order_id} | amount=${amount}`);

      // Stage 3 — Find order
      const [[orderRow]] = await pool.query(
        'SELECT id, user_id, amount FROM orders WHERE razorpay_order_id = ?',
        [razorpay_order_id]
      );

      if (!orderRow) {
        log.error('webhook', `[${reqId}] Order not found in DB | rzOrderId=${razorpay_order_id}`);
        return res.status(404).json({ error: 'Order not found' });
      }
      log.info('webhook', `[${reqId}] Order found | orderId=${orderRow.id} | userId=${orderRow.user_id}`);

      // Stage 4 — Enroll
      const enrolled = await enrollUser({
        userId:               orderRow.user_id,
        orderId:              orderRow.id,
        razorpay_payment_id,
        razorpay_order_id,
        razorpay_signature:   null,
        amount:               orderRow.amount,
        source:               'webhook',
      });

      if (enrolled) {
        log.info('webhook', `[${reqId}] User enrolled successfully | userId=${orderRow.user_id} | rzOrderId=${razorpay_order_id}`);
      } else {
        log.warn('webhook', `[${reqId}] User was already enrolled (idempotent) | userId=${orderRow.user_id}`);
      }

      return res.status(200).json({ status: 'ok' });

    } catch (err) {
      log.error('webhook', `[${reqId}] Unhandled error | ${err.message}`, err.stack);
      return res.status(500).end();
    }
  });

  log.info('webhook', 'Route registered (production mode)');
} else {
  log.info('webhook', 'Route skipped (not production)');
}

module.exports = router;