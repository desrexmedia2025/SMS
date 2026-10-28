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
