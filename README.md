# School Management System (SMS)

A modular **Node.js + Express.js + MySQL/MariaDB** (with built-in SQLite development/preview support) **School Management System** featuring **Real-Time Google OAuth 2.0 Sign-In**, **Paystack Payment Gateway Integration (Receive, Send & Reverse)**, **Student Join Proposal Approvals**, **Tabular Weekly Timetables**, and **Switchable Multi-Currency Support**, scoped strictly to **four role-based dashboards**:

1. **Superadmin Dashboard (`/dashboard/superadmin`)** - User & role governance (solely provisions Teacher and Financial Officer accounts), Student Join Proposal approvals (Accept / Reject), **Financial Stats & Paystack management** (revenue targets, opening treasury balance, billed/collected adjustments, Paystack fee collection, outbound Paystack transfers, and payment reversals/refunds), **School Settings** (institution profile, currency switcher, Google OAuth 2.0 keys, and Paystack API keys), academic years/terms, classes & subjects (no class streams), multi-subject & multi-class teacher assignments, conflict-checked **tabular weekly timetables**, attendance oversight, custom grading scales, exam publication & mark-correction approvals, announcements, audit logs, and verified backups.
2. **Teachers Dashboard (`/dashboard/teacher`)** - Scoped strictly to assigned classes & subjects: **Classwork, Homework, Tests & Exams Hub** (publish to any selected assigned class(es) or all assigned classes, upload **PDFs, pictures/images, documents, and videos**, and review/grade student submissions), **Class Announcements** (publish notices to any selected assigned class(es) or all assigned classes), class lists, **tabular personal weekly teaching timetable**, duplicate-safe attendance roll calls, official marksheets, formal mark-correction requests, and subject progress reports.
3. **Students Dashboard (`/dashboard/student`)** - Strict IDOR-protected personal portal: **Classwork, Homework, Tests & Exams Workspace** (view teacher instructions and inline PDF/image/video materials, write answers, upload **images, documents, and videos**, and view scores/feedback), **Class & School Announcements**, student profile (with staff-approved correction requests), subjects, **tabular weekly class timetable**, attendance history, published exam results, printable official Term Report Cards, and itemised Fee Statements with **online Paystack fee checkout & printable receipts**.
4. **Financial Dashboard (`/dashboard/financial`)** - Multi-currency fee categories, bulk class or individual fee billing, **Paystack payment collection, outbound Paystack transfers, transaction reversals/refunds, reference verification, and webhook reconciliation**, uniquely numbered printable receipts (`RCP-YYYY-NNNNN`), student ledgers & arrears, scholarships/discounts, daily collections, treasury reconciliation, and **tabular school timetable** access.

Every dashboard includes a responsive **Show Menu / Hide Menu** sidebar toggle and enterprise security protections.

---

## Project Structure

```text
├── database/
│   ├── schema.sql                                   # Consolidated MySQL/MariaDB InnoDB schema
│   ├── migrate.js                                   # Incremental idempotent migration runner
│   ├── migrations/
│   │   ├── 001_initial_schema.sql                   # Core relational tables & constraints
│   │   ├── 002_add_google_identity_to_users.sql     # Google OAuth 2.0 identity columns
│   │   ├── 003_add_paystack_and_admin_finance.sql   # Paystack transactions & Superadmin financial stats controls
│   │   ├── 004_security_hardening.sql               # Account lockout, failed login tracking & password rotation
│   │   ├── 005_student_applications_and_branding.sql# Student join proposals & School Management System branding
│   │   ├── 006_google_authentication.sql            # DB-configurable Google OAuth settings
│   │   ├── 007_oauth_states.sql                     # SQL-backed OAuth state & popup handoff store
│   │   ├── 008_paystack_keys_and_transfers.sql      # DB-configurable Paystack keys & outbound transfers ledger
│   │   ├── 009_teacher_subjects.sql                 # Multi-subject teacher specializations junction table
│   │   └── 010_coursework_media_and_class_announcements.sql # Coursework, exams, media uploads & class announcements
│   └── seeds/
│       └── seed.js                                  # Core RBAC foundation bootstrap (clean DB by default)
├── docs/
│   └── deployment-and-google-oauth.md               # MySQL provisioning, Google OAuth, Paystack & backups guide
├── src/
│   ├── app.js                                       # Express app, Paystack HMAC webhook, CSRF & route guards
│   ├── server.js                                    # HTTP server bootstrap & graceful shutdown
│   ├── config/                                      # environment.js, database.js, sessionStore.js, googleOAuth.js
│   ├── middleware/                                  # authenticate, authorizeRole, csrfProtection, rateLimiter, errorHandler
│   ├── models/                                      # user.model.js, academic.model.js, finance.model.js, system.model.js
│   ├── services/                                    # paystack.service.js, financial.service.js, superadmin.service.js, etc.
│   ├── controllers/                                 # Thin HTTP controllers per dashboard
│   ├── routes/                                      # auth, superadmin, teacher, student, financial routers
│   ├── validators/                                  # Server-side input & monetary validation
│   ├── views/                                       # Server-protected HTML shells (login + 4 dashboards)
│   └── public/                                      # Responsive institutional CSS & modular client JS
└── tests/
    └── sms.integration.test.js                      # 17 end-to-end RBAC, IDOR, OAuth, Paystack & security suites
```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy .env.example to .env and configure environment variables
cp .env.example .env

