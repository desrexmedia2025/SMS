(async function initLoginPage() {
  const signinView = document.getElementById('signin-view');
  const registerPanel = document.getElementById('register-panel');
  const resetPanel = document.getElementById('reset-panel');
  const alertEl = document.getElementById('login-alert');
  const infoEl = document.getElementById('login-info');
  const registerFeedbackEl = document.getElementById('register-feedback');
  const resetFeedbackEl = document.getElementById('reset-feedback');
  const form = document.getElementById('login-form');
  const submitBtn = document.getElementById('login-submit-btn');
  const registerForm = document.getElementById('student-register-form');
  const registerSubmitBtn = document.getElementById('register-submit-btn');
  const confirmForm = document.getElementById('reset-confirm-form');
  const googleSsoBlock = document.getElementById('google-sso-block');
  const googleRegisterBlock = document.getElementById('google-register-block');

  const OAUTH_MESSAGES = {
    unregistered_google:
      'No approved account matches that Google email. Students can submit a join proposal via "create one"; staff logins are created by Administration.',
    google_proposal_pending:
      'Your Google student join proposal is awaiting Superadmin approval. Once accepted, you can sign in with Google immediately.',
    google_proposal_rejected:
      'Your student join proposal was declined by Administration.',
    account_disabled:
      'This school account is currently inactive or suspended. Please contact Administration.',
    no_approved_role:
      'Your account does not have an assigned role yet. Please contact Administration.',
    oauth_cancelled: 'Google Sign-In was cancelled. You can sign in below whenever ready.',
    oauth_state_invalid: 'Google Sign-In session expired or state check failed. Please try again.',
    session_expired: 'Your session expired for your protection. Please sign in again.',
    subject_mismatch:
      'This school email is already linked to a different Google identity. Contact Administration.',
    google_already_linked: 'That Google account is already linked to another school user.',
    google_not_configured:
      'Google Sign-In is currently disabled in School Settings. Please sign in with your password.',
    oauth_network_restricted:
      'Google redirected back, but this cloud preview sandbox blocks outbound calls to oauth2.googleapis.com. Deploy to Vercel or run locally (or clear the Google Secret in Settings to use Sandbox mode here).',
    oauth_failed: 'Unable to complete Google Sign-In right now. Please try again or use your password.',
  };

  const INFO_MESSAGES = {
    google_proposal_submitted:
      'Your verified Google student join proposal has been submitted to the Superadmin. Once accepted, click "Continue with Google" to sign in.',
    google_proposal_already_pending:
      'A Google student join proposal for this email is already pending Superadmin review.',
  };

  function showError(msg) {
    alertEl.textContent = msg;
    alertEl.classList.remove('hidden');
    infoEl.classList.add('hidden');
  }

  function showInfo(msg) {
    infoEl.textContent = msg;
    infoEl.classList.remove('hidden');
    alertEl.classList.add('hidden');
  }

  function showSignInView() {
    registerPanel.classList.add('hidden');
    resetPanel.classList.add('hidden');
    signinView.classList.remove('hidden');
    document.getElementById('identifier').focus();
  }

  function showRegisterView() {
    signinView.classList.add('hidden');
    resetPanel.classList.add('hidden');
    registerFeedbackEl.classList.add('hidden');
    registerPanel.classList.remove('hidden');
    document.getElementById('reg-first-name').focus();
  }

  function showResetView() {
    signinView.classList.add('hidden');
    registerPanel.classList.add('hidden');
    resetPanel.classList.remove('hidden');
    document.getElementById('reset-email').focus();
  }

  const params = new URLSearchParams(window.location.search);
  const errKey = params.get('error');
  const infoKey = params.get('info');
  if (infoKey && INFO_MESSAGES[infoKey]) {
    showInfo(INFO_MESSAGES[infoKey]);
    window.history.replaceState({}, '', '/login');
  } else if (errKey && OAUTH_MESSAGES[errKey]) {
    if (
      ['oauth_cancelled', 'google_not_configured', 'session_expired', 'google_proposal_pending'].includes(
        errKey
      )
    ) {
      showInfo(OAUTH_MESSAGES[errKey]);
    } else {
      showError(OAUTH_MESSAGES[errKey]);
    }
    window.history.replaceState({}, '', '/login');
  }

  try {
    const sess = await SMS.initSession();
    if (sess.authenticated && sess.redirectTo) {
      SMS.navigateAuthenticated(sess.redirectTo, sess.sessionToken);
      return;
    }
    if (sess.school?.school_name) {
      document.getElementById('brand-school-name').textContent = sess.school.school_name;
    }
    if (Array.isArray(sess.registrationClasses) && sess.registrationClasses.length > 0) {
      const clsSelect = document.getElementById('reg-class-select');
      clsSelect.innerHTML =
        '<option value="">Select Class</option>' +
        sess.registrationClasses
          .map((c) => `<option value="${c.id}">${SMS.esc(c.name)}</option>`)
          .join('');
    }
    if (sess.googleAuthEnabled === false) {
      googleSsoBlock.classList.add('hidden');
      googleRegisterBlock.classList.add('hidden');
    } else {
      googleSsoBlock.classList.remove('hidden');
      googleRegisterBlock.classList.remove('hidden');
    }
  } catch (err) {
    showError(err.message);
  }

  document.getElementById('google-login-btn').addEventListener('click', (e) => {
    e.preventDefault();
    SMS.startGoogleAuth('/auth/google');
  });

  document.getElementById('google-register-btn').addEventListener('click', () => {
    const termsChk = document.getElementById('reg-accept-terms');
    if (termsChk && !termsChk.checked) {
      registerFeedbackEl.textContent =
        'You must read and accept the Terms and Conditions before creating an account.';
      registerFeedbackEl.className = 'alert alert-error';
      registerFeedbackEl.classList.remove('hidden');
      return;
    }
    const qs = new URLSearchParams({ mode: 'register' });
    const classId = document.getElementById('reg-class-select').value;
    const gender = document.getElementById('reg-gender').value;
    const guardianPhone = document.getElementById('reg-guardian-phone').value.trim();
    if (classId) qs.set('classId', classId);
    if (gender) qs.set('gender', gender);
    if (guardianPhone) qs.set('guardianPhone', guardianPhone);
    SMS.startGoogleAuth(`/auth/google?${qs.toString()}`);
  });

  const loginTermsModal = document.getElementById('login-terms-modal');
  const loginTermsBody = document.getElementById('login-terms-clauses-body');
  if (loginTermsBody && typeof SMS.buildTermsClausesHtml === 'function') {
    loginTermsBody.innerHTML = SMS.buildTermsClausesHtml();
  }
  document.getElementById('open-reg-terms-btn')?.addEventListener('click', () => {
    loginTermsModal?.classList.add('open');
  });
  document.getElementById('close-reg-terms-modal-btn')?.addEventListener('click', () => {
    loginTermsModal?.classList.remove('open');
  });
  document.getElementById('accept-reg-terms-modal-btn')?.addEventListener('click', () => {
    const chk = document.getElementById('reg-accept-terms');
    if (chk) chk.checked = true;
    registerFeedbackEl.classList.add('hidden');
    loginTermsModal?.classList.remove('open');
  });
  loginTermsModal?.addEventListener('click', (e) => {
    if (e.target === loginTermsModal) loginTermsModal.classList.remove('open');
  });

  async function performLogin(identifier, password) {
    alertEl.classList.add('hidden');
    infoEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'SIGNING IN...';
    try {
      const res = await SMS.api('/api/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      SMS.navigateAuthenticated(res.redirectTo, res.sessionToken);
    } catch (err) {
      showError(err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'LOG IN';
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const identifier = document.getElementById('identifier').value.trim();
    const password = document.getElementById('password').value;
    await performLogin(identifier, password);
  });

  /* ---------------- ONE-TIME CODE (OTP) SIGN-IN: EMAIL OR PHONE ---------------- */
  const otpPanel = document.getElementById('otp-panel');
  const otpToggleBtn = document.getElementById('toggle-otp-btn');
  const otpStepRequest = document.getElementById('otp-step-request');
  const otpStepVerify = document.getElementById('otp-step-verify');
  const otpIdentifierInput = document.getElementById('otp-identifier');
  const otpChannelSelect = document.getElementById('otp-channel');
  const otpRequestBtn = document.getElementById('otp-request-btn');
  const otpVerifyBtn = document.getElementById('otp-verify-btn');
  const otpCodeInput = document.getElementById('otp-code-input');
  const otpResendBtn = document.getElementById('otp-resend-btn');
  const otpBackBtn = document.getElementById('otp-back-btn');
  const otpTimerEl = document.getElementById('otp-timer');
  const otpSentNote = document.getElementById('otp-sent-note');
  const otpInfoEl = document.getElementById('otp-info');
  const otpErrorEl = document.getElementById('otp-error');

  let otpTimerHandle = null;

  function otpShowInfo(msg) {
    otpInfoEl.textContent = msg;
    otpInfoEl.classList.remove('hidden');
    otpErrorEl.classList.add('hidden');
  }

  function otpShowError(msg) {
    otpErrorEl.textContent = msg;
    otpErrorEl.classList.remove('hidden');
    otpInfoEl.classList.add('hidden');
  }

  function otpClearAlerts() {
    otpInfoEl.classList.add('hidden');
    otpErrorEl.classList.add('hidden');
  }

  function startOtpCountdown(seconds) {
    if (otpTimerHandle) clearInterval(otpTimerHandle);
    let remaining = Number(seconds) || 600;
    const tick = () => {
      const mins = Math.floor(remaining / 60);
      const secs = String(remaining % 60).padStart(2, '0');
      otpTimerEl.textContent = `Code expires in ${mins}:${secs}`;
      if (remaining <= 0) {
        clearInterval(otpTimerHandle);
        otpTimerHandle = null;
        otpTimerEl.textContent = 'Code expired. Request a new one.';
        return;
      }
      remaining -= 1;
    };
    tick();
    otpTimerHandle = setInterval(tick, 1000);
  }

  function showOtpRequestStep() {
    otpStepRequest.classList.remove('hidden');
    otpStepVerify.classList.add('hidden');
    if (otpTimerHandle) {
      clearInterval(otpTimerHandle);
      otpTimerHandle = null;
      otpTimerEl.textContent = '';
    }
  }

  function showOtpVerifyStep() {
    otpStepRequest.classList.add('hidden');
    otpStepVerify.classList.remove('hidden');
    otpCodeInput.value = '';
    otpCodeInput.focus();
  }

  otpToggleBtn.addEventListener('click', () => {
    otpPanel.classList.toggle('hidden');
    otpClearAlerts();
    if (!otpPanel.classList.contains('hidden')) {
      showOtpRequestStep();
      otpIdentifierInput.focus();
    }
  });

  otpCodeInput.addEventListener('input', () => {
    otpCodeInput.value = otpCodeInput.value.replace(/\D/g, '').slice(0, 6);
  });

  otpCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') otpVerifyBtn.click();
  });

  async function requestOtpCode() {
    const identifier = otpIdentifierInput.value.trim();
    if (identifier.length < 3) {
      otpShowError('Enter your email, username or phone number first.');
      return;
    }
    otpClearAlerts();
    otpRequestBtn.disabled = true;
    otpRequestBtn.textContent = 'SENDING...';
    try {
      const res = await SMS.api('/api/auth/otp/request', {
        method: 'POST',
        body: { identifier, channel: otpChannelSelect.value },
      });
      otpSentNote.textContent = `We sent a 6-digit code to ${res.destination}. Enter it below to sign in.`;
      if (res.sandboxCode) {
        otpShowInfo(
          `Sandbox mode (no ${res.channel === 'phone' ? 'SMS gateway' : 'email server'} configured): your one-time code is ${res.sandboxCode}`
        );
      } else {
        otpShowInfo(res.message);
      }
      startOtpCountdown(res.expiresInSeconds);
      showOtpVerifyStep();
    } catch (err) {
      otpShowError(err.message);
    } finally {
      otpRequestBtn.disabled = false;
      otpRequestBtn.textContent = 'SEND CODE';
    }
  }

  async function verifyOtpCode() {
    const identifier = otpIdentifierInput.value.trim();
    const code = otpCodeInput.value.trim();
    if (code.length !== 6) {
      otpShowError('Enter the 6-digit code that was sent to you.');
      return;
    }
    otpClearAlerts();
    otpVerifyBtn.disabled = true;
    otpVerifyBtn.textContent = 'VERIFYING...';
    try {
      const res = await SMS.api('/api/auth/otp/verify', {
        method: 'POST',
        body: { identifier, code },
      });
      SMS.navigateAuthenticated(res.redirectTo, res.sessionToken);
    } catch (err) {
      otpShowError(err.message);
      otpVerifyBtn.disabled = false;
      otpVerifyBtn.textContent = 'VERIFY & SIGN IN';
    }
  }

  otpRequestBtn.addEventListener('click', requestOtpCode);
  otpResendBtn.addEventListener('click', requestOtpCode);
  otpVerifyBtn.addEventListener('click', verifyOtpCode);
  otpBackBtn.addEventListener('click', () => {
    otpClearAlerts();
    showOtpRequestStep();
    otpIdentifierInput.focus();
  });

  document.getElementById('hero-signin-btn').addEventListener('click', showSignInView);
  document.getElementById('toggle-register-btn').addEventListener('click', showRegisterView);
  document.getElementById('back-to-signin-from-reg-btn').addEventListener('click', showSignInView);
  document.getElementById('toggle-reset-btn').addEventListener('click', showResetView);
  document.getElementById('back-to-login-btn').addEventListener('click', showSignInView);

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerFeedbackEl.classList.add('hidden');
    const acceptTerms = Boolean(document.getElementById('reg-accept-terms')?.checked);
    if (!acceptTerms) {
      registerFeedbackEl.textContent =
        'You must read and accept the Terms and Conditions to create an account.';
      registerFeedbackEl.className = 'alert alert-error';
      registerFeedbackEl.classList.remove('hidden');
      return;
    }
    registerSubmitBtn.disabled = true;
    registerSubmitBtn.textContent = 'SUBMITTING...';
    try {
      const payload = {
        firstName: document.getElementById('reg-first-name').value.trim(),
        lastName: document.getElementById('reg-last-name').value.trim(),
        email: document.getElementById('reg-email').value.trim(),
        requestedClassId: document.getElementById('reg-class-select').value || null,
        gender: document.getElementById('reg-gender').value,
        guardianPhone: document.getElementById('reg-guardian-phone').value.trim(),
        password: document.getElementById('reg-password').value,
        acceptTerms: true,
      };
      const res = await SMS.api('/api/auth/register-student', {
        method: 'POST',
        body: payload,
      });
      registerForm.reset();
      showSignInView();
      document.getElementById('identifier').value = payload.email;
      showInfo(res.message);
    } catch (err) {
      registerFeedbackEl.textContent = err.message;
      registerFeedbackEl.className = 'alert alert-error';
      registerFeedbackEl.classList.remove('hidden');
    } finally {
      registerSubmitBtn.disabled = false;
      registerSubmitBtn.textContent = 'CREATE ACCOUNT';
    }
  });

  document.getElementById('have-code-btn').addEventListener('click', () => {
    confirmForm.classList.remove('hidden');
  });

  document.getElementById('reset-request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const email = document.getElementById('reset-email').value.trim();
      const res = await SMS.api('/api/auth/password-reset/request', {
        method: 'POST',
        body: { email },
      });
      confirmForm.classList.remove('hidden');
      resetFeedbackEl.textContent = res.message;
      resetFeedbackEl.className = 'alert alert-info';
      resetFeedbackEl.classList.remove('hidden');
    } catch (err) {
      resetFeedbackEl.textContent = err.message;
      resetFeedbackEl.className = 'alert alert-error';
      resetFeedbackEl.classList.remove('hidden');
    }
  });

  confirmForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const email = document.getElementById('reset-email').value.trim();
      const resetCode = document.getElementById('reset-code').value.trim();
      const newPassword = document.getElementById('reset-new-password').value;
      const res = await SMS.api('/api/auth/password-reset/confirm', {
        method: 'POST',
        body: { email, resetCode, newPassword },
      });
      confirmForm.reset();
      showSignInView();
      showInfo(res.message);
    } catch (err) {
      resetFeedbackEl.textContent = err.message;
      resetFeedbackEl.className = 'alert alert-error';
      resetFeedbackEl.classList.remove('hidden');
    }
  });
})();
