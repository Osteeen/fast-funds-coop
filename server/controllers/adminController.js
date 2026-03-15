const bcrypt = require('bcrypt');
const { query } = require('../config/database');
const {
  generateRepaymentSchedule,
  createAuditLog,
  updateUserTier,
} = require('../models/loanModel');
const bankAPI = require('../config/bankAPI');
const emailService = require('../config/emailService');

const SALT_ROUNDS = 12;
const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE || '0.01');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, bvn, ...safe } = user;
  return safe;
}

// ---------------------------------------------------------------------------
// getAdminDashboard
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/dashboard
 * Returns key stats for the admin home screen.
 */
async function getAdminDashboard(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;

    const [
      totalAppsResult,
      pendingAppsResult,
      disbursedAmtResult,
      totalRepaidResult,
      defaultRateResult,
      revenueResult,
      recentAppsResult,
      overdueResult,
      statusDistResult,
    ] = await Promise.all([
      query('SELECT COUNT(*) AS count FROM loan_applications WHERE tenant_id = $1', [tenantId]),
      query(
        "SELECT COUNT(*) AS count FROM loan_applications WHERE tenant_id = $1 AND status IN ('pending','under_review')",
        [tenantId]
      ),
      query(
        "SELECT COALESCE(SUM(amount_approved),0) AS total FROM loan_applications WHERE tenant_id = $1 AND status IN ('disbursed','completed')",
        [tenantId]
      ),
      query(
        `SELECT COALESCE(SUM(rs.total_amount),0) AS total
         FROM repayment_schedule rs
         JOIN loan_applications la ON la.id = rs.loan_id
         WHERE la.tenant_id = $1 AND rs.status = 'paid'`,
        [tenantId]
      ),
      query(
        `SELECT
           COUNT(DISTINCT la.id) FILTER (WHERE rs.status IN ('failed','overdue')) AS defaulted,
           COUNT(DISTINCT la.id) FILTER (WHERE la.status IN ('disbursed','completed')) AS total_disbursed
         FROM loan_applications la
         LEFT JOIN repayment_schedule rs ON rs.loan_id = la.id
         WHERE la.tenant_id = $1`,
        [tenantId]
      ),
      query(
        'SELECT COALESCE(SUM(commission_amount),0) AS total FROM loan_revenue_log WHERE tenant_id = $1',
        [tenantId]
      ),
      query(
        `SELECT la.*, u.first_name, u.last_name, u.email, lp.name AS product_name
         FROM loan_applications la
         JOIN users u ON u.id = la.user_id
         LEFT JOIN loan_products lp ON lp.id = la.product_id
         WHERE la.tenant_id = $1
         ORDER BY la.created_at DESC
         LIMIT 10`,
        [tenantId]
      ),
      query(
        `SELECT COUNT(*) AS count
         FROM repayment_schedule rs
         JOIN loan_applications la ON la.id = rs.loan_id
         WHERE la.tenant_id = $1 AND rs.status IN ('overdue','failed')`,
        [tenantId]
      ),
      query(
        `SELECT status, COUNT(*) AS count
         FROM loan_applications WHERE tenant_id = $1
         GROUP BY status`,
        [tenantId]
      ),
    ]);

    const totalDisbursed = parseInt(defaultRateResult.rows[0].total_disbursed, 10);
    const defaulted = parseInt(defaultRateResult.rows[0].defaulted, 10);
    const defaultRate = totalDisbursed > 0 ? ((defaulted / totalDisbursed) * 100).toFixed(2) : '0.00';

    return res.json({
      success: true,
      message: 'Dashboard loaded.',
      data: {
        total_applications: parseInt(totalAppsResult.rows[0].count, 10),
        pending_applications: parseInt(pendingAppsResult.rows[0].count, 10),
        total_disbursed_amount: Number(disbursedAmtResult.rows[0].total),
        total_repaid_amount: Number(totalRepaidResult.rows[0].total),
        default_rate: parseFloat(defaultRate),
        total_revenue: Number(revenueResult.rows[0].total),
        overdue_repayments: parseInt(overdueResult.rows[0].count, 10),
        recent_applications: recentAppsResult.rows,
        status_distribution: statusDistResult.rows.reduce((acc, r) => {
          acc[r.status] = parseInt(r.count, 10);
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    console.error('[AdminDashboard] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load admin dashboard.' });
  }
}

// ---------------------------------------------------------------------------
// getLoans
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/loans
 * Paginated, filterable list of all loan applications.
 */
async function getLoans(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    const { status, search, product_id, from_date, to_date } = req.query;

    const conditions = ['la.tenant_id = $1'];
    const params = [tenantId];
    let paramIndex = 2;

    if (status) {
      conditions.push(`la.status = $${paramIndex++}`);
      params.push(status);
    }

    if (product_id) {
      conditions.push(`la.product_id = $${paramIndex++}`);
      params.push(parseInt(product_id, 10));
    }

    if (from_date) {
      conditions.push(`la.created_at >= $${paramIndex++}`);
      params.push(from_date);
    }

    if (to_date) {
      conditions.push(`la.created_at <= $${paramIndex++}`);
      params.push(to_date);
    }

    if (search) {
      conditions.push(
        `(u.first_name ILIKE $${paramIndex} OR u.last_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`
      );
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM loan_applications la
      JOIN users u ON u.id = la.user_id
      ${whereClause}
    `;

    const dataQuery = `
      SELECT la.*, u.first_name, u.last_name, u.email, u.phone, u.tier,
             lp.name AS product_name
      FROM loan_applications la
      JOIN users u ON u.id = la.user_id
      LEFT JOIN loan_products lp ON lp.id = la.product_id
      ${whereClause}
      ORDER BY la.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const [countResult, dataResult] = await Promise.all([
      query(countQuery, params),
      query(dataQuery, [...params, limit, offset]),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);

    return res.json({
      success: true,
      message: 'Loans fetched.',
      data: {
        loans: dataResult.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('[GetLoans] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch loans.' });
  }
}

// ---------------------------------------------------------------------------
// getLoanDetail
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/loans/:loanId
 * Full loan detail including user, product, documents, schedule, messages.
 */
async function getLoanDetail(req, res) {
  try {
    const loanId = parseInt(req.params.loanId, 10);
    const tenantId = req.user.tenant_id || 1;

    const loanResult = await query(
      `SELECT la.*,
              u.id AS customer_id, u.first_name, u.last_name, u.email, u.phone,
              u.account_number, u.bank_name, u.tier, u.is_verified,
              lp.name AS product_name, lp.description AS product_description,
              lp.min_amount, lp.max_amount, lp.min_tenor_months, lp.max_tenor_months
       FROM loan_applications la
       JOIN users u ON u.id = la.user_id
       LEFT JOIN loan_products lp ON lp.id = la.product_id
       WHERE la.id = $1 AND la.tenant_id = $2`,
      [loanId, tenantId]
    );

    if (!loanResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Loan not found.' });
    }

    const loanRow = loanResult.rows[0];

    // Separate user from loan fields
    const user = {
      id: loanRow.customer_id,
      first_name: loanRow.first_name,
      last_name: loanRow.last_name,
      email: loanRow.email,
      phone: loanRow.phone,
      account_number: loanRow.account_number,
      bank_name: loanRow.bank_name,
      tier: loanRow.tier,
      is_verified: loanRow.is_verified,
    };

    const [docsResult, scheduleResult, messagesResult] = await Promise.all([
      query('SELECT * FROM documents WHERE loan_id = $1', [loanId]),
      query(
        'SELECT * FROM repayment_schedule WHERE loan_id = $1 ORDER BY month_number ASC',
        [loanId]
      ),
      query(
        `SELECT m.*, u.first_name, u.last_name
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.loan_id = $1
         ORDER BY m.created_at ASC`,
        [loanId]
      ),
    ]);

    return res.json({
      success: true,
      message: 'Loan detail fetched.',
      data: {
        loan: loanRow,
        user,
        documents: docsResult.rows,
        repaymentSchedule: scheduleResult.rows,
        messages: messagesResult.rows,
      },
    });
  } catch (err) {
    console.error('[AdminGetLoanDetail] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch loan detail.' });
  }
}

// ---------------------------------------------------------------------------
// approveLoan
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/loans/:loanId/approve
 */
async function approveLoan(req, res) {
  try {
    const loanId = parseInt(req.params.loanId, 10);
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;

    let { amount_approved, interest_rate } = req.body;
    amount_approved = parseInt(amount_approved, 10);

    // Fetch loan
    const loanResult = await query(
      `SELECT la.*, u.email, u.first_name, u.last_name, u.account_number
       FROM loan_applications la
       JOIN users u ON u.id = la.user_id
       WHERE la.id = $1 AND la.tenant_id = $2`,
      [loanId, tenantId]
    );

    if (!loanResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Loan not found.' });
    }

    const loan = loanResult.rows[0];

    if (!['pending', 'under_review'].includes(loan.status)) {
      return res.status(400).json({
        success: false,
        message: `Loan cannot be approved because its current status is '${loan.status}'.`,
      });
    }

    // Use tenant default rate if not provided
    if (interest_rate === undefined || interest_rate === null || interest_rate === '') {
      const settingsResult = await query(
        'SELECT interest_rate FROM tenant_settings WHERE tenant_id = $1 LIMIT 1',
        [tenantId]
      );
      interest_rate = settingsResult.rows.length
        ? parseFloat(settingsResult.rows[0].interest_rate)
        : 5.0;
    } else {
      interest_rate = parseFloat(interest_rate);
    }

    // Calculate repayment figures
    const interestPerMonth = Math.round((amount_approved * interest_rate) / 100);
    const principalPerMonth = Math.round(amount_approved / loan.tenor_months);
    const monthlyRepayment = principalPerMonth + interestPerMonth;
    const totalRepayable = monthlyRepayment * loan.tenor_months;

    // Update loan
    const updatedLoan = await query(
      `UPDATE loan_applications
       SET status = 'approved',
           amount_approved = $1,
           interest_rate_at_approval = $2,
           monthly_repayment = $3,
           total_repayable = $4
       WHERE id = $5
       RETURNING *`,
      [amount_approved, interest_rate, monthlyRepayment, totalRepayable, loanId]
    );

    const approvedLoan = updatedLoan.rows[0];

    // Pre-generate repayment schedule based on NOW (will be regenerated on disbursement)
    await generateRepaymentSchedule(
      loanId,
      amount_approved,
      interest_rate,
      loan.tenor_months,
      new Date()
    );

    // Audit log
    await createAuditLog(tenantId, actorId, 'loan.approved', 'loan', loanId, {
      amount_approved,
      interest_rate,
      monthly_repayment: monthlyRepayment,
    });

    // Notification for customer
    await query(
      `INSERT INTO notifications (tenant_id, user_id, title, message)
       VALUES ($1, $2, $3, $4)`,
      [
        tenantId,
        loan.user_id,
        'Loan Application Approved',
        `Your loan application #${loanId} for ₦${(amount_approved / 100).toLocaleString()} has been approved!`,
      ]
    );

    // Email customer
    emailService
      .sendLoanApproved(
        { email: loan.email, first_name: loan.first_name, last_name: loan.last_name },
        approvedLoan
      )
      .catch(console.error);

    return res.json({
      success: true,
      message: 'Loan approved successfully.',
      data: { loan: approvedLoan },
    });
  } catch (err) {
    console.error('[ApproveLoan] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to approve loan.' });
  }
}

// ---------------------------------------------------------------------------
// declineLoan
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/loans/:loanId/decline
 */
async function declineLoan(req, res) {
  try {
    const loanId = parseInt(req.params.loanId, 10);
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;
    const { decline_reason } = req.body;

    const loanResult = await query(
      `SELECT la.*, u.email, u.first_name, u.last_name, u.id AS customer_user_id
       FROM loan_applications la
       JOIN users u ON u.id = la.user_id
       WHERE la.id = $1 AND la.tenant_id = $2`,
      [loanId, tenantId]
    );

    if (!loanResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Loan not found.' });
    }

    const loan = loanResult.rows[0];

    if (!['pending', 'under_review'].includes(loan.status)) {
      return res.status(400).json({
        success: false,
        message: `Loan cannot be declined because its current status is '${loan.status}'.`,
      });
    }

    const updatedLoan = await query(
      `UPDATE loan_applications
       SET status = 'declined', decline_reason = $1
       WHERE id = $2
       RETURNING *`,
      [decline_reason, loanId]
    );

    await createAuditLog(tenantId, actorId, 'loan.declined', 'loan', loanId, { decline_reason });

    // Notification
    await query(
      `INSERT INTO notifications (tenant_id, user_id, title, message)
       VALUES ($1, $2, $3, $4)`,
      [
        tenantId,
        loan.user_id,
        'Loan Application Declined',
        `Your loan application #${loanId} was not approved at this time. Reason: ${decline_reason}`,
      ]
    );

    // Email
    emailService
      .sendLoanDeclined(
        { email: loan.email, first_name: loan.first_name, last_name: loan.last_name },
        updatedLoan.rows[0],
        decline_reason
      )
      .catch(console.error);

    return res.json({
      success: true,
      message: 'Loan declined.',
      data: { loan: updatedLoan.rows[0] },
    });
  } catch (err) {
    console.error('[DeclineLoan] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to decline loan.' });
  }
}

// ---------------------------------------------------------------------------
// disburseLoan
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/loans/:loanId/disburse
 */
async function disburseLoan(req, res) {
  try {
    const loanId = parseInt(req.params.loanId, 10);
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;

    const loanResult = await query(
      `SELECT la.*, u.email, u.first_name, u.last_name, u.account_number, u.id AS customer_user_id
       FROM loan_applications la
       JOIN users u ON u.id = la.user_id
       WHERE la.id = $1 AND la.tenant_id = $2`,
      [loanId, tenantId]
    );

    if (!loanResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Loan not found.' });
    }

    const loan = loanResult.rows[0];

    if (loan.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: `Loan must be in 'approved' status to disburse. Current status: '${loan.status}'.`,
      });
    }

    if (!loan.account_number) {
      return res.status(400).json({
        success: false,
        message: 'Customer does not have a registered bank account for disbursement.',
      });
    }

    // Call bank API to credit customer
    const bankResult = await bankAPI.creditAccount(
      loan.account_number,
      Number(loan.amount_approved),
      `Loan Disbursement - Loan #${loanId}`
    );

    if (bankResult.status !== 'success') {
      return res.status(502).json({
        success: false,
        message: 'Disbursement failed: bank transfer was not successful.',
      });
    }

    const disbursedAt = new Date();

    // Update loan status
    const updatedLoan = await query(
      `UPDATE loan_applications
       SET status = 'disbursed', disbursed_at = $1
       WHERE id = $2
       RETURNING *`,
      [disbursedAt, loanId]
    );

    // Regenerate repayment schedule from actual disbursed_at date
    await generateRepaymentSchedule(
      loanId,
      Number(loan.amount_approved),
      Number(loan.interest_rate_at_approval),
      loan.tenor_months,
      disbursedAt
    );

    // Log revenue / commission
    const commissionAmount = Math.round(Number(loan.amount_approved) * COMMISSION_RATE);
    await query(
      `INSERT INTO loan_revenue_log (tenant_id, loan_id, disbursed_amount, commission_rate, commission_amount)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, loanId, Number(loan.amount_approved), COMMISSION_RATE, commissionAmount]
    );

    // Audit log
    await createAuditLog(tenantId, actorId, 'loan.disbursed', 'loan', loanId, {
      amount_disbursed: Number(loan.amount_approved),
      bank_ref: bankResult.transactionRef,
      commission_amount: commissionAmount,
    });

    // Notification
    await query(
      `INSERT INTO notifications (tenant_id, user_id, title, message)
       VALUES ($1, $2, $3, $4)`,
      [
        tenantId,
        loan.customer_user_id,
        'Loan Disbursed',
        `₦${(Number(loan.amount_approved) / 100).toLocaleString()} has been sent to your Providus Bank account.`,
      ]
    );

    // Email
    const customer = {
      email: loan.email,
      first_name: loan.first_name,
      last_name: loan.last_name,
      account_number: loan.account_number,
    };
    emailService.sendLoanDisbursed(customer, updatedLoan.rows[0]).catch(console.error);

    return res.json({
      success: true,
      message: 'Loan disbursed successfully.',
      data: {
        loan: updatedLoan.rows[0],
        transactionRef: bankResult.transactionRef,
      },
    });
  } catch (err) {
    console.error('[DisburseLoan] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to disburse loan.' });
  }
}

// ---------------------------------------------------------------------------
// getAdminMessages
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/loans/:loanId/messages
 * Returns all messages for a loan, marking customer messages as read.
 */
async function getAdminMessages(req, res) {
  try {
    const loanId = parseInt(req.params.loanId, 10);
    const tenantId = req.user.tenant_id || 1;

    const loanCheck = await query(
      'SELECT id FROM loan_applications WHERE id = $1 AND tenant_id = $2',
      [loanId, tenantId]
    );
    if (!loanCheck.rows.length) {
      return res.status(404).json({ success: false, message: 'Loan not found.' });
    }

    // Mark customer messages as read for admin
    await query(
      `UPDATE messages SET is_read = true
       WHERE loan_id = $1 AND sender_role = 'customer' AND is_read = false`,
      [loanId]
    );

    const messagesResult = await query(
      `SELECT m.*, m.content AS message, u.first_name, u.last_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.loan_id = $1
       ORDER BY m.created_at ASC`,
      [loanId]
    );

    return res.json({
      success: true,
      message: 'Messages fetched.',
      data: { messages: messagesResult.rows },
    });
  } catch (err) {
    console.error('[GetAdminMessages] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch messages.' });
  }
}

// ---------------------------------------------------------------------------
// sendAdminMessage
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/loans/:loanId/messages
 * Sends a message from an admin to the customer.
 */
async function sendAdminMessage(req, res) {
  try {
    const loanId = parseInt(req.params.loanId, 10);
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;
    const actorRole = req.user.role;
    const content = req.body.message || req.body.content;

    // Fetch loan and customer
    const loanResult = await query(
      `SELECT la.*, u.id AS customer_user_id, u.email AS customer_email,
              u.first_name AS customer_first_name, u.last_name AS customer_last_name
       FROM loan_applications la
       JOIN users u ON u.id = la.user_id
       WHERE la.id = $1 AND la.tenant_id = $2`,
      [loanId, tenantId]
    );

    if (!loanResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Loan not found.' });
    }

    const loan = loanResult.rows[0];

    const msgResult = await query(
      `INSERT INTO messages (tenant_id, loan_id, sender_id, sender_role, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *, content AS message`,
      [tenantId, loanId, actorId, actorRole, content]
    );
    const message = msgResult.rows[0];

    // Notify customer
    await query(
      `INSERT INTO notifications (tenant_id, user_id, title, message)
       VALUES ($1, $2, $3, $4)`,
      [
        tenantId,
        loan.customer_user_id,
        `New message on your Loan #${loanId}`,
        'The Kufre Loans team has sent you a message. Log in to view and respond.',
      ]
    );

    const customer = {
      email: loan.customer_email,
      first_name: loan.customer_first_name,
    };
    emailService
      .sendNewMessageNotification(customer, { id: loanId })
      .catch(console.error);

    return res.status(201).json({
      success: true,
      message: 'Message sent.',
      data: { message },
    });
  } catch (err) {
    console.error('[SendAdminMessage] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
}

// ---------------------------------------------------------------------------
// getUsers
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/users
 * Lists all customer accounts with loan counts and active loan status.
 */
async function getUsers(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
    const offset = (page - 1) * limit;
    const { search } = req.query;

    const conditions = ["u.role = 'customer'", 'u.tenant_id = $1'];
    const params = [tenantId];
    let paramIndex = 2;

    if (search) {
      conditions.push(
        `(u.first_name ILIKE $${paramIndex} OR u.last_name ILIKE $${paramIndex} OR u.email ILIKE $${paramIndex})`
      );
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM users u ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const usersResult = await query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.tier,
              u.account_number, u.bank_name, u.is_verified, u.created_at,
              COUNT(la.id) AS total_loans,
              COUNT(la.id) FILTER (WHERE la.status IN ('approved','disbursed')) AS active_loans
       FROM users u
       LEFT JOIN loan_applications la ON la.user_id = u.id
       ${whereClause}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      message: 'Users fetched.',
      data: {
        users: usersResult.rows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('[GetUsers] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
}

// ---------------------------------------------------------------------------
// getUserDetail
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/users/:userId
 * Full user profile with complete loan history.
 */
async function getUserDetail(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10);
    const tenantId = req.user.tenant_id || 1;

    const userResult = await query(
      `SELECT id, tenant_id, first_name, last_name, email, phone, role,
              account_number, bank_name, tier, is_verified, created_at
       FROM users
       WHERE id = $1 AND tenant_id = $2`,
      [userId, tenantId]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = userResult.rows[0];

    const loansResult = await query(
      `SELECT la.*, lp.name AS product_name
       FROM loan_applications la
       LEFT JOIN loan_products lp ON lp.id = la.product_id
       WHERE la.user_id = $1
       ORDER BY la.created_at DESC`,
      [userId]
    );

    return res.json({
      success: true,
      message: 'User detail fetched.',
      data: {
        user,
        loans: loansResult.rows,
      },
    });
  } catch (err) {
    console.error('[GetUserDetail] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch user detail.' });
  }
}

// ---------------------------------------------------------------------------
// createTeamMember
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/team
 * Creates an approver or viewer account (super_admin only).
 */
async function createTeamMember(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;
    const { first_name, last_name, email, password, role, phone } = req.body;

    // Prevent creating another super_admin
    if (role === 'super_admin') {
      return res.status(403).json({ success: false, message: 'Cannot create super_admin accounts via this endpoint.' });
    }

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({ success: false, message: 'A user with this email already exists.' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

    const insertResult = await query(
      `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, phone, role, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id, tenant_id, first_name, last_name, email, phone, role, is_verified, created_at`,
      [tenantId, first_name, last_name, email, password_hash, phone || null, role]
    );

    const newMember = insertResult.rows[0];

    await createAuditLog(tenantId, actorId, 'team.member.created', 'user', newMember.id, {
      role,
      email,
    });

    // Send welcome email with credentials
    emailService.sendTeamMemberWelcome({ first_name, email }, role, password).catch(
      (e) => console.error('[CreateTeamMember] Email error:', e.message)
    );

    return res.status(201).json({
      success: true,
      message: 'Team member created successfully.',
      data: { member: newMember },
    });
  } catch (err) {
    console.error('[CreateTeamMember] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create team member.' });
  }
}

// ---------------------------------------------------------------------------
// getTeamMembers
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/team
 * Returns all non-customer users (admins, approvers, viewers).
 */
async function getTeamMembers(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;

    const result = await query(
      `SELECT id, tenant_id, first_name, last_name, email, phone, role, is_verified, created_at
       FROM users
       WHERE tenant_id = $1 AND role != 'customer'
       ORDER BY created_at ASC`,
      [tenantId]
    );

    return res.json({
      success: true,
      message: 'Team members fetched.',
      data: { members: result.rows },
    });
  } catch (err) {
    console.error('[GetTeamMembers] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch team members.' });
  }
}

// ---------------------------------------------------------------------------
// deleteTeamMember
// ---------------------------------------------------------------------------

/**
 * DELETE /api/admin/team/:userId
 * Deletes a team member (super_admin only). Cannot delete yourself.
 */
async function deleteTeamMember(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;
    const targetId = parseInt(req.params.userId, 10);

    if (actorId === targetId) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }

    const existing = await query(
      'SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2 AND role != $3',
      [targetId, tenantId, 'customer']
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Team member not found.' });
    }
    if (existing.rows[0].role === 'super_admin') {
      return res.status(403).json({ success: false, message: 'Cannot delete a super admin account.' });
    }

    await query('DELETE FROM users WHERE id = $1', [targetId]);
    await createAuditLog(tenantId, actorId, 'team.member.deleted', 'user', targetId, {});

    return res.json({ success: true, message: 'Team member deleted.' });
  } catch (err) {
    console.error('[DeleteTeamMember] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete team member.' });
  }
}

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------

