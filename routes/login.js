// routes/login.js
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { pool } = require('../config/db');

const router = express.Router();

// Logger
const log = {
  info:  (...args) => console.log(`[${new Date().toISOString()}] [INFO] [login]`, ...args),
  warn:  (...args) => console.warn(`[${new Date().toISOString()}] [WARN] [login]`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR] [login]`, ...args),
};

// POST /api/login
router.post('/', async (req, res) => {
  try {
    const { email, password } = req.body;
    log.info('Request received | email=' + email);

    if (!email || !password) {
      log.warn('Missing email or password');
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    log.info('Email cleaned | cleanEmail=' + cleanEmail);

    // ── Find user ────────────────────────────────────────────
    const [users] = await pool.query(
      'SELECT id, name, email, password_hash, is_verified, is_paid FROM users WHERE email = ?',
      [cleanEmail]
    );
    log.info('User lookup complete | found=' + (users.length > 0));

    if (users.length === 0) {
      log.warn('User not found | cleanEmail=' + cleanEmail);
      // Generic message — don't reveal if email exists
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const user = users[0];

    // ── Check email verified ─────────────────────────────────
    if (!user.is_verified) {
      log.warn('Email not verified | userId=' + user.id + ' | cleanEmail=' + cleanEmail);
      return res.status(403).json({
        success: false,
        error: 'Please verify your email before logging in.',
        notVerified: true,
        email: cleanEmail,
      });
    }

    // ── Check password ───────────────────────────────────────
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    log.info('Password check | match=' + passwordMatch + ' | userId=' + user.id);
    if (!passwordMatch) {
      log.warn('Password mismatch | userId=' + user.id);
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // ── Issue JWT ────────────────────────────────────────────
    const token = jwt.sign(
      {
        id:      user.id,
        email:   user.email,
        name:    user.name,
        is_paid: user.is_paid,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    log.info('JWT issued | userId=' + user.id + ' | email=' + cleanEmail);

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id:      user.id,
        name:    user.name,
        email:   user.email,
        is_paid: user.is_paid,
      },
    });

  } catch (err) {
    log.error('Login error:', err.message);
    console.error('Login error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
