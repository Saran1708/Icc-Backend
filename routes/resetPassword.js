// routes/resetPassword.js
const express  = require('express');
const bcrypt   = require('bcryptjs');
const { pool } = require('../config/db');

const router = express.Router();

// ── POST /api/reset-password ──────────────────────────────────
// Step 3: User submits new password with reset_token
router.post('/', async (req, res) => {
  try {
    const { reset_token, password } = req.body;

    if (!reset_token || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Find record by reset_token where OTP has already been verified
    const [records] = await pool.query(
      'SELECT id, email, expires_at FROM password_resets WHERE token = ? AND otp_verified = 1',
      [reset_token.trim()]
    );

    if (records.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Your session has expired. Please start over.',
        expired: true,
      });
    }

    const record = records[0];

    // Check 5-minute window
    if (new Date() > new Date(record.expires_at)) {
      await pool.query('DELETE FROM password_resets WHERE id = ?', [record.id]);
      return res.status(400).json({
        success: false,
        error: 'Your session has expired. Please start over.',
        expired: true,
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user password
    await pool.query(
      'UPDATE users SET password_hash = ? WHERE email = ?',
      [passwordHash, record.email]
    );

    // Delete the reset record — one time use
    await pool.query('DELETE FROM password_resets WHERE id = ?', [record.id]);

    return res.json({
      success: true,
      message: 'Password reset successfully. You can now login.',
    });

  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;