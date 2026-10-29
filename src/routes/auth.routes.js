const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');
const { verifyCsrfToken } = require('../middleware/csrfProtection');
const { createRateLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const authRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  keyPrefix: 'auth',
  message: 'Too many authentication attempts from this network. Please wait a minute before trying again.',
});

router.get('/session', authController.getSessionStatus);
router.post('/login', authRateLimit, verifyCsrfToken, authController.login);
router.post('/register-student', authRateLimit, verifyCsrfToken, authController.registerStudent);
router.post('/logout', verifyCsrfToken, authController.logout);
router.post('/password-reset/request', authRateLimit, verifyCsrfToken, authController.requestReset);
router.post('/password-reset/confirm', authRateLimit, verifyCsrfToken, authController.confirmReset);
router.post('/password/change', authenticate, verifyCsrfToken, authController.changePassword);
router.post('/terms/accept', authenticate, verifyCsrfToken, authController.acceptTerms);
router.patch('/preferences', authenticate, verifyCsrfToken, authController.updatePreferences);

// Own profile photo upload / removal
const avatarRateLimit = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 30,
  keyPrefix: 'avatar',
  message: 'Too many profile photo changes. Please wait a few minutes.',
});
const { uploadAvatar } = require('../config/upload');
router.post(
  '/avatar',
  authenticate,
  avatarRateLimit,
  verifyCsrfToken,
  uploadAvatar,
  authController.uploadOwnAvatar
);
router.delete('/avatar', authenticate, verifyCsrfToken, authController.removeOwnAvatar);

// Real-Time Google OAuth 2.0 + State-Verified Interactive Sandbox & Popup Handoff
router.get('/google', authRateLimit, authController.startGoogleOAuth);
router.get('/google/consent-context', authRateLimit, authController.getConsentContext);
router.get('/google/dev-consent', authRateLimit, authController.renderDevGoogleConsent);
router.post('/google/dev-authorize', authRateLimit, authController.authorizeDevGoogleOAuth);
router.get('/google/callback', authRateLimit, authController.handleGoogleCallback);
router.post('/google/handoff', authRateLimit, authController.exchangeGoogleHandoff);
router.get('/google/popup-complete', authController.renderPopupComplete);
router.post('/google/unlink', authenticate, verifyCsrfToken, authController.unlinkGoogle);

module.exports = router;
