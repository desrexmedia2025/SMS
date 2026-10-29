-- =============================================================================
-- Migration 012: Terms & Conditions Acceptance, Theme & Language Preferences
-- =============================================================================

ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME DEFAULT NULL;
ALTER TABLE users ADD COLUMN terms_version VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN theme_preference VARCHAR(20) NOT NULL DEFAULT 'light';
ALTER TABLE users ADD COLUMN language_preference VARCHAR(10) NOT NULL DEFAULT 'en';

ALTER TABLE student_registration_requests ADD COLUMN terms_accepted TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE student_registration_requests ADD COLUMN terms_accepted_at DATETIME DEFAULT NULL;
ALTER TABLE student_registration_requests ADD COLUMN terms_version VARCHAR(20) NOT NULL DEFAULT '';
