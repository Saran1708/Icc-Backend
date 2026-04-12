// server.js
require('dotenv').config();

const express = require('express');
const cors    = require('cors');

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
const videoTokenRoute = require('./routes/videoToken');
const videoStreamRoute = require('./routes/videoStream');



const app  = express();
const PORT = process.env.PORT || 5000;

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
    // Allow requests with no origin (Postman, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

// ── Body parsers ──────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────
app.use('/api/register',        registerRoute);
app.use('/api/verify-email',    verifyEmailRoute);
app.use('/api/login',           loginRoute);
app.use('/api/forgot-password', forgotPasswordRoute);  // handles both / and /verify
app.use('/api/reset-password',  resetPasswordRoute);
app.use('/api/me',              meRoute);
app.use('/api/payment',         paymentRoute);
app.use('/api/pricing',         pricingRoute);
app.use('/api/video-token', videoTokenRoute);
app.use('/api/video-stream', videoStreamRoute);


// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────
async function start() {
  await testConnection(); // exits if DB unreachable
  app.listen(PORT, () => {
    console.log(`🚀 Server running`);
  });
}

start();