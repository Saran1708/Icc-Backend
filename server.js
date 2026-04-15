// server.js
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');

const { testConnection } = require('./config/db');

// ── Routes ───────────────────────────────────────────────────
const registerRoute       = require('./routes/register');
const verifyEmailRoute    = require('./routes/verifyEmail');
const loginRoute          = require('./routes/login');
const forgotPasswordRoute = require('./routes/forgotPassword');
const resetPasswordRoute  = require('./routes/resetPassword');
const meRoute             = require('./routes/me');
const paymentRoute        = require('./routes/payment');
const pricingRoute        = require('./routes/pricing');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── Logger ────────────────────────────────────────────────────
const log = {
  info:  (...args) => console.log(`[${new Date().toISOString()}] [INFO] `, ...args),
  warn:  (...args) => console.warn(`[${new Date().toISOString()}] [WARN] `, ...args),
  error: (...args) => console.error(`[${new Date().toISOString()}] [ERROR]`, ...args),
};

// ── Morgan HTTP request logging ───────────────────────────────
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
app.use(morgan(morganFormat, {
  skip: (req) => req.path === '/api/health', // skip noisy health checks
}));

// ── Ngrok browser warning bypass ─────────────────────────────
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// ── CORS ─────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      log.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

app.use('/api/payment/webhook', express.raw({ type: 'application/json' }));

// ── Body parsers ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────
log.info('Mounting API routes...');
app.use('/api/register',        registerRoute);
log.info('✓ Register route mounted');
app.use('/api/verify-email',    verifyEmailRoute);
log.info('✓ Verify email route mounted');
app.use('/api/login',           loginRoute);
log.info('✓ Login route mounted');
app.use('/api/forgot-password', forgotPasswordRoute);
log.info('✓ Forgot password route mounted');
app.use('/api/reset-password',  resetPasswordRoute);
log.info('✓ Reset password route mounted');
app.use('/api/me',              meRoute);
log.info('✓ Me route mounted');
app.use('/api/payment',         paymentRoute);
log.info('✓ Payment route mounted');
app.use('/api/pricing',         pricingRoute);
log.info('✓ Pricing route mounted');

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  log.warn(`404 — ${req.method} ${req.path}`);
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  log.error(`Unhandled error on ${req.method} ${req.path} —`, err.message);
  log.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
async function start() {
  log.info('Starting server...');
  try {
    await testConnection();
    log.info('Database connection established');
    app.listen(PORT, () => {
      log.info(`Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
  } catch (err) {
    log.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();