-- =============================================================================
-- Migration 007: Database-Backed OAuth 2.0 State & Cross-Context Handoff Tokens
-- Eliminates pre-login cookie/iframe state loss while enforcing single-use TTL
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
