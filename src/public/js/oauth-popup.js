(async function finishGooglePopup() {
  const params = new URLSearchParams(window.location.search);
  const rawTarget = params.get('target') || '/login';
  const handoffToken = params.get('handoff') || '';
  const safeTarget =
    rawTarget.startsWith('/') && !rawTarget.startsWith('//') ? rawTarget : '/login';

  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(
        {
          type: 'SMS_GOOGLE_AUTH_DONE',
          targetUrl: safeTarget,
          handoffToken,
        },
        window.location.origin
      );
      window.close();
      return;
    } catch (_) {
      // Fallback to in-frame handoff exchange below
    }
  }

  if (handoffToken) {
    try {
      const res = await fetch('/api/auth/google/handoff', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ handoffToken }),
      });
      const data = await res.json();
      if (data && data.ok && data.redirectTo) {
        const tok = String(data.sessionToken || '').trim();
        if (tok) {
          try {
            sessionStorage.setItem('sms_session_token', tok);
          } catch (_) {
            // ignore
          }
          const u = new URL(data.redirectTo, window.location.origin);
          u.searchParams.set('_st', tok);
          window.location.replace(`${u.pathname}${u.search}${u.hash}`);
          return;
        }
        window.location.replace(data.redirectTo);
        return;
      }
    } catch (_) {
      // Fall back to safeTarget below
    }
  }

  window.location.replace(safeTarget);
})();
