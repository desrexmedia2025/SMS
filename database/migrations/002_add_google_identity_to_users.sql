-- =============================================================================
-- Migration 002: Real-Time Google OAuth 2.0 Identity Fields on Users
-- Blueprint Revision 2.1 Addendum
-- Keeps local MySQL/MariaDB account & role as the authoritative source of truth.
-- =============================================================================

ALTER TABLE users ADD COLUMN google_subject_id VARCHAR(191) DEFAULT NULL;
ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN auth_provider VARCHAR(30) NOT NULL DEFAULT 'local';
CREATE UNIQUE INDEX idx_users_google_subject_id ON users (google_subject_id);