/**
 * PATCH /api/admin/settings
 * Updates tenant settings (super_admin only).
 */
async function updateSettings(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;

    const {
      interest_rate,
      tier1_max_amount,
      tier2_max_amount,
      tier3_max_amount,
      platform_name,
      support_email,
    } = req.body;

    // Build dynamic SET clause
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (interest_rate !== undefined) {
      updates.push(`interest_rate = $${paramIndex++}`);
      params.push(parseFloat(interest_rate));
    }
    if (tier1_max_amount !== undefined) {
      updates.push(`tier1_max_amount = $${paramIndex++}`);
      params.push(parseInt(tier1_max_amount, 10));
    }
    if (tier2_max_amount !== undefined) {
      updates.push(`tier2_max_amount = $${paramIndex++}`);
      params.push(parseInt(tier2_max_amount, 10));
    }
    if (tier3_max_amount !== undefined) {
      updates.push(`tier3_max_amount = $${paramIndex++}`);
      params.push(parseInt(tier3_max_amount, 10));
    }
    if (platform_name !== undefined) {
      updates.push(`platform_name = $${paramIndex++}`);
      params.push(platform_name);
    }
    if (support_email !== undefined) {
      updates.push(`support_email = $${paramIndex++}`);
      params.push(support_email);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields provided for update.' });
    }

    params.push(tenantId);
    const result = await query(
      `UPDATE tenant_settings SET ${updates.join(', ')} WHERE tenant_id = $${paramIndex} RETURNING *`,
      params
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Tenant settings not found.' });
    }

    await createAuditLog(tenantId, actorId, 'settings.updated', 'tenant_settings', tenantId, req.body);

    return res.json({
      success: true,
      message: 'Settings updated successfully.',
      data: { settings: result.rows[0] },
    });
  } catch (err) {
    console.error('[UpdateSettings] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update settings.' });
  }
}

