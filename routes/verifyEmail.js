// routes/verifyEmail.js
const express  = require('express');
const jwt      = require('jsonwebtoken');
const { pool } = require('../config/db');
const { sendMailBackground, otpEmailTemplate } = require('../utils/mailer');

const router = express.Router();

// POST /api/verify-email
router.post('/', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp   = otp.toString().trim();

    // ── Find user ────────────────────────────────────────────
    const [users] = await pool.query(
      'SELECT id, name, is_verified FROM users WHERE email = ?',
      [cleanEmail]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'No account found with this email' });
    }

    const user = users[0];

    if (user.is_verified) {
      // Still issue JWT so user gets auto-logged in
      const [userRows] = await pool.query(
        'SELECT id, name, email, is_paid FROM users WHERE id = ?',
        [user.id]
      );
      const fullUser = userRows[0];
      const token    = jwt.sign(
        { id: fullUser.id, email: fullUser.email, name: fullUser.name, is_paid: fullUser.is_paid },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );
      return res.json({
        success: true,
        message: 'Email already verified.',
        alreadyVerified: true,
        token,
        user: { id: fullUser.id, name: fullUser.name, email: fullUser.email, is_paid: fullUser.is_paid },
      });
    }

    // ── Find OTP record ──────────────────────────────────────
    const [records] = await pool.query(
      'SELECT id, token, expires_at FROM email_verifications WHERE user_id = ?',
      [user.id]
    );

    if (records.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Your OTP has expired. Click "Resend OTP" to get a new one.',
        expired: true,
      });
    }

    const record = records[0];

    // ── Check expiry ─────────────────────────────────────────
    if (new Date() > new Date(record.expires_at)) {
      await pool.query('DELETE FROM email_verifications WHERE id = ?', [record.id]);
      return res.status(400).json({
        success: false,
        error: 'Your OTP has expired. Click "Resend OTP" to get a new one.',
        expired: true,
      });
    }

    // ── Check OTP match ──────────────────────────────────────
    if (record.token !== cleanOtp) {
      return res.status(400).json({
        success: false,
        error: 'That OTP doesn\'t match. Please check your email and try again.',
      });
    }

    // ── Mark user as verified + delete OTP ───────────────────
    await pool.query('UPDATE users SET is_verified = 1 WHERE id = ?', [user.id]);
    await pool.query('DELETE FROM email_verifications WHERE id = ?', [record.id]);

   
    // ── Issue JWT so user is auto-logged in ──────────────────
    const [userRows] = await pool.query(
      'SELECT id, name, email, is_paid FROM users WHERE id = ?',
      [user.id]
    );
    const fullUser = userRows[0];
    const token    = jwt.sign(
      { id: fullUser.id, email: fullUser.email, name: fullUser.name, is_paid: fullUser.is_paid },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return res.json({
      success: true,
      message: 'Email verified successfully!',
      token,
      user: { id: fullUser.id, name: fullUser.name, email: fullUser.email, is_paid: fullUser.is_paid },
    });

  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/verify-email/resend  — resend OTP
router.post('/resend', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    const [users] = await pool.query(
      'SELECT id, name, is_verified FROM users WHERE email = ?',
      [cleanEmail]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'No account found with this email' });
    }

    const user = users[0];

    if (user.is_verified) {
      return res.json({ success: true, message: 'Already verified. Please login.', alreadyVerified: true });
    }

    // ── Generate new OTP ─────────────────────────────────────
    const otp       = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Delete old OTP if exists
    await pool.query('DELETE FROM email_verifications WHERE user_id = ?', [user.id]);

    await pool.query(
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, otp, expiresAt]
    );

    sendMailBackground(
      cleanEmail,
      user.name,
      'Your new verification OTP',
      otpEmailTemplate(user.name, otp)
    );

    return res.json({ success: true, message: 'New OTP sent to your email.' });

  } catch (err) {
    console.error('Resend OTP error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;