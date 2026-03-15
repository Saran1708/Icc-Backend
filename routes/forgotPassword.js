// routes/forgotPassword.js
const express  = require('express');
const crypto   = require('crypto');
const { pool } = require('../config/db');
const { sendMail, sendMailBackground, otpEmailTemplate } = require('../utils/mailer');

const router = express.Router();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── POST /api/forgot-password ─────────────────────────────────
// Step 1: User submits email → send OTP
router.post('/', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Always return success — don't reveal if email exists
    const [users] = await pool.query(
      'SELECT id, name FROM users WHERE email = ? AND is_verified = 1',
      [cleanEmail]
    );

    if (users.length === 0) {
      // Generic response for security — don't tell attacker email doesn't exist
      return res.json({
        success: true,
        message: 'If an account exists, an OTP has been sent to your email.',
      });
    }

    const user = users[0];

    // Generate 6-digit OTP, expires in 5 minutes
    const otp       = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Delete any existing reset record for this email
    await pool.query('DELETE FROM password_resets WHERE email = ?', [cleanEmail]);

    // Insert OTP (otp_verified = 0 at this stage)
    await pool.query(
      'INSERT INTO password_resets (email, token, otp_verified, expires_at) VALUES (?, ?, 0, ?)',
      [cleanEmail, otp, expiresAt]
    );

    // Reuse the same OTP email template
    sendMailBackground(
      cleanEmail,
      user.name,
      'Your password reset OTP',
      otpEmailTemplate(user.name, otp)
    );

    return res.json({
      success: true,
      message: 'If an account exists, an OTP has been sent to your email.',
    });

  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// ── POST /api/forgot-password/verify ─────────────────────────
// Step 2: User submits OTP → verify it → return reset_token
router.post('/verify', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp   = otp.toString().trim();

    // Find the record
    const [records] = await pool.query(
      'SELECT id, token, otp_verified, expires_at FROM password_resets WHERE email = ?',
      [cleanEmail]
    );

    if (records.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Your OTP has expired. Please request a new one.',
        expired: true,
      });
    }

    const record = records[0];

    // Check expiry
    if (new Date() > new Date(record.expires_at)) {
      await pool.query('DELETE FROM password_resets WHERE id = ?', [record.id]);
      return res.status(400).json({
        success: false,
        error: 'Your OTP has expired. Please request a new one.',
        expired: true,
      });
    }

    // Check OTP already used
    if (record.otp_verified === 1) {
      return res.status(400).json({
        success: false,
        error: 'This OTP has already been used. Please request a new one.',
        expired: true,
      });
    }

    // Check OTP match
    if (record.token !== cleanOtp) {
      return res.status(400).json({
        success: false,
        error: "That OTP doesn't match. Please check your email and try again.",
      });
    }

    // ── OTP correct → swap to reset_token, mark verified ─────
    const resetToken   = crypto.randomBytes(32).toString('hex');
    const newExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 more minutes

    await pool.query(
      'UPDATE password_resets SET token = ?, otp_verified = 1, expires_at = ? WHERE id = ?',
      [resetToken, newExpiresAt, record.id]
    );

    return res.json({
      success:     true,
      reset_token: resetToken, // returned to React, kept in state only
      message:     'OTP verified. You have 5 minutes to reset your password.',
    });

  } catch (err) {
    console.error('Forgot password verify error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;