// ---------------------------------------------------------------------------
// getSettings
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/settings
 * Returns the current tenant settings.
 */
async function getSettings(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;

    const result = await query(
      'SELECT * FROM tenant_settings WHERE tenant_id = $1 LIMIT 1',
      [tenantId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Settings not found.' });
    }

    return res.json({
      success: true,
      message: 'Settings fetched.',
      data: { settings: result.rows[0] },
    });
  } catch (err) {
    console.error('[GetSettings] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch settings.' });
  }
}

// ---------------------------------------------------------------------------
// getLoanProducts
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/products
 * Returns all loan products for this tenant.
 */
async function getLoanProducts(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;
    const result = await query(
      'SELECT * FROM loan_products WHERE tenant_id = $1 ORDER BY created_at ASC',
      [tenantId]
    );
    return res.json({ success: true, message: 'Loan products fetched.', data: { products: result.rows } });
  } catch (err) {
    console.error('[GetLoanProducts] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch loan products.' });
  }
}

// ---------------------------------------------------------------------------
// createLoanProduct
// ---------------------------------------------------------------------------

/**
 * POST /api/admin/products
 * Creates a new loan product (super_admin only).
 */
async function createLoanProduct(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;
    const { name, description, min_amount, max_amount, min_tenor_months, max_tenor_months } = req.body;

    const result = await query(
      `INSERT INTO loan_products
         (tenant_id, name, description, min_amount, max_amount, min_tenor_months, max_tenor_months, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING *`,
      [tenantId, name, description || null, parseInt(min_amount, 10), parseInt(max_amount, 10),
       parseInt(min_tenor_months, 10), parseInt(max_tenor_months, 10)]
    );

    const product = result.rows[0];
    await createAuditLog(tenantId, actorId, 'product.created', 'loan_product', product.id, { name });

    return res.status(201).json({ success: true, message: 'Loan product created.', data: { product } });
  } catch (err) {
    console.error('[CreateLoanProduct] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create loan product.' });
  }
}

