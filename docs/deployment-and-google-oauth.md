# MySQL/MariaDB Setup, Google OAuth 2.0, Paystack & Production Deployment Guide

## 1. MySQL / MariaDB Database Provisioning (Least Privilege)

Create the application database and a dedicated least-privilege database user (never run the web application as `root` in production):

```sql
CREATE DATABASE IF NOT EXISTS school_management
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'sms_app_user'@'%' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES
  ON school_management.* TO 'sms_app_user'@'%';

FLUSH PRIVILEGES;
```

Configure `.env` (copied from `.env.example`):

```env
NODE_ENV=production
DB_DRIVER=mysql
DB_AUTO_FALLBACK=false
DB_HOST=your-mysql-host.example.com
DB_PORT=3306
DB_NAME=school_management
DB_USER=sms_app_user
DB_PASSWORD=REPLACE_WITH_STRONG_PASSWORD
SESSION_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARS
```

Run incremental migrations and bootstrap the initial Superadmin safely:

```bash
npm run db:migrate
npm run db:seed
```

> **Incremental Migration Rule:** `database/migrate.js` tracks applied SQL files in `schema_migrations` (`001_initial_schema.sql`, `002_add_google_identity_to_users.sql`, `003_add_paystack_and_admin_finance.sql`) and never drops existing tables or records.

---

## 2. Real-Time Google Sign-In Setup (Blueprint Revision 2.1)

Google Sign-In authenticates users into the same **four approved school dashboards** (`superadmin`, `teacher`, `student`, `financial`) without Firebase and without auto-creating privileged accounts.

### Google Cloud Console Checklist
1. Open **Google Cloud Console -> APIs & Services -> OAuth consent screen** and configure your school's app name, support email, and authorised domain.
2. Open **Credentials -> Create Credentials -> OAuth Client ID -> Web application**.
3. Add **Authorised JavaScript origins**:
   - Local development: `http://localhost:3000`
   - Production: `https://sms.yourschool.edu`
4. Add **Authorised redirect URIs** (must match `GOOGLE_CALLBACK_URL` character-for-character):
   - Local development: `http://localhost:3000/auth/google/callback`
   - Production: `https://sms.yourschool.edu/auth/google/callback`
5. Set the credentials in `.env` on the server (never commit `.env` or expose `GOOGLE_CLIENT_SECRET` in frontend JS):
   ```env
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_CALLBACK_URL=https://sms.yourschool.edu/auth/google/callback
   GOOGLE_AUTO_LINK_VERIFIED_EMAIL=true
   ```

---

## 3. Paystack Payment Gateway Setup

Paystack powers school fee collections across the **Financial Dashboard**, **Superadmin Financial Stats & Paystack**, and **Students Fee Statement**.

1. Sign in to the **Paystack Dashboard -> Settings -> API Keys & Webhooks**.
2. Enter your Public Key, Secret Key, and optional Webhook Secret directly in **Superadmin Dashboard -> Settings -> Paystack Payment Gateway Keys** (or set them in `.env`):
   ```env
   PAYSTACK_PUBLIC_KEY=<your-paystack-public-key>
   PAYSTACK_SECRET_KEY=<your-paystack-secret-key>
   PAYSTACK_WEBHOOK_SECRET=<your-paystack-webhook-secret>
   PAYSTACK_CALLBACK_URL=https://sms.yourschool.edu/dashboard/financial
   ```
3. Set your **Paystack Webhook URL** to:
   ```text
   https://sms.yourschool.edu/api/paystack/webhook
   ```
   The server validates `x-paystack-signature` using HMAC-SHA512 over the raw JSON request body (`express.raw`) and settles `charge.success` events idempotently into `paystack_transactions`, `payments`, `payment_allocations`, and `receipts`.

---

## 4. Database Backups & Restoration

1. **Automated / CLI MySQL Backup:**
   ```bash
   mysqldump -u sms_app_user -p --single-transaction --routines school_management > backup_$(date +%F).sql
   ```
2. **Restoration Verification (Test on a staging database first):**
   ```bash
   mysql -u sms_app_user -p school_management_restore_test < backup_2026-10-27.sql
   ```
3. **In-App Verified Snapshots:**
   Superadmins can trigger and download verified JSON table snapshots (including `paystack_transactions`) from **Superadmin Dashboard -> Backup / Restore Status**.
