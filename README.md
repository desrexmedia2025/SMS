# School Management System (SMS)

A modular **Node.js + Express.js + MySQL/MariaDB** (with built-in SQLite development/preview support) **School Management System** featuring **Real-Time Google OAuth 2.0 Sign-In**, **Paystack Payment Gateway Integration (Receive, Send & Reverse)**, **Student Join Proposal Approvals**, **Overview Calendars**, **Tabular Weekly Timetables**, and **Switchable Multi-Currency Support**, scoped strictly to **four role-based dashboards**:

1. **Superadmin Dashboard (`/dashboard/superadmin`)** - Clean, streamlined school administration: Overview, **Classes & Subjects** (with automatic academic period bootstrapping and zero class streams), **Teachers** (multi-subject registration `Subject 1..N` and multi-class/all-classes assignments), **Students & Join Proposals** (enrol students or Accept/Reject student join proposals), **Tabular Timetable**, **Finance & Paystack** (fee items, billing, Paystack collection, outbound transfers, and payment reversals), **Staff Accounts** (provision Teacher and Financial Officer logins), **Announcements**, and **Settings** (school profile, currency switcher, Paystack keys for receiving/sending/reversing, and Google OAuth 2.0 keys).
2. **Teachers Dashboard (`/dashboard/teacher`)** - Clean teaching workspace scoped strictly to assigned classes & subjects: Overview, **Classwork, Homework, Tests & Exams** (publish to any selected assigned class(es) or all assigned classes, upload **PDFs, pictures/images, documents, and videos**, and view/grade student answers & uploads), **My Classes & Students**, **Tabular Timetable**, **Announcements** (send to any selected assigned class(es) or all assigned classes), and **Profile**.
3. **Students Dashboard (`/dashboard/student`)** - Clean, IDOR-protected student portal: Overview & Subjects, **Classwork, Homework, Tests & Exams** (read teacher instructions and inline PDF/image/video materials, write answers, and upload **images, documents, and videos**), **My Scores** (printable graded scores & teacher feedback), **Tabular Timetable**, **Fees & Paystack** (online Paystack checkout & printable receipts), **Announcements** (class + school), and **Profile**.
4. **Financial Dashboard (`/dashboard/financial`)** - Clean multi-currency finance workspace: Overview, **Fees & Billing** (fee items + class/student billing), **Payments & Receipts** (Paystack fee collection, outbound transfers, payment reversals, and printable `RCP-YYYY-NNNNN` receipts), **Student Balances**, and **Tabular Timetable**.

Every dashboard includes a responsive **Show Menu / Hide Menu** sidebar toggle and enterprise security protections.

**Profile Photos**: Every account has a profile photo shown in the side panel session box, with a **Change Photo / Remove** control and a larger **Profile Photo** card on the Teacher and Student Profile pages. Uploads accept JPG, PNG, WEBP or GIF images up to **2 MB**, are stored outside the web root (`data/uploads/avatars`), and are served only to signed-in users through the authenticated, `no-store` endpoint `GET /api/users/:id/avatar`. The Superadmin can additionally set or clear any portal account's photo from **Staff Accounts**.

**One-Time Code (OTP) Sign-In**: Alongside password sign-in, `/login` offers **Sign in with a one-time code** — the user enters an email, username or phone number, chooses **email** or **phone (SMS)** delivery, and receives a 6-digit code that signs them straight into their own dashboard. Codes are hashed (bcrypt), single-use, expire in 10 minutes, allow at most 5 verification attempts, are throttled to 3 requests per 10 minutes per account, and never reveal whether an account exists. Delivery goes to your configured gateway (`OTP_EMAIL_WEBHOOK_URL` / `OTP_SMS_WEBHOOK_URL`); when none is configured the system runs in **interactive sandbox mode** (non-production) and surfaces the code in the UI, exactly like the Paystack sandbox.

**Overview Calendar (All Four Dashboards)**: The first card of every Overview, anchored in the top-left corner, is a live month calendar with **Previous / Next / Today** navigation, colour-coded event markers, and a side agenda listing the selected day's items plus everything upcoming. Its role-scoped feed comes from `GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD`:
- **Superadmin** - school-wide coursework/exam deadlines, published announcements, fee due dates, and payments collected.
- **Teacher** - their own classwork, homework, test and exam deadlines plus the class announcements they published.
- **Student** - deadlines for their enrolled class (with submitted / not-submitted status), school & class announcements, and their own fee due dates.
- **Financial** - fee bills falling due and payments received, with no access to academic coursework data.

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
│   │   ├── 010_coursework_media_and_class_announcements.sql # Coursework, exams, media uploads & class announcements
│   │   ├── 011_site_usage_analytics.sql             # Lite site usage analytics & daily activity rollups
│   │   ├── 012_terms_theme_and_language.sql         # Terms acceptance, theme & language preferences
│   │   └── 013_profile_photo_and_otp.sql            # Profile photo storage & hashed one-time sign-in codes
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
│   ├── routes/                                      # auth, calendar, superadmin, teacher, student, financial routers
│   ├── validators/                                  # Server-side input & monetary validation
│   ├── views/                                       # Server-protected HTML shells (login + 4 dashboards)
│   └── public/                                      # Responsive institutional CSS & modular client JS
└── tests/
    └── sms.integration.test.js                      # 25 end-to-end RBAC, IDOR, OAuth, Paystack, calendar, OTP, profile photo & security suites
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
- **Confidentiality & Redaction**: Public endpoints redact database drivers, file paths, reset codes, and credentials; Student and Teacher payloads strip internal treasury targets and unpublished assessments.

### Changing Currency
Superadmins and authorised Financial Officers can switch the school's active currency (`GHS GH₵`, `USD $`, `EUR €`, `GBP £`, `NGN ₦`, `KES KSh`, `ZAR R`, `XOF CFA`, `CAD CA$`, `AUD A$`, `INR ₹`, or any custom currency symbol) from the **Currency** selector in the top header of the **Superadmin** and **Financial** dashboards, or under **Superadmin Dashboard -> School Settings & Currency**.

### Default Bootstrap Superadmin Account
| Role | Email | Initial Password |
| :--- | :--- | :--- |
| **Superadmin** | `admin@school.edu.gh` | `Admin@2026!` |

