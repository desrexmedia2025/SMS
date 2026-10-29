-- =============================================================================
-- Migration 013: Profile Photos & One-Time Sign-In Codes (OTP)
-- Adds uploadable avatar storage per user and a hashed, single-use OTP store
-- =============================================================================

ALTER TABLE users ADD COLUMN avatar_file VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN avatar_updated_at DATETIME DEFAULT NULL;

CREATE TABLE IF NOT EXISTS login_otp_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  channel VARCHAR(16) NOT NULL DEFAULT 'email',
  destination VARCHAR(190) NOT NULL DEFAULT '',
  code_hash VARCHAR(255) NOT NULL,
  purpose VARCHAR(24) NOT NULL DEFAULT 'login',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME DEFAULT NULL,
  request_ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_login_otp_user ON login_otp_codes (user_id);
CREATE INDEX idx_login_otp_purpose ON login_otp_codes (purpose);