// ---------------------------------------------------------------------------
// updateLoanProduct
// ---------------------------------------------------------------------------

/**
 * PUT /api/admin/products/:productId
 * Updates a loan product (super_admin only).
 */
async function updateLoanProduct(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;
    const productId = parseInt(req.params.productId, 10);
    const { name, description, min_amount, max_amount, min_tenor_months, max_tenor_months, is_active } = req.body;

    const existing = await query(
      'SELECT id FROM loan_products WHERE id = $1 AND tenant_id = $2',
      [productId, tenantId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Loan product not found.' });
    }

    const updates = [];
    const params = [];
    let i = 1;
    if (name !== undefined)               { updates.push(`name = $${i++}`);                params.push(name); }
    if (description !== undefined)        { updates.push(`description = $${i++}`);         params.push(description); }
    if (min_amount !== undefined)         { updates.push(`min_amount = $${i++}`);          params.push(parseInt(min_amount, 10)); }
    if (max_amount !== undefined)         { updates.push(`max_amount = $${i++}`);          params.push(parseInt(max_amount, 10)); }
    if (min_tenor_months !== undefined)   { updates.push(`min_tenor_months = $${i++}`);    params.push(parseInt(min_tenor_months, 10)); }
    if (max_tenor_months !== undefined)   { updates.push(`max_tenor_months = $${i++}`);    params.push(parseInt(max_tenor_months, 10)); }
    if (is_active !== undefined)          { updates.push(`is_active = $${i++}`);           params.push(Boolean(is_active)); }

    if (!updates.length) {
      return res.status(400).json({ success: false, message: 'No fields provided to update.' });
    }

    params.push(productId);
    const result = await query(
      `UPDATE loan_products SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );

    await createAuditLog(tenantId, actorId, 'product.updated', 'loan_product', productId, req.body);

    return res.json({ success: true, message: 'Loan product updated.', data: { product: result.rows[0] } });
  } catch (err) {
    console.error('[UpdateLoanProduct] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update loan product.' });
  }
}

// ---------------------------------------------------------------------------
// deleteLoanProduct
// ---------------------------------------------------------------------------

/**
 * DELETE /api/admin/products/:productId
 * Soft-deletes (deactivates) a loan product (super_admin only).
 * Cannot delete if active loans exist against it.
 */
async function deleteLoanProduct(req, res) {
  try {
    const tenantId = req.user.tenant_id || 1;
    const actorId = req.user.id;
    const productId = parseInt(req.params.productId, 10);

    const existing = await query(
      'SELECT id FROM loan_products WHERE id = $1 AND tenant_id = $2',
      [productId, tenantId]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Loan product not found.' });
    }

    // Block deletion if active loans reference this product
    const activeLoans = await query(
      `SELECT COUNT(*) AS count FROM loan_applications
       WHERE product_id = $1 AND status IN ('pending','under_review','approved','disbursed')`,
      [productId]
    );
    if (parseInt(activeLoans.rows[0].count, 10) > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete a product with active loan applications. Deactivate it instead.',
      });
    }

    await query('DELETE FROM loan_products WHERE id = $1', [productId]);
    await createAuditLog(tenantId, actorId, 'product.deleted', 'loan_product', productId, {});

    return res.json({ success: true, message: 'Loan product deleted.' });
  } catch (err) {
    console.error('[DeleteLoanProduct] Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete loan product.' });
  }
}

module.exports = {
  getAdminDashboard,
  getLoans,
  getLoanDetail,
  approveLoan,
  declineLoan,
  disburseLoan,
  getAdminMessages,
  sendAdminMessage,
  getUsers,
  getUserDetail,
  createTeamMember,
  getTeamMembers,
  deleteTeamMember,
  updateSettings,
  getSettings,
  getLoanProducts,
  createLoanProduct,
  updateLoanProduct,
  deleteLoanProduct,
};
