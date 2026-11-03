-- =============================================================================
-- Migration 018: Announcement Editing
-- Lets a published announcement be corrected (by its author or the Superadmin)
-- and shows every receiver that a notice was revised.
-- =============================================================================

ALTER TABLE announcements
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE announcements
  ADD COLUMN edited_by_user_id INT DEFAULT NULL;

ALTER TABLE announcements
  ADD COLUMN edited_at DATETIME DEFAULT NULL;
