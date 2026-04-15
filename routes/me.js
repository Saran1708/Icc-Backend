// routes/me.js
const express     = require('express');
const { pool }    = require('../config/db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Logger
const log = {
  info:  (...args) => console.log(`[${new Date().toISOString()}] [INFO] [me]`, ...args),
  warn:  (...args) => console.warn(`[${new Date().toISOString()}] [WARN] [me]`, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR] [me]`, ...args),
};

// GET /api/me  — returns current user info (requires JWT)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    log.info('Request received | userId=' + userId);

    const [users] = await pool.query(
      'SELECT id, name, email, is_paid, created_at FROM users WHERE id = ?',
      [userId]
    );
    log.info('User lookup | found=' + (users.length > 0));

    if (users.length === 0) {
      log.warn('User not found | userId=' + userId);
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    log.info('User data retrieved | userId=' + userId + ' | email=' + users[0].email);
    return res.json({ success: true, user: users[0] });

  } catch (err) {
    log.error('Me error:', err.message);
    console.error('Me error:', err);
    return res.status(500).json({ success: false, error: 'Something went wrong.' });
  }
});

module.exports = router;