# 3. Run database migrations
npm run db:migrate

# 4. Run the automated integration & security test suite
npm test

# 5. Start the server (listens on 0.0.0.0:3000)
npm start
```

### Paystack Keys (Receiving, Sending & Reversing Transactions)
- **Settings UI Configuration**: Sign in as Superadmin and open **Settings -> Paystack Payment Gateway Keys** to enter your **Paystack Public Key** (`pk_live_...` / `pk_test_...`), **Paystack Secret Key** (`sk_live_...` / `sk_test_...`), and optional **Webhook Secret**, and toggle **Receive Payments**, **Send Outbound Transfers**, and **Reverse & Refund Transactions**. Secret keys are stored server-side and redacted from all API responses and backups.
- **Interactive Sandbox Mode**: When no live/test Secret Key is configured in non-production environments, an interactive Paystack Sandbox supports full checkout verification, outbound transfers (`TRF-YYYY-...`), and payment reversals/refunds offline.

### Clean Database & Onboarding Policy
- By default (`AUTO_SEED_DEMO=false`), the database initializes **completely clean** with zero sample academic or financial records—only the foundational RBAC permissions and bootstrap **Superadmin** account are created.
- **Students** can submit a join proposal from `/login` (`Don't have an account? Create one`), which waits for Superadmin approval before granting portal access.
- **Teachers** and **Financial Officers** are provisioned exclusively by the Superadmin, who issues their login credentials.

### Security Architecture
- **Strict Content-Security-Policy (CSP) & Headers**: Enforces `script-src 'self'`, `script-src-attr 'none'` (zero inline event handlers), `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`, and `Cache-Control: no-store` across all authenticated pages and APIs.
- **Session Fingerprint Binding & Idle Timeout**: SQL-backed sessions (`HttpOnly`, `SameSite`, regenerated upon authentication) are bound to a SHA-256 User-Agent fingerprint (`SESSION_HIJACK_BLOCKED` on mismatch) with a rolling 30-minute inactivity timeout and client-side back-button cache guard.
- **Constant-Time CSRF & Same-Origin Verification**: State-changing endpoints verify 256-bit CSRF tokens via `crypto.timingSafeEqual` alongside `Origin`/`Referer` host validation.
- **Brute-Force Lockout & Anti-Enumeration**: Constant-work bcrypt comparison prevents username timing enumeration; 5 consecutive failed sign-in attempts lock the account for 15 minutes (`HTTP 423`), with one-click **Unlock / Revoke Sessions** on the Superadmin Dashboard.
- **Confidentiality & Privacy Masking**: Public endpoints redact database drivers, file paths, reset codes, and credentials; Student and Teacher payloads strip internal treasury targets and unpublished assessments; Superadmin and Financial topbars include a **Hide Figures / Show Figures** privacy blur toggle.

### Changing Currency
Superadmins and authorised Financial Officers can switch the school's active currency (`GHS GH₵`, `USD $`, `EUR €`, `GBP £`, `NGN ₦`, `KES KSh`, `ZAR R`, `XOF CFA`, `CAD CA$`, `AUD A$`, `INR ₹`, or any custom currency symbol) from the **Currency** selector in the top header of the **Superadmin** and **Financial** dashboards, or under **Superadmin Dashboard -> School Settings & Currency**.

### Default Bootstrap Superadmin Account
| Role | Email | Initial Password |
| :--- | :--- | :--- |
| **Superadmin** | `admin@school.edu.gh` | `Admin@2026!` |

