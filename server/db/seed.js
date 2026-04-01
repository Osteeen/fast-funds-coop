require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 12;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ------------------------------------------------------------------
    // 1. Tenant
    // ------------------------------------------------------------------
    const tenantResult = await client.query(`
      INSERT INTO tenants (name, primary_color, domain, status)
      VALUES ('Fastfunds Cooperative Society Limited', '#D4001A', 'fastfunds.com', 'active')
      ON CONFLICT DO NOTHING
      RETURNING *;
    `);
    if (tenantResult.rows.length) {
      console.log('Created tenant:', tenantResult.rows[0].name);
    } else {
      console.log('Tenant already exists — skipping.');
    }

    // ------------------------------------------------------------------
    // 2. Tenant settings
    //    NOTE: All amounts stored in KOBO.
    //    tier1 = ₦500,000 → 50,000,000 kobo
    //    tier2 = ₦1,500,000 → 150,000,000 kobo
    //    tier3 = ₦5,000,000 → 500,000,000 kobo
    // ------------------------------------------------------------------
    const settingsResult = await client.query(`
      INSERT INTO tenant_settings
        (tenant_id, interest_rate, tier1_max_amount, tier2_max_amount, tier3_max_amount, platform_name, support_email)
      VALUES (1, 5.00, 50000000, 150000000, 500000000, 'Fastfunds Cooperative Society', 'support@fastfunds.com')
      ON CONFLICT DO NOTHING
      RETURNING *;
    `);
    if (settingsResult.rows.length) {
      console.log('Created tenant_settings for tenant 1');
    } else {
      console.log('Tenant settings already exist — skipping.');
    }

    // ------------------------------------------------------------------
    // 3. Loan products
    //    Quick Loan:    ₦100,000 – ₦500,000 (10,000,000 – 50,000,000 kobo), 1–12 months
    //    Business Loan: ₦500,000 – ₦5,000,000 (50,000,000 – 500,000,000 kobo), 3–24 months
    // ------------------------------------------------------------------
    const quickLoan = await client.query(`
      INSERT INTO loan_products
        (tenant_id, name, description, min_amount, max_amount, min_tenor_months, max_tenor_months, is_active)
      VALUES (
        1,
        'Quick Loan',
        'Fast, short-term personal loans for everyday needs. Decisions in 24 hours.',
        10000000,
        50000000,
        1,
        12,
        true
      )
      ON CONFLICT DO NOTHING
      RETURNING *;
    `);
    if (quickLoan.rows.length) {
      console.log('Created loan product: Quick Loan (id=%d)', quickLoan.rows[0].id);
    } else {
      console.log('Quick Loan already exists — skipping.');
    }

    const businessLoan = await client.query(`
      INSERT INTO loan_products
        (tenant_id, name, description, min_amount, max_amount, min_tenor_months, max_tenor_months, is_active)
      VALUES (
        1,
        'Business Loan',
        'Larger loans designed to help SMEs grow. Flexible tenors up to 24 months.',
        50000000,
        500000000,
        3,
        24,
        true
      )
      ON CONFLICT DO NOTHING
      RETURNING *;
    `);
    if (businessLoan.rows.length) {
      console.log('Created loan product: Business Loan (id=%d)', businessLoan.rows[0].id);
    } else {
      console.log('Business Loan already exists — skipping.');
    }

    // ------------------------------------------------------------------
    // 4. Users
    // ------------------------------------------------------------------
    const usersToCreate = [
      {
        first_name: 'Super',
        last_name: 'Admin',
        email: 'admin@kufre.com',
        password: 'Admin@123',
        phone: '08000000001',
        bvn: '12345678901',
        role: 'super_admin',
        tier: 1,
        is_verified: true,
      },
      {
        first_name: 'Jane',
        last_name: 'Approver',
        email: 'approver@kufre.com',
        password: 'Approver@123',
        phone: '08000000002',
        bvn: '12345678902',
        role: 'approver',
        tier: 1,
        is_verified: true,
      },
      {
        first_name: 'John',
        last_name: 'Viewer',
        email: 'viewer@kufre.com',
        password: 'Viewer@123',
        phone: '08000000003',
        bvn: '12345678903',
        role: 'viewer',
        tier: 1,
        is_verified: true,
      },
      {
        first_name: 'Chidi',
        last_name: 'Okafor',
        email: 'customer@kufre.com',
        password: 'Customer@123',
        phone: '08012345678',
        bvn: '22345678901',
        role: 'customer',
        account_number: '5001234567',
        bank_name: 'Providus Bank',
        tier: 1,
        is_verified: true,
      },
    ];

    for (const u of usersToCreate) {
      const hash = await bcrypt.hash(u.password, SALT_ROUNDS);

      const result = await client.query(
        `
        INSERT INTO users
          (tenant_id, first_name, last_name, email, password_hash, phone, bvn, role,
           account_number, bank_name, tier, is_verified)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (email) DO NOTHING
        RETURNING id, email, role;
        `,
        [
          1,
          u.first_name,
          u.last_name,
          u.email,
          hash,
          u.phone,
          u.bvn,
          u.role,
          u.account_number || null,
          u.bank_name || null,
          u.tier,
          u.is_verified,
        ]
      );

      if (result.rows.length) {
        console.log(
          `Created user: ${result.rows[0].email} (role=${result.rows[0].role}, id=${result.rows[0].id})`
        );
      } else {
        console.log(`User ${u.email} already exists — skipping.`);
      }
    }

    await client.query('COMMIT');
    console.log('\nSeed completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
