# School Management System (SMS)

A modular **Node.js + Express.js + MySQL/MariaDB** (with built-in SQLite development/preview support) **School Management System** featuring **Real-Time Google OAuth 2.0 Sign-In**, **Paystack Payment Gateway Integration (Receive, Send & Reverse)**, **Student Join Proposal Approvals**, **Overview Calendars**, **Tabular Weekly Timetables**, and **Switchable Multi-Currency Support**, scoped strictly to **four role-based dashboards**:

1. **Superadmin Dashboard (`/dashboard/superadmin`)** - Clean, streamlined school administration: Overview, **Classes & Subjects** (with automatic academic period bootstrapping and zero class streams), **Teachers** (multi-subject registration `Subject 1..N` and multi-class/all-classes assignments), **Students & Join Proposals** (enrol students or Accept/Reject student join proposals), **Tabular Timetable**, **Finance & Paystack** (fee items, billing, Paystack collection, outbound transfers, and payment reversals), **Staff Accounts** (provision Teacher and Financial Officer logins), **Announcements**, and **Settings** (school profile, currency switcher, Paystack keys for receiving/sending/reversing, and Google OAuth 2.0 keys).
2. **Teachers Dashboard (`/dashboard/teacher`)** - Clean teaching workspace scoped strictly to assigned classes & subjects: Overview, **Classwork, Homework, Tests & Exams** (publish to any selected assigned class(es) or all assigned classes, upload **PDFs, pictures/images, documents, and videos**, and view/grade student answers & uploads), **My Classes & Students**, **Tabular Timetable**, **Announcements** (send to any selected assigned class(es) or all assigned classes), and **Profile**.
3. **Students Dashboard (`/dashboard/student`)** - Clean, IDOR-protected student portal: Overview & Subjects, **Classwork, Homework, Tests & Exams** (read teacher instructions and inline PDF/image/video materials, write answers, and upload **images, documents, and videos**), **My Scores** (printable graded scores & teacher feedback), **Tabular Timetable**, **Fees & Paystack** (online Paystack checkout & printable receipts), **Announcements** (class + school), and **Profile**.
4. **Financial Dashboard (`/dashboard/financial`)** - Clean multi-currency finance workspace: Overview, **Fees & Billing** (fee items + class/student billing), **Payments & Receipts** (Paystack fee collection, outbound transfers, payment reversals, and printable `RCP-YYYY-NNNNN` receipts), **Student Balances**, and **Tabular Timetable**.

Every dashboard includes a responsive **Show Menu / Hide Menu** sidebar toggle and enterprise security protections.

**Profile Photos**: Every account has a profile photo shown in the side panel session box, with a **Change Photo / Remove** control and a larger **Profile Photo** card on the Teacher and Student Profile pages. Uploads accept JPG, PNG, WEBP or GIF images up to **2 MB**, are stored outside the web root (`data/uploads/avatars`), and are served only to signed-in users through the authenticated, `no-store` endpoint `GET /api/users/:id/avatar`. The Superadmin can additionally set or clear any portal account's photo from **Staff Accounts**.

