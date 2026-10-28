-- =============================================================================
-- Migration 001: Initial School Management System Relational Schema
-- Target Engine: MySQL 8.0+ / MariaDB 10.6+ (InnoDB, utf8mb4)
-- =============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(120) PRIMARY KEY,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS school_settings (
  id INT PRIMARY KEY,
  school_name VARCHAR(180) NOT NULL,
  school_code VARCHAR(40) NOT NULL,
  motto VARCHAR(255) NOT NULL DEFAULT '',
  email VARCHAR(160) NOT NULL DEFAULT '',
  phone VARCHAR(60) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT '',
  timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Accra',
  currency_code VARCHAR(10) NOT NULL DEFAULT 'GHS',
  currency_symbol VARCHAR(16) NOT NULL DEFAULT 'GH₵',
  student_fee_portal_enabled TINYINT(1) NOT NULL DEFAULT 1,
  attendance_cutoff_time VARCHAR(10) NOT NULL DEFAULT '09:00',
  allow_teacher_mark_edit_after_publish TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(255) DEFAULT NULL,
  full_name VARCHAR(160) NOT NULL,
  phone VARCHAR(50) NOT NULL DEFAULT '',
  avatar_url VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  password_reset_token_hash VARCHAR(255) DEFAULT NULL,
  password_reset_expires_at DATETIME DEFAULT NULL,
  last_login_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  assigned_by_user_id INT DEFAULT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_ur_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ur_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR(191) PRIMARY KEY,
  user_id INT DEFAULT NULL,
  sess TEXT NOT NULL,
  expires_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS academic_years (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  start_date VARCHAR(20) NOT NULL,
  end_date VARCHAR(20) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS terms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  academic_year_id INT NOT NULL,
  name VARCHAR(60) NOT NULL,
  start_date VARCHAR(20) NOT NULL,
  end_date VARCHAR(20) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE (academic_year_id, name),
  CONSTRAINT fk_terms_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  staff_number VARCHAR(50) NOT NULL UNIQUE,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  qualification VARCHAR(120) NOT NULL DEFAULT '',
  specialization VARCHAR(120) NOT NULL DEFAULT '',
  department VARCHAR(100) NOT NULL DEFAULT '',
  hire_date VARCHAR(20) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_teachers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  level_order INT NOT NULL DEFAULT 1,
  capacity INT NOT NULL DEFAULT 40,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS streams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  room_number VARCHAR(40) NOT NULL DEFAULT '',
  class_teacher_id INT DEFAULT NULL,
  UNIQUE (class_id, name),
  CONSTRAINT fk_streams_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_streams_teacher FOREIGN KEY (class_teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subjects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  department VARCHAR(100) NOT NULL DEFAULT '',
  is_elective TINYINT(1) NOT NULL DEFAULT 0,
  pass_mark DECIMAL(5,2) NOT NULL DEFAULT 50.00,
  max_mark DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  admission_number VARCHAR(50) NOT NULL UNIQUE,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  gender VARCHAR(20) NOT NULL DEFAULT '',
  date_of_birth VARCHAR(20) NOT NULL DEFAULT '',
  guardian_name VARCHAR(140) NOT NULL DEFAULT '',
  guardian_phone VARCHAR(50) NOT NULL DEFAULT '',
  guardian_email VARCHAR(160) NOT NULL DEFAULT '',
  address VARCHAR(255) NOT NULL DEFAULT '',
  medical_notes VARCHAR(255) NOT NULL DEFAULT '',
  enrollment_date VARCHAR(20) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_students_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS student_enrolments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  class_id INT NOT NULL,
  stream_id INT DEFAULT NULL,
  academic_year_id INT NOT NULL,
  term_id INT DEFAULT NULL,
  roll_number VARCHAR(30) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'enrolled',
  enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, academic_year_id),
  CONSTRAINT fk_enrol_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_enrol_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_enrol_stream FOREIGN KEY (stream_id) REFERENCES streams(id) ON DELETE SET NULL,
  CONSTRAINT fk_enrol_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  class_id INT NOT NULL,
  stream_id INT DEFAULT NULL,
  subject_id INT NOT NULL,
  academic_year_id INT NOT NULL,
  term_id INT DEFAULT NULL,
  assignment_key VARCHAR(120) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ta_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_stream FOREIGN KEY (stream_id) REFERENCES streams(id) ON DELETE SET NULL,
  CONSTRAINT fk_ta_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  CONSTRAINT fk_ta_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS timetables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  academic_year_id INT NOT NULL,
  term_id INT DEFAULT NULL,
  class_id INT NOT NULL,
  stream_id INT DEFAULT NULL,
  subject_id INT NOT NULL,
  teacher_id INT NOT NULL,
  day_of_week VARCHAR(20) NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  end_time VARCHAR(10) NOT NULL,
  room VARCHAR(50) NOT NULL DEFAULT '',
  CONSTRAINT fk_tt_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  CONSTRAINT fk_tt_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  class_id INT NOT NULL,
  stream_id INT DEFAULT NULL,
  subject_id INT DEFAULT NULL,
  academic_year_id INT NOT NULL,
  term_id INT DEFAULT NULL,
  session_date VARCHAR(20) NOT NULL,
  session_key VARCHAR(120) NOT NULL UNIQUE,
  taken_by_user_id INT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'submitted',
  notes VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_as_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_as_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
  CONSTRAINT fk_as_user FOREIGN KEY (taken_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  status VARCHAR(20) NOT NULL,
  remarks VARCHAR(255) NOT NULL DEFAULT '',
  updated_by_user_id INT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, student_id),
  CONSTRAINT fk_ar_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS grading_scales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grade VARCHAR(10) NOT NULL UNIQUE,
  min_score DECIMAL(5,2) NOT NULL,
  max_score DECIMAL(5,2) NOT NULL,
  grade_point DECIMAL(4,2) NOT NULL DEFAULT 0.00,
  remark VARCHAR(80) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  assessment_type VARCHAR(40) NOT NULL,
  class_id INT NOT NULL,
  stream_id INT DEFAULT NULL,
  subject_id INT NOT NULL,
  academic_year_id INT NOT NULL,
  term_id INT NOT NULL,
  max_score DECIMAL(6,2) NOT NULL DEFAULT 100.00,
  weight_percent DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  scheduled_date VARCHAR(20) NOT NULL DEFAULT '',
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  created_by_user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_assess_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_assess_subject FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE CASCADE,
  CONSTRAINT fk_assess_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE,
  CONSTRAINT fk_assess_term FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS marks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assessment_id INT NOT NULL,
  student_id INT NOT NULL,
  score DECIMAL(6,2) NOT NULL,
  percentage DECIMAL(6,2) NOT NULL,
  grade VARCHAR(10) NOT NULL,
  remark VARCHAR(120) NOT NULL DEFAULT '',
  entered_by_user_id INT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (assessment_id, student_id),
  CONSTRAINT fk_marks_assess FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  CONSTRAINT fk_marks_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mark_correction_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  mark_id INT NOT NULL,
  assessment_id INT NOT NULL,
  student_id INT NOT NULL,
  requested_by_user_id INT NOT NULL,
  previous_score DECIMAL(6,2) NOT NULL,
  proposed_score DECIMAL(6,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  reviewed_by_user_id INT DEFAULT NULL,
  review_note VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME DEFAULT NULL,
  CONSTRAINT fk_mcr_mark FOREIGN KEY (mark_id) REFERENCES marks(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fee_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  default_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  frequency VARCHAR(30) NOT NULL DEFAULT 'termly',
  is_mandatory TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(24) NOT NULL DEFAULT 'active'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fee_assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  fee_category_id INT NOT NULL,
  academic_year_id INT NOT NULL,
  term_id INT NOT NULL,
  amount_due DECIMAL(12,2) NOT NULL,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  due_date VARCHAR(20) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'unpaid',
  created_by_user_id INT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (student_id, fee_category_id, academic_year_id, term_id),
  CONSTRAINT fk_fa_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fa_cat FOREIGN KEY (fee_category_id) REFERENCES fee_categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fa_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fa_term FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fee_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  fee_assignment_id INT NOT NULL,
  adjustment_type VARCHAR(30) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  approved_by_user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fadj_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fadj_assign FOREIGN KEY (fee_assignment_id) REFERENCES fee_assignments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  academic_year_id INT NOT NULL,
  term_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  payment_method VARCHAR(30) NOT NULL,
  reference_number VARCHAR(100) NOT NULL DEFAULT '',
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  payment_date VARCHAR(20) NOT NULL,
  received_by_user_id INT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'completed',
  notes VARCHAR(255) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pay_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pay_user FOREIGN KEY (received_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  fee_assignment_id INT NOT NULL,
  allocated_amount DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_pa_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_assign FOREIGN KEY (fee_assignment_id) REFERENCES fee_assignments(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_number VARCHAR(50) NOT NULL UNIQUE,
  payment_id INT NOT NULL UNIQUE,
  student_id INT NOT NULL,
  issued_amount DECIMAL(12,2) NOT NULL,
  currency_code VARCHAR(10) NOT NULL,
  currency_symbol VARCHAR(16) NOT NULL,
  issued_by_user_id INT NOT NULL,
  snapshot_json TEXT NOT NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rcp_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rcp_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reconciliations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reconciliation_date VARCHAR(20) NOT NULL,
  payment_method VARCHAR(30) NOT NULL DEFAULT 'all',
  system_total DECIMAL(12,2) NOT NULL,
  counted_total DECIMAL(12,2) NOT NULL,
  variance DECIMAL(12,2) NOT NULL,
  notes VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'balanced',
  reconciled_by_user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  body TEXT NOT NULL,
  audience VARCHAR(30) NOT NULL DEFAULT 'all',
  priority VARCHAR(24) NOT NULL DEFAULT 'normal',
  author_user_id INT NOT NULL,
  publish_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at VARCHAR(30) DEFAULT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'published',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ann_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profile_change_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  student_id INT DEFAULT NULL,
  field_name VARCHAR(60) NOT NULL,
  current_value VARCHAR(255) NOT NULL DEFAULT '',
  requested_value VARCHAR(255) NOT NULL,
  reason VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  reviewed_by_user_id INT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME DEFAULT NULL,
  CONSTRAINT fk_pcr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT DEFAULT NULL,
  actor_role VARCHAR(40) NOT NULL DEFAULT '',
  action VARCHAR(100) NOT NULL,
  target_type VARCHAR(60) NOT NULL DEFAULT '',
  target_id VARCHAR(60) NOT NULL DEFAULT '',
  ip_address VARCHAR(64) NOT NULL DEFAULT '',
  metadata_json TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backup_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(180) NOT NULL,
  size_bytes INT NOT NULL DEFAULT 0,
  tables_count INT NOT NULL DEFAULT 0,
  total_rows INT NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'verified',
  created_by_user_id INT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- =============================================================================
-- Migration 002: Real-Time Google OAuth 2.0 Identity Fields on Users
-- Blueprint Revision 2.1 Addendum
-- Keeps local MySQL/MariaDB account & role as the authoritative source of truth.
-- =============================================================================

ALTER TABLE users ADD COLUMN google_subject_id VARCHAR(191) DEFAULT NULL;
ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN auth_provider VARCHAR(30) NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX idx_users_google_subject_id ON users (google_subject_id);
-- =============================================================================
-- Migration 003: Paystack Payment Gateway & Superadmin Financial Stats Controls
-- =============================================================================

ALTER TABLE school_settings ADD COLUMN term_revenue_target DECIMAL(12,2) NOT NULL DEFAULT 15000.00;
ALTER TABLE school_settings ADD COLUMN opening_balance_adjustment DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE school_settings ADD COLUMN billed_stat_adjustment DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE school_settings ADD COLUMN collected_stat_adjustment DECIMAL(12,2) NOT NULL DEFAULT 0.00;
ALTER TABLE school_settings ADD COLUMN paystack_enabled TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE school_settings ADD COLUMN paystack_channels VARCHAR(120) NOT NULL DEFAULT 'card,mobile_money,bank_transfer,ussd';

CREATE TABLE IF NOT EXISTS paystack_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(120) NOT NULL UNIQUE,
  access_code VARCHAR(120) NOT NULL DEFAULT '',
  authorization_url VARCHAR(500) NOT NULL DEFAULT '',
  student_id INT NOT NULL,
  academic_year_id INT NOT NULL,
  term_id INT NOT NULL,
  payer_email VARCHAR(160) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  amount_subunits INT NOT NULL,
  currency_code VARCHAR(10) NOT NULL,
  channel VARCHAR(40) NOT NULL DEFAULT 'mobile_money',
  gateway_mode VARCHAR(24) NOT NULL DEFAULT 'sandbox',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  gateway_response VARCHAR(255) NOT NULL DEFAULT '',
  payment_id INT DEFAULT NULL,
  receipt_number VARCHAR(50) DEFAULT NULL,
  initiated_by_user_id INT NOT NULL,
  verified_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_psk_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
  CONSTRAINT fk_psk_user FOREIGN KEY (initiated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Incremental Migration 004: Account Brute-Force Lockout & Credential Hygiene
-- Safely adds lockout and password rotation tracking columns to users

ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until VARCHAR(40) DEFAULT NULL;
ALTER TABLE users ADD COLUMN password_changed_at DATETIME DEFAULT NULL;

-- =============================================================================
-- Migration 005: Student Join Proposals & School Management System Branding
-- =============================================================================

CREATE TABLE IF NOT EXISTS student_registration_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  email VARCHAR(160) NOT NULL,
  phone VARCHAR(50) NOT NULL DEFAULT '',
  gender VARCHAR(20) NOT NULL DEFAULT '',
  date_of_birth VARCHAR(20) NOT NULL DEFAULT '',
  requested_class_id INT DEFAULT NULL,
  guardian_name VARCHAR(140) NOT NULL DEFAULT '',
  guardian_phone VARCHAR(50) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  admission_number VARCHAR(50) DEFAULT NULL,
  approved_user_id INT DEFAULT NULL,
  approved_student_id INT DEFAULT NULL,
  reviewed_by_user_id INT DEFAULT NULL,
  review_note VARCHAR(255) NOT NULL DEFAULT '',
  reviewed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_srr_class FOREIGN KEY (requested_class_id) REFERENCES classes(id) ON DELETE SET NULL,
  CONSTRAINT fk_srr_reviewer FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Migration 006: Google OAuth 2.0 Runtime Settings & Google Student Proposals
-- =============================================================================

ALTER TABLE school_settings ADD COLUMN google_oauth_enabled TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE school_settings ADD COLUMN google_client_id VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE school_settings ADD COLUMN google_client_secret VARCHAR(255) NOT NULL DEFAULT '';

ALTER TABLE student_registration_requests ADD COLUMN google_subject_id VARCHAR(191) DEFAULT NULL;
ALTER TABLE student_registration_requests ADD COLUMN auth_provider VARCHAR(30) NOT NULL DEFAULT 'local';

-- =============================================================================
-- Migration 007: Database-Backed OAuth 2.0 State & Cross-Context Handoff Tokens
-- =============================================================================

CREATE TABLE IF NOT EXISTS oauth_states (
  state_token VARCHAR(128) PRIMARY KEY,
  intent VARCHAR(24) NOT NULL DEFAULT 'login',
  use_popup TINYINT(1) NOT NULL DEFAULT 0,
  link_user_id INT DEFAULT NULL,
  reg_meta_json TEXT DEFAULT NULL,
  consumed TINYINT(1) NOT NULL DEFAULT 0,
  expires_at BIGINT NOT NULL,
  handoff_token_hash VARCHAR(128) DEFAULT NULL,
  handoff_user_id INT DEFAULT NULL,
  handoff_redirect_to VARCHAR(255) DEFAULT NULL,
  handoff_consumed TINYINT(1) NOT NULL DEFAULT 0,
  handoff_expires_at BIGINT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================================================
-- Migration 008: Runtime Paystack API Keys (Send, Receive & Reverse) & Transfers
-- =============================================================================

ALTER TABLE school_settings ADD COLUMN paystack_public_key VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE school_settings ADD COLUMN paystack_secret_key VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE school_settings ADD COLUMN paystack_webhook_secret VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE school_settings ADD COLUMN paystack_transfers_enabled TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE school_settings ADD COLUMN paystack_refunds_enabled TINYINT(1) NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS paystack_transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(64) NOT NULL UNIQUE,
  transfer_code VARCHAR(80) NOT NULL DEFAULT '',
  recipient_name VARCHAR(160) NOT NULL,
  recipient_account VARCHAR(64) NOT NULL,
  bank_or_network VARCHAR(80) NOT NULL,
  channel VARCHAR(30) NOT NULL DEFAULT 'mobile_money',
  amount DECIMAL(12,2) NOT NULL,
  amount_subunits BIGINT NOT NULL,
  currency_code VARCHAR(10) NOT NULL DEFAULT 'GHS',
  reason VARCHAR(255) NOT NULL DEFAULT '',
  gateway_mode VARCHAR(24) NOT NULL DEFAULT 'sandbox',
  status VARCHAR(24) NOT NULL DEFAULT 'success',
  gateway_response VARCHAR(255) NOT NULL DEFAULT '',
  initiated_by_user_id INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pskt_user FOREIGN KEY (initiated_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;




