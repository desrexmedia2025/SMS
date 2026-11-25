-- =============================================================================
-- Migration 021: Teacher date of birth
-- The staff registration form now captures an age through the wheel picker.
-- The record stores the implied date of birth alongside the other staff
-- details, mirroring the students table.
-- =============================================================================

ALTER TABLE teachers ADD COLUMN date_of_birth VARCHAR(20) NOT NULL DEFAULT '';
