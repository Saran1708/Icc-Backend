// routes/me.js
const express     = require('express');
const { pool }    = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/me  — returns current user info (requires JWT)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, name, email, is_paid, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    return res.json({ success: true, user: users[0] });

  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong.' });
  }
});

module.exports = router;