**Report Cards & End-of-Term Rollover**: The Superadmin generates a full set of report cards for any class in any term from **Report Cards** - weighted per-subject averages, GPA, the school grading scale, attendance, class position (ties share a rank) and class size. Each card opens as a clean, printable A4 sheet (`Print` uses `window.print()` with a print-only stylesheet) showing the school header, subject table, summary boxes, grading scale, class teacher and head teacher remarks and signature lines. Teachers add the **class teacher remark** for their own classes only; the **head teacher remark** is Superadmin-only. Students see their own published cards under **Report Cards**. **Promote / Roll Over a Class** moves every enrolled student into a chosen target year and term in one click, optionally promoting them to the next class level (which also archives the outgoing year's enrolments).

**Messaging & Notification Bell**: Every dashboard topbar has a notification bell with a live unread badge and a dropdown of unread conversations (polled every 60 seconds, with **Mark all read** and a jump straight into the thread). The **Messages** section is a full inbox: compose, conversation view with threaded replies, and attachments that reuse the existing media pipeline (PDF, image, video or document, streamed through the authenticated `/api/media/:id` endpoint so only conversation participants can open them). Reach is enforced server-side by role - **Superadmin** can message everyone, a whole role, a class or any individual; **Teachers** can only message their assigned classes and the students in them (plus admin/finance staff); **Students** can only message their own teachers or the admin; **Financial** staff message individuals. Every attempt outside those rules is rejected with `HTTP 403`.

**School Events (All Four Dashboards)**: The Superadmin publishes school-wide events from **School Events** - holidays, PTA meetings, exam weeks, sports day or anything else - each with its own colour, a date range (single or multi-day) and an audience (**Everyone**, **Teachers only**, **Students only**, or **Staff only**). Events are pushed into every dashboard's Overview calendar feed through `GET /api/calendar/events`, carry their custom colour into the day dots and the agenda, and are filtered by the viewer's role, so a students-only exam week never shows on a teacher's calendar.

**Edit Any Record (Superadmin)**: Every row in **Students**, **Teachers List** and **Staff Accounts** now has an **Edit** control that opens a modal for full record editing. Student edits cover admission number, names, portal email, phone, class placement, gender, date of birth, guardian details, address, medical notes, status and an optional password reset; teacher edits cover staff number, names, email, phone, qualification, specialization, department, hire date, status and optional password reset; staff account edits cover full name, username, email, phone, role, status and optional password reset. All three are validated server-side (email/admission-number/staff-number uniqueness return `HTTP 409`), require CSRF, are Superadmin-only (`HTTP 403` for every other role) and are written to the audit log as `STUDENT_RECORD_UPDATED`, `TEACHER_RECORD_UPDATED` and `STAFF_ACCOUNT_UPDATED`.

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
│   │   ├── 013_profile_photo_and_otp.sql            # Profile photo storage (OTP table dropped by 014)
│   │   ├── 014_remove_otp_login.sql                  # Retires the one-time code sign-in store
│   │   ├── 015_school_events.sql                     # School-wide calendar events (holidays, PTA, exams, sports)
│   │   ├── 016_messaging_notifications.sql           # Message threads, participants & notification bell
│   │   └── 017_report_cards_and_rollover.sql         # Per-term report cards (position, GPA, remarks) & promotion
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
    └── sms.integration.test.js                      # 29 end-to-end RBAC, IDOR, OAuth, Paystack, calendar, school events, messaging, report cards, profile photo, record editing & security suites
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

## Vercel Deployment

The project ships ready for Vercel: `vercel.json` exposes the Express app as the
serverless function `api/index.js`, and `middleware.js` forwards every path to
that function.

**Live production URL:** `https://school-management-system-gamma-ebon.vercel.app`

Environment variables are configured on the Vercel project (Settings -> Environment Variables):

| Variable | Production value |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `APP_BASE_URL` | `https://school-management-system-gamma-ebon.vercel.app` |
| `SESSION_SECRET` | 48-character random secret (sensitive) |
| `SESSION_COOKIE_NAME` | `sms.sid` |
| `DB_DRIVER` | `sqlite` (temporary - see note below) |
| `SQLITE_PATH` | `/tmp/sms_vercel.sqlite` |
| `DB_AUTO_FALLBACK` | `true` |
| `AUTO_SEED_DEMO` | `false` (the database stays clean) |
| `SUPERADMIN_INITIAL_EMAIL` / `SUPERADMIN_INITIAL_PASSWORD` | bootstrap superadmin credentials (sensitive) |
| `DEFAULT_CURRENCY_CODE` / `DEFAULT_CURRENCY_SYMBOL` / `SCHOOL_TIMEZONE` | `GHS` / `GH₵` / `Africa/Accra` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | OAuth 2.0 credentials (`GOOGLE_CLIENT_SECRET` is still empty) |
| `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` / `PAYSTACK_CALLBACK_URL` | payment gateway keys (still empty) |

**Important - database persistence:** Vercel's filesystem is ephemeral, so the
current SQLite file (`/tmp/sms_vercel.sqlite`) is per-instance and is discarded
whenever a new instance starts; uploaded coursework files behave the same way.
For real use, point the project at a hosted MySQL/MariaDB database by setting
`DB_DRIVER=mysql`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
(and `DB_CONNECTION_LIMIT`) on Vercel, then redeploy. Sessions are stored in the
database, so a shared MySQL instance is what keeps users signed in across
serverless instances.

**How the deployment is produced:** the Vercel project's Install Command clones
this branch (`arena/1ab5d416-sms`) into the build container and runs
`npm install`, so the deployed build always matches the branch tip. Connecting
the GitHub repository to the project (Vercel Dashboard -> Settings -> Git) is
the recommended long-term setup: it replaces that step with native Git
deployments that use `vercel.json` directly.

