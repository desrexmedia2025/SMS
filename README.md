# School Management System (SMS)

A modular **Node.js + Express.js + MySQL/MariaDB** (with built-in SQLite development/preview support) **School Management System** featuring **Real-Time Google OAuth 2.0 Sign-In**, **Paystack Payment Gateway Integration (Receive, Send & Reverse)**, **Student Join Proposal Approvals**, **Overview Calendars**, **Tabular Weekly Timetables**, and **Switchable Multi-Currency Support**, scoped strictly to **four role-based dashboards**:

1. **Superadmin Dashboard (`/dashboard/superadmin`)** - Clean, streamlined school administration: Overview, **Classes & Subjects** (with automatic academic period bootstrapping and zero class streams), **Teachers** (multi-subject registration `Subject 1..N` and multi-class/all-classes assignments), **Students & Join Proposals** (enrol students or Accept/Reject student join proposals), **Tabular Timetable**, **Finance & Paystack** (fee items, billing, Paystack collection, outbound transfers, and payment reversals), **Staff** (one searchable directory of every Teacher and Financial Officer, with full record editing), **Staff Accounts** (provision Teacher and Financial Officer logins), **Announcements**, and **Settings** (school profile, currency switcher, Paystack keys for receiving/sending/reversing, and Google OAuth 2.0 keys).
2. **Teachers Dashboard (`/dashboard/teacher`)** - Clean teaching workspace scoped strictly to assigned classes & subjects: Overview, **Classwork, Homework, Tests & Exams** (publish to any selected assigned class(es) or all assigned classes, upload **PDFs, pictures/images, documents, and videos**, and view/grade student answers & uploads), **My Classes & Students**, **Tabular Timetable**, **Announcements** (send to any selected assigned class(es) or all assigned classes), and **Profile**.
3. **Students Dashboard (`/dashboard/student`)** - Clean, IDOR-protected student portal: Overview & Subjects, **Classwork, Homework, Tests & Exams** (read teacher instructions and inline PDF/image/video materials, write answers, and upload **images, documents, and videos**), **My Scores** (printable graded scores & teacher feedback), **Tabular Timetable**, **Fees & Paystack** (online Paystack checkout & printable receipts), **Announcements** (class + school), and **Profile**.
4. **Financial Dashboard (`/dashboard/financial`)** - Clean multi-currency finance workspace: Overview, **Fees & Billing** (fee items + class/student billing), **Payments & Receipts** (Paystack fee collection, outbound transfers, payment reversals, and printable `RCP-YYYY-NNNNN` receipts), **Student Balances**, and **Tabular Timetable**.

Every dashboard includes a responsive **Show Menu / Hide Menu** sidebar toggle and enterprise security protections.

**Profile Photos**: Every account has a profile photo shown in the side panel session box, with a **Change Photo / Remove** control and a larger **Profile Photo** card on the Teacher and Student Profile pages. Uploads accept JPG, PNG, WEBP or GIF images up to **2 MB**, are stored outside the web root (`data/uploads/avatars`), and are served only to signed-in users through the authenticated, `no-store` endpoint `GET /api/users/:id/avatar`. The Superadmin can additionally set or clear any portal account's photo from **Staff Accounts**.

