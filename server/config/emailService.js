const { Resend } = require('resend');
const resendClient = new Resend(process.env.RESEND_API_KEY);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const FROM_ADDRESS = `"Fastfunds Cooperative Society" <${process.env.EMAIL_FROM || 'no-reply@fastfunds.com'}>`;
const BRAND_COLOR = '#D4001A';
const GOLD_COLOR = '#C8992A';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@fastfunds.com';
const CLIENT_URL = process.env.CLIENT_URL || 'https://fastfunds.com';

/**
 * Format a kobo amount as a Nigerian Naira string.
 * @param {number} kobo
 * @returns {string}
 */
function formatNaira(kobo) {
  const naira = (kobo / 100).toFixed(2);
  return `₦${Number(naira).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

/**
 * Wrap content in a consistent branded HTML email shell.
 */
function buildEmailHtml(title, bodyHtml) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&display=swap');
    body { margin: 0; padding: 0; background-color: #f4f4f4; font-family: 'Instrument Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1A1A1A; }
    .wrapper { width: 100%; background-color: #f4f4f4; padding: 30px 0; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background-color: ${BRAND_COLOR}; padding: 28px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 1px; }
    .header p { color: rgba(255,255,255,0.75); margin: 4px 0 0; font-size: 13px; }
    .body { padding: 32px; }
    .body h2 { color: ${BRAND_COLOR}; margin-top: 0; font-size: 20px; }
    .body p { line-height: 1.7; margin: 0 0 16px; }
    .info-box { background-color: #FFF5F5; border-left: 4px solid ${BRAND_COLOR}; border-radius: 4px; padding: 16px 20px; margin: 20px 0; }
    .info-box p { margin: 4px 0; font-size: 14px; }
    .info-box strong { color: ${BRAND_COLOR}; }
    .btn { display: inline-block; background-color: ${BRAND_COLOR}; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: bold; font-size: 15px; margin: 8px 0; }
    .footer { background-color: #f9f9f9; padding: 20px 32px; text-align: center; font-size: 12px; color: #999999; border-top: 1px solid #eeeeee; }
    .footer a { color: ${BRAND_COLOR}; text-decoration: none; }
    .divider { border: none; border-top: 1px solid #eeeeee; margin: 24px 0; }
    .status-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: bold; }
    .status-success { background-color: #d4edda; color: #155724; }
    .status-warning { background-color: #fff3cd; color: #856404; }
    .status-danger { background-color: #f8d7da; color: #721c24; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <h1>Fastfunds Cooperative Society</h1>
        <p>Empowering Members, Building Futures</p>
      </div>
      <div class="body">
        ${bodyHtml}
      </div>
      <div class="footer">
        <p>You received this email because you have an account with Fastfunds Cooperative Society.</p>
        <p>Need help? <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
        <p>&copy; ${new Date().getFullYear()} Fastfunds Cooperative Society Limited. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Send an email, logging errors without throwing.
 */
async function sendMail(to, subject, html) {
  try {
    const { data, error } = await resendClient.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });
    if (error) {
      console.error(`[EmailService] Failed to send "${subject}" to ${to}:`, error.message);
      return null;
    }
    console.log(`[EmailService] Sent "${subject}" to ${to} — ID: ${data.id}`);
    return data;
  } catch (err) {
    console.error(`[EmailService] Failed to send "${subject}" to ${to}:`, err.message);
  }
}

// ---------------------------------------------------------------------------
// Email methods
// ---------------------------------------------------------------------------

const emailService = {
  /**
   * Welcome email after successful registration.
   */
  async sendWelcome(user, accountNumber) {
    const subject = 'Welcome to Fastfunds Cooperative Society!';
    const html = buildEmailHtml(
      subject,
      `
      <h2>Welcome, ${user.first_name}! 🎉</h2>
      <p>Your account has been successfully created. You are now part of the Fastfunds Cooperative Society family — where smart lending meets trusted finance.</p>
      <div class="info-box">
        <p><strong>Your Virtual Account Details</strong></p>
        <p>Account Number: <strong>${accountNumber}</strong></p>
        <p>Bank: <strong>Providus Bank</strong></p>
        <p>Account Name: <strong>${user.first_name} ${user.last_name}</strong></p>
      </div>
      <p>You can use these details to fund your wallet or make repayments. Keep them safe.</p>
      <p>Ready to get started?</p>
      <a href="${CLIENT_URL}/dashboard" class="btn">Go to Dashboard</a>
      <hr class="divider" />
      <p style="font-size: 13px; color: #777;">If you did not create this account, please contact us immediately at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
      `
    );
    await sendMail(user.email, subject, html);
  },

  /**
   * Confirmation email when a loan application is submitted.
   */
  async sendLoanApplicationReceived(user, loanId) {
    const subject = `Loan Application Received — Ref #${loanId}`;
    const html = buildEmailHtml(
      subject,
      `
      <h2>We've received your application!</h2>
      <p>Hi ${user.first_name}, thank you for applying with Fastfunds Cooperative Society. Your application is currently under review.</p>
      <div class="info-box">
        <p><strong>Application Reference:</strong> #${loanId}</p>
        <p><strong>Status:</strong> <span class="status-badge status-warning">Under Review</span></p>
      </div>
      <p>Our team typically reviews applications within <strong>1–2 business days</strong>. We will send you an update as soon as a decision is made.</p>
      <a href="${CLIENT_URL}/dashboard/loans/${loanId}" class="btn">Track Your Application</a>
      <p style="margin-top: 20px;">If you have any questions, feel free to message us through your loan portal.</p>
      `
    );
    await sendMail(user.email, subject, html);
  },

  /**
   * Email when a loan application is approved.
   */
  async sendLoanApproved(user, loan) {
    const subject = `Your Loan Has Been Approved — Ref #${loan.id}`;
    const html = buildEmailHtml(
      subject,
      `
      <h2>Congratulations, ${user.first_name}!</h2>
      <p>Great news — your loan application has been <strong>approved</strong>. Here are the details of your approved loan:</p>
      <div class="info-box">
        <p><strong>Loan Reference:</strong> #${loan.id}</p>
        <p><strong>Approved Amount:</strong> ${formatNaira(loan.amount_approved)}</p>
        <p><strong>Interest Rate:</strong> ${loan.interest_rate_at_approval}% per month (flat)</p>
        <p><strong>Tenor:</strong> ${loan.tenor_months} month(s)</p>
        <p><strong>Monthly Repayment:</strong> ${formatNaira(loan.monthly_repayment)}</p>
        <p><strong>Total Repayable:</strong> ${formatNaira(loan.total_repayable)}</p>
        <p><strong>Status:</strong> <span class="status-badge status-success">Approved</span></p>
      </div>
      <p>Your loan will be disbursed to your registered virtual account shortly. Please ensure your account details are up to date.</p>
      <a href="${CLIENT_URL}/dashboard/loans/${loan.id}" class="btn">View Loan Details</a>
      `
    );
    await sendMail(user.email, subject, html);
  },

  /**
   * Email when a loan application is declined.
   */
  async sendLoanDeclined(user, loan, reason) {
    const subject = `Loan Application Update — Ref #${loan.id}`;
    const html = buildEmailHtml(
      subject,
      `
      <h2>Application Decision Update</h2>
      <p>Hi ${user.first_name}, we regret to inform you that your loan application has not been approved at this time.</p>
      <div class="info-box">
        <p><strong>Loan Reference:</strong> #${loan.id}</p>
        <p><strong>Status:</strong> <span class="status-badge status-danger">Declined</span></p>
        <p><strong>Reason:</strong> ${reason || 'Not specified.'}</p>
      </div>
      <p>This decision does not permanently affect your eligibility. You may reapply after addressing the reason above or contact our support team for guidance.</p>
      <a href="${CLIENT_URL}/dashboard" class="btn">Back to Dashboard</a>
      <p style="margin-top: 20px; font-size: 13px; color: #777;">If you believe this decision was made in error, please contact us at <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
      `
    );
    await sendMail(user.email, subject, html);
  },

  /**
   * Email when a loan is disbursed to the customer's account.
   */
  async sendLoanDisbursed(user, loan) {
    const subject = `Loan Disbursed — ${formatNaira(loan.amount_approved)} Sent`;
    const html = buildEmailHtml(
      subject,
      `
      <h2>Your loan has been disbursed!</h2>
      <p>Hi ${user.first_name}, ${formatNaira(loan.amount_approved)} has been successfully transferred to your registered Providus Bank virtual account.</p>
      <div class="info-box">
        <p><strong>Loan Reference:</strong> #${loan.id}</p>
        <p><strong>Amount Disbursed:</strong> ${formatNaira(loan.amount_approved)}</p>
        <p><strong>Destination Account:</strong> ${user.account_number} (Providus Bank)</p>
        <p><strong>Tenor:</strong> ${loan.tenor_months} month(s)</p>
        <p><strong>Monthly Repayment:</strong> ${formatNaira(loan.monthly_repayment)}</p>
        <p><strong>Status:</strong> <span class="status-badge status-success">Disbursed</span></p>
      </div>
      <p>Your first repayment will be due in <strong>30 days</strong>. Repayments will be automatically debited from your virtual account each month — please ensure it is funded.</p>
      <a href="${CLIENT_URL}/dashboard/loans/${loan.id}" class="btn">View Repayment Schedule</a>
      `
    );
    await sendMail(user.email, subject, html);
  },

  /**
   * Email when a repayment is successfully processed.
   */
  async sendRepaymentSuccessful(user, repayment, loan) {
    const subject = `Repayment Successful — Month ${repayment.month_number}`;
    const html = buildEmailHtml(
      subject,
      `
      <h2>Repayment Confirmed</h2>
      <p>Hi ${user.first_name}, your repayment for Month ${repayment.month_number} has been successfully processed.</p>
      <div class="info-box">
        <p><strong>Loan Reference:</strong> #${loan.id}</p>
        <p><strong>Month:</strong> ${repayment.month_number} of ${loan.tenor_months}</p>
        <p><strong>Amount Paid:</strong> ${formatNaira(repayment.total_amount)}</p>
        <p><strong>Principal:</strong> ${formatNaira(repayment.principal_amount)}</p>
        <p><strong>Interest:</strong> ${formatNaira(repayment.interest_amount)}</p>
        <p><strong>Paid On:</strong> ${new Date().toLocaleDateString('en-NG', { dateStyle: 'long' })}</p>
        <p><strong>Status:</strong> <span class="status-badge status-success">Paid</span></p>
      </div>
      <p>Thank you for keeping up with your repayments — it helps build your credit profile for higher loan amounts in the future.</p>
      <a href="${CLIENT_URL}/dashboard/loans/${loan.id}" class="btn">View Repayment Schedule</a>
      `
    );
    await sendMail(user.email, subject, html);
  },

  /**
   * Email when a repayment debit attempt fails.
   */
  async sendRepaymentFailed(user, repayment, loan) {
    const subject = `Action Required: Repayment Failed — Month ${repayment.month_number}`;
    const html = buildEmailHtml(
      subject,
      `
      <h2>Repayment Could Not Be Processed</h2>
      <p>Hi ${user.first_name}, we were unable to debit your account for the Month ${repayment.month_number} repayment on Loan #${loan.id}.</p>
      <div class="info-box">
        <p><strong>Loan Reference:</strong> #${loan.id}</p>
        <p><strong>Month:</strong> ${repayment.month_number} of ${loan.tenor_months}</p>
        <p><strong>Amount Due:</strong> ${formatNaira(repayment.total_amount)}</p>
        <p><strong>Due Date:</strong> ${new Date(repayment.due_date).toLocaleDateString('en-NG', { dateStyle: 'long' })}</p>
        <p><strong>Status:</strong> <span class="status-badge status-danger">Failed</span></p>
      </div>
      <p><strong>Please fund your Providus Bank virtual account (${user.account_number}) immediately</strong> to avoid penalties and negative impact on your loan profile.</p>
      <p>If you have already funded your account, please contact our support team.</p>
      <a href="mailto:${SUPPORT_EMAIL}" class="btn">Contact Support</a>
      `
    );
    await sendMail(user.email, subject, html);
  },

  /**
   * Email notifying customer of a new message from admin on their loan.
   */
  async sendNewMessageNotification(user, loan) {
    const subject = `New Message on Your Loan #${loan.id}`;
    const html = buildEmailHtml(
      subject,
      `
      <h2>You have a new message</h2>
      <p>Hi ${user.first_name}, the Fastfunds Cooperative Society team has sent you a message regarding your Loan #${loan.id}.</p>
      <p>Log in to your portal to read and respond to the message.</p>
      <a href="${CLIENT_URL}/dashboard/loans/${loan.id}?tab=messages" class="btn">View Message</a>
      `
    );
    await sendMail(user.email, subject, html);
  },

  /**
   * Welcome email for new team members added by super admin.
   */
  async sendTeamMemberWelcome(user, role, password) {
    const subject = 'Welcome to the Fastfunds Cooperative Society Team';
    const html = buildEmailHtml(
      subject,
      `
      <h2>Welcome to the Team, ${user.first_name}!</h2>
      <p>Your Fastfunds Cooperative Society admin account has been created. Here are your login details:</p>
      <div class="info-box">
        <p><strong>Email:</strong> ${user.email}</p>
        <p><strong>Password:</strong> ${password}</p>
        <p><strong>Role:</strong> ${role}</p>
      </div>
      <p>Please log in and change your password immediately.</p>
      <a href="${CLIENT_URL}/admin/login" class="btn">Log In Now</a>
      <p style="margin-top: 20px; font-size: 13px; color: #777;">If you did not expect this email, please contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
      `
    );
    await sendMail(user.email, subject, html);
  },

  /**
   * Admin notification email when a new loan application is submitted.
   */
  async sendAdminNewApplication(adminEmail, loan, customer) {
    const subject = `New Loan Application — #${loan.id} from ${customer.first_name} ${customer.last_name}`;
    const html = buildEmailHtml(
      subject,
      `
      <h2>New Loan Application Received</h2>
      <p>A new loan application has been submitted and requires review.</p>
      <div class="info-box">
        <p><strong>Application ID:</strong> #${loan.id}</p>
        <p><strong>Customer:</strong> ${customer.first_name} ${customer.last_name}</p>
        <p><strong>Email:</strong> ${customer.email}</p>
        <p><strong>Amount Requested:</strong> ${formatNaira(loan.amount_requested)}</p>
        <p><strong>Tenor:</strong> ${loan.tenor_months} month(s)</p>
        <p><strong>Purpose:</strong> ${loan.purpose || 'Not specified'}</p>
        <p><strong>Submitted At:</strong> ${new Date(loan.created_at).toLocaleString('en-NG')}</p>
      </div>
      <a href="${CLIENT_URL}/admin/loans/${loan.id}" class="btn">Review Application</a>
      `
    );
    await sendMail(adminEmail, subject, html);
  },

  /**
   * Admin notification email when a customer repayment fails.
   */
  async sendAdminRepaymentFailed(adminEmail, user, repayment, loan) {
    const subject = `Repayment Failed — Loan #${loan.id} | ${user.first_name} ${user.last_name}`;
    const html = buildEmailHtml(
      subject,
      `
      <h2>Repayment Failure Alert</h2>
      <p>A repayment debit attempt has failed and requires your attention.</p>
      <div class="info-box">
        <p><strong>Loan Reference:</strong> #${loan.id}</p>
        <p><strong>Customer:</strong> ${user.first_name} ${user.last_name} (${user.email})</p>
        <p><strong>Account Number:</strong> ${user.account_number}</p>
        <p><strong>Month:</strong> ${repayment.month_number} of ${loan.tenor_months}</p>
        <p><strong>Amount Due:</strong> ${formatNaira(repayment.total_amount)}</p>
        <p><strong>Due Date:</strong> ${new Date(repayment.due_date).toLocaleDateString('en-NG', { dateStyle: 'long' })}</p>
        <p><strong>Status:</strong> <span class="status-badge status-danger">Failed</span></p>
      </div>
      <a href="${CLIENT_URL}/admin/loans/${loan.id}" class="btn">View Loan</a>
      `
    );
    await sendMail(adminEmail, subject, html);
  },
};

module.exports = emailService;
