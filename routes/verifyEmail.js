// routes/verifyEmail.js
const express  = require('express');
const jwt      = require('jsonwebtoken');
const { pool } = require('../config/db');
const { sendMailBackground, otpEmailTemplate } = require('../utils/mailer');

const router = express.Router();

// Logger
const log = {
  info:  (...args) => console.log(`[${new Date().toISOString()}] [INFO] [verifyEmail]`, ...args),
  warn:  (...args) => console.warn(`[${new Date().toISOString()}] [WARN] [verifyEmail]`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR] [verifyEmail]`, ...args),
};

// POST /api/verify-email
router.post('/', async (req, res) => {
  try {
    const { email, otp } = req.body;
    log.info('Request received | email=' + email + ' | otp=' + otp);

    if (!email || !otp) {
      log.warn('Missing email or otp');
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp   = otp.toString().trim();
    log.info('Input cleaned | cleanEmail=' + cleanEmail);

    // ── Find user ────────────────────────────────────────────
    const [users] = await pool.query(
      'SELECT id, name, is_verified FROM users WHERE email = ?',
      [cleanEmail]
    );
    log.info('User lookup complete | found=' + (users.length > 0));

    if (users.length === 0) {
      log.warn('User not found | cleanEmail=' + cleanEmail);
      return res.status(404).json({ success: false, error: 'No account found with this email' });
    }

    const user = users[0];
    log.info('User found | userId=' + user.id + ' | is_verified=' + user.is_verified);

    if (user.is_verified) {
      log.info('User already verified | userId=' + user.id + ' | issuing JWT');
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
    log.info('OTP record lookup | found=' + (records.length > 0));

    if (records.length === 0) {
      log.warn('OTP record not found | userId=' + user.id);
      return res.status(400).json({
        success: false,
        error: 'Your OTP has expired. Click "Resend OTP" to get a new one.',
        expired: true,
      });
    }

    const record = records[0];

    // ── Check expiry ─────────────────────────────────────────
    const isExpired = new Date() > new Date(record.expires_at);
    log.info('OTP expiry check | expired=' + isExpired);
    if (isExpired) {
      await pool.query('DELETE FROM email_verifications WHERE id = ?', [record.id]);
      log.warn('OTP expired | userId=' + user.id);
      return res.status(400).json({
        success: false,
        error: 'Your OTP has expired. Click "Resend OTP" to get a new one.',
        expired: true,
      });
    }

    // ── Check OTP match ──────────────────────────────────────
    const otpMatch = record.token === cleanOtp;
    log.info('OTP match check | match=' + otpMatch);
    if (!otpMatch) {
      log.warn('OTP mismatch | userId=' + user.id);
      return res.status(400).json({
        success: false,
        error: 'That OTP doesn\'t match. Please check your email and try again.',
      });
    }

    // ── Mark user as verified + delete OTP ───────────────────
    await pool.query('UPDATE users SET is_verified = 1 WHERE id = ?', [user.id]);
    await pool.query('DELETE FROM email_verifications WHERE id = ?', [record.id]);
    log.info('User verified and OTP deleted | userId=' + user.id);

   
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
    log.info('JWT issued | userId=' + fullUser.id + ' | email=' + fullUser.email);

    return res.json({
      success: true,
      message: 'Email verified successfully!',
      token,
      user: { id: fullUser.id, name: fullUser.name, email: fullUser.email, is_paid: fullUser.is_paid },
    });

  } catch (err) {
    log.error('Verify OTP error:', err.message);
    console.error('Verify OTP error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/verify-email/resend  — resend OTP
router.post('/resend', async (req, res) => {
  try {
    const { email } = req.body;
    log.info('Resend request | email=' + email);

    if (!email) {
      log.warn('Missing email in resend request');
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    log.info('Email cleaned | cleanEmail=' + cleanEmail);

    const [users] = await pool.query(
      'SELECT id, name, is_verified FROM users WHERE email = ?',
      [cleanEmail]
    );
    log.info('User lookup | found=' + (users.length > 0));

    if (users.length === 0) {
      log.warn('User not found for resend | cleanEmail=' + cleanEmail);
      return res.status(404).json({ success: false, error: 'No account found with this email' });
    }

    const user = users[0];
    log.info('User found | userId=' + user.id + ' | is_verified=' + user.is_verified);

    if (user.is_verified) {
      log.info('User already verified | userId=' + user.id);
      return res.json({ success: true, message: 'Already verified. Please login.', alreadyVerified: true });
    }

    // ── Generate new OTP ─────────────────────────────────────
    const otp       = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    log.info('New OTP generated | userId=' + user.id);

    // Delete old OTP if exists
    await pool.query('DELETE FROM email_verifications WHERE user_id = ?', [user.id]);

    await pool.query(
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, otp, expiresAt]
    );
    log.info('New OTP saved to DB | userId=' + user.id);

    sendMailBackground(
      cleanEmail,
      user.name,
      'Your new verification OTP',
      otpEmailTemplate(user.name, otp)
    );
    log.info('Resend OTP email queued | userId=' + user.id + ' | cleanEmail=' + cleanEmail);

    return res.json({ success: true, message: 'New OTP sent to your email.' });

  } catch (err) {
    log.error('Resend OTP error:', err.message);
    console.error('Resend OTP error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;