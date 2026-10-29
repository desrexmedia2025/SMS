(async function initSuperadminDashboard() {
  const { esc, money, api, toast, statusBadge, openPaystackCheckout, activateSection } = window.SMS;

  await SMS.initSession();
  SMS.configureGoogleLinkButton('google-link-btn');
  SMS.initOverviewCalendar();
  SMS.initMessageBell();
  SMS.initMessaging();
  SMS.initProfileAvatar();
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);

  const user = SMS.getUser();
  if (user) {
    document.getElementById('sb-user-info').textContent = `${user.fullName} | ${user.email}`;
  }

  let currentSettings = null;
  let acadCache = { classes: [], subjects: [], years: [], terms: [] };
  let teachersCache = [];
  let studentsCache = [];
  let usersCache = [];
  let customRegSubjects = [];
  let editCustomSubjects = [];

  // Sub-tab controller matching .subnav-tabs[data-tab-group] & #subtab-<slug>[data-tab-pane]
  function activateSubtab(group, subtabSlug) {
    document
      .querySelectorAll(`.subnav-tabs[data-tab-group="${group}"] .subtab-btn`)
      .forEach((btn) => btn.classList.toggle('active', btn.dataset.subtab === subtabSlug));
    document
      .querySelectorAll(`.subtab-pane[data-tab-pane="${group}"]`)
      .forEach((pane) => pane.classList.toggle('hidden', pane.id !== `subtab-${subtabSlug}`));
  }

  document.querySelectorAll('.subnav-tabs[data-tab-group]').forEach((bar) => {
    const group = bar.dataset.tabGroup;
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('.subtab-btn');
      if (!btn) return;
      activateSubtab(group, btn.dataset.subtab);
    });
  });

  function getCheckedValues(containerId) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked'))
      .map((cb) => Number(cb.value))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  function getSubjectRowValues(containerId) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('input[type="text"]'))
      .map((inp) => inp.value.trim())
      .filter(Boolean);
  }

  function renderSubjectCheckPills(containerId, subjects, checkedIds = []) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    const set = new Set((checkedIds || []).map(Number));
    if (!subjects.length) {
      wrap.innerHTML =
        '<span class="multi-subject-hint">No subjects yet — type subjects below and they will be created automatically.</span>';
      return;
    }
    wrap.innerHTML = subjects
      .map(
        (s) => `<label class="subject-check-pill">
          <input type="checkbox" value="${s.id}" ${set.has(Number(s.id)) ? 'checked' : ''}>
          <span><strong>${esc(s.code)}</strong> &middot; ${esc(s.name)}</span>
        </label>`
      )
      .join('');
  }

  function renderClassCheckPills(containerId, classes, checkedIds = []) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    const set = new Set((checkedIds || []).map(Number));
    if (!classes.length) {
      wrap.innerHTML =
        '<span class="multi-subject-hint">No classes created yet — add a class under Classes &amp; Subjects.</span>';
      return;
    }
    wrap.innerHTML = classes
      .map(
        (c) => `<label class="subject-check-pill">
          <input type="checkbox" value="${c.id}" ${set.has(Number(c.id)) ? 'checked' : ''}>
          <span>${esc(c.name)}</span>
        </label>`
      )
      .join('');
  }

  function updateTeacherSubjectCountBadge() {
    const checked = getCheckedValues('tch-reg-subject-checkboxes').length;
    const rows = getSubjectRowValues('tch-subject-rows-list').length;
    const total = checked + rows + customRegSubjects.length;
    document.getElementById('tch-selected-subjects-count').textContent = `${total} subject(s) selected`;
  }

  function updateUsrSubjectCountBadge() {
    const checked = getCheckedValues('usr-tch-subject-checkboxes').length;
    const rows = getSubjectRowValues('usr-tch-subject-rows').length;
    document.getElementById('usr-tch-subjects-count').textContent = `${checked + rows} subject(s) selected`;
  }

  function updateEditSubjectCountBadge() {
    const checked = getCheckedValues('edit-tch-subject-checkboxes').length;
    const total = checked + editCustomSubjects.length;
    document.getElementById('edit-tch-subjects-count').textContent = `${total} subject(s) selected`;
  }

  function updateAsgSubjectCountBadge() {
    const checked = getCheckedValues('asg-subjects-checkboxes').length;
    document.getElementById('asg-selected-subjects-count').textContent = `${checked} subject(s) selected`;
  }

  function renderCustomRegChips() {
    document.getElementById('tch-custom-subject-chips').innerHTML = customRegSubjects
      .map(
        (name, idx) =>
          `<span class="subject-badge-tag">${esc(name)} <button type="button" data-del-reg-chip="${idx}" style="border:none;background:none;color:#1d4ed8;font-weight:800;cursor:pointer;margin-left:4px;">&times;</button></span>`
      )
      .join('');
    updateTeacherSubjectCountBadge();
  }

  function renderEditCustomChips() {
    document.getElementById('edit-tch-custom-subject-chips').innerHTML = editCustomSubjects
      .map(
        (name, idx) =>
          `<span class="subject-badge-tag">${esc(name)} <button type="button" data-del-edit-chip="${idx}" style="border:none;background:none;color:#1d4ed8;font-weight:800;cursor:pointer;margin-left:4px;">&times;</button></span>`
      )
      .join('');
    updateEditSubjectCountBadge();
  }

  function showIssuedCredentials(creds) {
    if (!creds) return;
    document.getElementById('sa-issued-creds-body').innerHTML = `
      <div><strong>Name:</strong> ${esc(creds.fullName || '-')}</div>
      <div><strong>Role:</strong> <code>${esc(creds.role || '-')}</code></div>
      <div><strong>Email:</strong> <code>${esc(creds.email)}</code></div>
      <div><strong>Username:</strong> <code>${esc(creds.username)}</code></div>
      <div><strong>Initial Password:</strong> <code>${esc(creds.initialPassword)}</code></div>
    `;
    const banner = document.getElementById('sa-issued-creds-banner');
    banner.classList.remove('hidden');
    banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  document.getElementById('close-creds-banner').addEventListener('click', () => {
    document.getElementById('sa-issued-creds-banner').classList.add('hidden');
  });

  function populateSettingsForm(data) {
    const s = data.settings;
    if (!s) return;
    currentSettings = s;
    document.getElementById('set-school-name').value = s.school_name || 'School Management System';
    document.getElementById('set-phone').value = s.phone || '';
    document.getElementById('set-email').value = s.email || '';
    document.getElementById('set-address').value = s.address || '';
    document.getElementById('set-fee-portal').checked = s.student_fee_portal_enabled !== 0;

    const curSel = document.getElementById('set-currency-code');
    curSel.innerHTML = (data.currencies || [])
      .map(
        (c) =>
          `<option value="${esc(c.code)}" data-sym="${esc(c.symbol)}" ${c.code === s.currency_code ? 'selected' : ''}>${esc(c.code)} - ${esc(c.name)} (${esc(c.symbol)})</option>`
      )
      .join('');
    document.getElementById('set-currency-symbol').value = s.currency_symbol || '';
    curSel.onchange = () => {
      const opt = curSel.options[curSel.selectedIndex];
      if (opt?.dataset.sym) document.getElementById('set-currency-symbol').value = opt.dataset.sym;
    };

    // Google Sign-In
    document.getElementById('set-google-enabled').checked =
      s.google_oauth_enabled === undefined ? true : Boolean(s.google_oauth_enabled);
    document.getElementById('set-google-client-id').value = s.google_client_id || '';
    const gSec = document.getElementById('set-google-client-secret');
    gSec.value = '';
    gSec.placeholder = s.google_secret_configured
      ? 'Configured (leave blank to keep existing secret)'
      : 'Paste Google Client Secret';

    // Paystack Keys & Transaction Policies
    document.getElementById('set-psk-receive-enabled').checked =
      s.paystack_enabled === undefined ? true : Boolean(s.paystack_enabled);
    document.getElementById('set-psk-send-enabled').checked =
      s.paystack_transfers_enabled === undefined ? true : Boolean(s.paystack_transfers_enabled);
    document.getElementById('set-psk-reverse-enabled').checked =
      s.paystack_refunds_enabled === undefined ? true : Boolean(s.paystack_refunds_enabled);
    document.getElementById('set-paystack-public-key').value =
      s.paystack_public_key || data.paystack?.publicKey || '';
    const pskSecInput = document.getElementById('set-paystack-secret-key');
    pskSecInput.value = '';
    pskSecInput.placeholder = s.paystack_secret_configured
      ? 'Configured (leave blank to keep current Secret Key)'
      : 'sk_live_... or sk_test_...';
    document.getElementById('set-clear-paystack-secret').checked = false;
  }

  // ---------------- LOADERS ----------------
  async function loadOverview() {
    const data = await api('/api/superadmin/overview');
    SMS.setCurrency(data.settings.currency_code, data.settings.currency_symbol);
    document.getElementById('sb-school-name').textContent =
      data.settings.school_name || 'School Management System';

    SMS.populateCurrencyOptions(
      'sa-currency-switcher',
      data.currencies || [],
      data.settings.currency_code
    );

    const m = data.metrics;
    const pendingCount = Number(m.pendingStudentRequests || 0);
    const pill = document.getElementById('nav-pending-proposals-pill');
    pill.textContent = String(pendingCount);
    pill.classList.toggle('hidden', pendingCount === 0);

    const propSubBtn = document.getElementById('stu-proposals-subtab-btn');
    propSubBtn.textContent =
      pendingCount > 0 ? `Join Proposals (${pendingCount})` : 'Join Proposals';

    const pendingBanner = document.getElementById('ov-pending-banner');
    if (pendingCount > 0) {
      pendingBanner.innerHTML = `<div class="alert alert-info" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:0;">
        <span><strong>${pendingCount}</strong> student join proposal(s) waiting for your approval.</span>
        <button type="button" class="btn btn-primary btn-sm" id="ov-open-proposals-btn">Review Proposals</button>
      </div>`;
      pendingBanner.classList.remove('hidden');
    } else {
      pendingBanner.innerHTML = '';
      pendingBanner.classList.add('hidden');
    }

    document.getElementById('ov-kpis').innerHTML = [
      SMS.kpiCard({
        label: 'Classes',
        value: m.activeClasses || 0,
        sub: 'Active classes',
        icon: 'layers',
        tone: 'blue',
      }),
      SMS.kpiCard({
        label: 'Teachers',
        value: m.activeTeachers || 0,
        sub: `${m.activeUsers || 0} active accounts`,
        icon: 'users',
        tone: 'indigo',
      }),
      SMS.kpiCard({
        label: 'Students',
        value: m.activeStudents || 0,
        sub: `${pendingCount} pending proposal(s)`,
        icon: 'graduation',
        tone: 'sky',
      }),
      SMS.kpiCard({
        label: 'Fees Collected',
        value: money(m.finance?.collected || 0),
        sub: `Balance: ${money(m.finance?.outstanding || 0)}`,
        icon: 'wallet',
        tone: 'teal',
      }),
    ].join('');

    const annHtml =
      (data.announcements || [])
        .map(
          (a) => `<div class="feed-item">
            <div class="feed-item-head">
              <strong>${esc(a.title)}</strong>
              ${statusBadge(a.priority)}
            </div>
            <div class="feed-item-body">${esc(a.body)}</div>
          </div>`
        )
        .join('') || '<div class="empty-state">No announcements published yet.</div>';

    document.getElementById('ov-announcements').innerHTML = annHtml;
    document.getElementById('ann-list').innerHTML = annHtml;

    if (data.analytics) {
      renderOverviewAnalytics(data.analytics);
    }

    populateSettingsForm(data);
  }

  // ---------------- LITE SITE ANALYTICS & VECTOR GRAPHS ----------------
  let currentAnalyticsDays = 14;

  function renderTrendSvgChart(series = [], uid = 'ov') {
    const pts = Array.isArray(series) && series.length ? series : [{ date: '', label: 'Today', views: 0, actions: 0, signIns: 0 }];
    const W = 680;
    const H = 228;
    const padL = 38;
    const padR = 16;
    const padT = 16;
    const padB = 32;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const rawMax = Math.max(1, ...pts.map((d) => Math.max(d.views || 0, d.actions || 0, d.signIns || 0)));
    const step = Math.max(1, Math.ceil(rawMax / 4));
    const yMax = step * 4;

    const xAt = (idx) =>
      pts.length === 1 ? padL + plotW / 2 : padL + (idx / (pts.length - 1)) * plotW;
    const yAt = (val) => padT + plotH - (Math.max(0, Number(val || 0)) / yMax) * plotH;

    let gridSvg = '';
    for (let t = 0; t <= 4; t += 1) {
      const val = t * step;
      const y = yAt(val).toFixed(1);
      gridSvg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${t === 0 ? '#cbd9ee' : '#e6eef9'}" stroke-width="1" ${t === 0 ? '' : 'stroke-dasharray="3 3"'} />`;
      gridSvg += `<text x="${padL - 8}" y="${(Number(y) + 3.5).toFixed(1)}" text-anchor="end" fill="#647c9e" font-size="11" font-family="inherit">${val}</text>`;
    }

    const viewCoords = pts.map((d, i) => [xAt(i), yAt(d.views || 0)]);
    const actCoords = pts.map((d, i) => [xAt(i), yAt(d.actions || 0)]);

    const buildLine = (coords) =>
      coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

    const baselineY = (padT + plotH).toFixed(1);
    const viewLine = buildLine(viewCoords);
    const viewArea = `${viewLine} L${viewCoords[viewCoords.length - 1][0].toFixed(1)},${baselineY} L${viewCoords[0][0].toFixed(1)},${baselineY} Z`;
    const actLine = buildLine(actCoords);
    const actArea = `${actLine} L${actCoords[actCoords.length - 1][0].toFixed(1)},${baselineY} L${actCoords[0][0].toFixed(1)},${baselineY} Z`;

    const labelStride = pts.length > 20 ? 4 : pts.length > 10 ? 2 : 1;
    let xLabelsSvg = '';
    pts.forEach((d, i) => {
      if (i % labelStride !== 0 && i !== pts.length - 1) return;
      const x = xAt(i).toFixed(1);
      xLabelsSvg += `<text x="${x}" y="${H - 8}" text-anchor="middle" fill="#647c9e" font-size="10.5" font-family="inherit">${esc(d.label)}</text>`;
    });

    let dotsSvg = '';
    pts.forEach((d, i) => {
      const vx = viewCoords[i][0].toFixed(1);
      const vy = viewCoords[i][1].toFixed(1);
      const ax = actCoords[i][0].toFixed(1);
      const ay = actCoords[i][1].toFixed(1);
      const tip = `${esc(d.label)}: ${d.views || 0} visit(s), ${d.actions || 0} action(s), ${d.signIns || 0} sign-in(s)`;
      dotsSvg += `<circle cx="${vx}" cy="${vy}" r="3.6" fill="#ffffff" stroke="#1d4ed8" stroke-width="2"><title>${tip}</title></circle>`;
      dotsSvg += `<circle cx="${ax}" cy="${ay}" r="3" fill="#0d9488"><title>${tip}</title></circle>`;
    });

    return `
      <div class="chart-legend-row">
        <span class="chart-legend-item"><span class="chart-legend-swatch" style="background:#1d4ed8;"></span>Portal Visits</span>
        <span class="chart-legend-item"><span class="chart-legend-swatch" style="background:#0d9488;"></span>Site Actions &amp; Sign-Ins</span>
      </div>
      <svg class="analytics-svg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Site traffic and activity trend graph">
        <defs>
          <linearGradient id="smsViewGrad-${esc(uid)}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2563eb" stop-opacity="0.24"/>
            <stop offset="100%" stop-color="#2563eb" stop-opacity="0.01"/>
          </linearGradient>
          <linearGradient id="smsActGrad-${esc(uid)}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0d9488" stop-opacity="0.14"/>
            <stop offset="100%" stop-color="#0d9488" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        ${gridSvg}
        <path d="${viewArea}" fill="url(#smsViewGrad-${esc(uid)})" />
        <path d="${actArea}" fill="url(#smsActGrad-${esc(uid)})" />
        <path d="${viewLine}" fill="none" stroke="#1d4ed8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        <path d="${actLine}" fill="none" stroke="#0d9488" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round" stroke-linejoin="round" />
        ${dotsSvg}
        ${xLabelsSvg}
      </svg>
    `;
  }

  function renderModuleActivityBars(modules = []) {
    if (!modules.length) {
      return '<div class="empty-state">No module usage recorded yet.</div>';
    }
    const maxWeight = Math.max(
      1,
      ...modules.map((m) => Number(m.events || 0) + Number(m.records || 0))
    );
    return `<div class="analytics-bar-list">${modules
      .map((m) => {
        const combined = Number(m.events || 0) + Number(m.records || 0);
        const pct = combined > 0 ? Math.max(6, Math.round((combined / maxWeight) * 100)) : 0;
        return `<div class="analytics-bar-row">
          <div class="analytics-bar-head">
            <span class="analytics-bar-label">${esc(m.label)}</span>
            <span class="analytics-bar-meta"><strong>${m.events || 0}</strong> event(s) &middot; ${esc(m.recordLabel || '')}</span>
          </div>
          <div class="analytics-bar-track">
            <div class="analytics-bar-fill" style="width:${pct}%;"></div>
          </div>
        </div>`;
      })
      .join('')}</div>`;
  }

  function renderRoleDonut(roles = []) {
    const palette = ['#1d4ed8', '#0284c7', '#0f766e', '#4f46e5'];
    const activitySum = roles.reduce((acc, r) => acc + Number(r.visits || 0) + Number(r.actions || 0), 0);
    const useActivity = activitySum > 0;
    const weights = roles.map((r) =>
      useActivity ? Number(r.visits || 0) + Number(r.actions || 0) : Number(r.accounts || 0)
    );
    const total = weights.reduce((a, b) => a + b, 0);

    const r = 62;
    const cx = 90;
    const cy = 90;
    const circ = 2 * Math.PI * r;
    let offset = 0;

    const arcs =
      total > 0
        ? weights
            .map((w, idx) => {
              if (w <= 0) return '';
              const len = (w / total) * circ;
              const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${palette[idx % palette.length]}" stroke-width="18" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(roles[idx].label)}: ${w}</title></circle>`;
              offset += len;
              return seg;
            })
            .join('')
        : '';

    const centerLabel = useActivity ? 'Interactions' : 'Accounts';

    return `<div class="donut-layout">
      <svg class="analytics-donut-svg" viewBox="0 0 180 180" role="img" aria-label="Usage by dashboard role">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8f0fc" stroke-width="18" />
        ${arcs}
        <text x="${cx}" y="${cy - 3}" text-anchor="middle" fill="#0e2242" font-size="24" font-weight="700" font-family="inherit">${total}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="#647c9e" font-size="11" font-weight="600" font-family="inherit">${centerLabel}</text>
      </svg>
      <div class="donut-legend-list">
        ${roles
          .map(
            (role, idx) => `<div class="donut-legend-row">
              <span class="donut-legend-name">
                <span class="chart-legend-swatch" style="background:${palette[idx % palette.length]};"></span>
                ${esc(role.label)}
              </span>
              <span class="donut-legend-stats">
                <strong>${Number(role.visits || 0) + Number(role.actions || 0)}</strong> activity &middot; ${role.accounts || 0} acct &middot; ${role.activeSessions || 0} online
              </span>
            </div>`
          )
          .join('')}
      </div>
    </div>`;
  }

  function renderClassSnapshotBars(classes = []) {
    if (!classes.length) {
      return '<div class="empty-state" style="padding:18px 14px;">Create a class to view student enrolment and coursework bars per class.</div>';
    }
    const maxVal = Math.max(1, ...classes.map((c) => Math.max(c.students || 0, c.coursework || 0)));
    return `
      <div class="chart-legend-row" style="margin-bottom:4px;">
        <span class="chart-legend-item"><span class="chart-legend-swatch" style="background:#1d4ed8;"></span>Students</span>
        <span class="chart-legend-item"><span class="chart-legend-swatch" style="background:#0284c7;"></span>Works &amp; Exams</span>
      </div>
      <div class="class-col-chart">
        ${classes
          .map((c) => {
            const sH = c.students > 0 ? Math.max(10, Math.round((c.students / maxVal) * 100)) : 4;
            const wH = c.coursework > 0 ? Math.max(10, Math.round((c.coursework / maxVal) * 100)) : 4;
            return `<div class="class-col-item">
              <div class="class-col-bars">
                <div class="class-col-bar students" style="height:${sH}%;" title="${esc(c.name)}: ${c.students} student(s)"></div>
                <div class="class-col-bar works" style="height:${wH}%;" title="${esc(c.name)}: ${c.coursework} work(s)"></div>
              </div>
              <div class="class-col-name" title="${esc(c.name)}">${esc(c.name)}</div>
              <div class="class-col-counts">${c.students}S / ${c.coursework}W</div>
            </div>`;
          })
          .join('')}
      </div>
    `;
  }

  function formatShortTime(ts) {
    if (!ts) return '';
    const raw = String(ts).trim().replace('T', ' ').replace(/\.\d+Z?$/, '');
    return raw.slice(0, 16);
  }

  function renderLiveFeed(feed = []) {
    if (!feed.length) {
      return '<div class="empty-state">No recent site activity recorded yet.</div>';
    }
    return `<div class="activity-stream">${feed
      .map(
        (item) => `<div class="activity-stream-item">
          <div class="activity-stream-left">
            <span class="activity-stream-dot" aria-hidden="true"></span>
            <div>
              <div class="activity-stream-title">${esc(item.label)}</div>
              <div class="activity-stream-sub">${esc(item.actorName)} &middot; <span class="badge badge-neutral" style="padding:1px 6px;font-size:10.5px;">${esc(item.actorRole)}</span></div>
            </div>
          </div>
          <div class="activity-stream-time">${esc(formatShortTime(item.createdAt))}</div>
        </div>`
      )
      .join('')}</div>`;
  }

  function renderOverviewAnalytics(an) {
    const s = an.summary || {};
    const pillsEl = document.getElementById('ov-pulse-pills');
    if (pillsEl) {
      pillsEl.innerHTML = `
        <span class="pulse-chip pulse-chip-live"><span class="pulse-dot" aria-hidden="true"></span>${s.activeSessions || 0} online</span>
        <span class="pulse-chip">${s.pageViewsToday || 0} visit(s) today</span>
        <span class="pulse-chip">${s.signInsPeriod || 0} sign-in(s)</span>
      `;
    }
    const ovChartEl = document.getElementById('ov-usage-chart');
    if (ovChartEl) {
      ovChartEl.innerHTML = renderTrendSvgChart(an.dailyTrend || [], 'ov');
    }
    const ovModEl = document.getElementById('ov-module-bars');
    if (ovModEl) {
      ovModEl.innerHTML = renderModuleActivityBars(an.moduleActivity || []);
    }
  }

  async function loadAnalytics(days = currentAnalyticsDays) {
    currentAnalyticsDays = Number(days) || 14;
    document.querySelectorAll('#an-window-tabs [data-an-days]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.anDays) === currentAnalyticsDays);
    });

    const res = await api(`/api/superadmin/analytics?days=${encodeURIComponent(currentAnalyticsDays)}`);
    const an = res.analytics || {};
    const s = an.summary || {};

    document.getElementById('an-trend-title').textContent =
      `Daily Traffic & Site Actions (${an.windowDays || currentAnalyticsDays} Days)`;

    document.getElementById('an-kpis').innerHTML = [
      SMS.kpiCard({
        label: 'Online Now',
        value: s.activeSessions || 0,
        sub: `${s.onlineUsers || 0} signed-in user(s)`,
        icon: 'users',
        tone: 'teal',
      }),
      SMS.kpiCard({
        label: 'Portal Visits',
        value: s.pageViewsPeriod || 0,
        sub: `${s.pageViewsToday || 0} visit(s) today`,
        icon: 'trending',
        tone: 'blue',
      }),
      SMS.kpiCard({
        label: 'Sign-Ins',
        value: s.signInsPeriod || 0,
        sub: `${s.failedLoginsPeriod || 0} failed / blocked`,
        icon: 'check',
        tone: 'indigo',
      }),
      SMS.kpiCard({
        label: 'Site Actions',
        value: s.actionsPeriod || 0,
        sub: `${s.actionsToday || 0} today · ${s.mediaUploadsCount || 0} file upload(s)`,
        icon: 'clipboard',
        tone: 'sky',
      }),
    ].join('');

    document.getElementById('an-trend-chart').innerHTML = renderTrendSvgChart(
      an.dailyTrend || [],
      'full'
    );
    document.getElementById('an-role-donut').innerHTML = renderRoleDonut(
      an.portalUsageByRole || []
    );
    document.getElementById('an-module-chart').innerHTML = renderModuleActivityBars(
      an.moduleActivity || []
    );
    document.getElementById('an-class-bars').innerHTML = renderClassSnapshotBars(
      an.classSnapshot || []
    );
    document.getElementById('an-live-feed').innerHTML = renderLiveFeed(an.liveFeed || []);
  }

  async function loadAcademicAndTeachers() {
    const [acad, tData] = await Promise.all([
      api('/api/superadmin/academic'),
      api('/api/superadmin/teachers'),
    ]);
    acadCache = acad;
    teachersCache = tData.teachers || [];

    const dl = document.getElementById('subject-suggestions-list');
    const defaultSubjects = [
      'Mathematics',
      'Further Mathematics',
      'English Language',
      'Literature in English',
      'Integrated Science',
      'Physics',
      'Chemistry',
      'Biology',
      'Social Studies',
      'Computing / ICT',
      'Economics',
      'Geography',
      'History',
      'Government',
      'French',
    ];
    const seenSub = new Set();
    const mergedSubNames = [];
    for (const s of acad.subjects) {
      if (s?.name && !seenSub.has(s.name.toLowerCase())) {
        seenSub.add(s.name.toLowerCase());
        mergedSubNames.push(s.name);
      }
    }
    for (const def of defaultSubjects) {
      if (!seenSub.has(def.toLowerCase())) {
        seenSub.add(def.toLowerCase());
        mergedSubNames.push(def);
      }
    }
    dl.innerHTML = mergedSubNames.map((n) => `<option value="${esc(n)}"></option>`).join('');

    document.getElementById('classes-list-tbody').innerHTML =
      acad.classes
        .map(
          (c) => `<tr>
            <td><strong>${esc(c.name)}</strong></td>
            <td class="num">${c.level_order}</td>
            <td>${statusBadge(c.status)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="3" class="empty-state">No classes created yet.</td></tr>';

    document.getElementById('subjects-list-tbody').innerHTML =
      acad.subjects
        .map(
          (s) => `<tr>
            <td><code>${esc(s.code)}</code></td>
            <td><strong>${esc(s.name)}</strong></td>
            <td>${esc(s.department || '-')}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="3" class="empty-state">No subjects created yet.</td></tr>';

    const classOpts = acad.classes
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const subOpts = acad.subjects
      .map((s) => `<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`).join('');
    const teacherOpts = teachersCache
      .map(
        (t) =>
          `<option value="${t.id}">${esc(t.first_name)} ${esc(t.last_name)} (${esc(t.staff_number)})</option>`
      )
      .join('');

    document.getElementById('st-class-select').innerHTML =
      '<option value="">Unassigned</option>' + classOpts;
    document.getElementById('tt-class').innerHTML =
      classOpts || '<option value="">Add a Class first</option>';
    const ttFilterSel = document.getElementById('tt-filter-class');
    const prevTtVal = ttFilterSel.value;
    ttFilterSel.innerHTML = '<option value="">All Classes</option>' + classOpts;
    if (prevTtVal) ttFilterSel.value = prevTtVal;

    document.getElementById('tt-subject').innerHTML =
      subOpts || '<option value="">Add a Subject first</option>';
    document.getElementById('tt-teacher').innerHTML =
      teacherOpts || '<option value="">Register a Teacher first</option>';
    document.getElementById('asg-teacher').innerHTML =
      teacherOpts || '<option value="">Register a Teacher first</option>';

    renderSubjectCheckPills(
      'tch-reg-subject-checkboxes',
      acad.subjects,
      getCheckedValues('tch-reg-subject-checkboxes')
    );
    renderClassCheckPills(
      'tch-reg-class-checkboxes',
      acad.classes,
      getCheckedValues('tch-reg-class-checkboxes')
    );
    renderClassCheckPills(
      'asg-classes-checkboxes',
      acad.classes,
      getCheckedValues('asg-classes-checkboxes')
    );
    renderSubjectCheckPills(
      'usr-tch-subject-checkboxes',
      acad.subjects,
      getCheckedValues('usr-tch-subject-checkboxes')
    );
    syncAssignTeacherSubjects();
    updateTeacherSubjectCountBadge();
    updateUsrSubjectCountBadge();

    renderTeachersTable(teachersCache);

    document.getElementById('assignments-tbody').innerHTML =
      (tData.assignments || [])
        .map(
          (a) => `<tr>
            <td><code>${esc(a.staff_number)}</code></td>
            <td>${esc(a.first_name)} ${esc(a.last_name)}</td>
            <td><strong>${esc(a.class_name)}</strong></td>
            <td>${esc(a.subject_code)} - ${esc(a.subject_name)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No class assignments yet.</td></tr>';
  }

  function renderTeachersTable(list) {
    document.getElementById('teachers-list-tbody').innerHTML =
      (list || [])
        .map((t) => {
          const badges = (t.subjects || [])
            .map(
              (s) =>
                `<span class="subject-badge-tag"><strong>${esc(s.code)}</strong> &middot; ${esc(s.name)}</span>`
            )
            .join('');
          return `<tr>
            <td><code>${esc(t.staff_number)}</code></td>
            <td><strong>${esc(t.first_name)} ${esc(t.last_name)}</strong></td>
            <td>${esc(t.email)}</td>
            <td><div class="subject-badges-wrap">${badges || '<span class="multi-subject-hint">No subjects</span>'}</div></td>
            <td>${statusBadge(t.user_status || t.status)}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" data-edit-tch="${t.id}">Edit Info</button>
              <button type="button" class="btn btn-secondary btn-sm" data-edit-tch-subs="${t.id}">Subjects</button>
            </td>
          </tr>`;
        })
        .join('') || '<tr><td colspan="6" class="empty-state">No teachers registered yet.</td></tr>';
  }

  async function searchTeachersServer() {
    const q = document.getElementById('tch-search-input')?.value.trim() || '';
    const clearBtn = document.getElementById('tch-clear-btn');
    if (clearBtn) clearBtn.classList.toggle('hidden', !q);
    const tData = await api(`/api/superadmin/teachers?search=${encodeURIComponent(q)}`);
    renderTeachersTable(tData.teachers || []);
  }

  function syncAssignTeacherSubjects() {
    const tid = Number(document.getElementById('asg-teacher').value || 0);
    const found = teachersCache.find((t) => Number(t.id) === tid);
    const prechecked = found?.subjectIds || [];
    renderSubjectCheckPills('asg-subjects-checkboxes', acadCache.subjects, prechecked);
    updateAsgSubjectCountBadge();
  }

  async function loadStudents() {
    const search = document.getElementById('stu-search').value.trim();
    const data = await api(`/api/superadmin/students?search=${encodeURIComponent(search)}`);
    const items = data.items || [];
    studentsCache = items;
    document.getElementById('students-tbody').innerHTML =
      items
        .map(
          (s) => `<tr>
            <td><code>${esc(s.admission_number)}</code></td>
            <td><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong></td>
            <td>${esc(s.class_name || 'Unassigned')}</td>
            <td>${esc(s.email)}</td>
            <td>${esc(s.guardian_phone || '-')}</td>
            <td>${statusBadge(s.status)}</td>
            <td><button type="button" class="btn btn-secondary btn-sm" data-edit-stu="${s.id}">Edit</button></td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No students enrolled yet.</td></tr>';
  }

  async function loadStudentRequests() {
    const status = document.getElementById('stu-req-status-filter').value;
    const data = await api(`/api/superadmin/student-requests?status=${encodeURIComponent(status)}`);
    const classOpts =
      '<option value="">Select Class</option>' +
      acadCache.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    document.getElementById('student-requests-tbody').innerHTML =
      (data.items || [])
        .map((r) => {
          const isPending = r.status === 'pending';
          return `<tr>
            <td class="tabular">${esc(String(r.created_at || '').slice(0, 16))}</td>
            <td><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong></td>
            <td>${esc(r.email)}</td>
            <td>
              ${
                isPending
                  ? `<select data-srr-class="${r.id}" style="min-width:130px;">${classOpts}</select>`
                  : esc(r.requested_class_name || '-')
              }
            </td>
            <td>${esc(r.guardian_phone || r.phone || '-')}</td>
            <td>${statusBadge(r.status)}</td>
            <td>
              ${
                isPending
                  ? `<div style="display:flex;gap:6px;">
                      <button type="button" class="btn btn-primary btn-sm" data-srr-approve="${r.id}">Accept</button>
                      <button type="button" class="btn btn-danger btn-sm" data-srr-reject="${r.id}">Reject</button>
                    </div>`
                  : `<span style="font-size:12px;color:var(--text-muted);">${esc(r.review_note || 'Reviewed')}</span>`
              }
            </td>
          </tr>`;
        })
        .join('') || '<tr><td colspan="7" class="empty-state">No student join proposals found.</td></tr>';

    (data.items || []).forEach((r) => {
      if (r.status === 'pending' && r.requested_class_id) {
        const sel = document.querySelector(`[data-srr-class="${r.id}"]`);
        if (sel) sel.value = String(r.requested_class_id);
      }
    });
  }

  async function loadTimetable() {
    const classId = document.getElementById('tt-filter-class').value || '';
    const qs = classId ? `?classId=${encodeURIComponent(classId)}` : '';
    const data = await api(`/api/superadmin/timetables${qs}`);
    SMS.renderTimetableMatrix('tt-matrix-container', data.items || [], {
      showClass: !classId,
      showTeacher: true,
      emptyMessage: 'No timetable lessons scheduled yet.',
    });
  }

  async function loadFinance() {
    const [fin, acad, stuData, trfData] = await Promise.all([
      api('/api/superadmin/finance/stats'),
      api('/api/superadmin/academic'),
      api('/api/superadmin/students?limit=100'),
      api('/api/financial/paystack/transfers'),
    ]);
    const m = fin.metrics;
    document.getElementById('sa-fin-kpis').innerHTML = [
      SMS.kpiCard({
        label: 'Total Billed',
        value: money(m.netBilled),
        sub: 'Net billed fees',
        icon: 'layers',
        tone: 'blue',
      }),
      SMS.kpiCard({
        label: 'Total Collected',
        value: money(m.totalCollected),
        sub: `${m.collectionRate}% collected`,
        icon: 'check',
        tone: 'teal',
      }),
      SMS.kpiCard({
        label: 'Paystack Collected',
        value: money(m.paystackCollected || 0),
        sub: 'Online gateway receipts',
        icon: 'trending',
        tone: 'indigo',
      }),
      SMS.kpiCard({
        label: 'Outstanding Balance',
        value: money(m.totalOutstanding),
        sub: 'Unpaid student fees',
        icon: 'wallet',
        tone: 'sky',
      }),
    ].join('');

    const cats = fin.feeCategories || [];
    document.getElementById('sa-fin-cats-tbody').innerHTML =
      cats
        .map(
          (c) => `<tr>
            <td><code>${esc(c.code)}</code></td>
            <td><strong>${esc(c.name)}</strong></td>
            <td class="num">${money(c.default_amount)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="3" class="empty-state">No fee items created yet.</td></tr>';

    document.getElementById('sa-fin-cat-sel').innerHTML =
      cats
        .map((c) => `<option value="${c.id}">${esc(c.name)} (${money(c.default_amount)})</option>`)
        .join('') || '<option value="">Create a Fee Item first</option>';

    document.getElementById('sa-fin-class-sel').innerHTML =
      acad.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') ||
      '<option value="">Add a Class first</option>';

    const stuOpts = (stuData.items || [])
      .map(
        (s) =>
          `<option value="${s.id}">${esc(s.admission_number)} - ${esc(s.first_name)} ${esc(s.last_name)}</option>`
      )
      .join('');
    document.getElementById('sa-fin-student-sel').innerHTML =
      stuOpts || '<option value="">No enrolled students yet</option>';
    document.getElementById('sa-psk-student').innerHTML =
      stuOpts || '<option value="">No enrolled students yet</option>';

    document.getElementById('sa-fin-payments-tbody').innerHTML =
      (fin.recentPayments || [])
        .map(
          (p) => `<tr>
            <td class="tabular">${esc(p.payment_date)}</td>
            <td><code>${esc(p.receipt_number || '-')}</code></td>
            <td><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong></td>
            <td><span class="badge ${p.payment_method === 'paystack' ? 'badge-primary' : 'badge-neutral'}">${esc(p.payment_method)}</span></td>
            <td class="num"><strong>${money(p.amount)}</strong></td>
            <td>${statusBadge(p.status)}</td>
            <td>
              ${
                p.status === 'completed'
                  ? `<button type="button" class="btn btn-danger btn-sm" data-rev-pay="${p.id}">Reverse</button>`
                  : '-'
              }
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No payments recorded yet.</td></tr>';

    document.getElementById('sa-fin-transfers-tbody').innerHTML =
      (trfData.items || [])
        .map(
          (t) => `<tr>
            <td class="tabular">${esc(String(t.created_at || '').slice(0, 16))}</td>
            <td><code>${esc(t.reference)}</code></td>
            <td><strong>${esc(t.recipient_name)}</strong> (${esc(t.bank_or_network)})</td>
            <td class="num"><strong>${money(t.amount)}</strong></td>
            <td>${statusBadge(t.status)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty-state">No transfers sent yet.</td></tr>';
  }

  async function loadUsers() {
    const search = document.getElementById('usr-search-input')?.value.trim() || '';
    const role = document.getElementById('usr-role-filter')?.value || '';
    const clearBtn = document.getElementById('usr-clear-btn');
    if (clearBtn) clearBtn.classList.toggle('hidden', !search && !role);
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    if (role) qs.set('role', role);
    const data = await api(`/api/superadmin/users${qs.toString() ? `?${qs.toString()}` : ''}`);
    usersCache = data.items || [];
    document.getElementById('users-tbody').innerHTML =
      (data.items || [])
        .map(
          (u) => `<tr>
            <td><strong>${esc(u.full_name)}</strong></td>
            <td>${esc(u.email)}</td>
            <td><span class="badge badge-neutral">${esc(u.role)}</span></td>
            <td>${statusBadge(u.status)}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" data-set-avatar="${u.id}" data-user-name="${esc(u.full_name)}">Photo</button>
              <button type="button" class="btn btn-secondary btn-sm" data-edit-user="${u.id}">Edit</button>
              ${
                u.role !== 'superadmin'
                  ? `<button type="button" class="btn btn-secondary btn-sm" data-toggle-user="${u.id}" data-cur-status="${esc(u.status)}">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>`
                  : ''
              }
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty-state">No user accounts found.</td></tr>';
  }

  // ---------------- EDIT RECORD MODALS (Students / Teachers / Staff) ----------------
  function openRecordModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('hidden');
    const first = modal.querySelector('input[type="text"], input[type="email"], select');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function closeRecordModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
  }

  function bindRecordModalChrome() {
    document.querySelectorAll('[data-close-edit-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const backdrop = btn.closest('.record-modal-backdrop');
        if (backdrop) backdrop.classList.add('hidden');
      });
    });
    document.querySelectorAll('.record-modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.add('hidden');
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.record-modal-backdrop').forEach((b) => b.classList.add('hidden'));
    });
  }
  bindRecordModalChrome();

  function fillClassSelect(selectEl, selectedId) {
    if (!selectEl) return;
    const opts = ['<option value="">Unassigned</option>'].concat(
      (acadCache.classes || []).map(
        (c) => `<option value="${c.id}"${Number(c.id) === Number(selectedId) ? ' selected' : ''}>${esc(c.name)}</option>`
      )
    );
    selectEl.innerHTML = opts.join('');
  }

  function dateOnly(value) {
    return value ? String(value).slice(0, 10) : '';
  }

  // ---- Students ----
  document.getElementById('students-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-stu]');
    if (!btn) return;
    openStudentEditor(Number(btn.dataset.editStu)).catch((error) => toast(error.message, 'error'));
  });

  async function openStudentEditor(studentId) {
    await loadAcademicAndTeachers();
    let s = studentsCache.find((x) => Number(x.id) === studentId);
    if (!s) {
      const res = await api(`/api/superadmin/students?search=${encodeURIComponent('')}`);
      s = (res.items || []).find((x) => Number(x.id) === studentId) || null;
    }
    if (!s) {
      toast('Student record could not be loaded.', 'error');
      return;
    }
    document.getElementById('edit-stu-id').value = String(studentId);
    document.getElementById('edit-student-modal-title').textContent =
      `Edit Student — ${s.first_name} ${s.last_name}`;
    document.getElementById('edit-stu-admission').value = s.admission_number || '';
    document.getElementById('edit-stu-first').value = s.first_name || '';
    document.getElementById('edit-stu-last').value = s.last_name || '';
    document.getElementById('edit-stu-email').value = s.email || '';
    document.getElementById('edit-stu-phone').value = s.phone || '';
    document.getElementById('edit-stu-gender').value = s.gender || '';
    document.getElementById('edit-stu-dob').value = dateOnly(s.date_of_birth);
    document.getElementById('edit-stu-guardian').value = s.guardian_name || '';
    document.getElementById('edit-stu-guardian-phone').value = s.guardian_phone || '';
    document.getElementById('edit-stu-guardian-email').value = s.guardian_email || '';
    document.getElementById('edit-stu-address').value = s.address || '';
    document.getElementById('edit-stu-medical').value = s.medical_notes || '';
    document.getElementById('edit-stu-password').value = '';
    document.getElementById('edit-stu-status').value = s.status || 'active';
    fillClassSelect(document.getElementById('edit-stu-class'), s.class_id);
    document.getElementById('edit-student-error').textContent = '';
    openRecordModal('edit-student-modal');
  }

  document.getElementById('edit-student-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-stu-id').value;
    const btn = document.getElementById('edit-student-save');
    const err = document.getElementById('edit-student-error');
    err.textContent = '';
    btn.disabled = true;
    try {
      const res = await api(`/api/superadmin/students/${id}`, {
        method: 'PATCH',
        body: {
          admissionNumber: document.getElementById('edit-stu-admission').value.trim(),
          firstName: document.getElementById('edit-stu-first').value.trim(),
          lastName: document.getElementById('edit-stu-last').value.trim(),
          email: document.getElementById('edit-stu-email').value.trim(),
          phone: document.getElementById('edit-stu-phone').value.trim(),
          gender: document.getElementById('edit-stu-gender').value,
          dateOfBirth: document.getElementById('edit-stu-dob').value,
          guardianName: document.getElementById('edit-stu-guardian').value.trim(),
          guardianPhone: document.getElementById('edit-stu-guardian-phone').value.trim(),
          guardianEmail: document.getElementById('edit-stu-guardian-email').value.trim(),
          address: document.getElementById('edit-stu-address').value.trim(),
          medicalNotes: document.getElementById('edit-stu-medical').value.trim(),
          status: document.getElementById('edit-stu-status').value,
          classId: document.getElementById('edit-stu-class').value,
          password: document.getElementById('edit-stu-password').value.trim(),
        },
      });
      closeRecordModal('edit-student-modal');
      toast(res.message || 'Student record updated.', 'success');
      await loadStudents();
      await loadStudentRequests();
    } catch (error) {
      err.textContent = error.message;
      toast(error.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Teachers ----
  document.getElementById('teachers-list-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-tch]');
    if (!btn) return;
    const teacher = teachersCache.find((t) => Number(t.id) === Number(btn.dataset.editTch));
    if (!teacher) return;
    document.getElementById('edit-teacher-id').value = String(teacher.id);
    document.getElementById('edit-teacher-modal-title').textContent =
      `Edit Teacher — ${teacher.first_name} ${teacher.last_name}`;
    document.getElementById('edit-teacher-staff-number').value = teacher.staff_number || '';
    document.getElementById('edit-teacher-first').value = teacher.first_name || '';
    document.getElementById('edit-teacher-last').value = teacher.last_name || '';
    document.getElementById('edit-teacher-email').value = teacher.email || '';
    document.getElementById('edit-teacher-phone').value = teacher.phone || '';
    document.getElementById('edit-teacher-qualification').value = teacher.qualification || '';
    document.getElementById('edit-teacher-specialization').value = teacher.specialization || '';
    document.getElementById('edit-teacher-department').value = teacher.department || '';
    document.getElementById('edit-teacher-hire-date').value = dateOnly(teacher.hire_date);
    document.getElementById('edit-teacher-password').value = '';
    document.getElementById('edit-teacher-status').value = teacher.user_status || teacher.status || 'active';
    document.getElementById('edit-teacher-error').textContent = '';
    openRecordModal('edit-teacher-modal');
  });

  document.getElementById('edit-teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-teacher-id').value;
    const btn = document.getElementById('edit-teacher-save');
    const err = document.getElementById('edit-teacher-error');
    err.textContent = '';
    btn.disabled = true;
    try {
      const res = await api(`/api/superadmin/teachers/${id}`, {
        method: 'PATCH',
        body: {
          staffNumber: document.getElementById('edit-teacher-staff-number').value.trim(),
          firstName: document.getElementById('edit-teacher-first').value.trim(),
          lastName: document.getElementById('edit-teacher-last').value.trim(),
          email: document.getElementById('edit-teacher-email').value.trim(),
          phone: document.getElementById('edit-teacher-phone').value.trim(),
          qualification: document.getElementById('edit-teacher-qualification').value.trim(),
          specialization: document.getElementById('edit-teacher-specialization').value.trim(),
          department: document.getElementById('edit-teacher-department').value.trim(),
          hireDate: document.getElementById('edit-teacher-hire-date').value,
          status: document.getElementById('edit-teacher-status').value,
          password: document.getElementById('edit-teacher-password').value.trim(),
        },
      });
      closeRecordModal('edit-teacher-modal');
      toast(res.message || 'Teacher record updated.', 'success');
      await loadAcademicAndTeachers();
    } catch (error) {
      err.textContent = error.message;
      toast(error.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Staff / user accounts ----
  document.getElementById('users-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-edit-user]');
    if (!btn) return;
    const userId = Number(btn.dataset.editUser);
    let u = usersCache.find((x) => Number(x.id) === userId);
    try {
      if (!u) {
        const emailCell = btn.closest('tr')?.children[1]?.textContent?.trim() || '';
        const res = await api(`/api/superadmin/users?search=${encodeURIComponent(emailCell)}`);
        u = (res.items || []).find((x) => Number(x.id) === userId) || null;
      }
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
    if (!u) {
      toast('Account could not be loaded.', 'error');
      return;
    }
    document.getElementById('edit-user-id').value = String(userId);
    document.getElementById('edit-user-modal-title').textContent = `Edit Account — ${u.full_name}`;
    document.getElementById('edit-user-full-name').value = u.full_name || '';
    document.getElementById('edit-user-username').value = u.username || '';
    document.getElementById('edit-user-email').value = u.email || '';
    document.getElementById('edit-user-phone').value = u.phone || '';
    document.getElementById('edit-user-role').value = u.role || 'teacher';
    document.getElementById('edit-user-status').value = u.status || 'active';
    document.getElementById('edit-user-password').value = '';
    document.getElementById('edit-user-error').textContent = '';
    openRecordModal('edit-user-modal');
  });

  document.getElementById('edit-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-user-id').value;
    const btn = document.getElementById('edit-user-save');
    const err = document.getElementById('edit-user-error');
    err.textContent = '';
    btn.disabled = true;
    try {
      const res = await api(`/api/superadmin/users/${id}/profile`, {
        method: 'PATCH',
        body: {
          fullName: document.getElementById('edit-user-full-name').value.trim(),
          username: document.getElementById('edit-user-username').value.trim(),
          email: document.getElementById('edit-user-email').value.trim(),
          phone: document.getElementById('edit-user-phone').value.trim(),
          role: document.getElementById('edit-user-role').value,
          status: document.getElementById('edit-user-status').value,
          password: document.getElementById('edit-user-password').value.trim(),
        },
      });
      closeRecordModal('edit-user-modal');
      toast(res.message || 'Staff account updated.', 'success');
      await loadUsers();
      await loadAcademicAndTeachers();
    } catch (error) {
      err.textContent = error.message;
      toast(error.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------- SCHOOL-WIDE CALENDAR EVENTS ----------------
  const SEV_PRESET_COLORS = [
    '#2563eb', '#0ea5e9', '#7c3aed', '#dc2626',
    '#059669', '#f59e0b', '#db2777', '#0f172a',
  ];

  let schoolEventsCache = [];
  let editingSchoolEventId = null;

  function renderSevPresets() {
    const box = document.getElementById('sev-colour-presets');
    if (!box) return;
    box.innerHTML = SEV_PRESET_COLORS.map(
      (c) =>
        `<button type="button" class="sev-colour-swatch" data-sev-colour="${c}" style="background:${c}" aria-label="Use colour ${c}"></button>`
    ).join('');
  }
  renderSevPresets();

  document.getElementById('sev-colour-presets').addEventListener('click', (e) => {
    const sw = e.target.closest('[data-sev-colour]');
    if (!sw) return;
    document.getElementById('sev-colour').value = sw.dataset.sevColour;
  });

  const SEV_TYPE_COLORS = {
    holiday: '#0ea5e9',
    meeting: '#7c3aed',
    exam: '#dc2626',
    sports: '#059669',
    other: '#f59e0b',
  };

  document.getElementById('sev-type').addEventListener('change', (e) => {
    document.getElementById('sev-colour').value = SEV_TYPE_COLORS[e.target.value] || '#2563eb';
  });

  function sevDateLabel(ev) {
    if (ev.start_date === ev.end_date) return ev.start_date;
    return `${ev.start_date} to ${ev.end_date}`;
  }

  async function loadSchoolEvents() {
    const data = await api('/api/superadmin/events');
    schoolEventsCache = data.items || [];
    renderSchoolEvents();
  }

  function renderSchoolEvents() {
    const q = (document.getElementById('sev-search-input')?.value || '').trim().toLowerCase();
    document.getElementById('sev-clear-btn')?.classList.toggle('hidden', !q);
    const rows = schoolEventsCache.filter(
      (ev) =>
        !q ||
        `${ev.title} ${ev.event_type_label} ${ev.description || ''}`.toLowerCase().includes(q)
    );
    document.getElementById('school-events-tbody').innerHTML =
      rows
        .map(
          (ev) => `<tr>
            <td><span class="sev-colour-chip" style="background:${esc(ev.color)}"></span></td>
            <td>
              <strong>${esc(ev.title)}</strong>
              ${ev.description ? `<div class="muted-sm">${esc(ev.description)}</div>` : ''}
            </td>
            <td><span class="badge badge-neutral">${esc(ev.event_type_label)}</span></td>
            <td class="tabular">${esc(sevDateLabel(ev))}${ev.multi_day ? ' <span class="muted-sm">(multi-day)</span>' : ''}</td>
            <td>${esc(ev.audience_label)}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" data-edit-sev="${ev.id}">Edit</button>
              <button type="button" class="btn btn-secondary btn-sm" data-del-sev="${ev.id}">Delete</button>
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty-state">No school events scheduled yet.</td></tr>';
  }

  document.getElementById('sev-search-btn').addEventListener('click', renderSchoolEvents);
  document.getElementById('sev-clear-btn').addEventListener('click', () => {
    document.getElementById('sev-search-input').value = '';
    renderSchoolEvents();
  });
  document.getElementById('sev-search-input').addEventListener('input', renderSchoolEvents);

  function resetSchoolEventForm() {
    editingSchoolEventId = null;
    document.getElementById('school-event-form').reset();
    document.getElementById('school-event-id').value = '';
    document.getElementById('school-event-form-title').textContent = 'Add School Event';
    document.getElementById('sev-submit-btn').textContent = 'Add Event';
    document.getElementById('cancel-edit-school-event').classList.add('hidden');
    document.getElementById('sev-colour').value = '#2563eb';
  }

  document.getElementById('cancel-edit-school-event').addEventListener('click', resetSchoolEventForm);

  document.getElementById('school-event-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      title: document.getElementById('sev-title').value.trim(),
      description: document.getElementById('sev-description').value.trim(),
      eventType: document.getElementById('sev-type').value,
      startDate: document.getElementById('sev-start').value,
      endDate: document.getElementById('sev-end').value || document.getElementById('sev-start').value,
      color: document.getElementById('sev-colour').value,
      audience: document.getElementById('sev-audience').value,
    };
    const isEdit = Boolean(editingSchoolEventId);
    const btn = document.getElementById('sev-submit-btn');
    btn.disabled = true;
    try {
      const res = isEdit
        ? await api(`/api/superadmin/events/${editingSchoolEventId}`, {
            method: 'PATCH',
            body: payload,
          })
        : await api('/api/superadmin/events', { method: 'POST', body: payload });
      toast(res.message || 'School event saved.', 'success');
      resetSchoolEventForm();
      window.SMS.clearCalendarCache();
      await loadSchoolEvents();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('school-events-tbody').addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-sev]');
    if (editBtn) {
      const ev = schoolEventsCache.find((x) => Number(x.id) === Number(editBtn.dataset.editSev));
      if (!ev) return;
      editingSchoolEventId = ev.id;
      document.getElementById('school-event-id').value = String(ev.id);
      document.getElementById('sev-title').value = ev.title || '';
      document.getElementById('sev-description').value = ev.description || '';
      document.getElementById('sev-type').value = ev.event_type || 'other';
      document.getElementById('sev-start').value = ev.start_date || '';
      document.getElementById('sev-end').value = ev.end_date || '';
      document.getElementById('sev-audience').value = ev.audience || 'all';
      document.getElementById('sev-colour').value = ev.color || '#2563eb';
      document.getElementById('school-event-form-title').textContent = `Edit — ${ev.title}`;
      document.getElementById('sev-submit-btn').textContent = 'Save Changes';
      document.getElementById('cancel-edit-school-event').classList.remove('hidden');
      document.getElementById('sev-title').focus();
      return;
    }

    const delBtn = e.target.closest('[data-del-sev]');
    if (delBtn) {
      const ev = schoolEventsCache.find((x) => Number(x.id) === Number(delBtn.dataset.delSev));
      if (!ev) return;
      if (!window.confirm(`Delete the event "${ev.title}"?`)) return;
      try {
        const res = await api(`/api/superadmin/events/${ev.id}`, { method: 'DELETE' });
        toast(res.message || 'School event deleted.', 'success');
        if (Number(editingSchoolEventId) === Number(ev.id)) resetSchoolEventForm();
        window.SMS.clearCalendarCache();
        await loadSchoolEvents();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // ---------------- REPORT CARDS & END-OF-TERM ROLLOVER ----------------
  let rcCache = { cards: [] };

  function fillPeriodSelects() {
    const classOpts = (acadCache.classes || [])
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
      .join('');
    const yearOpts = (acadCache.years || [])
      .map((y) => `<option value="${y.id}"${y.is_active ? ' selected' : ''}>${esc(y.name)}</option>`)
      .join('');
    const termOpts = (acadCache.terms || [])
      .map((t) => `<option value="${t.id}"${t.is_active ? ' selected' : ''}>${esc(t.name)}</option>`)
      .join('');
    ['rc-gen-class', 'rc-list-class', 'rc-promote-class'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = classOpts;
    });
    ['rc-gen-year', 'rc-list-year', 'rc-promote-from-year', 'rc-promote-to-year'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = yearOpts;
    });
    ['rc-gen-term', 'rc-list-term', 'rc-promote-from-term', 'rc-promote-to-term'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = termOpts;
    });
  }

  async function loadReportCards() {
    const classId = document.getElementById('rc-list-class').value;
    const yearId = document.getElementById('rc-list-year').value;
    const termId = document.getElementById('rc-list-term').value;
    if (!classId) return;
    const data = await api(
      `/api/superadmin/reports/report-cards?classId=${encodeURIComponent(classId)}&academicYearId=${encodeURIComponent(
        yearId
      )}&termId=${encodeURIComponent(termId)}`
    );
    rcCache.cards = data.items || [];
    renderReportCards();
  }

  function renderReportCards() {
    const rows = rcCache.cards;
    document.getElementById('rc-list-tbody').innerHTML =
      rows
        .map(
          (r) => `<tr>
            <td>${r.classPosition ? `<strong>${esc(String(r.classPosition))}</strong> / ${esc(String(r.classSize))}` : '-'}</td>
            <td><strong>${esc(r.studentName)}</strong></td>
            <td><code>${esc(r.admissionNumber)}</code></td>
            <td>${esc(String(r.overallAverage))}%</td>
            <td><span class="badge badge-neutral">${esc(r.overallGrade)}</span></td>
            <td>${esc(String(r.gpa))}</td>
            <td class="tabular">${esc(r.attendanceSummary)}</td>
            <td>${esc(r.teacherRemark || '-')}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" data-rc-print="${r.studentId}">Print</button>
              <button type="button" class="btn btn-secondary btn-sm" data-rc-remark="${r.studentId}">Remark</button>
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="9" class="empty-state">No report cards generated for that class and term yet.</td></tr>';
  }

  document.getElementById('rc-generate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('rc-generate-btn');
    btn.disabled = true;
    try {
      const res = await api('/api/superadmin/reports/report-cards/generate', {
        method: 'POST',
        body: {
          classId: document.getElementById('rc-gen-class').value,
          academicYearId: document.getElementById('rc-gen-year').value,
          termId: document.getElementById('rc-gen-term').value,
        },
      });
      toast(res.message || 'Report cards generated.', 'success');
      document.getElementById('rc-list-class').value = document.getElementById('rc-gen-class').value;
      document.getElementById('rc-list-year').value = document.getElementById('rc-gen-year').value;
      document.getElementById('rc-list-term').value = document.getElementById('rc-gen-term').value;
      await loadReportCards();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('rc-load-btn').addEventListener('click', () => {
    loadReportCards().catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('rc-promote-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('rc-promote-btn');
    btn.disabled = true;
    try {
      const res = await api('/api/superadmin/reports/promote-class', {
        method: 'POST',
        body: {
          classId: document.getElementById('rc-promote-class').value,
          fromAcademicYearId: document.getElementById('rc-promote-from-year').value,
          fromTermId: document.getElementById('rc-promote-from-term').value,
          toAcademicYearId: document.getElementById('rc-promote-to-year').value,
          toTermId: document.getElementById('rc-promote-to-term').value,
          promoteToNextClass: document.getElementById('rc-promote-next-class').checked,
        },
      });
      toast(res.message || 'Class promoted.', 'success');
      await loadStudents();
      await loadAcademicAndTeachers();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('rc-list-tbody').addEventListener('click', async (e) => {
    const yearId = document.getElementById('rc-list-year').value;
    const termId = document.getElementById('rc-list-term').value;

    const printBtn = e.target.closest('[data-rc-print]');
    if (printBtn) {
      try {
        const res = await api(
          `/api/superadmin/reports/report-cards/student/${printBtn.dataset.rcPrint}?academicYearId=${encodeURIComponent(
            yearId
          )}&termId=${encodeURIComponent(termId)}`
        );
        window.SMS.printReportCardHtml(
          window.SMS.buildReportCardHtml(res.reportCard, res.gradingScales)
        );
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }

    const remarkBtn = e.target.closest('[data-rc-remark]');
    if (remarkBtn) {
      const studentId = remarkBtn.dataset.rcRemark;
      const card = rcCache.cards.find((c) => String(c.studentId) === String(studentId));
      const teacherRemark = window.prompt(
        `Class teacher's remark for ${card ? card.studentName : 'this student'}:`,
        card?.teacherRemark || ''
      );
      if (teacherRemark === null) return;
      const headRemark = window.prompt(
        "Head teacher's remark (leave blank to keep):",
        card?.headteacherRemark || ''
      );
      try {
        const res = await api('/api/superadmin/reports/report-cards/remark', {
          method: 'POST',
          body: { studentId, academicYearId: yearId, termId, teacherRemark, headteacherRemark: headRemark },
        });
        toast(res.message || 'Remark saved.', 'success');
        await loadReportCards();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // ---------------- NAVIGATION ----------------
  async function loadSectionData(sec) {
    if (sec === 'overview') await loadOverview();
    if (sec === 'analytics') await loadAnalytics(currentAnalyticsDays);
    if (
      sec === 'academic' ||
      sec === 'teacher-register' ||
      sec === 'teachers' ||
      sec === 'teacher-assign'
    ) {
      await loadAcademicAndTeachers();
    }
    if (sec === 'students') {
      await loadAcademicAndTeachers();
      await loadStudents();
      await loadStudentRequests();
    }
    if (sec === 'events') await loadSchoolEvents();
    if (sec === 'report-cards') {
      await loadAcademicAndTeachers();
      fillPeriodSelects();
      await loadReportCards().catch(() => {});
    }
    if (sec === 'messages') await window.SMS.refreshMessages();
    if (sec === 'timetables') {
      await loadAcademicAndTeachers();
      await loadTimetable();
    }
    if (sec === 'finance') await loadFinance();
    if (sec === 'users') {
      await loadAcademicAndTeachers();
      await loadUsers();
    }
    if (sec === 'announcements' || sec === 'settings') await loadOverview();
  }

  SMS.initNavigation(async (sec) => {
    try {
      await loadSectionData(sec);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Overview quick buttons & pending proposals jump
  document.getElementById('sec-overview').addEventListener('click', (e) => {
    const jumpBtn = e.target.closest('[data-jump-section]');
    if (jumpBtn) {
      const sec = jumpBtn.dataset.jumpSection;
      activateSection(sec);
      loadSectionData(sec).catch((err) => toast(err.message, 'error'));
      return;
    }
    if (e.target.closest('#ov-open-proposals-btn')) {
      activateSection('students');
      activateSubtab('students', 'stu-proposals');
      loadSectionData('students').catch((err) => toast(err.message, 'error'));
    }
  });

  // Site Analytics period switcher & manual refresh
  document.getElementById('an-window-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-an-days]');
    if (!btn) return;
    loadAnalytics(Number(btn.dataset.anDays)).catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('an-refresh-btn').addEventListener('click', () => {
    loadAnalytics(currentAnalyticsDays)
      .then(() => toast('Analytics refreshed.', 'info'))
      .catch((err) => toast(err.message, 'error'));
  });

  // Topbar currency switcher
  SMS.bindCurrencySelect('sa-currency-switcher', '/api/superadmin/settings/currency', async () => {
    await loadOverview();
    if (!document.getElementById('sec-finance').classList.contains('hidden')) await loadFinance();
  });

  // Classes & Subjects forms
  document.getElementById('create-class-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/academic/classes', { method: 'POST', body: fd });
      e.target.reset();
      toast('Class created.', 'success');
      await loadAcademicAndTeachers();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('create-subject-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/academic/subjects', { method: 'POST', body: fd });
      e.target.reset();
      toast('Subject added.', 'success');
      await loadAcademicAndTeachers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Teacher registration multi-subject interactions
  document.getElementById('btn-add-tch-subject-row').addEventListener('click', () => {
    const wrap = document.getElementById('tch-subject-rows-list');
    const idx = wrap.querySelectorAll('[data-subject-row]').length + 1;
    const row = document.createElement('div');
    row.className = 'subject-row-item';
    row.setAttribute('data-subject-row', '');
    row.innerHTML = `
      <span class="subject-row-label">Subject ${idx}</span>
      <input type="text" class="tch-subject-row-input" list="subject-suggestions-list" placeholder="Type another subject">
      <button type="button" class="btn btn-secondary btn-sm" data-remove-subject-row>Remove</button>
    `;
    wrap.appendChild(row);
  });

  document.getElementById('tch-subject-rows-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-subject-row]');
    if (!btn) return;
    btn.closest('[data-subject-row]')?.remove();
    updateTeacherSubjectCountBadge();
  });

  document.getElementById('tch-subject-rows-list').addEventListener('input', updateTeacherSubjectCountBadge);
  document.getElementById('tch-reg-subject-checkboxes').addEventListener('change', updateTeacherSubjectCountBadge);

  document.getElementById('btn-add-tch-subject').addEventListener('click', () => {
    const inp = document.getElementById('tch-custom-subject-input');
    const parts = inp.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      if (!customRegSubjects.includes(p)) customRegSubjects.push(p);
    }
    inp.value = '';
    renderCustomRegChips();
  });

  document.getElementById('tch-custom-subject-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-reg-chip]');
    if (!btn) return;
    customRegSubjects.splice(Number(btn.dataset.delRegChip), 1);
    renderCustomRegChips();
  });

  document.getElementById('create-teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const quickInput = document.getElementById('tch-custom-subject-input').value.trim();
    const extraQuick = quickInput
      ? quickInput
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    fd.subjectIds = getCheckedValues('tch-reg-subject-checkboxes');
    fd.customSubjects = Array.from(
      new Set([...getSubjectRowValues('tch-subject-rows-list'), ...customRegSubjects, ...extraQuick])
    );
    fd.classIds = getCheckedValues('tch-reg-class-checkboxes');

    try {
      const res = await api('/api/superadmin/teachers', { method: 'POST', body: fd });
      e.target.reset();
      customRegSubjects = [];
      renderCustomRegChips();
      showIssuedCredentials(res.issuedCredentials);
      toast('Teacher registered.', 'success');
      await loadAcademicAndTeachers();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Edit teacher subjects
  document.getElementById('teachers-list-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-tch-subs]');
    if (!btn) return;
    const tid = Number(btn.dataset.editTchSubs);
    const teacher = teachersCache.find((t) => Number(t.id) === tid);
    if (!teacher) return;
    document.getElementById('edit-tch-id').value = String(tid);
    document.getElementById('edit-teacher-subjects-title').textContent =
      `Update Subjects — ${teacher.first_name} ${teacher.last_name}`;
    editCustomSubjects = [];
    renderSubjectCheckPills('edit-tch-subject-checkboxes', acadCache.subjects, teacher.subjectIds || []);
    document.getElementById('edit-tch-custom-subject-input').value = '';
    renderEditCustomChips();
    document.getElementById('edit-teacher-subjects-card').classList.remove('hidden');
  });

  document.getElementById('edit-tch-subject-checkboxes').addEventListener('change', updateEditSubjectCountBadge);

  document.getElementById('btn-add-edit-tch-subject').addEventListener('click', () => {
    const inp = document.getElementById('edit-tch-custom-subject-input');
    const parts = inp.value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of parts) {
      if (!editCustomSubjects.includes(p)) editCustomSubjects.push(p);
    }
    inp.value = '';
    renderEditCustomChips();
  });

  document.getElementById('edit-tch-custom-subject-chips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-edit-chip]');
    if (!btn) return;
    editCustomSubjects.splice(Number(btn.dataset.delEditChip), 1);
    renderEditCustomChips();
  });

  document.getElementById('btn-cancel-edit-teacher-subjects').addEventListener('click', () => {
    document.getElementById('edit-teacher-subjects-card').classList.add('hidden');
  });

  document.getElementById('edit-teacher-subjects-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tid = Number(document.getElementById('edit-tch-id').value);
    const subjectIds = getCheckedValues('edit-tch-subject-checkboxes');
    const inlinePending = document.getElementById('edit-tch-custom-subject-input').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const customSubjects = Array.from(new Set([...editCustomSubjects, ...inlinePending]));
    try {
      await api(`/api/superadmin/teachers/${tid}/subjects`, {
        method: 'PUT',
        body: { subjectIds, customSubjects },
      });
      document.getElementById('edit-teacher-subjects-card').classList.add('hidden');
      toast('Teacher subjects updated.', 'success');
      await loadAcademicAndTeachers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Assign Teacher to Classes
  document.getElementById('asg-teacher').addEventListener('change', syncAssignTeacherSubjects);
  document.getElementById('asg-subjects-checkboxes').addEventListener('change', updateAsgSubjectCountBadge);
  document.getElementById('asg-all-classes-chk').addEventListener('change', (e) => {
    document
      .querySelectorAll('#asg-classes-checkboxes input[type="checkbox"]')
      .forEach((cb) => {
        cb.checked = e.target.checked;
      });
  });

  document.getElementById('assign-teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const teacherId = Number(document.getElementById('asg-teacher').value);
    const applyToAllClasses = document.getElementById('asg-all-classes-chk').checked;
    const classIds = getCheckedValues('asg-classes-checkboxes');
    const subjectIds = getCheckedValues('asg-subjects-checkboxes');

    if (!applyToAllClasses && !classIds.length) {
      toast('Select at least one class or check All Classes.', 'error');
      return;
    }
    if (!subjectIds.length) {
      toast('Select at least one subject.', 'error');
      return;
    }

    try {
      const res = await api('/api/superadmin/teachers/assign', {
        method: 'POST',
        body: { teacherId, classIds, applyToAllClasses, subjectIds },
      });
      toast(`Assigned ${res.assignedCount} teaching slot(s).`, 'success');
      await loadAcademicAndTeachers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Teachers, Students & Users Server-Backed Search Controls
  document.getElementById('tch-search-btn')?.addEventListener('click', () => {
    searchTeachersServer().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('tch-search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchTeachersServer().catch((err) => toast(err.message, 'error'));
    }
  });
  document.getElementById('tch-clear-btn')?.addEventListener('click', () => {
    const inp = document.getElementById('tch-search-input');
    if (inp) inp.value = '';
    searchTeachersServer().catch((err) => toast(err.message, 'error'));
  });

  // Students & Join Proposals
  document.getElementById('stu-filter-btn').addEventListener('click', () => {
    const q = document.getElementById('stu-search').value.trim();
    document.getElementById('stu-clear-btn')?.classList.toggle('hidden', !q);
    loadStudents().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('stu-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('stu-filter-btn').click();
    }
  });
  document.getElementById('stu-clear-btn')?.addEventListener('click', () => {
    document.getElementById('stu-search').value = '';
    document.getElementById('stu-clear-btn')?.classList.add('hidden');
    loadStudents().catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('usr-search-btn')?.addEventListener('click', () => {
    loadUsers().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('usr-role-filter')?.addEventListener('change', () => {
    loadUsers().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('usr-search-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loadUsers().catch((err) => toast(err.message, 'error'));
    }
  });
  document.getElementById('usr-clear-btn')?.addEventListener('click', () => {
    const inp = document.getElementById('usr-search-input');
    const sel = document.getElementById('usr-role-filter');
    if (inp) inp.value = '';
    if (sel) sel.value = '';
    loadUsers().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('stu-req-status-filter').addEventListener('change', () => {
    loadStudentRequests().catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('create-student-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/superadmin/students', { method: 'POST', body: fd });
      e.target.reset();
      showIssuedCredentials(res.issuedCredentials);
      toast('Student enrolled.', 'success');
      await loadStudents();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('student-requests-tbody').addEventListener('click', async (e) => {
    const appBtn = e.target.closest('[data-srr-approve]');
    if (appBtn) {
      const reqId = Number(appBtn.dataset.srrApprove);
      const classId = document.querySelector(`[data-srr-class="${reqId}"]`)?.value || null;
      try {
        await api(`/api/superadmin/student-requests/${reqId}/review`, {
          method: 'POST',
          body: { decision: 'approved', classId: classId ? Number(classId) : null },
        });
        toast('Student proposal accepted and enrolled.', 'success');
        await loadStudentRequests();
        await loadStudents();
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }

    const rejBtn = e.target.closest('[data-srr-reject]');
    if (rejBtn) {
      const reqId = Number(rejBtn.dataset.srrReject);
      const note = prompt('Optional reason for rejection:') || 'Declined by administrator';
      try {
        await api(`/api/superadmin/student-requests/${reqId}/review`, {
          method: 'POST',
          body: { decision: 'rejected', reviewNote: note },
        });
        toast('Proposal rejected.', 'info');
        await loadStudentRequests();
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // Timetable
  document.getElementById('tt-filter-class').addEventListener('change', () => {
    loadTimetable().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('create-tt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/timetables', { method: 'POST', body: fd });
      toast('Lesson added to timetable.', 'success');
      await loadTimetable();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Finance & Paystack
  document.getElementById('sa-bill-target-type').addEventListener('change', (e) => {
    const isClass = e.target.value === 'class';
    document.getElementById('sa-bill-class-wrap').classList.toggle('hidden', !isClass);
    document.getElementById('sa-bill-student-wrap').classList.toggle('hidden', isClass);
  });

  document.getElementById('sa-fee-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/financial/categories', { method: 'POST', body: fd });
      e.target.reset();
      toast('Fee item saved.', 'success');
      await loadFinance();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('sa-assign-fee-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/assignments', { method: 'POST', body: fd });
      toast(res.message || 'Fee assigned.', 'success');
      await loadFinance();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('sa-paystack-init-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.callbackUrl = `${window.location.origin}/dashboard/superadmin`;
    try {
      const res = await api('/api/financial/paystack/initialize', { method: 'POST', body: fd });
      openPaystackCheckout(res.transaction, {
        verifyEndpoint: '/api/financial/paystack/verify',
        onSuccess: async () => {
          await loadFinance();
          await loadOverview();
        },
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('sa-paystack-transfer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/paystack/transfers', { method: 'POST', body: fd });
      toast(`Transfer sent (${res.transfer.reference}).`, 'success');
      e.target.reset();
      await loadFinance();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('sa-fin-payments-tbody').addEventListener('click', async (e) => {
    const revBtn = e.target.closest('[data-rev-pay]');
    if (!revBtn) return;
    const reason = prompt('Reason for reversing this payment:');
    if (!reason || reason.trim().length < 4) {
      toast('Please enter a reason (min 4 characters).', 'error');
      return;
    }
    try {
      await api(`/api/financial/payments/${revBtn.dataset.revPay}/reverse`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast('Payment reversed.', 'info');
      await loadFinance();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Staff Accounts
  const usrRoleSel = document.getElementById('usr-role-select');
  const syncUsrTeacherFields = () => {
    document
      .getElementById('usr-teacher-extra-fields')
      .classList.toggle('hidden', usrRoleSel.value !== 'teacher');
  };
  usrRoleSel.addEventListener('change', syncUsrTeacherFields);
  syncUsrTeacherFields();

  document.getElementById('usr-tch-subject-checkboxes').addEventListener('change', updateUsrSubjectCountBadge);
  document.getElementById('usr-tch-subject-rows').addEventListener('input', updateUsrSubjectCountBadge);

  document.getElementById('btn-add-usr-subject-row').addEventListener('click', () => {
    const wrap = document.getElementById('usr-tch-subject-rows');
    const idx = wrap.querySelectorAll('[data-subject-row]').length + 1;
    const row = document.createElement('div');
    row.className = 'subject-row-item';
    row.setAttribute('data-subject-row', '');
    row.innerHTML = `
      <span class="subject-row-label">Subject ${idx}</span>
      <input type="text" class="tch-subject-row-input" list="subject-suggestions-list" placeholder="Type subject name">
      <button type="button" class="btn btn-secondary btn-sm" data-del-usr-sub>Remove</button>
    `;
    wrap.appendChild(row);
  });

  document.getElementById('usr-tch-subject-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-usr-sub]');
    if (!btn) return;
    btn.closest('[data-subject-row]')?.remove();
    updateUsrSubjectCountBadge();
  });

  document.getElementById('create-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    if (fd.role === 'teacher') {
      fd.subjectIds = getCheckedValues('usr-tch-subject-checkboxes');
      fd.customSubjects = getSubjectRowValues('usr-tch-subject-rows');
    }
    try {
      const res = await api('/api/superadmin/users', { method: 'POST', body: fd });
      e.target.reset();
      syncUsrTeacherFields();
      showIssuedCredentials(res.issuedCredentials);
      toast('Staff account created.', 'success');
      await loadUsers();
      await loadAcademicAndTeachers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Superadmin sets any portal account's profile photo
  const userAvatarInput = document.getElementById('user-avatar-input');
  let pendingAvatarUserId = null;

  document.getElementById('users-tbody').addEventListener('click', async (e) => {
    const avatarBtn = e.target.closest('[data-set-avatar]');
    if (avatarBtn) {
      pendingAvatarUserId = Number(avatarBtn.dataset.setAvatar);
      if (pendingAvatarUserId > 0) userAvatarInput?.click();
      return;
    }
    const btn = e.target.closest('[data-toggle-user]');
    if (!btn) return;
    const next = btn.dataset.curStatus === 'active' ? 'suspended' : 'active';
    try {
      await api(`/api/superadmin/users/${btn.dataset.toggleUser}`, {
        method: 'PATCH',
        body: { status: next },
      });
      toast(`Account ${next}.`, 'info');
      await loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  userAvatarInput?.addEventListener('change', async () => {
    const file = userAvatarInput.files && userAvatarInput.files[0];
    const userId = pendingAvatarUserId;
    pendingAvatarUserId = null;
    userAvatarInput.value = '';
    if (!file || !userId) return;
    if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)) {
      toast('Profile photos must be a JPG, PNG, WEBP or GIF image.', 'error');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast('Profile photos must be 2 MB or smaller.', 'error');
      return;
    }
    const form = new FormData();
    form.append('avatar', file);
    try {
      const data = await api(`/api/superadmin/users/${userId}/avatar`, {
        method: 'POST',
        body: form,
      });
      toast(data.message || 'Profile photo updated.', 'success');
      await loadUsers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Announcements
  document.getElementById('create-ann-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/announcements', { method: 'POST', body: fd });
      e.target.reset();
      toast('Announcement published.', 'success');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Settings
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      schoolName: document.getElementById('set-school-name').value.trim(),
      schoolCode: currentSettings?.school_code || 'SMS',
      phone: document.getElementById('set-phone').value.trim(),
      email: document.getElementById('set-email').value.trim(),
      address: document.getElementById('set-address').value.trim(),
      currencyCode: document.getElementById('set-currency-code').value,
      currencySymbol: document.getElementById('set-currency-symbol').value.trim(),
      studentFeePortalEnabled: document.getElementById('set-fee-portal').checked,
      googleOauthEnabled: document.getElementById('set-google-enabled').checked,
      googleClientId: document.getElementById('set-google-client-id').value.trim(),
      googleClientSecret: document.getElementById('set-google-client-secret').value.trim(),
      paystackEnabled: document.getElementById('set-psk-receive-enabled').checked,
      paystackTransfersEnabled: document.getElementById('set-psk-send-enabled').checked,
      paystackRefundsEnabled: document.getElementById('set-psk-reverse-enabled').checked,
      paystackPublicKey: document.getElementById('set-paystack-public-key').value.trim(),
      paystackSecretKey: document.getElementById('set-paystack-secret-key').value.trim(),
      clearPaystackSecret: document.getElementById('set-clear-paystack-secret').checked,
    };

    try {
      const updated = await api('/api/superadmin/settings', { method: 'PUT', body: payload });
      SMS.setCurrency(updated.settings.currency_code, updated.settings.currency_symbol);
      populateSettingsForm(updated);
      toast('Settings saved.', 'success');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await loadOverview();
  await loadAcademicAndTeachers();
})();
