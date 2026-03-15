require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { startRepaymentEngine } = require('./jobs/repaymentEngine');

const app = express();

// Trust Railway/Vercel proxy
app.set('trust proxy', 1);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// CORS
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:4173',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, Vite proxy)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes.',
  },
});

// Static file serving for uploads
app.use('/uploads', express.static(uploadsDir));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'OK', timestamp: new Date().toISOString() });
});

// Public: loan products (no auth required)
app.get('/api/products', async (req, res) => {
  try {
    const { query } = require('./config/database');
    const result = await query(
      `SELECT lp.*, ts.interest_rate
       FROM loan_products lp
       JOIN tenant_settings ts ON ts.tenant_id = lp.tenant_id
       WHERE lp.is_active = true AND lp.tenant_id = 1
       ORDER BY lp.created_at ASC`
    );
    return res.json({ success: true, data: { products: result.rows } });
  } catch (err) {
    console.error('[PublicProducts] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch products.' });
  }
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/admin', adminRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body.' });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: 'File size exceeds the 5MB limit.' });
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'An unexpected internal server error occurred.';

  res.status(statusCode).json({ success: false, message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  // Start cron job
  startRepaymentEngine();
});

module.exports = app;
