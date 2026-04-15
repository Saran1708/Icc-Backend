// routes/resetPassword.js
const express  = require('express');
const bcrypt   = require('bcryptjs');
const { pool } = require('../config/db');

const router = express.Router();

// Logger
const log = {
  info:  (...args) => console.log(`[${new Date().toISOString()}] [INFO] [resetPassword]`, ...args),
  warn:  (...args) => console.warn(`[${new Date().toISOString()}] [WARN] [resetPassword]`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR] [resetPassword]`, ...args),
};

// ── POST /api/reset-password ──────────────────────────────────
// Step 3: User submits new password with reset_token
router.post('/', async (req, res) => {
  try {
    const { reset_token, password } = req.body;
    log.info('Reset password request | reset_token=' + (reset_token ? reset_token.substring(0, 8) + '...' : 'none'));

    if (!reset_token || !password) {
      log.warn('Missing reset_token or password');
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    if (password.length < 8) {
      log.warn('Password too short');
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Find record by reset_token where OTP has already been verified
    const [records] = await pool.query(
      'SELECT id, email, expires_at FROM password_resets WHERE token = ? AND otp_verified = 1',
      [reset_token.trim()]
    );
    log.info('Reset record lookup | found=' + (records.length > 0));

    if (records.length === 0) {
      log.warn('Reset token not found or not verified');
      return res.status(400).json({
        success: false,
        error: 'Your session has expired. Please start over.',
        expired: true,
      });
    }

    const record = records[0];
    log.info('Reset record found | email=' + record.email);

    // Check 5-minute window
    const isExpired = new Date() > new Date(record.expires_at);
    log.info('Expiry check | expired=' + isExpired);
    if (isExpired) {
      await pool.query('DELETE FROM password_resets WHERE id = ?', [record.id]);
      log.warn('Reset session expired | email=' + record.email);
      return res.status(400).json({
        success: false,
        error: 'Your session has expired. Please start over.',
        expired: true,
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);
    log.info('Password hashed');

    // Update user password
    await pool.query(
      'UPDATE users SET password_hash = ? WHERE email = ?',
      [passwordHash, record.email]
    );
    log.info('Password updated | email=' + record.email);

    // Delete the reset record — one time use
    await pool.query('DELETE FROM password_resets WHERE id = ?', [record.id]);
    log.info('Reset record deleted | email=' + record.email);

    return res.json({
      success: true,
      message: 'Password reset successfully. You can now login.',
    });

  } catch (err) {
    log.error('Reset password error:', err.message);
    console.error('Reset password error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;