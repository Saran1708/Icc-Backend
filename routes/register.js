// routes/register.js
const express  = require('express');
const bcrypt   = require('bcryptjs');
const { pool } = require('../config/db');
const { sendMail, sendMailBackground, otpEmailTemplate } = require('../utils/mailer');

const router = express.Router();

// Generate a 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/register
router.post('/', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // ── Validate input ───────────────────────────────────────
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    const cleanName  = name.trim().replace(/[<>"'%;()&+]/g, '');
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 2 || cleanName.length > 80) {
      return res.status(400).json({ success: false, error: 'Name must be 2–80 characters' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail) || cleanEmail.length > 254) {
      return res.status(400).json({ success: false, error: 'Invalid email address' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // ── Check if email already exists ────────────────────────
    const [existing] = await pool.query(
      'SELECT id, is_verified FROM users WHERE email = ?',
      [cleanEmail]
    );

    if (existing.length > 0) {
      const user = existing[0];

      if (user.is_verified) {
        // Fully registered — tell them to login
        return res.status(409).json({
          success: false,
          error: 'An account with this email already exists',
          field: 'email',
        });
      } else {
        // Registered but unverified — resend OTP
        const otp       = generateOTP();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await pool.query(
          'DELETE FROM email_verifications WHERE user_id = ?',
          [user.id]
        );
        await pool.query(
          'INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)',
          [user.id, otp, expiresAt]
        );

        sendMailBackground(cleanEmail, cleanName, 'Your verification OTP', otpEmailTemplate(cleanName, otp));

        return res.json({
          success: true,
          message: 'Account pending verification. A new OTP has been sent to your email.',
          email: cleanEmail,
          resent: true,
        });
      }
    }

    // ── Hash password ────────────────────────────────────────
    const passwordHash = await bcrypt.hash(password, 10);

    // ── Insert user ──────────────────────────────────────────
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [cleanName, cleanEmail, passwordHash]
    );

    const userId = result.insertId;

    // ── Generate OTP + save ──────────────────────────────────
    const otp       = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await pool.query(
      'INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)',
      [userId, otp, expiresAt]
    );

    // ── Send OTP email ───────────────────────────────────────
    sendMailBackground(
      cleanEmail,
      cleanName,
      'Verify your email — OTP inside',
      otpEmailTemplate(cleanName, otp)
    );

    return res.json({
      success: true,
      message: 'Account created! Check your email for the OTP.',
      email: cleanEmail,
    });

  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;