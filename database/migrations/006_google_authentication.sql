-- =============================================================================
-- Migration 006: Google OAuth 2.0 Runtime Settings & Google Student Proposals
-- =============================================================================

ALTER TABLE school_settings ADD COLUMN google_oauth_enabled TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE school_settings ADD COLUMN google_client_id VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE school_settings ADD COLUMN google_client_secret VARCHAR(255) NOT NULL DEFAULT '';

ALTER TABLE student_registration_requests ADD COLUMN google_subject_id VARCHAR(191) DEFAULT NULL;
ALTER TABLE student_registration_requests ADD COLUMN auth_provider VARCHAR(30) NOT NULL DEFAULT 'local';
