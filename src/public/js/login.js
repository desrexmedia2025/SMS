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
    const qs = new URLSearchParams({ mode: 'register' });
    const classId = document.getElementById('reg-class-select').value;
    const gender = document.getElementById('reg-gender').value;
    const guardianPhone = document.getElementById('reg-guardian-phone').value.trim();
    if (classId) qs.set('classId', classId);
    if (gender) qs.set('gender', gender);
    if (guardianPhone) qs.set('guardianPhone', guardianPhone);
    SMS.startGoogleAuth(`/auth/google?${qs.toString()}`);
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

  document.getElementById('hero-signin-btn').addEventListener('click', showSignInView);
  document.getElementById('toggle-register-btn').addEventListener('click', showRegisterView);
  document.getElementById('back-to-signin-from-reg-btn').addEventListener('click', showSignInView);
  document.getElementById('toggle-reset-btn').addEventListener('click', showResetView);
  document.getElementById('back-to-login-btn').addEventListener('click', showSignInView);

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    registerFeedbackEl.classList.add('hidden');
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
