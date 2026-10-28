// Hardened DOM, HTTP, CSRF, Session Carrier, Privacy Masking, Currency, Paystack Checkout & CSV utilities for SMS
window.SMS = (() => {
  const SESSION_STORAGE_KEY = 'sms_session_token';
  let csrfToken = '';
  let sessionToken = '';
  let currencySymbol = 'GH₵';
  let currencyCode = 'GHS';
  let currentUser = null;
  let googleAuthEnabled = false;
  let googleAuthMode = 'sandbox';

  function setSessionToken(tok) {
    sessionToken = String(tok || '').trim();
    try {
      if (sessionToken) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, sessionToken);
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (_) {
      // ignore storage errors
    }
  }

  function getSessionToken() {
    if (sessionToken) return sessionToken;
    try {
      sessionToken = String(sessionStorage.getItem(SESSION_STORAGE_KEY) || '').trim();
    } catch (_) {
      sessionToken = '';
    }
    return sessionToken;
  }

  function withNavSession(targetUrl, tokenOverride) {
    const urlStr = String(targetUrl || '/');
    if (!urlStr.startsWith('/') || urlStr.startsWith('//')) return urlStr;
    const tok = String(tokenOverride || getSessionToken() || '').trim();
    if (!tok) return urlStr;
    const u = new URL(urlStr, window.location.origin);
    u.searchParams.set('_st', tok);
    return `${u.pathname}${u.search}${u.hash}`;
  }

  function navigateAuthenticated(targetUrl, tokenOverride) {
    if (tokenOverride) setSessionToken(tokenOverride);
    window.location.replace(withNavSession(targetUrl, tokenOverride));
  }

  // Bootstrap fallback session token from URL on navigation & strip immediately from address bar
  (() => {
    try {
      const u = new URL(window.location.href);
      const navTok = u.searchParams.get('_st');
      if (navTok) {
        setSessionToken(navTok);
        u.searchParams.delete('_st');
        window.history.replaceState({}, '', `${u.pathname}${u.search}${u.hash}`);
      } else {
        getSessionToken();
      }
    } catch (_) {
      // ignore
    }
  })();

  function esc(val) {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(amount, symOverride) {
    const sym = symOverride || currencySymbol || 'GH₵';
    const num = Number(amount || 0);
    const formatted = `${esc(sym)} ${num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
    return `<span class="sensitive-figure">${formatted}</span>`;
  }

  function moneyPlain(amount, symOverride) {
    const sym = symOverride || currencySymbol || 'GH₵';
    const num = Number(amount || 0);
    return `${sym} ${num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  function setCurrency(code, symbol) {
    if (code) currencyCode = code;
    if (symbol) currencySymbol = symbol;
    const sbCur = document.getElementById('sb-currency-display');
    if (sbCur) {
      sbCur.textContent = `${currencyCode} (${currencySymbol})`;
    }
  }

  function getCurrency() {
    return { code: currencyCode, symbol: currencySymbol };
  }

  function toast(message, type = 'info') {
    let box = document.getElementById('toast-container');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toast-container';
      box.className = 'toast-container';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function api(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };
    const activeSessionTok = getSessionToken();
    if (activeSessionTok) {
      headers['X-SMS-Session'] = activeSessionTok;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const res = await fetch(url, {
      ...options,
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));
    if (data && data.sessionToken) {
      setSessionToken(data.sessionToken);
    }
    if (data && data.csrfToken) {
      csrfToken = data.csrfToken;
    }

    if (res.status === 401 && window.location.pathname.startsWith('/dashboard/')) {
      setSessionToken('');
      window.location.href = '/login?error=session_expired';
      throw new Error('Session expired. Redirecting to sign in...');
    }

    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  async function initSession() {
    const sess = await api('/api/auth/session');
    csrfToken = sess.csrfToken || '';
    currentUser = sess.user || null;
    googleAuthEnabled = Boolean(sess.googleAuthEnabled);
    googleAuthMode = String(sess.googleAuthMode || 'sandbox');
    if (sess.school) {
      setCurrency(sess.school.currency_code, sess.school.currency_symbol);
    }
    try {
      sessionStorage.removeItem('sms_privacy_masked');
      document.body?.classList.remove('privacy-masked');
    } catch (_) {
      // ignore storage errors
    }
    enhancePasswordInputs();
    installBackButtonGuard();
    return sess;
  }

  function installBackButtonGuard() {
    if (!window.location.pathname.startsWith('/dashboard/')) return;
    window.addEventListener('pageshow', async (event) => {
      if (event.persisted) {
        try {
          const check = await api('/api/auth/session');
          if (!check.authenticated) {
            window.location.replace('/login');
          }
        } catch (_) {
          window.location.replace('/login');
        }
      }
    });
  }

  function enhancePasswordInputs(root = document) {
    root.querySelectorAll('input[type="password"]').forEach((inp) => {
      if (inp.dataset.pwEnhanced === '1') return;
      inp.dataset.pwEnhanced = '1';
      inp.setAttribute('spellcheck', 'false');
      inp.setAttribute('autocapitalize', 'off');

      const wrap = document.createElement('div');
      wrap.className = 'password-field-wrap';
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'pw-toggle-btn';
      toggle.textContent = 'Show';
      toggle.setAttribute('aria-label', 'Toggle password visibility');
      toggle.addEventListener('click', () => {
        const showing = inp.type === 'text';
        inp.type = showing ? 'password' : 'text';
        toggle.textContent = showing ? 'Show' : 'Hide';
      });
      wrap.appendChild(toggle);
    });
  }

  window.addEventListener('message', async (event) => {
    if (event.origin !== window.location.origin) return;
    if (event.data && event.data.type === 'SMS_GOOGLE_AUTH_DONE') {
      const targetUrl = String(event.data.targetUrl || '/login');
      const handoffToken = String(event.data.handoffToken || '').trim();

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
            navigateAuthenticated(data.redirectTo, data.sessionToken);
            return;
          }
        } catch (_) {
          // Fall back to targetUrl below
        }
      }

      if (targetUrl.startsWith('/') && !targetUrl.startsWith('//')) {
        navigateAuthenticated(targetUrl);
      }
    }
  });

  function startGoogleAuth(baseUrl = '/auth/google') {
    const resolvedBaseUrl = baseUrl.includes('mode=link') ? withNavSession(baseUrl) : baseUrl;
    const inIframe = (() => {
      try {
        return window.self !== window.top;
      } catch (_) {
        return true;
      }
    })();

    // Only open a top-level popup when redirecting to external accounts.google.com (which sends X-Frame-Options: DENY).
    // In interactive sandbox mode, navigate directly inside the current frame so there is zero cross-window split.
    if (inIframe && googleAuthMode === 'live') {
      const sep = resolvedBaseUrl.includes('?') ? '&' : '?';
      const popupUrl = `${resolvedBaseUrl}${sep}popup=1`;
      const w = 520;
      const h = 640;
      const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
      const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
      const popup = window.open(
        popupUrl,
        'sms_google_oauth',
        `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`
      );
      if (popup) {
        popup.focus();
        return;
      }
    }
    window.location.href = resolvedBaseUrl;
  }

  function configureGoogleLinkButton(btnId = 'google-link-btn') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('linked') === 'google') {
      toast('Google Sign-In linked to your account.', 'success');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('oauth_error')) {
      const reason = params.get('oauth_error');
      const msg =
        reason === 'google_already_linked'
          ? 'That Google account is already linked to another school user.'
          : 'Could not link Google account.';
      toast(msg, 'error');
      window.history.replaceState({}, '', window.location.pathname);
    }

    const gBtn = document.getElementById(btnId);
    if (!gBtn) return;

    if (currentUser && currentUser.googleLinked) {
      gBtn.classList.remove('hidden');
      gBtn.textContent = 'Google Linked';
      gBtn.href = '#';
      gBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!confirm('Unlink Google Sign-In from your school account?')) return;
        try {
          await api('/api/auth/google/unlink', { method: 'POST' });
          toast('Google Sign-In unlinked.', 'success');
          navigateAuthenticated(window.location.pathname);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      return;
    }

    if (!googleAuthEnabled) {
      gBtn.classList.add('hidden');
    } else {
      gBtn.classList.remove('hidden');
      gBtn.addEventListener('click', (e) => {
        e.preventDefault();
        startGoogleAuth('/auth/google?mode=link');
      });
    }
  }

  function initPrivacyToggle(btnId = 'privacy-toggle-btn') {
    const btn = document.getElementById(btnId);
    const saved = sessionStorage.getItem('sms_privacy_masked') === '1';
    if (saved) {
      document.body.classList.add('privacy-masked');
    }
    if (!btn) return;
    const syncLabel = () => {
      const masked = document.body.classList.contains('privacy-masked');
      btn.textContent = masked ? 'Show Figures' : 'Hide Figures';
    };
    syncLabel();
    btn.addEventListener('click', () => {
      document.body.classList.toggle('privacy-masked');
      const masked = document.body.classList.contains('privacy-masked');
      sessionStorage.setItem('sms_privacy_masked', masked ? '1' : '0');
      syncLabel();
    });
  }

  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // proceed to login regardless
    }
    setSessionToken('');
    try {
      sessionStorage.clear();
    } catch (_) {
      // ignore
    }
    window.location.replace('/login');
  }

  function syncSidebarToggleLabel() {
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    if (!mobileBtn || !sidebar) return;

    const isMobile = window.innerWidth <= 900;
    const isVisible = isMobile
      ? sidebar.classList.contains('open')
      : !document.body.classList.contains('sidebar-collapsed');

    if (backdrop) {
      backdrop.classList.toggle('open', isMobile && isVisible);
    }

    const labelSpan = mobileBtn.querySelector('.menu-btn-text');
    const labelText = isVisible ? 'Hide Menu' : 'Show Menu';
    if (labelSpan) {
      labelSpan.textContent = labelText;
    } else {
      mobileBtn.textContent = labelText;
    }
    mobileBtn.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
    mobileBtn.setAttribute('title', isVisible ? 'Hide sidebar menu' : 'Show sidebar menu');
  }

  function activateSection(sec, onSectionChange) {
    const navBtns = document.querySelectorAll('.nav-btn[data-section]');
    const sidebar = document.getElementById('sidebar');
    navBtns.forEach((b) => b.classList.toggle('active', b.dataset.section === sec));
    const activeBtn = document.querySelector(`.nav-btn[data-section="${sec}"]`);
    const titleEl = document.getElementById('topbar-title');
    const subtitleEl = document.getElementById('topbar-subtitle');
    if (titleEl && activeBtn) {
      const labelEl = activeBtn.querySelector('.nav-item-label');
      titleEl.textContent =
        activeBtn.dataset.title || (labelEl ? labelEl.textContent.trim() : activeBtn.textContent.trim());
    }
    if (subtitleEl && activeBtn) {
      subtitleEl.textContent = activeBtn.dataset.subtitle || '';
      subtitleEl.classList.toggle('hidden', !activeBtn.dataset.subtitle);
    }
    if (sidebar && window.innerWidth <= 900) {
      sidebar.classList.remove('open');
      syncSidebarToggleLabel();
    }
    document.querySelectorAll('.module-panel').forEach((p) => {
      p.classList.toggle('hidden', p.id !== `sec-${sec}`);
    });
    if (onSectionChange) onSectionChange(sec);
  }

  function initNavigation(onSectionChange) {
    const navBtns = document.querySelectorAll('.nav-btn[data-section]');
    const sidebar = document.getElementById('sidebar');
    const mobileBtn = document.getElementById('mobile-menu-btn');

    if (sidebar && !document.getElementById('sidebar-backdrop')) {
      const backdrop = document.createElement('div');
      backdrop.id = 'sidebar-backdrop';
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', () => {
        sidebar.classList.remove('open');
        syncSidebarToggleLabel();
      });
    }

    try {
      if (window.innerWidth > 900 && window.sessionStorage.getItem('sms_sidebar_collapsed') === '1') {
        document.body.classList.add('sidebar-collapsed');
      }
    } catch (_e) {
      // ignore storage errors
    }

    if (mobileBtn && sidebar) {
      mobileBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>' +
        '<span class="menu-btn-text">Hide Menu</span>';

      mobileBtn.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          sidebar.classList.toggle('open');
        } else {
          const collapsed = document.body.classList.toggle('sidebar-collapsed');
          try {
            window.sessionStorage.setItem('sms_sidebar_collapsed', collapsed ? '1' : '0');
          } catch (_e) {
            // ignore storage errors
          }
        }
        syncSidebarToggleLabel();
      });

      window.addEventListener('resize', syncSidebarToggleLabel);
      syncSidebarToggleLabel();
    }

    navBtns.forEach((btn) => {
      btn.addEventListener('click', () => activateSection(btn.dataset.section, onSectionChange));
    });
  }

  function renderTimetableMatrix(targetOrId, items = [], options = {}) {
    const container =
      typeof targetOrId === 'string' ? document.getElementById(targetOrId) : targetOrId;
    if (!container) return;

    const {
      showClass = true,
      showTeacher = true,
      deleteAttr = '',
      emptyMessage = 'No timetable lessons scheduled yet.',
    } = options;

    const list = Array.isArray(items) ? items : [];
    const hasSaturday = list.some(
      (r) => String(r.day_of_week || '').toLowerCase() === 'saturday'
    );
    const days = hasSaturday
      ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    const headHtml = `
      <thead>
        <tr>
          <th class="tt-time-col">Time</th>
          ${days.map((d) => `<th>${esc(d)}</th>`).join('')}
        </tr>
      </thead>
    `;

    if (!list.length) {
      container.innerHTML = `
        <div class="timetable-matrix-wrap">
          <table class="timetable-matrix">
            ${headHtml}
            <tbody>
              <tr>
                <td colspan="${days.length + 1}" class="empty-state">${esc(emptyMessage)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
      return;
    }

    const slotMap = new Map();
    for (const row of list) {
      const start = String(row.start_time || '').slice(0, 5);
      const end = String(row.end_time || '').slice(0, 5);
      const key = `${start}|${end}`;
      if (!slotMap.has(key)) {
        slotMap.set(key, { start, end, byDay: {} });
      }
      const dayKey = String(row.day_of_week || '').trim();
      const entry = slotMap.get(key);
      if (!entry.byDay[dayKey]) entry.byDay[dayKey] = [];
      entry.byDay[dayKey].push(row);
    }

    const sortedBands = Array.from(slotMap.values()).sort((a, b) => {
      if (a.start !== b.start) return a.start.localeCompare(b.start);
      return a.end.localeCompare(b.end);
    });

    const bodyRows = sortedBands
      .map((band) => {
        const dayCells = days
          .map((day) => {
            const matches = band.byDay[day] || [];
            if (!matches.length) {
              return '<td><div class="tt-empty-slot">-</div></td>';
            }
            const cards = matches
              .map((m) => {
                const metaLines = [];
                if (showClass && m.class_name) {
                  metaLines.push(`<strong>${esc(m.class_name)}</strong>`);
                }
                if (showTeacher && m.teacher_name) {
                  metaLines.push(`Teacher: ${esc(m.teacher_name)}`);
                }
                if (m.room) {
                  metaLines.push(`Room: ${esc(m.room)}`);
                }
                return `
                  <div class="tt-slot-card">
                    ${m.subject_code ? `<span class="tt-slot-code">${esc(m.subject_code)}</span>` : ''}
                    <div class="tt-slot-subj">${esc(m.subject_name || '-')}</div>
                    ${metaLines.length ? `<div class="tt-slot-meta">${metaLines.join('<br>')}</div>` : ''}
                    ${
                      deleteAttr && m.id
                        ? `<div class="tt-slot-actions"><button type="button" class="btn btn-danger btn-sm" ${deleteAttr}="${m.id}">Remove</button></div>`
                        : ''
                    }
                  </div>
                `;
              })
              .join('');
            return `<td>${cards}</td>`;
          })
          .join('');

        return `
          <tr>
            <td class="tt-time-cell">${esc(band.start)} - ${esc(band.end)}</td>
            ${dayCells}
          </tr>
        `;
      })
      .join('');

    container.innerHTML = `
      <div class="timetable-matrix-wrap">
        <table class="timetable-matrix">
          ${headHtml}
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    `;
  }

  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    if (
      [
        'active',
        'paid',
        'present',
        'published',
        'approved',
        'balanced',
        'verified',
        'completed',
        'enrolled',
        'success',
      ].includes(s)
    ) {
      return `<span class="badge badge-success">${esc(status)}</span>`;
    }
    if (['partial', 'late', 'pending', 'important', 'excused'].includes(s)) {
      return `<span class="badge badge-warning">${esc(status)}</span>`;
    }
    if (
      [
        'unpaid',
        'absent',
        'inactive',
        'suspended',
        'locked',
        'rejected',
        'discrepancy',
        'urgent',
        'failed',
        'abandoned',
        'reversed',
      ].includes(s)
    ) {
      return `<span class="badge badge-danger">${esc(status)}</span>`;
    }
    return `<span class="badge badge-neutral">${esc(status || 'N/A')}</span>`;
  }

  function exportCsv(filename, headers, rows) {
    const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      headers.map(csvCell).join(','),
      ...rows.map((row) => row.map(csvCell).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function bindCurrencySelect(selectId, endpoint, onChanged) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.addEventListener('change', async () => {
      try {
        const res = await api(endpoint, {
          method: 'PATCH',
          body: { currencyCode: sel.value },
        });
        setCurrency(res.currency.code, res.currency.symbol);
        toast(`Active currency updated to ${res.currency.code} (${res.currency.symbol})`, 'success');
        if (onChanged) await onChanged();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  function populateCurrencyOptions(selectId, currencies = [], activeCode = 'GHS') {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    sel.innerHTML = currencies
      .map(
        (c) =>
          `<option value="${esc(c.code)}" ${c.code === activeCode ? 'selected' : ''}>${esc(c.symbol)} - ${esc(c.code)}</option>`
      )
      .join('');
  }

  function openPaystackCheckout(tx, { verifyEndpoint, abandonEndpoint, onSuccess } = {}) {
    if (tx.gatewayMode !== 'sandbox' && tx.authorizationUrl) {
      window.location.href = tx.authorizationUrl;
      return;
    }

    let modal = document.getElementById('paystack-checkout-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'paystack-checkout-modal';
      modal.className = 'modal-backdrop';
      document.body.appendChild(modal);
    }

    let activeChannel = tx.channel || 'mobile_money';
    const channels = [
      { id: 'mobile_money', label: 'Mobile Money' },
      { id: 'card', label: 'Card' },
      { id: 'bank_transfer', label: 'Bank' },
      { id: 'ussd', label: 'USSD' },
    ];

    function renderChannelDetails(ch) {
      if (ch === 'mobile_money') {
        return `
          <div class="form-group">
            <label>Mobile Money Network</label>
            <select id="psk-sim-provider">
              <option>MTN Mobile Money</option>
              <option>Telecel Cash</option>
              <option>AirtelTigo Money</option>
            </select>
          </div>
          <div class="form-group">
            <label>Subscriber Mobile Number</label>
            <input type="text" placeholder="Enter mobile wallet number" autocomplete="off">
          </div>`;
      }
      if (ch === 'card') {
        return `
          <div class="form-group">
            <label>Card Number</label>
            <input type="password" value="0000000000004081" autocomplete="off" aria-label="Masked card">
          </div>
          <div class="form-grid">
            <div class="form-group"><label>Expiry</label><input type="text" placeholder="MM/YY" autocomplete="off"></div>
            <div class="form-group"><label>CVV</label><input type="password" value="000" autocomplete="off"></div>
          </div>`;
      }
      if (ch === 'bank_transfer') {
        return `<div class="alert alert-info" style="margin:6px 0;">Authorize Paystack bank settlement for reference <strong>${esc(tx.reference)}</strong>.</div>`;
      }
      return `<div class="alert alert-info" style="margin:6px 0;">Authorize Paystack USSD prompt for reference <strong>${esc(tx.reference)}</strong>.</div>`;
    }

    function renderModal() {
      modal.innerHTML = `
        <div class="paystack-modal-box">
          <div class="paystack-top">
            <div class="paystack-brand">
              <span class="paystack-bars"><span></span><span></span><span></span></span>
              <span>paystack</span>
            </div>
            <div style="text-align:right;font-size:12px;">
              <div style="color:#94a3b8;">${esc(tx.payerEmail)}</div>
              <div style="font-weight:800;font-size:15px;color:#38bdf8;">${esc(moneyPlain(tx.amount, tx.currencySymbol))}</div>
            </div>
          </div>
          <div class="paystack-body">
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">
              Student: <strong>${esc(tx.student?.name || '')}</strong> (${esc(tx.student?.admissionNumber || '')})<br>
              Reference: <code>${esc(tx.reference)}</code>
            </div>
            <div class="paystack-channels">
              ${channels
                .map(
                  (c) =>
                    `<button type="button" class="paystack-ch-btn ${activeChannel === c.id ? 'active' : ''}" data-psk-ch="${c.id}">${esc(c.label)}</button>`
                )
                .join('')}
            </div>
            <div id="psk-ch-fields">${renderChannelDetails(activeChannel)}</div>
            <div style="display:flex;gap:8px;margin-top:16px;">
              <button type="button" class="btn btn-paystack" style="flex:1;" id="psk-authorize-btn">
                Pay ${esc(moneyPlain(tx.amount, tx.currencySymbol))}
              </button>
              <button type="button" class="btn btn-secondary" id="psk-cancel-btn">Cancel</button>
            </div>
          </div>
        </div>
      `;

      modal.querySelectorAll('[data-psk-ch]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeChannel = btn.dataset.pskCh;
          renderModal();
        });
      });

      modal.querySelector('#psk-authorize-btn').addEventListener('click', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Verifying with Paystack...';
        try {
          const verified = await api(verifyEndpoint, {
            method: 'POST',
            body: { reference: tx.reference, channel: activeChannel },
          });
          modal.classList.remove('open');
          toast(`Paystack payment verified - Receipt ${verified.receiptNumber}`, 'success');
          if (onSuccess) await onSuccess(verified);
        } catch (err) {
          toast(err.message, 'error');
          e.target.disabled = false;
          e.target.textContent = `Pay ${moneyPlain(tx.amount, tx.currencySymbol)}`;
        }
      });

      modal.querySelector('#psk-cancel-btn').addEventListener('click', async () => {
        modal.classList.remove('open');
        if (abandonEndpoint) {
          try {
            await api(abandonEndpoint, { method: 'POST', body: { reference: tx.reference } });
          } catch (_) {
            // ignore
          }
        }
      });
    }

    renderModal();
    modal.classList.add('open');
  }

  function formatBytes(bytes) {
    const num = Number(bytes || 0);
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  }

  function renderMediaAttachments(attachments = [], options = {}) {
    if (!Array.isArray(attachments) || !attachments.length) return '';
    const compact = Boolean(options.compact);

    if (compact) {
      return `<div class="subject-badges-wrap">${attachments
        .map((att) => {
          const viewUrl = esc(withNavSession(att.url));
          const dlUrl = esc(withNavSession(att.downloadUrl || `${att.url}?download=1`));
          const kindLabel = String(att.mediaKind || 'file').toUpperCase();
          const targetHref = att.mediaKind === 'document' ? dlUrl : viewUrl;
          return `<a href="${targetHref}" target="_blank" rel="noopener" class="subject-badge-tag" style="text-decoration:none;"><strong>${esc(kindLabel)}</strong> &middot; ${esc(att.originalName)}</a>`;
        })
        .join('')}</div>`;
    }

    return `<div class="media-gallery">${attachments
      .map((att) => {
        const viewUrl = esc(withNavSession(att.url));
        const dlUrl = esc(withNavSession(att.downloadUrl || `${att.url}?download=1`));
        const sizeLabel = esc(formatBytes(att.sizeBytes));
        const kind = String(att.mediaKind || 'document').toLowerCase();

        if (kind === 'image') {
          return `<div class="media-item-card">
            <a href="${viewUrl}" target="_blank" rel="noopener">
              <img src="${viewUrl}" alt="${esc(att.originalName)}" class="media-thumb-img" loading="lazy">
            </a>
            <div class="media-item-meta">
              <span class="media-item-name" title="${esc(att.originalName)}">${esc(att.originalName)}</span>
              <span class="media-item-sub">Image &middot; ${sizeLabel} &middot; <a href="${dlUrl}">Download</a></span>
            </div>
          </div>`;
        }

        if (kind === 'video') {
          return `<div class="media-item-card media-item-video">
            <video controls preload="metadata" src="${viewUrl}" class="media-video-player"></video>
            <div class="media-item-meta">
              <span class="media-item-name" title="${esc(att.originalName)}">${esc(att.originalName)}</span>
              <span class="media-item-sub">Video &middot; ${sizeLabel} &middot; <a href="${dlUrl}">Download</a></span>
            </div>
          </div>`;
        }

        if (kind === 'pdf') {
          return `<div class="media-item-card media-item-doc">
            <div class="media-doc-badge">PDF</div>
            <div class="media-item-meta">
              <span class="media-item-name" title="${esc(att.originalName)}">${esc(att.originalName)}</span>
              <span class="media-item-sub">${sizeLabel} &middot; <a href="${viewUrl}" target="_blank" rel="noopener">Open PDF</a> &middot; <a href="${dlUrl}">Download</a></span>
            </div>
          </div>`;
        }

        return `<div class="media-item-card media-item-doc">
          <div class="media-doc-badge">DOC</div>
          <div class="media-item-meta">
            <span class="media-item-name" title="${esc(att.originalName)}">${esc(att.originalName)}</span>
            <span class="media-item-sub">${sizeLabel} &middot; <a href="${dlUrl}">Download File</a></span>
          </div>
        </div>`;
      })
      .join('')}</div>`;
  }

  return {
    esc,
    money,
    moneyPlain,
    setCurrency,
    getCurrency,
    toast,
    api,
    initSession,
    enhancePasswordInputs,
    startGoogleAuth,
    configureGoogleLinkButton,
    initPrivacyToggle,
    logout,
    activateSection,
    initNavigation,
    renderTimetableMatrix,
    formatBytes,
    renderMediaAttachments,
    statusBadge,
    exportCsv,
    bindCurrencySelect,
    populateCurrencyOptions,
    openPaystackCheckout,
    withNavSession,
    navigateAuthenticated,
    setSessionToken,
    getSessionToken,
    getUser: () => currentUser,
    isGoogleAuthEnabled: () => googleAuthEnabled,
  };
})();
