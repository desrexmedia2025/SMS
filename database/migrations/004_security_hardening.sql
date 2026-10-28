-- Incremental Migration 004: Account Brute-Force Lockout & Credential Hygiene
-- Safely adds lockout and password rotation tracking columns to users

ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until VARCHAR(40) DEFAULT NULL;
ALTER TABLE users ADD COLUMN password_changed_at DATETIME DEFAULT NULL;
