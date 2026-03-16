const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const { query } = require('../config/database');
const bankAPI = require('../config/bankAPI');
const emailService = require('../config/emailService');

const SALT_ROUNDS = 12;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// ---------------------------------------------------------------------------
// In-memory password reset token store.
// NOTE: In production this MUST be replaced with Redis for horizontal scaling
//       and persistence across server restarts. Each entry: { userId, expires }.
// ---------------------------------------------------------------------------
const resetTokenStore = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateJWT(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function sanitizeUser(user) {
  const { password_hash, bvn, ...safe } = user;
  return safe;
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/register
 * Creates a new customer account, provisions a virtual bank account,
 * and sends a welcome email.
 */
async function register(req, res) {
  try {
    const { first_name, last_name, email, password, phone, bvn } = req.body;

    // Check for duplicate email
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email address already exists. Please log in instead.',
      });
    }

    // Check for duplicate BVN
    if (bvn) {
      const existingBvn = await query('SELECT id FROM users WHERE bvn = $1', [bvn]);
      if (existingBvn.rows.length > 0) {
        return res.status(409).json({
          success: false,
          message: 'An account with this BVN already exists. Please log in instead.',
        });
      }
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Insert user (tenant_id defaults to 1)
    const insertResult = await query(
      `INSERT INTO users (first_name, last_name, email, password_hash, phone, bvn, role, tier, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, 'customer', 1, false)
       RETURNING *`,
      [first_name, last_name, email, password_hash, phone, bvn]
    );

    const newUser = insertResult.rows[0];

    // Provision virtual bank account
    let accountNumber = null;
    let bankName = 'Providus Bank';

    try {
      const bankResult = await bankAPI.createVirtualAccount({
        first_name,
        last_name,
        email,
        bvn,
        phone,
      });
      accountNumber = bankResult.accountNumber;
      bankName = bankResult.bankName;
    } catch (bankErr) {
      console.error('[Register] Bank API error (non-fatal):', bankErr.message);
    }

    // Update user with account details
    if (accountNumber) {
      await query(
        'UPDATE users SET account_number = $1, bank_name = $2, is_verified = true WHERE id = $3',
        [accountNumber, bankName, newUser.id]
      );
      newUser.account_number = accountNumber;
      newUser.bank_name = bankName;
      newUser.is_verified = true;
    }

    // Create welcome notification
    await query(
      `INSERT INTO notifications (tenant_id, user_id, title, message)
       VALUES ($1, $2, $3, $4)`,
      [
        newUser.tenant_id || 1,
        newUser.id,
        'Welcome to Kufre Loans!',
        `Hi ${first_name}, your account has been created successfully. Your virtual account number is ${accountNumber || 'being provisioned'}.`,
      ]
    );

    // Send welcome email (non-blocking)
    emailService.sendWelcome(newUser, accountNumber).catch(console.error);

    // Generate JWT
    const token = generateJWT(newUser);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      data: {
        token,
        user: sanitizeUser(newUser),
      },
    });
  } catch (err) {
    console.error('[Register] Error:', err);
    return res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/login
 * Authenticates a user and returns a JWT.
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    // Find user by email — include password_hash for comparison
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);

    if (!result.rows.length) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email address or password.',
      });
    }

    const user = result.rows[0];

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email address or password.',
      });
    }

    const token = generateJWT(user);

    return res.json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user: sanitizeUser(user),
      },
    });
  } catch (err) {
    console.error('[Login] Error:', err);
    return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
}

// ---------------------------------------------------------------------------
// forgotPassword
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/forgot-password
 * Generates a password reset token and sends a reset-link email.
 *
 * NOTE: The token is stored in an in-memory Map (resetTokenStore) with a
 * 1-hour expiry. Replace with Redis in production.
 */
async function forgotPassword(req, res) {
  try {
    const { email } = req.body;

    const result = await query(
      'SELECT id, first_name, email FROM users WHERE email = $1',
      [email]
    );

    // Always return 200 to prevent email enumeration
    if (!result.rows.length) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.',
      });
    }

    const user = result.rows[0];

    // Generate a secure random token
    const rawToken = uuidv4() + crypto.randomBytes(16).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour from now

    // Store in memory: key = tokenHash, value = { userId, expires }
    resetTokenStore.set(tokenHash, { userId: user.id, expires: expiresAt });

    // Build reset URL
    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;

    // Send reset email (non-blocking)
    const subject = 'Password Reset Request — Kufre Loans';
    const html = `
      <p>Hi ${user.first_name},</p>
      <p>We received a request to reset the password for your Kufre Loans account.</p>
      <p>Click the button below to set a new password. This link expires in <strong>1 hour</strong>.</p>
      <p><a href="${resetUrl}" style="background:#1B4332;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;">Reset My Password</a></p>
      <p>If you did not request a password reset, please ignore this email — your account is safe.</p>
      <p>If the button does not work, copy and paste this URL into your browser:<br/>${resetUrl}</p>
    `;

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '587', 10),
      secure: process.env.EMAIL_SECURE === 'true',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });

    transporter
      .sendMail({
        from: `"Kufre Loans" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject,
        html,
      })
      .catch((e) => console.error('[ForgotPassword] Email error:', e.message));

    return res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (err) {
    console.error('[ForgotPassword] Error:', err);
    return res.status(500).json({ success: false, message: 'Password reset request failed.' });
  }
}

// ---------------------------------------------------------------------------
// resetPassword
// ---------------------------------------------------------------------------

/**
 * POST /api/auth/reset-password
 * Validates the reset token, updates the password, and clears the token.
 */
async function resetPassword(req, res) {
  try {
    const { token, new_password } = req.body;

    // Hash the incoming token to look it up in the store
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const entry = resetTokenStore.get(tokenHash);

    if (!entry) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset token.',
      });
    }

    if (Date.now() > entry.expires) {
      resetTokenStore.delete(tokenHash);
      return res.status(400).json({
        success: false,
        message: 'Password reset token has expired. Please request a new one.',
      });
    }

    const { userId } = entry;

    // Verify user still exists
    const userResult = await query('SELECT id, email FROM users WHERE id = $1', [userId]);
    if (!userResult.rows.length) {
      resetTokenStore.delete(tokenHash);
      return res.status(400).json({ success: false, message: 'User not found.' });
    }

    // Hash new password and update
    const newHash = await bcrypt.hash(new_password, SALT_ROUNDS);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);

    // Invalidate token
    resetTokenStore.delete(tokenHash);

    return res.json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (err) {
    console.error('[ResetPassword] Error:', err);
    return res.status(500).json({ success: false, message: 'Password reset failed.' });
  }
}

module.exports = { register, login, forgotPassword, resetPassword };
