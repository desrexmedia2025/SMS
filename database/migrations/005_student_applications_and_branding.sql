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

UPDATE school_settings
SET school_name = 'School Management System',
    school_code = 'SMS-PORTAL'
WHERE id = 1 AND school_name = 'Accra Crest International Academy';
