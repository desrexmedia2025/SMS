-- =============================================================================
-- Migration 014: Retire the One-Time Code (OTP) sign-in experiment
-- Drops the OTP code store; sign-in is password + Google OAuth 2.0 only.
-- Profile photo columns added in migration 013 are kept.
-- =============================================================================

DROP TABLE IF EXISTS login_otp_codes;
