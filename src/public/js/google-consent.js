(async function initGoogleConsentPage() {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state') || '';
  document.getElementById('gc-state').value = state;

  const cancelLink = document.getElementById('gc-cancel-link');
  if (cancelLink && state) {
    cancelLink.href = `/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`;
  }

  try {
    const res = await fetch(
      `/api/auth/google/consent-context?state=${encodeURIComponent(state)}`,
      { headers: { Accept: 'application/json' }, credentials: 'same-origin' }
    );
    const data = await res.json();
    if (!res.ok || !data.ok) {
      window.location.replace('/login?error=oauth_state_invalid');
      return;
    }

    if (data.schoolName) {
      document.getElementById('gc-school-name').textContent = data.schoolName;
    }
    if (data.intent === 'register') {
      document.getElementById('gc-heading').textContent = 'Sign up with Google';
      document.getElementById('gc-subtitle').textContent =
        'Submit a verified student join proposal for administrator approval';
    } else if (data.intent === 'link') {
      document.getElementById('gc-heading').textContent = 'Link Google Account';
      if (data.linkEmail) document.getElementById('gc-email').value = data.linkEmail;
      if (data.linkFullName) document.getElementById('gc-name').value = data.linkFullName;
    }
    document.getElementById('gc-email').focus();
  } catch (_) {
    document.getElementById('gc-email').focus();
  }
})();