**Report Cards & End-of-Term Rollover**: The Superadmin generates a full set of report cards for any class in any term from **Report Cards** - weighted per-subject averages, GPA, the school grading scale, attendance, class position (ties share a rank) and class size. Each card opens as a clean, printable A4 sheet (`Print` uses `window.print()` with a print-only stylesheet) showing the school header, subject table, summary boxes, grading scale, class teacher and head teacher remarks and signature lines. Teachers add the **class teacher remark** for their own classes only; the **head teacher remark** is Superadmin-only. Students see their own published cards under **Report Cards**. **Promote / Roll Over a Class** moves every enrolled student into a chosen target year and term in one click, optionally promoting them to the next class level (which also archives the outgoing year's enrolments).

**Logo & Favicon**: The school mark is a royal-blue rounded square with a white graduation cap (`src/public/img/logo.svg`). It is shipped as `/favicon.svg`, a multi-size `/favicon.ico` (16/24/32/48), `/favicon-16.png`, `/favicon-32.png` and a 180px `/apple-touch-icon.png`, and every page (login, all four dashboards and the Google hand-off screens) declares them plus the `#1d4ed8` theme colour, so the site is branded in browser tabs, bookmarks, iOS home screens and Windows tiles.

**Notification Bell (Everything In One Place)**: The bell polls `GET /api/notifications` and badges the number of unseen items. It is a single feed for **unread messages**, **published announcements**, **new student join proposals**, **profile change requests**, **mark correction requests**, **coursework a student has not submitted**, **submissions waiting to be graded**, **newly published results**, and **fee bills due within seven days**. Each entry is tagged by type (Message, Announcement, New registration, ...), shows who it concerns, and jumps straight to the place where it is handled - the conversation, the Announcements tab, the Students proposals sub-tab, the Coursework tab, or Billing. Opening an announcement marks it read (`POST /api/notifications/read`) and **Mark all read** clears every message and announcement (`POST /api/notifications/read-all`); pending approvals stay in the list until they are actually reviewed. Announcement reads are persisted in `announcement_reads` (migration 019), so the badge never re-appears after it has been cleared.

**Messaging & Notification Bell**: Every dashboard topbar has a notification bell with a live unread badge and a dropdown of unread conversations (polled every 60 seconds, with **Mark all read** and a jump straight into the thread). The **Messages** section is a full inbox: compose, conversation view with threaded replies, and attachments that reuse the existing media pipeline (PDF, image, video or document, streamed through the authenticated `/api/media/:id` endpoint so only conversation participants can open them). Reach is enforced server-side by role - **Superadmin** can message everyone, a whole role, a class or any individual; **Teachers** can only message their assigned classes and the students in them (plus admin/finance staff); **Students** can only message their own teachers or the admin; **Financial** staff message individuals. Every attempt outside those rules is rejected with `HTTP 403`.

**School Events (All Four Dashboards)**: The Superadmin publishes school-wide events from **School Events** - holidays, PTA meetings, exam weeks, sports day or anything else - each with its own colour, a date range (single or multi-day) and an audience (**Everyone**, **Teachers only**, **Students only**, or **Staff only**). Events are pushed into every dashboard's Overview calendar feed through `GET /api/calendar/events`, carry their custom colour into the day dots and the agenda, and are filtered by the viewer's role, so a students-only exam week never shows on a teacher's calendar.

**Edit Any Record (Superadmin)**: Every row in **Students**, **Teachers List** and **Staff Accounts** now has an **Edit** control that opens a modal for full record editing. Student edits cover admission number, names, portal email, phone, class placement, gender, date of birth, guardian details, address, medical notes, status and an optional password reset; teacher edits cover staff number, names, email, phone, qualification, specialization, department, hire date, status and optional password reset; staff account edits cover full name, username, email, phone, role, status and optional password reset. All three are validated server-side (email/admission-number/staff-number uniqueness return `HTTP 409`), require CSRF, are Superadmin-only (`HTTP 403` for every other role) and are written to the audit log as `STUDENT_RECORD_UPDATED`, `TEACHER_RECORD_UPDATED` and `STAFF_ACCOUNT_UPDATED`.

**Announcements (Every Receiver)**: A notice is published once and lands on every dashboard it was written for - **Everyone**, **Teachers**, **Students**, **Financial staff** or selected classes - including the **Financial** dashboard, which now has its own **Announcements** section. The Superadmin can edit or delete any notice (`PATCH`/`DELETE /api/superadmin/announcements/:id`) and a teacher can edit or delete the class announcements they authored (`PATCH`/`DELETE /api/teacher/announcements/:id`); teachers may only ever target their own assigned classes. Every edit is stamped with `edited_at` and the editor's name, so receivers see an **Edited** badge on the revised notice, and both actions are written to the audit log.

**Staff Directory (Superadmin)**: The **Staff** tab lists everyone who works at the school - teaching staff (with staff number, subjects, classes and qualifications) and Financial Officers - in one searchable table with role and status filters. Searching matches name, staff number, email, phone, username, department, specialization and subjects, and each row's **Edit** button opens that person's full record editor (the teacher record editor for teaching staff, the account editor for Financial Officers). Only `teacher` and `financial` accounts appear: students and Superadmins are never listed, and the endpoint is Superadmin-only (`HTTP 403` for every other role).

**Overview Calendar (All Four Dashboards)**: The first card of every Overview, anchored in the top-left corner, is a live month calendar with **Previous / Next / Today** navigation, colour-coded event markers, and a side agenda listing the selected day's items plus everything upcoming. Its role-scoped feed comes from `GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD`:
- **Superadmin** - school-wide coursework/exam deadlines, published announcements, fee due dates, and payments collected.
- **Teacher** - their own classwork, homework, test and exam deadlines plus the class announcements they published.
- **Student** - deadlines for their enrolled class (with submitted / not-submitted status), school & class announcements, and their own fee due dates.
- **Financial** - fee bills falling due and payments received, with no access to academic coursework data.
- School-wide events published by the Superadmin land on every dashboard in this list, and the calendar re-pulls its month the moment an event is added, edited or deleted (and whenever the Overview tab is opened), so a newly set event is visible straight away instead of after a page reload. Each event keeps the exact colour it was created with - the day dot, the agenda entry and the dedicated **School Events** block in the calendar side panel all paint with it - and school events take priority over coursework, announcement and fee markers when a day has more markers than fit.

**App Themes**: The sidebar **Theme** picker on every dashboard ships nine palettes - **Light**, **Dark**, **Ocean Glass**, **Midnight Indigo**, **Royal Plum**, **Forest Green**, **Sandstone**, **Slate Grey** and **System** (which follows the operating system's light/dark setting). The choice is saved to the account (`PATCH /api/auth/preferences`) and applied locally, so it follows the user from device to device; the two dark palettes reuse every dark-mode component rule, and unknown values are rejected with `HTTP 400`.

**Notes (Lightweight Word Processor)**: Every dashboard - Superadmin, Teacher, Student and Financial - has a **Notes** tab holding a private notebook. Each note is a small document: a title, a rich-text page with **bold / italic / underline / strikethrough**, **headings**, **bullet & numbered lists**, **quotes**, **alignment**, **links** and **undo/redo**, plus **picture**, **video** and **file** insertion straight from the toolbar. Images and videos are embedded in the page; other files are attached as downloadable chips. Everything saves automatically a moment after you stop typing (with a *Saving… / All changes saved* indicator, word & character counts, eight note colours, pinning, search and autosave-on-tab-switch). Notes live in the `notes` table (migration 020) behind `/api/notes`, are private to their author (another user gets `HTTP 404`), and their attachments reuse the authenticated media pipeline (`/api/media/:id`, `owner_type = 'note'`, `HTTP 403` for everyone but the owner). Note bodies are run through an allow-list HTML sanitiser (`src/utils/sanitizeNoteHtml.js`) on the server, so scripts, event handlers and `javascript:` URLs pasted into the editor can never be stored or re-rendered.

**Public Landing Page (`/`)**: Visitors arrive on a public landing page instead of being dropped straight into the sign-in form. The school's own photograph (`src/public/img/landing-bg.jpg`) is the backdrop of the opening, a mid-page pull quote and the closing, each under a flat ink scrim at 62% so white type stays legible whichever part of the picture lands behind it - no wash, the photograph stays a photograph. Everything in between is set on warm paper with near-black ink and nothing but hairline rules and space for structure: no card boxes, no icon tiles, no pills. Serif display headings (Iowan/Palatino/Georgia) sit above a plain sans body, every section carries a serif number above a small-caps label with flanking rules, and the brand blue is a spot colour used for rules, labels and the one solid button. **The buttons are the dashboard's own buttons**: the landing `.lp-btn` copies the app's `.btn` exactly - 9px radius, 600 weight, the same soft shadows - and the call to action is the app's `.btn-primary` flat-filled instead of shaded, so signing in feels like staying inside one interface. It is also the only control on the page with no hover state. The page runs: a sticky bar with **Sign in** and **Get Started** plus a scroll progress line, the photograph hero (label, headline, one line of copy, both calls to action, an install note and four role links), a facts strip, **What it does** (eight numbered entries in a ruled 4x2 index), **How it works** (three ruled steps with large serif numerals), **Portals** (four role entries in 4x1), a photographic pull quote, **Inside the portal** (a CSS-drawn dashboard illustration with a serif caption, clearly labelled as one), **Payments** (a ruled checklist), **Security** (six entries in 3x2), a **FAQ** accordion, the photograph again behind **Ready to get started?**, and a centred footer with a diamond ornament crediting **The Desrex Studio (Acura Solutions)**. Hover is plain but visible: entries draw a brand rule across their top edge, colour their heading, warm their copy and lift 3px, portal initials fill solid, nav links underline, the payments ticks fill, FAQ rows tint. Every grid uses a fixed column count that divides its items (4x2, 4x1, 3x2; two columns under 1080px, one under 700px) so each row is full and each block sits dead centre; the hero, section heads, index entries, the illustration, the FAQ, the footer columns and the footer bottom bar are centred too. The footer's contact column is filled from the school's own settings (email, phone, address) and stays out of the way when the school has not published them. The page ships as three small files plus the photograph (`src/views/landing.html`, `src/public/css/landing.css`, `src/public/js/landing.js`, `src/public/img/landing-bg.jpg`) rather than reusing the 125 KB dashboard stylesheet, and it has no inline scripts at all, so it runs untouched inside the app's strict Content-Security-Policy. The school name, motto and contact details are read from the public `GET /api/auth/session` endpoint, so the page is branded with the school's own identity; a visitor who is already signed in is redirected to their dashboard instead. Its own assets are cache-busted (`?v=7.0`) and revalidated on every load. The **Sign in**, **Student join proposal** and **Terms and conditions** links deep-link into the sign-in screen through `/login?panel=register` and `/login?terms=1`.
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
│   │   ├── 017_report_cards_and_rollover.sql         # Per-term report cards (position, GPA, remarks) & promotion
│   │   ├── 018_announcement_editing.sql             # Announcement edit tracking (edited_at / edited_by)
│   │   └── 019_notification_reads.sql              # Per-account announcement read tracking for the bell
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

**Live production URL:** `https://maindek.vercel.app`

Environment variables are configured on the Vercel project (Settings ->
Environment Variables):

| Variable | Production value |
| :--- | :--- |
| `NODE_ENV` | `production` |
| `APP_BASE_URL` | `https://maindek.vercel.app` |
| `SESSION_SECRET` | 48-character random secret (sensitive) |
| `SESSION_COOKIE_NAME` | `sms.sid` |
| `DB_DRIVER` | `mysql` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | hosted MySQL host / `4000` / `school_management` |
| `DB_USER` / `DB_PASSWORD` | database user (sensitive) |
| `DB_SSL` | `true` (TLS is required by the hosted provider) |
| `DB_CONNECTION_LIMIT` | `5` (serverless-friendly pool size) |
| `DB_CONNECT_TIMEOUT_MS` | `25000` |
| `DB_AUTO_FALLBACK` | `false` (never silently fall back to SQLite) |
| `AUTO_SEED_DEMO` | `false` (the database stays clean) |
| `SUPERADMIN_INITIAL_EMAIL` / `SUPERADMIN_INITIAL_PASSWORD` | bootstrap superadmin credentials (sensitive) |
| `DEFAULT_CURRENCY_CODE` / `DEFAULT_CURRENCY_SYMBOL` / `SCHOOL_TIMEZONE` | `GHS` / `GH₵` / `Africa/Accra` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | OAuth 2.0 credentials (`GOOGLE_CLIENT_SECRET` is still empty) |
| `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` / `PAYSTACK_CALLBACK_URL` | payment gateway keys (still empty) |

**Database persistence:** production runs on a hosted MySQL-compatible database,
so sessions, users, fees and coursework survive redeploys and are shared by every
serverless instance. `DB_AUTO_FALLBACK=false` means a database failure surfaces as
a visible error instead of silently starting an empty SQLite file. Local
development still defaults to SQLite (`DB_DRIVER=sqlite`,
`SQLITE_PATH=./data/sms_dev.sqlite`) and needs no server.

Uploaded coursework files still live in `data/uploads`, which is ephemeral on
Vercel; move that directory to Vercel Blob before relying on attachments in
production.

**How the deployment is produced:** the Vercel project's Install Command clones
this branch (`arena/1ab5d416-sms`) into the build container and runs
`npm install`, so the deployed build always matches the branch tip. Connecting
the GitHub repository to the project (Vercel Dashboard -> Settings -> Git) is
the recommended long-term setup: it replaces that step with native Git
deployments that use `vercel.json` directly.

