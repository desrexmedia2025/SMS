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
