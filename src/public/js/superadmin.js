(async function initSuperadminDashboard() {
  const { esc, money, api, toast, statusBadge, exportCsv, openPaystackCheckout, activateSection } =
    window.SMS;

  const state = {
    overview: null,
    academic: null,
    teachersData: null,
    reportsData: null,
    financeStats: null,
    regCustomSubjects: [],
    editCustomSubjects: [],
    editingTeacherId: null,
  };

  await SMS.initSession();
  SMS.initPrivacyToggle('privacy-toggle-btn');
  SMS.configureGoogleLinkButton('google-link-btn');
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);

  const user = SMS.getUser();
  if (user) {
    document.getElementById('sb-user-info').textContent = `${user.fullName} | ${user.email}`;
  }

  // ---------------- SUB-TAB NAVIGATION ----------------
  function switchSubtab(group, subtabId) {
    document.querySelectorAll(`[data-tab-group="${group}"] .subtab-btn`).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.subtab === subtabId);
    });
    document.querySelectorAll(`.subtab-pane[data-tab-pane="${group}"]`).forEach((pane) => {
      pane.classList.toggle('hidden', pane.id !== `subtab-${subtabId}`);
    });
  }

  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('.subtab-btn[data-subtab]');
    if (tabBtn) {
      const bar = tabBtn.closest('[data-tab-group]');
      if (bar) switchSubtab(bar.dataset.tabGroup, tabBtn.dataset.subtab);
      return;
    }

    const openSubBtn = e.target.closest('[data-open-subtab]');
    if (openSubBtn) {
      const [group, subtab] = String(openSubBtn.dataset.openSubtab || '').split(':');
      if (group && subtab) switchSubtab(group, subtab);
      return;
    }

    const jumpBtn = e.target.closest('[data-jump-section]');
    if (jumpBtn) {
      const targetSec = jumpBtn.dataset.jumpSection;
      const targetSub = jumpBtn.dataset.jumpSubtab || '';
      activateSection(targetSec, onSectionLoad);
      if (targetSub) {
        const [grp, sub] = targetSub.split(':');
        if (grp && sub) switchSubtab(grp, sub);
      }
    }
  });

  async function onSectionLoad(sec) {
    try {
      if (sec === 'overview') await loadOverview();
      if (sec === 'finance') await loadFinancialGovernance();
      if (sec === 'users') await loadUsers();
      if (sec === 'students') {
        await loadAcademicAndSelectors();
        await loadStudentRequests();
        await loadStudents();
      }
      if (sec === 'teachers') await loadAcademicAndSelectors();
      if (sec === 'academic') await loadAcademicAndSelectors();
      if (sec === 'timetables') {
        await loadAcademicAndSelectors();
        await loadTimetables();
      }
      if (sec === 'attendance') await loadAttendanceOverview();
      if (sec === 'exams') await loadExams();
      if (sec === 'reports') await loadReports();
      if (sec === 'announcements') await loadOverview();
      if (sec === 'settings') await loadOverview();
      if (sec === 'audit') await loadAudits();
      if (sec === 'backups') await loadBackups();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  document.getElementById('goto-student-requests-btn').addEventListener('click', () => {
    activateSection('students', onSectionLoad);
    switchSubtab('students', 'stu-proposals');
  });

  document.getElementById('goto-finance-stats-btn').addEventListener('click', () => {
    activateSection('finance', onSectionLoad);
  });

  // ---------------- SETUP GUIDE & OVERVIEW ----------------
  function renderSetupGuide(data) {
    const guideEl = document.getElementById('sa-setup-guide');
    if (!guideEl) return;

    const hasPeriod = Boolean(data.activeYear && data.activeTerm);
    const hasClasses = Number(data.metrics?.activeClasses || 0) > 0;
    const hasPeople =
      Number(data.metrics?.activeTeachers || 0) > 0 ||
      Number(data.metrics?.activeStudents || 0) > 0;
    const hasFees =
      Number(data.metrics?.finance?.ledgerNetBilled || data.metrics?.finance?.collected || 0) > 0;

    if (hasPeriod && hasClasses && hasPeople && hasFees) {
      guideEl.classList.add('hidden');
      guideEl.innerHTML = '';
      return;
    }

    const steps = [
      {
        num: 'Step 1',
        title: 'Academic Year & Term',
        desc: 'Create your current academic year and active term.',
        done: hasPeriod,
        sec: 'academic',
        sub: 'academic:acad-calendar',
        btnLabel: 'Set Calendar',
      },
      {
        num: 'Step 2',
        title: 'Classes & Subjects',
        desc: 'Add classes, optional streams and your subject catalogue.',
        done: hasClasses,
        sec: 'academic',
        sub: 'academic:acad-classes',
        btnLabel: 'Add Classes',
      },
      {
        num: 'Step 3',
        title: 'Teachers & Students',
        desc: 'Register teaching staff and enrol students or approve proposals.',
        done: hasPeople,
        sec: 'teachers',
        sub: 'teachers:tch-staff',
        btnLabel: 'Add Staff / Students',
      },
      {
        num: 'Step 4',
        title: 'Fee Structure & Billing',
        desc: 'Create fee categories and assign term billing.',
        done: hasFees,
        sec: 'finance',
        sub: 'finance:fin-categories',
        btnLabel: 'Configure Fees',
      },
    ];

    guideEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
        <div>
          <strong style="font-size:14.5px;color:var(--text);">Workspace Setup Checklist</strong>
          <div class="card-subtitle">Your database starts completely clean — add your school records in sequence below.</div>
        </div>
      </div>
      <div class="setup-steps-grid">
        ${steps
          .map(
            (s) => `
          <div class="setup-step-item ${s.done ? 'done' : ''}">
            <div>
              <div class="setup-step-top">
                <span class="setup-step-num">${s.num}</span>
                ${s.done ? '<span class="badge badge-success">Ready</span>' : '<span class="badge badge-neutral">Pending</span>'}
              </div>
              <div class="setup-step-title">${esc(s.title)}</div>
              <div class="setup-step-desc">${esc(s.desc)}</div>
            </div>
            <div>
              <button type="button" class="btn ${s.done ? 'btn-secondary' : 'btn-primary'} btn-sm" data-jump-section="${s.sec}" data-jump-subtab="${s.sub}">
                ${esc(s.btnLabel)}
              </button>
            </div>
          </div>`
          )
          .join('')}
      </div>
    `;
    guideEl.classList.remove('hidden');
  }

  async function loadOverview() {
    const data = await api('/api/superadmin/overview');
    state.overview = data;
    SMS.setCurrency(data.settings.currency_code, data.settings.currency_symbol);
    document.getElementById('sb-school-name').textContent =
      data.settings.school_name || 'School Management System';

    const periodLabel =
      data.activeYear || data.activeTerm
        ? `${data.activeYear?.name || 'No Year'} - ${data.activeTerm?.name || 'No Term'}`
        : 'No Active Period';
    document.getElementById('active-period-badge').textContent = periodLabel;

    SMS.populateCurrencyOptions(
      'header-currency-select',
      data.currencies,
      data.settings.currency_code
    );

    const m = data.metrics;
    const pendingCount = Number(m.pendingStudentRequests || 0);

    const navPill = document.getElementById('nav-pending-proposals-pill');
    if (navPill) {
      navPill.textContent = String(pendingCount);
      navPill.classList.toggle('hidden', pendingCount === 0);
    }

    const reqBtn = document.getElementById('goto-student-requests-btn');
    if (reqBtn) {
      reqBtn.textContent =
        pendingCount > 0 ? `Join Proposals (${pendingCount} Pending)` : 'Join Proposals';
    }

    const propSubBtn = document.getElementById('stu-proposals-subtab-btn');
    if (propSubBtn) {
      propSubBtn.textContent =
        pendingCount > 0 ? `Join Proposals (${pendingCount})` : 'Join Proposals';
    }

    renderSetupGuide(data);

    document.getElementById('ov-kpis').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">Enrolled Students</div>
        <div class="kpi-value">${m.activeStudents}</div>
        <div class="kpi-sub">${m.activeClasses} classes | ${pendingCount} pending proposals</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Teaching Staff</div>
        <div class="kpi-value">${m.activeTeachers}</div>
        <div class="kpi-sub">${m.activeUsers} active user accounts</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Attendance Rate</div>
        <div class="kpi-value">${m.attendanceRate}%</div>
        <div class="kpi-sub">Submitted roll-call rate</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Fees Collected</div>
        <div class="kpi-value">${money(m.finance.collected)}</div>
        <div class="kpi-sub">Paystack: ${money(m.finance.paystackCollected)} (${m.finance.collectionRate}%)</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Outstanding Fees</div>
        <div class="kpi-value">${money(m.finance.outstanding)}</div>
        <div class="kpi-sub">Target attainment: ${m.finance.targetAttainmentRate}%</div>
      </div>
    `;

    const annHtml = (data.announcements || [])
      .slice(0, 6)
      .map(
        (a) => `<div style="padding:11px 0;border-bottom:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <strong>${esc(a.title)}</strong>
            ${statusBadge(a.priority)}
          </div>
          <div style="font-size:12.5px;color:var(--text-muted);margin-top:4px;">${esc(a.body)}</div>
          <div style="font-size:11px;color:var(--text-light);margin-top:4px;">Audience: ${esc(a.audience)} | By ${esc(a.author_name || 'Superadmin')}</div>
        </div>`
      )
      .join('');
    document.getElementById('ov-announcements').innerHTML =
      annHtml || '<div class="empty-state">No announcements published yet.</div>';
    document.getElementById('all-announcements-list').innerHTML =
      annHtml || '<div class="empty-state">No announcements published yet.</div>';

    document.getElementById('ov-audits-body').innerHTML =
      (data.recentAudits || [])
        .map(
          (al) => `<tr>
            <td class="tabular">${esc(String(al.created_at || '').slice(0, 16))}</td>
            <td>${esc(al.actor_name || al.actor_role || 'System')}</td>
            <td><code>${esc(al.action)}</code></td>
            <td>${esc(al.target_type)} #${esc(al.target_id)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No system activity recorded yet.</td></tr>';

    populateSettingsForm(data);
  }

  // ---------------- FINANCIAL & PAYSTACK GOVERNANCE ----------------
  async function loadFinancialGovernance() {
    const [fin, accountsRes, acadRes, stuRes] = await Promise.all([
      api('/api/superadmin/finance/stats'),
      api('/api/financial/accounts?limit=100'),
      api('/api/superadmin/academic'),
      api('/api/superadmin/students?limit=100'),
    ]);
    state.financeStats = fin;
    SMS.setCurrency(fin.settings?.currency_code, fin.settings?.currency_symbol);

    const m = fin.metrics;
    document.getElementById('adm-fin-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Managed Net Billed</div><div class="kpi-value">${money(m.netBilled)}</div><div class="kpi-sub">Ledger: ${money(m.ledgerNetBilled)} | Adj: ${money(m.billedAdjustment)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Managed Collected</div><div class="kpi-value">${money(m.totalCollected)}</div><div class="kpi-sub">Ledger: ${money(m.ledgerCollected)} | Adj: ${money(m.collectedAdjustment)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Outstanding Arrears</div><div class="kpi-value">${money(m.totalOutstanding)}</div><div class="kpi-sub">Collection rate: ${m.collectionRate}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Revenue Target</div><div class="kpi-value">${money(m.termRevenueTarget)}</div><div class="kpi-sub">Attainment: ${m.targetAttainmentRate}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Treasury Position</div><div class="kpi-value">${money(m.treasuryPosition)}</div><div class="kpi-sub">Paystack: ${money(m.paystackCollected)} (${m.paystackSuccessCount} tx)</div></div>
    `;

    document.getElementById('adm-fin-target').value = m.termRevenueTarget;
    document.getElementById('adm-fin-opening').value = m.openingBalance;
    document.getElementById('adm-fin-billed-adj').value = m.billedAdjustment;
    document.getElementById('adm-fin-coll-adj').value = m.collectedAdjustment;
    document.getElementById('adm-psk-channels').value =
      fin.settings?.paystack_channels || 'card,mobile_money,bank_transfer,ussd';
    document.getElementById('adm-psk-enabled').checked = Boolean(fin.settings?.paystack_enabled);

    const accounts = accountsRes.items || [];
    document.getElementById('adm-pay-student').innerHTML = accounts.length
      ? accounts
          .map(
            (s) =>
              `<option value="${s.student_id}">${esc(s.admission_number)} - ${esc(s.first_name)} ${esc(s.last_name)} (Balance: ${SMS.moneyPlain(s.balance)})</option>`
          )
          .join('')
      : '<option value="">No enrolled students with billing yet</option>';

    // Populate Fee Assignment selectors
    const activeCats = (fin.feeCategories || []).filter((c) => c.status === 'active');
    const billCatSel = document.getElementById('adm-bill-cat');
    if (billCatSel) {
      billCatSel.innerHTML = activeCats.length
        ? activeCats
            .map(
              (c) =>
                `<option value="${c.id}">${esc(c.code)} - ${esc(c.name)} (${SMS.moneyPlain(c.default_amount)})</option>`
            )
            .join('')
        : '<option value="">Create a Fee Category first</option>';
    }

    const billClassSel = document.getElementById('adm-bill-class');
    if (billClassSel) {
      billClassSel.innerHTML =
        '<option value="">None (Select Individual Student)</option>' +
        (acadRes.classes || [])
          .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
          .join('');
    }

    const billStuSel = document.getElementById('adm-bill-student');
    if (billStuSel) {
      billStuSel.innerHTML =
        '<option value="">All Students in Selected Class</option>' +
        (stuRes.items || [])
          .map(
            (s) =>
              `<option value="${s.id}">${esc(s.admission_number)} - ${esc(s.first_name)} ${esc(s.last_name)}</option>`
          )
          .join('');
    }

    // Fee categories table
    document.getElementById('adm-fee-cats-tbody').innerHTML =
      (fin.feeCategories || [])
        .map(
          (c) => `<tr data-cat-row="${c.id}">
            <td><code>${esc(c.code)}</code></td>
            <td><input type="text" class="adm-cat-name" value="${esc(c.name)}"></td>
            <td>${esc(c.frequency)}</td>
            <td class="num" style="width:150px;"><input type="number" step="0.01" min="0.01" class="adm-cat-amt" value="${c.default_amount}"></td>
            <td>
              <select class="adm-cat-status" style="width:110px;">
                <option value="active" ${c.status === 'active' ? 'selected' : ''}>active</option>
                <option value="inactive" ${c.status === 'inactive' ? 'selected' : ''}>inactive</option>
              </select>
            </td>
            <td><button type="button" class="btn btn-secondary btn-sm" data-save-cat="${c.id}">Save</button></td>
          </tr>`
        )
        .join('') ||
      '<tr><td colspan="6" class="empty-state">No fee categories added yet. Create your first category above.</td></tr>';

    // Student Fee Assignments table
    document.getElementById('adm-fa-tbody').innerHTML =
      (fin.feeAssignments || [])
        .map(
          (fa) => `<tr data-fa-row="${fa.id}">
            <td><strong>${esc(fa.first_name)} ${esc(fa.last_name)}</strong><br><small style="color:var(--text-light);">${esc(fa.admission_number)}</small></td>
            <td>${esc(fa.fee_name)} (${esc(fa.term_name || '-')})</td>
            <td class="num" style="width:130px;"><input type="number" step="0.01" min="0" class="adm-fa-due" value="${fa.amount_due}"></td>
            <td class="num" style="width:130px;"><input type="number" step="0.01" min="0" class="adm-fa-disc" value="${fa.discount_amount}"></td>
            <td class="num">${money(fa.amount_paid)}</td>
            <td class="num"><strong>${money(fa.balance)}</strong></td>
            <td>${statusBadge(fa.status)}</td>
            <td>
              <button type="button" class="btn btn-secondary btn-sm" data-save-fa="${fa.id}">Update</button>
              ${
                Number(fa.amount_paid) === 0
                  ? `<button type="button" class="btn btn-danger btn-sm" data-del-fa="${fa.id}">Void</button>`
                  : ''
              }
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="8" class="empty-state">No student fee assignments yet.</td></tr>';

    // Payments & Reversals table
    document.getElementById('adm-payments-tbody').innerHTML =
      (fin.recentPayments || [])
        .map(
          (p) => `<tr>
            <td class="tabular">${esc(p.payment_date)}</td>
            <td><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong> (${esc(p.admission_number)})</td>
            <td><span class="badge badge-primary">${esc(p.payment_method)}</span> <code>${esc(p.reference_number || '-')}</code></td>
            <td><code>${esc(p.receipt_number || '-')}</code></td>
            <td class="num"><strong>${money(p.amount)}</strong></td>
            <td>${statusBadge(p.status)}</td>
            <td>
              ${
                p.status === 'completed'
                  ? `<button type="button" class="btn btn-danger btn-sm" data-rev-pay="${p.id}">Reverse / Refund</button>`
                  : 'Reversed'
              }
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No payments recorded yet.</td></tr>';

    await loadAdminPaystackTransfers();
  }

  async function loadAdminPaystackTransfers() {
    const tbody = document.getElementById('adm-psk-transfers-tbody');
    if (!tbody) return;
    const res = await api('/api/financial/paystack/transfers');
    tbody.innerHTML =
      (res.items || [])
        .map(
          (t) => `<tr>
            <td class="tabular">${esc(String(t.created_at || '').slice(0, 16))}</td>
            <td><code>${esc(t.reference)}</code><br><small>${esc(t.reason || '-')}</small></td>
            <td><strong>${esc(t.recipient_name)}</strong><br><small>${esc(t.recipient_account)}</small></td>
            <td><span class="badge badge-neutral">${esc(t.channel)}</span> ${esc(t.bank_or_network)}</td>
            <td class="num"><strong>${money(t.amount)}</strong></td>
            <td><span class="badge badge-primary">${esc(t.gateway_mode)}</span></td>
            <td>${statusBadge(t.status)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No outbound Paystack transfers sent yet.</td></tr>';
  }

  function populateSettingsForm(data) {
    const s = data.settings;
    if (!s) return;
    document.getElementById('set-name').value = s.school_name || '';
    document.getElementById('set-code').value = s.school_code || '';
    document.getElementById('set-motto').value = s.motto || '';
    document.getElementById('set-email').value = s.email || '';
    document.getElementById('set-phone').value = s.phone || '';
    document.getElementById('set-tz').value = s.timezone || 'Africa/Accra';
    document.getElementById('set-address').value = s.address || '';
    document.getElementById('set-cutoff').value = s.attendance_cutoff_time || '08:30';
    document.getElementById('set-fee-portal').checked = Boolean(s.student_fee_portal_enabled);
    document.getElementById('set-direct-mark-edit').checked = Boolean(
      s.allow_teacher_mark_edit_after_publish
    );
    document.getElementById('set-google-enabled').checked =
      s.google_oauth_enabled === undefined ? true : Boolean(s.google_oauth_enabled);
    document.getElementById('set-google-client-id').value = s.google_client_id || '';
    document.getElementById('set-google-client-secret').value = '';
    document.getElementById('set-google-client-secret').placeholder = s.google_secret_configured
      ? 'Configured (leave blank to keep current secret)'
      : 'Paste Google Cloud Client Secret';

    const gModeBadge = document.getElementById('set-google-mode-badge');
    if (gModeBadge) {
      const gMode = data.googleOAuth?.mode || 'sandbox';
      gModeBadge.textContent =
        gMode === 'live'
          ? 'Live Google OAuth 2.0'
          : gMode === 'sandbox'
            ? 'Interactive OAuth Sandbox'
            : 'Disabled';
    }

    // Paystack Keys & Transaction Policies
    const pskPublicInput = document.getElementById('set-paystack-public-key');
    const pskSecretInput = document.getElementById('set-paystack-secret-key');
    const pskWebhookInput = document.getElementById('set-paystack-webhook-secret');
    const pskClearChk = document.getElementById('set-clear-paystack-secret');
    if (pskPublicInput) pskPublicInput.value = s.paystack_public_key || data.paystack?.publicKey || '';
    if (pskSecretInput) {
      pskSecretInput.value = '';
      pskSecretInput.placeholder = s.paystack_secret_configured
        ? 'Configured (leave blank to keep current Secret Key)'
        : 'sk_live_... or sk_test_...';
    }
    if (pskWebhookInput) {
      pskWebhookInput.value = '';
      pskWebhookInput.placeholder = s.paystack_webhook_secret_configured
        ? 'Configured (leave blank to keep current Webhook Secret)'
        : 'Defaults to Secret Key when blank';
    }
    if (pskClearChk) pskClearChk.checked = false;

    const pskHint = document.getElementById('set-paystack-secret-hint');
    if (pskHint) {
      pskHint.textContent = s.paystack_secret_configured
        ? 'Paystack Secret Key is stored securely and hidden from browser responses. Leave secret fields blank to retain.'
        : 'Enter your Paystack live or test keys above to activate live payment collection, transfers, and reversals.';
    }

    const pskModeBadge = document.getElementById('set-paystack-mode-badge');
    if (pskModeBadge) {
      const pMode = data.paystack?.mode || 'sandbox';
      if (data.paystack?.enabled === false) {
        pskModeBadge.textContent = 'Paystack Disabled';
      } else if (pMode === 'live') {
        pskModeBadge.textContent = 'Live Paystack Keys Active';
      } else if (pMode === 'test') {
        pskModeBadge.textContent = 'Test Paystack Keys Active';
      } else {
        pskModeBadge.textContent = 'Interactive Sandbox Mode';
      }
    }

    const pskRecvChk = document.getElementById('set-psk-receive-enabled');
    const pskSendChk = document.getElementById('set-psk-send-enabled');
    const pskRevChk = document.getElementById('set-psk-reverse-enabled');
    if (pskRecvChk) {
      pskRecvChk.checked = s.paystack_enabled === undefined ? true : Boolean(s.paystack_enabled);
    }
    if (pskSendChk) {
      pskSendChk.checked =
        s.paystack_transfers_enabled === undefined ? true : Boolean(s.paystack_transfers_enabled);
    }
    if (pskRevChk) {
      pskRevChk.checked =
        s.paystack_refunds_enabled === undefined ? true : Boolean(s.paystack_refunds_enabled);
    }

    const cSel = document.getElementById('set-currency-code');
    cSel.innerHTML = (data.currencies || [])
      .map(
        (c) =>
          `<option value="${esc(c.code)}" data-sym="${esc(c.symbol)}" ${c.code === s.currency_code ? 'selected' : ''}>${esc(c.name)} - ${esc(c.symbol)}</option>`
      )
      .join('');
    document.getElementById('set-currency-symbol').value = s.currency_symbol || '';
    cSel.onchange = () => {
      const opt = cSel.options[cSel.selectedIndex];
      if (opt?.dataset.sym) document.getElementById('set-currency-symbol').value = opt.dataset.sym;
    };
  }

  const DEFAULT_SUBJECT_SUGGESTIONS = [
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
    'Financial Accounting',
    'Business Management',
    'Creative Arts & Design',
    'Physical Education',
  ];

  function refreshSubjectSuggestionsDatalist(subjects = []) {
    const dl = document.getElementById('subject-suggestions-list');
    if (!dl) return;
    const seen = new Set();
    const merged = [];
    for (const s of subjects) {
      if (s?.name && !seen.has(s.name.toLowerCase())) {
        seen.add(s.name.toLowerCase());
        merged.push(s.name);
      }
    }
    for (const def of DEFAULT_SUBJECT_SUGGESTIONS) {
      if (!seen.has(def.toLowerCase())) {
        seen.add(def.toLowerCase());
        merged.push(def);
      }
    }
    dl.innerHTML = merged.map((name) => `<option value="${esc(name)}"></option>`).join('');
  }

  // ---------------- MULTI-SUBJECT TEACHER HELPERS ----------------
  function getCheckedValues(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return [];
    return Array.from(el.querySelectorAll('input[type="checkbox"]:checked'))
      .map((cb) => Number(cb.value))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  function getSubjectRowValues(rowsContainerId) {
    const wrap = document.getElementById(rowsContainerId);
    if (!wrap) return [];
    const seen = new Set();
    const out = [];
    wrap.querySelectorAll('input[type="text"]').forEach((inp) => {
      inp.value
        .split(',')
        .map((v) => v.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .forEach((name) => {
          const key = name.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            out.push(name);
          }
        });
    });
    return out;
  }

  function renumberSubjectRows(rowsContainerId) {
    const wrap = document.getElementById(rowsContainerId);
    if (!wrap) return;
    wrap.querySelectorAll('[data-subject-row]').forEach((row, idx) => {
      const lbl = row.querySelector('.subject-row-label');
      if (lbl) lbl.textContent = `Subject ${idx + 1}`;
    });
  }

  function appendSubjectRow(rowsContainerId, inputClass, removeAttr) {
    const wrap = document.getElementById(rowsContainerId);
    if (!wrap) return;
    const nextNum = wrap.querySelectorAll('[data-subject-row]').length + 1;
    const row = document.createElement('div');
    row.className = 'subject-row-item';
    row.setAttribute('data-subject-row', '');
    row.innerHTML = `
      <span class="subject-row-label">Subject ${nextNum}</span>
      <input type="text" class="${inputClass}" list="subject-suggestions-list" placeholder="Enter subject ${nextNum}...">
      <button type="button" class="btn btn-secondary btn-sm" ${removeAttr}>Remove</button>
    `;
    wrap.appendChild(row);
    row.querySelector('input')?.focus();
  }

  function resetSubjectRows(rowsContainerId, inputClass, removeAttr) {
    const wrap = document.getElementById(rowsContainerId);
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="subject-row-item" data-subject-row>
        <span class="subject-row-label">Subject 1</span>
        <input type="text" class="${inputClass}" list="subject-suggestions-list" placeholder="e.g. Mathematics">
      </div>
      <div class="subject-row-item" data-subject-row>
        <span class="subject-row-label">Subject 2</span>
        <input type="text" class="${inputClass}" list="subject-suggestions-list" placeholder="e.g. Physics (optional — leave blank if 1 subject)">
        <button type="button" class="btn btn-secondary btn-sm" ${removeAttr}>Remove</button>
      </div>
    `;
  }

  function updateSubjectCounter(checkboxContainerId, customList, badgeId, rowsContainerId) {
    const badge = document.getElementById(badgeId);
    if (!badge) return;
    const checkedIds = getCheckedValues(checkboxContainerId);
    const catalogue = state.academic?.subjects || [];
    const selectedNames = new Set();
    checkedIds.forEach((id) => {
      const found = catalogue.find((s) => Number(s.id) === Number(id));
      selectedNames.add(found ? found.name.toLowerCase() : `id:${id}`);
    });
    (customList || []).forEach((n) => selectedNames.add(String(n).toLowerCase()));
    if (rowsContainerId) {
      getSubjectRowValues(rowsContainerId).forEach((n) => selectedNames.add(n.toLowerCase()));
    }
    const total = selectedNames.size;
    badge.textContent = `${total} ${total === 1 ? 'subject' : 'subjects'} selected`;
  }

  function renderSubjectCheckPills(containerId, subjects, checkedIds = []) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const checkedSet = new Set(checkedIds.map((v) => Number(v)));
    if (!subjects || !subjects.length) {
      el.innerHTML =
        '<span class="multi-subject-hint">No subjects in school catalogue yet — type subject names below to add and assign them automatically.</span>';
      return;
    }
    el.innerHTML = subjects
      .map(
        (s) => `<label class="subject-check-pill">
          <input type="checkbox" value="${s.id}" ${checkedSet.has(Number(s.id)) ? 'checked' : ''}>
          <span><strong>${esc(s.code)}</strong> &middot; ${esc(s.name)}</span>
        </label>`
      )
      .join('');
  }

  function renderCustomChips(chipsContainerId, customList, chipType) {
    const el = document.getElementById(chipsContainerId);
    if (!el) return;
    el.innerHTML = customList
      .map(
        (name, idx) => `<span class="subject-chip">
          <span>${esc(name)}</span>
          <button type="button" class="subject-chip-remove" data-remove-chip="${chipType}" data-chip-idx="${idx}" aria-label="Remove ${esc(name)}">&times;</button>
        </span>`
      )
      .join('');
  }

  function addCustomSubjectsFromInput(inputId, customList, checkboxContainerId, chipsContainerId, badgeId, chipType) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const raw = input.value.trim();
    if (!raw) return;

    const catalogue = state.academic?.subjects || [];
    const parts = raw
      .split(',')
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const cbContainer = document.getElementById(checkboxContainerId);
    for (const part of parts) {
      const lower = part.toLowerCase();
      const match = catalogue.find(
        (s) => s.name.toLowerCase() === lower || s.code.toLowerCase() === lower
      );
      if (match && cbContainer) {
        const cb = cbContainer.querySelector(`input[type="checkbox"][value="${match.id}"]`);
        if (cb) cb.checked = true;
        continue;
      }
      if (!customList.some((c) => c.toLowerCase() === lower)) {
        customList.push(part);
      }
    }

    input.value = '';
    renderCustomChips(chipsContainerId, customList, chipType);
    updateSubjectCounter(checkboxContainerId, customList, badgeId);
  }

  function syncAssignTeacherSubjectPreselection() {
    const teacherSel = document.getElementById('asg-teacher');
    const teacherId = Number(teacherSel?.value || 0);
    const teachers = state.teachersData?.teachers || [];
    const found = teachers.find((t) => Number(t.id) === teacherId);
    const prechecked = found?.subjectIds?.length ? found.subjectIds : [];
    renderSubjectCheckPills('asg-subjects-checkboxes', state.academic?.subjects || [], prechecked);
    updateSubjectCounter('asg-subjects-checkboxes', [], 'asg-selected-subjects-count');
  }

  // ---------------- ACADEMIC STRUCTURE & TEACHERS ----------------
  async function loadAcademicAndSelectors() {
    const [acad, tData] = await Promise.all([
      api('/api/superadmin/academic'),
      api('/api/superadmin/teachers'),
    ]);
    state.academic = acad;
    state.teachersData = tData;

    const classOpts = acad.classes.length
      ? acad.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
      : '<option value="">Add a Class first</option>';

    const optionalClassOpts =
      '<option value="">Unassigned</option>' +
      acad.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    const streamOpts =
      '<option value="">All / General</option>' +
      acad.streams
        .map((s) => `<option value="${s.id}">${esc(s.class_name)} - ${esc(s.name)}</option>`)
        .join('');

    const subOpts = acad.subjects.length
      ? acad.subjects
          .map((s) => `<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`)
          .join('')
      : '<option value="">Add a Subject first</option>';

    const teacherOpts = tData.teachers.length
      ? tData.teachers
          .map(
            (t) =>
              `<option value="${t.id}">${esc(t.first_name)} ${esc(t.last_name)} (${esc(t.staff_number)})</option>`
          )
          .join('')
      : '<option value="">Register a Teacher first</option>';

    const yearOpts = acad.years.length
      ? acad.years
          .map(
            (y) =>
              `<option value="${y.id}" ${y.is_active ? 'selected' : ''}>${esc(y.name)}${y.is_active ? ' (Active)' : ''}</option>`
          )
          .join('')
      : '<option value="">Add an Academic Year first</option>';

    const termOpts = acad.terms.length
      ? acad.terms
          .map(
            (t) =>
              `<option value="${t.id}" ${t.is_active ? 'selected' : ''}>${esc(t.academic_year_name)} - ${esc(t.name)}${t.is_active ? ' (Active)' : ''}</option>`
          )
          .join('')
      : '<option value="">Add a Term first</option>';

    const stClassEl = document.getElementById('st-class-select');
    if (stClassEl) stClassEl.innerHTML = optionalClassOpts;

    ['asg-class', 'str-class-select', 'tt-class'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = classOpts;
    });
    const ttFilterEl = document.getElementById('tt-filter-class');
    if (ttFilterEl) {
      const prevVal = ttFilterEl.value;
      ttFilterEl.innerHTML =
        '<option value="">All Classes</option>' +
        acad.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      if (prevVal) ttFilterEl.value = prevVal;
    }
    ['st-stream-select', 'asg-stream', 'tt-stream'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = streamOpts;
    });
    ['tt-subject'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = subOpts;
    });
    ['asg-teacher', 'tt-teacher'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = teacherOpts;
    });

    // Populate multi-subject checkboxes on Register Teacher & User Provision forms
    refreshSubjectSuggestionsDatalist(acad.subjects);
    const prevRegChecked = getCheckedValues('tch-reg-subject-checkboxes');
    renderSubjectCheckPills('tch-reg-subject-checkboxes', acad.subjects, prevRegChecked);
    updateSubjectCounter(
      'tch-reg-subject-checkboxes',
      state.regCustomSubjects,
      'tch-selected-subjects-count',
      'tch-subject-rows-list'
    );

    const prevUsrChecked = getCheckedValues('usr-tch-subject-checkboxes');
    renderSubjectCheckPills('usr-tch-subject-checkboxes', acad.subjects, prevUsrChecked);
    updateSubjectCounter('usr-tch-subject-checkboxes', [], 'usr-tch-subjects-count', 'usr-tch-subject-rows');

    // Optional immediate class checkboxes on Register Teacher form
    const regClassesWrap = document.getElementById('tch-reg-class-checkboxes');
    const regClassesGroup = document.getElementById('tch-reg-classes-group');
    if (regClassesWrap) {
      if (acad.classes.length > 0) {
        if (regClassesGroup) regClassesGroup.classList.remove('hidden');
        const prevCls = getCheckedValues('tch-reg-class-checkboxes');
        const clsSet = new Set(prevCls);
        regClassesWrap.innerHTML = acad.classes
          .map(
            (c) => `<label class="subject-check-pill">
              <input type="checkbox" value="${c.id}" ${clsSet.has(Number(c.id)) ? 'checked' : ''}>
              <span>${esc(c.name)}</span>
            </label>`
          )
          .join('');
      } else {
        regClassesWrap.innerHTML =
          '<span class="multi-subject-hint">No classes created yet — you can assign classes later under Class &amp; Subject Assignments.</span>';
      }
    }

    // Populate multi-subject checkboxes on Assign Teacher form
    syncAssignTeacherSubjectPreselection();
    ['act-year-select', 'term-year-select'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = yearOpts;
    });
    const actTerm = document.getElementById('act-term-select');
    if (actTerm) actTerm.innerHTML = termOpts;

    // Years & Terms table
    const yearsTermsBody = document.getElementById('years-terms-tbody');
    if (yearsTermsBody) {
      if (acad.terms.length > 0) {
        yearsTermsBody.innerHTML = acad.terms
          .map(
            (t) => `<tr>
              <td><strong>${esc(t.academic_year_name)}</strong></td>
              <td>${esc(t.name)}</td>
              <td class="tabular">${esc(t.start_date)} to ${esc(t.end_date)}</td>
              <td>${t.is_active ? statusBadge('active') : '<span class="badge badge-neutral">Inactive</span>'}</td>
            </tr>`
          )
          .join('');
      } else if (acad.years.length > 0) {
        yearsTermsBody.innerHTML = acad.years
          .map(
            (y) => `<tr>
              <td><strong>${esc(y.name)}</strong></td>
              <td><small style="color:var(--text-light);">No terms added yet</small></td>
              <td class="tabular">${esc(y.start_date)} to ${esc(y.end_date)}</td>
              <td>${y.is_active ? statusBadge('active') : '<span class="badge badge-neutral">Inactive</span>'}</td>
            </tr>`
          )
          .join('');
      } else {
        yearsTermsBody.innerHTML =
          '<tr><td colspan="4" class="empty-state">No academic years or terms added yet.</td></tr>';
      }
    }

    // Classes table
    const classesBody = document.getElementById('classes-tbody');
    if (classesBody) {
      classesBody.innerHTML =
        acad.classes
          .map(
            (c) => `<tr>
              <td><strong>${esc(c.name)}</strong></td>
              <td class="num">${c.level_order}</td>
              <td class="num">${c.capacity}</td>
              <td>${statusBadge(c.status)}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="4" class="empty-state">No classes created yet.</td></tr>';
    }

    // Streams table
    document.getElementById('streams-tbody').innerHTML =
      acad.streams
        .map(
          (s) =>
            `<tr><td><strong>${esc(s.class_name)}</strong></td><td>${esc(s.name)}</td><td>${esc(s.room_number || '-')}</td><td>${esc(s.class_teacher_name || 'Unassigned')}</td></tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No class streams added yet.</td></tr>';

    // Subjects table
    document.getElementById('subjects-tbody').innerHTML =
      acad.subjects
        .map(
          (sub) =>
            `<tr><td><code>${esc(sub.code)}</code></td><td><strong>${esc(sub.name)}</strong></td><td>${esc(sub.department || '-')}</td><td class="num">${sub.pass_mark}%</td></tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No subjects in catalogue yet.</td></tr>';

    // Registered Teachers Directory
    const teachersListBody = document.getElementById('teachers-list-tbody');
    if (teachersListBody) {
      teachersListBody.innerHTML =
        tData.teachers
          .map((t) => {
            const subBadges =
              t.subjects && t.subjects.length
                ? `<div class="subject-badges-wrap">${t.subjects
                    .map(
                      (s) =>
                        `<span class="subject-badge-tag"><strong>${esc(s.code)}</strong> &middot; ${esc(s.name)}</span>`
                    )
                    .join('')}</div>`
                : t.specialization
                  ? `<span style="color:var(--text-muted);font-size:12.5px;">${esc(t.specialization)}</span>`
                  : '<span class="multi-subject-hint">No subjects linked</span>';
            return `<tr>
              <td><code>${esc(t.staff_number)}</code></td>
              <td><strong>${esc(t.first_name)} ${esc(t.last_name)}</strong><br><small style="color:var(--text-light);">${esc(t.qualification || '')}</small></td>
              <td>${esc(t.email)}</td>
              <td>${esc(t.department || '-')}</td>
              <td>${subBadges}</td>
              <td>${statusBadge(t.user_status || t.status)}</td>
              <td>
                <button type="button" class="btn btn-secondary btn-sm" data-edit-tch-subjects="${t.id}">Edit Subjects</button>
              </td>
            </tr>`;
          })
          .join('') || '<tr><td colspan="7" class="empty-state">No teachers registered yet.</td></tr>';
    }

    // Teacher Subject Assignments
    document.getElementById('teacher-assignments-tbody').innerHTML =
      tData.assignments
        .map(
          (a) => `<tr>
            <td><code>${esc(a.staff_number)}</code></td>
            <td>${esc(a.first_name)} ${esc(a.last_name)}</td>
            <td>${esc(a.class_name)}${a.stream_name ? ' - ' + esc(a.stream_name) : ''}</td>
            <td>${esc(a.subject_code)} - ${esc(a.subject_name)}</td>
            <td>${esc(a.academic_year_name)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty-state">No class or subject assignments yet.</td></tr>';
  }

  // ---------------- USERS, STUDENTS, EXAMS, REPORTS, AUDIT, BACKUPS ----------------
  async function loadUsers() {
    const search = document.getElementById('users-search').value.trim();
    const role = document.getElementById('users-role-filter').value;
    const data = await api(
      `/api/superadmin/users?search=${encodeURIComponent(search)}&role=${encodeURIComponent(role)}`
    );
    document.getElementById('users-tbody').innerHTML =
      data.items
        .map(
          (u) => `<tr>
            <td><strong>${esc(u.full_name)}</strong></td>
            <td>${esc(u.email)}<br><small style="color:var(--text-light)">@${esc(u.username)}</small></td>
            <td>
              <select data-user-role="${u.id}" style="width:auto;padding:4px 8px;font-size:12px;">
                ${['superadmin', 'teacher', 'student', 'financial']
                  .map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`)
                  .join('')}
              </select>
            </td>
            <td><span class="badge badge-neutral">${esc(u.auth_provider)}${u.google_linked ? ' + Google' : ''}</span></td>
            <td>
              ${statusBadge(u.status)}
              ${u.is_locked ? ' ' + statusBadge('locked') : ''}
            </td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" data-save-user="${u.id}" type="button">Save Role</button>
                <button class="btn ${u.status === 'active' ? 'btn-danger' : 'btn-success'} btn-sm" data-toggle-user="${u.id}" data-next-status="${u.status === 'active' ? 'suspended' : 'active'}" type="button">
                  ${u.status === 'active' ? 'Suspend' : 'Activate'}
                </button>
                <button class="btn btn-secondary btn-sm" data-unlock-user="${u.id}" type="button" title="Clear lockout and sign out active sessions">
                  ${u.is_locked ? 'Unlock' : 'Revoke Sessions'}
                </button>
              </div>
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty-state">No matching user accounts.</td></tr>';
  }

  async function loadStudentRequests() {
    const status = document.getElementById('stu-req-status-filter').value;
    const data = await api(`/api/superadmin/student-requests?status=${encodeURIComponent(status)}`);
    const classes = state.academic?.classes || [];

    document.getElementById('student-requests-tbody').innerHTML =
      (data.items || [])
        .map((r) => {
          const isPending = r.status === 'pending';
          const classCell = isPending
            ? `<select data-srr-class="${r.id}" style="padding:4px 8px;font-size:12px;">
                 <option value="">Assign Class</option>
                 ${classes
                   .map(
                     (c) =>
                       `<option value="${c.id}" ${Number(r.requested_class_id) === Number(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`
                   )
                   .join('')}
               </select>`
            : esc(r.requested_class_name || 'Unassigned');

          const admCell = isPending
            ? `<input type="text" data-srr-adm="${r.id}" placeholder="Auto ADM-YYYY-NNN" style="padding:4px 8px;font-size:12px;max-width:145px;">`
            : r.admission_number
              ? `<code>${esc(r.admission_number)}</code>`
              : '-';

          const decisionCell = isPending
            ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">
                 <button type="button" class="btn btn-success btn-sm" data-accept-srr="${r.id}">Accept</button>
                 <button type="button" class="btn btn-danger btn-sm" data-reject-srr="${r.id}">Reject</button>
               </div>`
            : `<small style="color:var(--text-light);">${esc(r.reviewer_name || 'Admin')}${r.review_note ? ': ' + esc(r.review_note) : ''}</small>`;

          return `<tr>
            <td class="tabular">${esc(String(r.created_at || '').slice(0, 16))}</td>
            <td>
              <strong>${esc(r.first_name)} ${esc(r.last_name)}</strong>
              ${r.auth_provider === 'google' ? '<span class="badge badge-primary" style="margin-left:4px;">Google</span>' : ''}
              <br><small style="color:var(--text-light);">${esc(r.gender || '-')}</small>
            </td>
            <td>${esc(r.email)}<br><small style="color:var(--text-light);">${esc(r.guardian_phone || r.phone || '')}</small></td>
            <td>${classCell}</td>
            <td>${admCell}</td>
            <td>${statusBadge(r.status)}</td>
            <td>${decisionCell}</td>
          </tr>`;
        })
        .join('') ||
      '<tr><td colspan="7" class="empty-state">No student join proposals matching this filter.</td></tr>';
  }

  async function loadStudents() {
    const search = document.getElementById('students-search').value.trim();
    const data = await api(`/api/superadmin/students?search=${encodeURIComponent(search)}`);
    document.getElementById('students-tbody').innerHTML =
      data.items
        .map(
          (s) => `<tr>
            <td><code>${esc(s.admission_number)}</code></td>
            <td><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong></td>
            <td>${esc(s.gender || '-')}</td>
            <td>${esc(s.class_name || 'Unassigned')}${s.stream_name ? ' - ' + esc(s.stream_name) : ''}</td>
            <td>${esc(s.guardian_name || '-')}<br><small style="color:var(--text-light);">${esc(s.guardian_phone || '')}</small></td>
            <td>${esc(s.email)}</td>
            <td>${statusBadge(s.status)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No students enrolled yet.</td></tr>';
  }

  async function loadTimetables() {
    const classId = document.getElementById('tt-filter-class')?.value || '';
    const qs = classId ? `?classId=${encodeURIComponent(classId)}` : '';
    const data = await api(`/api/superadmin/timetables${qs}`);
    SMS.renderTimetableMatrix('tt-matrix-container', data.items || [], {
      showClass: !classId,
      showTeacher: true,
      emptyMessage: classId
        ? 'No timetable slots scheduled for the selected class yet.'
        : 'No timetable slots scheduled yet. Use the form above to add your first lesson slot.',
    });
  }

  async function loadAttendanceOverview() {
    const data = await api('/api/superadmin/attendance');
    document.getElementById('att-overview-tbody').innerHTML =
      data.sessions
        .map(
          (s) => `<tr>
            <td class="tabular">${esc(s.session_date)}</td>
            <td>${esc(s.class_name)}${s.stream_name ? ' - ' + esc(s.stream_name) : ''}</td>
            <td>${esc(s.subject_name || 'Homeroom')}</td>
            <td>${esc(s.taken_by_name || '-')}</td>
            <td class="num">${s.present_count || 0}</td>
            <td class="num">${s.late_count || 0}</td>
            <td class="num">${s.absent_count || 0}</td>
            <td>${statusBadge(s.status)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="8" class="empty-state">No attendance sessions submitted yet.</td></tr>';
  }

  async function loadExams() {
    const data = await api('/api/superadmin/exams');
    document.getElementById('exams-tbody').innerHTML =
      data.assessments
        .map(
          (a) => `<tr>
            <td><strong>${esc(a.title)}</strong></td>
            <td><span class="badge badge-neutral">${esc(a.assessment_type)}</span></td>
            <td>${esc(a.class_name)} - ${esc(a.subject_name)}</td>
            <td>${esc(a.term_name)}</td>
            <td class="num">${a.marks_count}</td>
            <td>${statusBadge(a.is_published ? 'published' : 'draft')}</td>
            <td>
              <button class="btn ${a.is_published ? 'btn-secondary' : 'btn-primary'} btn-sm" type="button" data-pub-assess="${a.id}" data-next-pub="${a.is_published ? '0' : '1'}">
                ${a.is_published ? 'Unpublish' : 'Publish to Students'}
              </button>
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No assessments created yet.</td></tr>';

    document.getElementById('mark-corr-tbody').innerHTML =
      data.correctionRequests
        .map(
          (r) => `<tr>
            <td><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong><br><small>${esc(r.subject_name)} - ${esc(r.assessment_title)}</small></td>
            <td class="tabular">${r.previous_score} to <strong>${r.proposed_score}</strong></td>
            <td>${esc(r.reason)}<br><small>By ${esc(r.requested_by_name)}</small></td>
            <td>${statusBadge(r.status)}</td>
            <td>
              ${
                r.status === 'pending'
                  ? `<button class="btn btn-success btn-sm" type="button" data-corr-id="${r.id}" data-decision="approved">Approve</button>
                     <button class="btn btn-danger btn-sm" type="button" data-corr-id="${r.id}" data-decision="rejected">Reject</button>`
                  : '-'
              }
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty-state">No mark correction requests.</td></tr>';

    document.getElementById('prof-req-tbody').innerHTML =
      data.profileRequests
        .map(
          (p) => `<tr>
            <td>${esc(p.requester_name)}</td>
            <td><code>${esc(p.field_name)}</code></td>
            <td>${esc(p.current_value)} to <strong>${esc(p.requested_value)}</strong></td>
            <td>${statusBadge(p.status)}</td>
            <td>
              ${
                p.status === 'pending'
                  ? `<button class="btn btn-success btn-sm" type="button" data-prof-id="${p.id}" data-decision="approved">Approve</button>
                     <button class="btn btn-danger btn-sm" type="button" data-prof-id="${p.id}" data-decision="rejected">Reject</button>`
                  : '-'
              }
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty-state">No profile requests.</td></tr>';

    document.getElementById('grading-tbody').innerHTML =
      data.gradingScales
        .map(
          (g) => `<tr>
            <td><strong>${esc(g.grade)}</strong></td>
            <td class="num">${g.min_score}%</td>
            <td class="num">${g.max_score}%</td>
            <td class="num">${g.grade_point}</td>
            <td>${esc(g.remark || '-')}</td>
            <td><button type="button" class="btn btn-danger btn-sm" data-del-grade="${g.id}">Remove</button></td>
          </tr>`
        )
        .join('') ||
      '<tr><td colspan="6" class="empty-state">No grading bands added yet. Define your school grading scale on the left.</td></tr>';
  }

  async function loadReports() {
    const data = await api('/api/superadmin/reports');
    state.reportsData = data;
    const attMap = new Map(data.classAttendance.map((a) => [a.class_name, a]));
    const feeMap = new Map(data.feeByClass.map((f) => [f.class_name, f]));

    document.getElementById('school-reports-tbody').innerHTML =
      data.classPerformance
        .map((cp) => {
          const att = attMap.get(cp.class_name) || {};
          const fee = feeMap.get(cp.class_name) || {};
          const attRate =
            Number(att.total_entries || 0) > 0
              ? `${Math.round((Number(att.attended_entries || 0) / Number(att.total_entries)) * 100)}%`
              : 'N/A';
          return `<tr>
            <td><strong>${esc(cp.class_name)}</strong></td>
            <td class="num">${cp.students_assessed || 0}</td>
            <td class="num">${cp.avg_percentage !== null ? cp.avg_percentage + '%' : 'N/A'}</td>
            <td class="num">${attRate}</td>
            <td class="num">${money(fee.net_billed || 0)}</td>
            <td class="num">${money(fee.collected || 0)}</td>
          </tr>`;
        })
        .join('') || '<tr><td colspan="6" class="empty-state">No class data available for reports yet.</td></tr>';
  }

  async function loadAudits() {
    const search = document.getElementById('audit-search').value.trim();
    const role = document.getElementById('audit-role-filter').value;
    const data = await api(
      `/api/superadmin/audit-logs?search=${encodeURIComponent(search)}&role=${encodeURIComponent(role)}`
    );
    document.getElementById('audit-tbody').innerHTML =
      data.items
        .map(
          (a) => `<tr>
            <td class="tabular">${esc(a.created_at)}</td>
            <td>${esc(a.actor_name || 'System')}</td>
            <td><span class="badge badge-neutral">${esc(a.actor_role || 'system')}</span></td>
            <td><code>${esc(a.action)}</code></td>
            <td>${esc(a.target_type)} ${esc(a.target_id)}</td>
            <td><small style="color:var(--text-light)">${esc(a.metadata_json || '')}</small></td>
          </tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty-state">No audit log entries yet.</td></tr>';
  }

  async function loadBackups() {
    const data = await api('/api/superadmin/backups');
    document.getElementById('backup-health-banner').textContent =
      `Database Connection: ${data.health.connected ? 'HEALTHY' : 'OFFLINE'} | Active Engine: ${String(data.health.driver || 'SQL').toUpperCase()} | Verified Redaction Enabled`;
    document.getElementById('backups-tbody').innerHTML =
      data.backups
        .map(
          (b) => `<tr>
            <td class="tabular">${esc(b.created_at)}</td>
            <td><code>${esc(b.filename)}</code></td>
            <td class="num">${b.tables_count}</td>
            <td class="num">${b.total_rows}</td>
            <td class="num">${(Number(b.size_bytes) / 1024).toFixed(1)} KB</td>
            <td>${statusBadge(b.status)}</td>
            <td><a class="btn btn-secondary btn-sm" href="${SMS.esc(SMS.withNavSession('/api/superadmin/backups/' + encodeURIComponent(b.filename)))}">Download</a></td>
          </tr>`
        )
        .join('') ||
      '<tr><td colspan="7" class="empty-state">No snapshots generated yet. Click "Create Verified Snapshot".</td></tr>';
  }

  SMS.initNavigation(onSectionLoad);

  SMS.bindCurrencySelect('header-currency-select', '/api/superadmin/settings/currency', async () => {
    await loadOverview();
    if (!document.getElementById('sec-finance').classList.contains('hidden')) await loadFinancialGovernance();
    if (!document.getElementById('sec-reports').classList.contains('hidden')) await loadReports();
  });

  // ---------------- FINANCIAL HANDLERS ----------------
  document.getElementById('adm-fin-config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.paystackEnabled = document.getElementById('adm-psk-enabled').checked;
    try {
      await api('/api/superadmin/finance/stats-config', { method: 'PUT', body: fd });
      toast('Financial stats, targets & Paystack settings updated.', 'success');
      await loadFinancialGovernance();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('reset-fin-adj-btn').addEventListener('click', async () => {
    try {
      await api('/api/superadmin/finance/stats-config', {
        method: 'PUT',
        body: {
          termRevenueTarget: document.getElementById('adm-fin-target').value || 0,
          openingBalanceAdjustment: 0,
          billedStatAdjustment: 0,
          collectedStatAdjustment: 0,
          paystackEnabled: document.getElementById('adm-psk-enabled').checked,
          paystackChannels: document.getElementById('adm-psk-channels').value,
        },
      });
      toast('Financial stat adjustments reset to pure ledger values.', 'success');
      await loadFinancialGovernance();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('adm-create-fee-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/financial/categories', { method: 'POST', body: fd });
      e.target.reset();
      toast('Fee category created.', 'success');
      await loadFinancialGovernance();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('adm-assign-fee-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.academicYearId = state.overview?.activeYear?.id;
    fd.termId = state.overview?.activeTerm?.id;
    if (!fd.classId && !fd.studentId) {
      toast('Select either a Target Class or an Individual Student.', 'error');
      return;
    }
    try {
      const res = await api('/api/financial/assignments', { method: 'POST', body: fd });
      e.target.reset();
      toast(`Fee assigned (${res.assignedCount || 1} student record(s) billed).`, 'success');
      await loadFinancialGovernance();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('adm-psk-pay-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/paystack/initialize', { method: 'POST', body: fd });
      openPaystackCheckout(res.transaction, {
        verifyEndpoint: '/api/financial/paystack/verify',
        abandonEndpoint: '/api/financial/paystack/abandon',
        onSuccess: async () => {
          e.target.reset();
          await loadFinancialGovernance();
          await loadOverview();
        },
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('sec-finance').addEventListener('click', async (e) => {
    const saveCatBtn = e.target.closest('[data-save-cat]');
    if (saveCatBtn) {
      const cid = saveCatBtn.dataset.saveCat;
      const tr = document.querySelector(`[data-cat-row="${cid}"]`);
      try {
        await api(`/api/financial/categories/${cid}`, {
          method: 'PATCH',
          body: {
            name: tr.querySelector('.adm-cat-name').value,
            defaultAmount: tr.querySelector('.adm-cat-amt').value,
            status: tr.querySelector('.adm-cat-status').value,
          },
        });
        toast('Fee category updated.', 'success');
        await loadFinancialGovernance();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    const saveFaBtn = e.target.closest('[data-save-fa]');
    if (saveFaBtn) {
      const fid = saveFaBtn.dataset.saveFa;
      const tr = document.querySelector(`[data-fa-row="${fid}"]`);
      try {
        await api(`/api/superadmin/finance/assignments/${fid}`, {
          method: 'PATCH',
          body: {
            amountDue: tr.querySelector('.adm-fa-due').value,
            discountAmount: tr.querySelector('.adm-fa-disc').value,
          },
        });
        toast('Fee assignment updated.', 'success');
        await loadFinancialGovernance();
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    const delFaBtn = e.target.closest('[data-del-fa]');
    if (delFaBtn) {
      if (!confirm('Void and delete this unpaid fee assignment?')) return;
      try {
        await api(`/api/superadmin/finance/assignments/${delFaBtn.dataset.delFa}`, {
          method: 'DELETE',
        });
        toast('Unpaid fee assignment voided.', 'success');
        await loadFinancialGovernance();
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    const revPayBtn = e.target.closest('[data-rev-pay]');
    if (revPayBtn) {
      const reason = prompt('Enter mandatory audit reason for reversing this payment:');
      if (!reason || reason.trim().length < 4) {
        toast('A clear reversal reason (min 4 characters) is required.', 'error');
        return;
      }
      try {
        await api(`/api/superadmin/finance/payments/${revPayBtn.dataset.revPay}/reverse`, {
          method: 'POST',
          body: { reason: reason.trim() },
        });
        toast('Payment reversed and financial stats updated.', 'success');
        await loadFinancialGovernance();
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // ---------------- ISSUED CREDENTIALS HELPER ----------------
  function renderIssuedCredentials(containerId, creds) {
    const box = document.getElementById(containerId);
    if (!box || !creds) return;
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
        <div>
          <strong>Issued Login Credentials (Share Directly With ${esc(creds.fullName)})</strong>
          <div style="margin-top:6px;font-size:12.5px;line-height:1.6;">
            Role: <code>${esc(creds.role)}</code> |
            Email: <code>${esc(creds.email)}</code> |
            Username: <code>${esc(creds.username)}</code> |
            Initial Password: <code>${esc(creds.initialPassword)}</code>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-dismiss-creds="${containerId}">Dismiss</button>
      </div>
    `;
    box.classList.remove('hidden');
  }

  document.addEventListener('click', (e) => {
    const dismissBtn = e.target.closest('[data-dismiss-creds]');
    if (dismissBtn) {
      const box = document.getElementById(dismissBtn.dataset.dismissCreds);
      if (box) {
        box.innerHTML = '';
        box.classList.add('hidden');
      }
    }
  });

  // ---------------- USERS, STUDENTS, TEACHERS & ACADEMIC FORMS ----------------
  document.getElementById('users-filter-btn').addEventListener('click', loadUsers);
  document.getElementById('stu-req-filter-btn').addEventListener('click', loadStudentRequests);
  document.getElementById('stu-req-status-filter').addEventListener('change', loadStudentRequests);
  document.getElementById('students-search-btn').addEventListener('click', loadStudents);
  document.getElementById('audit-filter-btn').addEventListener('click', loadAudits);

  document.getElementById('student-requests-tbody').addEventListener('click', async (e) => {
    const acceptBtn = e.target.closest('[data-accept-srr]');
    if (acceptBtn) {
      const id = acceptBtn.dataset.acceptSrr;
      const clsEl = document.querySelector(`[data-srr-class="${id}"]`);
      const admEl = document.querySelector(`[data-srr-adm="${id}"]`);
      try {
        const res = await api(`/api/superadmin/student-requests/${id}/review`, {
          method: 'POST',
          body: {
            decision: 'approved',
            classId: clsEl ? clsEl.value || null : null,
            admissionNumber: admEl ? admEl.value.trim() : '',
          },
        });
        toast(res.message, 'success');
        await loadStudentRequests();
        await loadStudents();
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }

    const rejectBtn = e.target.closest('[data-reject-srr]');
    if (rejectBtn) {
      const id = rejectBtn.dataset.rejectSrr;
      const note =
        prompt('Optional note/reason for rejecting this student join proposal:', '') ?? null;
      if (note === null) return;
      try {
        const res = await api(`/api/superadmin/student-requests/${id}/review`, {
          method: 'POST',
          body: { decision: 'rejected', reviewNote: note.trim() },
        });
        toast(res.message, 'info');
        await loadStudentRequests();
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // Toggle teacher multi-subject fields on Provision Staff & Portal Account form
  const usrRoleSelect = document.getElementById('usr-provision-role');
  const usrTeacherExtra = document.getElementById('usr-teacher-extra-fields');
  usrRoleSelect?.addEventListener('change', () => {
    usrTeacherExtra?.classList.toggle('hidden', usrRoleSelect.value !== 'teacher');
  });

  document.getElementById('btn-add-usr-subject-row')?.addEventListener('click', () => {
    appendSubjectRow('usr-tch-subject-rows', 'usr-tch-subject-row-input', 'data-remove-usr-subject-row');
  });

  document.getElementById('usr-tch-subject-rows')?.addEventListener('input', () => {
    updateSubjectCounter('usr-tch-subject-checkboxes', [], 'usr-tch-subjects-count', 'usr-tch-subject-rows');
  });

  document.getElementById('usr-tch-subject-checkboxes')?.addEventListener('change', () => {
    updateSubjectCounter('usr-tch-subject-checkboxes', [], 'usr-tch-subjects-count', 'usr-tch-subject-rows');
  });

  document.getElementById('usr-tch-subject-rows')?.addEventListener('click', (e) => {
    const rmBtn = e.target.closest('[data-remove-usr-subject-row]');
    if (rmBtn) {
      rmBtn.closest('[data-subject-row]')?.remove();
      renumberSubjectRows('usr-tch-subject-rows');
      updateSubjectCounter('usr-tch-subject-checkboxes', [], 'usr-tch-subjects-count', 'usr-tch-subject-rows');
    }
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
      usrTeacherExtra?.classList.add('hidden');
      resetSubjectRows('usr-tch-subject-rows', 'usr-tch-subject-row-input', 'data-remove-usr-subject-row');
      renderIssuedCredentials('issued-user-creds-box', res.issuedCredentials);
      toast('Account created. Copy and share the issued login credentials.', 'success');
      await loadUsers();
      await loadAcademicAndSelectors();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('users-tbody').addEventListener('click', async (e) => {
    const saveBtn = e.target.closest('[data-save-user]');
    if (saveBtn) {
      const uid = saveBtn.dataset.saveUser;
      const role = document.querySelector(`[data-user-role="${uid}"]`).value;
      try {
        await api(`/api/superadmin/users/${uid}`, { method: 'PATCH', body: { role } });
        toast('Role updated.', 'success');
        await loadUsers();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    const togBtn = e.target.closest('[data-toggle-user]');
    if (togBtn) {
      const uid = togBtn.dataset.toggleUser;
      const status = togBtn.dataset.nextStatus;
      try {
        await api(`/api/superadmin/users/${uid}`, { method: 'PATCH', body: { status } });
        toast(`Account ${status}.`, 'success');
        await loadUsers();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    const unlockBtn = e.target.closest('[data-unlock-user]');
    if (unlockBtn) {
      const uid = unlockBtn.dataset.unlockUser;
      try {
        const res = await api(`/api/superadmin/users/${uid}/unlock`, { method: 'POST' });
        toast(res.message, 'success');
        await loadUsers();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  document.getElementById('enrol-student-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.academicYearId = state.overview?.activeYear?.id;
    fd.termId = state.overview?.activeTerm?.id;
    try {
      const res = await api('/api/superadmin/students', { method: 'POST', body: fd });
      e.target.reset();
      if (res.issuedCredentials) {
        renderIssuedCredentials('issued-student-creds-box', res.issuedCredentials);
      }
      toast('Student enrolled. Copy and share the issued login credentials.', 'success');
      await loadStudents();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Multi-subject interactive listeners (Register Teacher, Edit Subjects, Assign Teacher)
  document.getElementById('tch-reg-subject-checkboxes')?.addEventListener('change', () => {
    updateSubjectCounter(
      'tch-reg-subject-checkboxes',
      state.regCustomSubjects,
      'tch-selected-subjects-count',
      'tch-subject-rows-list'
    );
  });

  document.getElementById('tch-subject-rows-list')?.addEventListener('input', () => {
    updateSubjectCounter(
      'tch-reg-subject-checkboxes',
      state.regCustomSubjects,
      'tch-selected-subjects-count',
      'tch-subject-rows-list'
    );
  });

  document.getElementById('btn-add-tch-subject-row')?.addEventListener('click', () => {
    appendSubjectRow('tch-subject-rows-list', 'tch-subject-row-input', 'data-remove-subject-row');
  });

  document.getElementById('btn-add-tch-subject')?.addEventListener('click', () => {
    addCustomSubjectsFromInput(
      'tch-custom-subject-input',
      state.regCustomSubjects,
      'tch-reg-subject-checkboxes',
      'tch-custom-subject-chips',
      'tch-selected-subjects-count',
      'reg'
    );
    updateSubjectCounter(
      'tch-reg-subject-checkboxes',
      state.regCustomSubjects,
      'tch-selected-subjects-count',
      'tch-subject-rows-list'
    );
  });

  document.getElementById('tch-custom-subject-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomSubjectsFromInput(
        'tch-custom-subject-input',
        state.regCustomSubjects,
        'tch-reg-subject-checkboxes',
        'tch-custom-subject-chips',
        'tch-selected-subjects-count',
        'reg'
      );
      updateSubjectCounter(
        'tch-reg-subject-checkboxes',
        state.regCustomSubjects,
        'tch-selected-subjects-count',
        'tch-subject-rows-list'
      );
    }
  });

  document.getElementById('edit-tch-subject-checkboxes')?.addEventListener('change', () => {
    updateSubjectCounter('edit-tch-subject-checkboxes', state.editCustomSubjects, 'edit-tch-subjects-count');
  });

  document.getElementById('btn-add-edit-tch-subject')?.addEventListener('click', () => {
    addCustomSubjectsFromInput(
      'edit-tch-custom-subject-input',
      state.editCustomSubjects,
      'edit-tch-subject-checkboxes',
      'edit-tch-custom-subject-chips',
      'edit-tch-subjects-count',
      'edit'
    );
  });

  document.getElementById('edit-tch-custom-subject-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCustomSubjectsFromInput(
        'edit-tch-custom-subject-input',
        state.editCustomSubjects,
        'edit-tch-subject-checkboxes',
        'edit-tch-custom-subject-chips',
        'edit-tch-subjects-count',
        'edit'
      );
    }
  });

  document.getElementById('asg-teacher')?.addEventListener('change', () => {
    syncAssignTeacherSubjectPreselection();
  });

  document.getElementById('asg-subjects-checkboxes')?.addEventListener('change', () => {
    updateSubjectCounter('asg-subjects-checkboxes', [], 'asg-selected-subjects-count');
  });

  document.getElementById('sec-teachers')?.addEventListener('click', (e) => {
    const rmRowBtn = e.target.closest('[data-remove-subject-row]');
    if (rmRowBtn) {
      rmRowBtn.closest('[data-subject-row]')?.remove();
      renumberSubjectRows('tch-subject-rows-list');
      updateSubjectCounter(
        'tch-reg-subject-checkboxes',
        state.regCustomSubjects,
        'tch-selected-subjects-count',
        'tch-subject-rows-list'
      );
      return;
    }

    const rmChip = e.target.closest('[data-remove-chip]');
    if (rmChip) {
      const idx = Number(rmChip.dataset.chipIdx);
      if (rmChip.dataset.removeChip === 'reg') {
        state.regCustomSubjects.splice(idx, 1);
        renderCustomChips('tch-custom-subject-chips', state.regCustomSubjects, 'reg');
        updateSubjectCounter(
          'tch-reg-subject-checkboxes',
          state.regCustomSubjects,
          'tch-selected-subjects-count',
          'tch-subject-rows-list'
        );
      } else if (rmChip.dataset.removeChip === 'edit') {
        state.editCustomSubjects.splice(idx, 1);
        renderCustomChips('edit-tch-custom-subject-chips', state.editCustomSubjects, 'edit');
        updateSubjectCounter('edit-tch-subject-checkboxes', state.editCustomSubjects, 'edit-tch-subjects-count');
      }
      return;
    }

    const editBtn = e.target.closest('[data-edit-tch-subjects]');
    if (editBtn) {
      const tid = Number(editBtn.dataset.editTchSubjects);
      const teacher = (state.teachersData?.teachers || []).find((t) => Number(t.id) === tid);
      if (!teacher) return;
      state.editingTeacherId = tid;
      state.editCustomSubjects = [];
      document.getElementById('edit-tch-id').value = String(tid);
      document.getElementById('edit-teacher-subjects-title').textContent = `Update Subjects Taught — ${teacher.first_name} ${teacher.last_name} (${teacher.staff_number})`;
      renderSubjectCheckPills(
        'edit-tch-subject-checkboxes',
        state.academic?.subjects || [],
        teacher.subjectIds || []
      );
      renderCustomChips('edit-tch-custom-subject-chips', state.editCustomSubjects, 'edit');
      updateSubjectCounter('edit-tch-subject-checkboxes', state.editCustomSubjects, 'edit-tch-subjects-count');
      const card = document.getElementById('edit-teacher-subjects-card');
      card.classList.remove('hidden');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });

  document.getElementById('btn-cancel-edit-teacher-subjects')?.addEventListener('click', () => {
    document.getElementById('edit-teacher-subjects-card')?.classList.add('hidden');
    state.editingTeacherId = null;
    state.editCustomSubjects = [];
  });

  document.getElementById('edit-teacher-subjects-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    addCustomSubjectsFromInput(
      'edit-tch-custom-subject-input',
      state.editCustomSubjects,
      'edit-tch-subject-checkboxes',
      'edit-tch-custom-subject-chips',
      'edit-tch-subjects-count',
      'edit'
    );
    const tid = Number(document.getElementById('edit-tch-id').value);
    const subjectIds = getCheckedValues('edit-tch-subject-checkboxes');
    const customSubjects = [...state.editCustomSubjects];
    try {
      await api(`/api/superadmin/teachers/${tid}/subjects`, {
        method: 'PUT',
        body: { subjectIds, customSubjects },
      });
      state.editCustomSubjects = [];
      document.getElementById('edit-teacher-subjects-card')?.classList.add('hidden');
      toast('Teacher subjects updated.', 'success');
      await loadAcademicAndSelectors();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('create-teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    // Capture any typed subjects still sitting in the quick-add box or Subject 1..N rows
    addCustomSubjectsFromInput(
      'tch-custom-subject-input',
      state.regCustomSubjects,
      'tch-reg-subject-checkboxes',
      'tch-custom-subject-chips',
      'tch-selected-subjects-count',
      'reg'
    );
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const rowSubjects = getSubjectRowValues('tch-subject-rows-list');
    const mergedCustom = Array.from(new Set([...rowSubjects, ...state.regCustomSubjects]));
    fd.subjectIds = getCheckedValues('tch-reg-subject-checkboxes');
    fd.customSubjects = mergedCustom;
    fd.classIds = getCheckedValues('tch-reg-class-checkboxes');
    try {
      const res = await api('/api/superadmin/teachers', { method: 'POST', body: fd });
      e.target.reset();
      state.regCustomSubjects = [];
      resetSubjectRows('tch-subject-rows-list', 'tch-subject-row-input', 'data-remove-subject-row');
      renderCustomChips('tch-custom-subject-chips', state.regCustomSubjects, 'reg');
      renderIssuedCredentials('issued-teacher-creds-box', res.issuedCredentials);
      const subCount = Array.isArray(res.subjects) ? res.subjects.length : 0;
      toast(
        subCount > 0
          ? `Teacher registered with ${subCount} ${subCount === 1 ? 'subject' : 'subjects'}. Share the issued login credentials.`
          : 'Teacher registered. Copy and share the issued login credentials.',
        'success'
      );
      await loadAcademicAndSelectors();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('assign-teacher-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    const subjectIds = getCheckedValues('asg-subjects-checkboxes');
    if (!subjectIds.length) {
      toast('Please select at least one subject to assign.', 'error');
      return;
    }
    fd.subjectIds = subjectIds;
    fd.academicYearId = state.overview?.activeYear?.id;
    fd.termId = state.overview?.activeTerm?.id;
    try {
      const res = await api('/api/superadmin/teachers/assign', { method: 'POST', body: fd });
      const count = res.assignedCount || subjectIds.length;
      toast(
        `Assigned ${count} ${count === 1 ? 'subject' : 'subjects'} to teacher for the selected class.`,
        'success'
      );
      await loadAcademicAndSelectors();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('activate-period-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/academic/activate', { method: 'POST', body: fd });
      toast('Active academic period updated.', 'success');
      await loadOverview();
      await loadAcademicAndSelectors();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('create-year-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/academic/years', { method: 'POST', body: fd });
      e.target.reset();
      toast('Academic year created.', 'success');
      await loadOverview();
      await loadAcademicAndSelectors();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('create-term-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/academic/terms', { method: 'POST', body: fd });
      e.target.reset();
      toast('Term created.', 'success');
      await loadOverview();
      await loadAcademicAndSelectors();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('create-class-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/academic/classes', { method: 'POST', body: fd });
      e.target.reset();
      toast('Class created.', 'success');
      await loadAcademicAndSelectors();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('create-stream-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/academic/streams', { method: 'POST', body: fd });
      e.target.reset();
      toast('Stream added.', 'success');
      await loadAcademicAndSelectors();
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
      toast('Subject added to catalogue.', 'success');
      await loadAcademicAndSelectors();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('create-tt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.academicYearId = state.overview?.activeYear?.id;
    fd.termId = state.overview?.activeTerm?.id;
    try {
      await api('/api/superadmin/timetables', { method: 'POST', body: fd });
      toast('Timetable slot scheduled.', 'success');
      await loadTimetables();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // ---------------- EXAMS & GRADING HANDLERS ----------------
  document.getElementById('create-grade-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/superadmin/exams/grading-scales', { method: 'POST', body: fd });
      e.target.reset();
      toast('Grade band added.', 'success');
      await loadExams();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('sec-exams').addEventListener('click', async (e) => {
    const pubBtn = e.target.closest('[data-pub-assess]');
    if (pubBtn) {
      try {
        await api(`/api/superadmin/exams/assessments/${pubBtn.dataset.pubAssess}/publish`, {
          method: 'PATCH',
          body: { isPublished: pubBtn.dataset.nextPub === '1' },
        });
        toast('Publication status updated.', 'success');
        await loadExams();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    const corrBtn = e.target.closest('[data-corr-id]');
    if (corrBtn) {
      try {
        await api(`/api/superadmin/exams/corrections/${corrBtn.dataset.corrId}/review`, {
          method: 'POST',
          body: { decision: corrBtn.dataset.decision },
        });
        toast(`Mark correction ${corrBtn.dataset.decision}.`, 'success');
        await loadExams();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    const profBtn = e.target.closest('[data-prof-id]');
    if (profBtn) {
      try {
        await api(`/api/superadmin/profile-requests/${profBtn.dataset.profId}/review`, {
          method: 'POST',
          body: { decision: profBtn.dataset.decision },
        });
        toast(`Profile request ${profBtn.dataset.decision}.`, 'success');
        await loadExams();
      } catch (err) {
        toast(err.message, 'error');
      }
    }

    const delGradeBtn = e.target.closest('[data-del-grade]');
    if (delGradeBtn) {
      if (!confirm('Remove this grade band from the grading scale?')) return;
      try {
        await api(`/api/superadmin/exams/grading-scales/${delGradeBtn.dataset.delGrade}`, {
          method: 'DELETE',
        });
        toast('Grade band removed.', 'success');
        await loadExams();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

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

  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.studentFeePortalEnabled = document.getElementById('set-fee-portal').checked;
    fd.allowTeacherMarkEditAfterPublish = document.getElementById('set-direct-mark-edit').checked;
    fd.googleOauthEnabled = document.getElementById('set-google-enabled').checked;
    fd.paystackEnabled = document.getElementById('set-psk-receive-enabled').checked;
    fd.paystackTransfersEnabled = document.getElementById('set-psk-send-enabled').checked;
    fd.paystackRefundsEnabled = document.getElementById('set-psk-reverse-enabled').checked;
    fd.clearPaystackSecret = Boolean(document.getElementById('set-clear-paystack-secret')?.checked);
    try {
      const updated = await api('/api/superadmin/settings', { method: 'PUT', body: fd });
      populateSettingsForm(updated);
      toast('School settings, Paystack keys & access policies saved.', 'success');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('tt-filter-class')?.addEventListener('change', () => {
    loadTimetables().catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('adm-open-psk-keys-btn')?.addEventListener('click', () => {
    activateSection('settings', onSectionChange);
    setTimeout(() => {
      document.getElementById('set-paystack-public-key')?.focus();
    }, 80);
  });

  document.getElementById('adm-psk-transfer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/paystack/transfers', { method: 'POST', body: fd });
      e.target.reset();
      toast(`Paystack transfer sent (${res.transfer.reference}).`, 'success');
      await loadAdminPaystackTransfers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('export-school-report-btn').addEventListener('click', () => {
    if (!state.reportsData) return;
    const attMap = new Map(state.reportsData.classAttendance.map((a) => [a.class_name, a]));
    const feeMap = new Map(state.reportsData.feeByClass.map((f) => [f.class_name, f]));
    const rows = state.reportsData.classPerformance.map((cp) => {
      const att = attMap.get(cp.class_name) || {};
      const fee = feeMap.get(cp.class_name) || {};
      const attRate =
        Number(att.total_entries || 0) > 0
          ? `${Math.round((Number(att.attended_entries || 0) / Number(att.total_entries)) * 100)}%`
          : 'N/A';
      return [
        cp.class_name,
        cp.students_assessed || 0,
        cp.avg_percentage ?? 'N/A',
        attRate,
        fee.net_billed || '0.00',
        fee.collected || '0.00',
      ];
    });
    exportCsv(
      'school_executive_report.csv',
      ['Class', 'Students Assessed', 'Avg Score %', 'Attendance', 'Net Billed', 'Collected'],
      rows
    );
  });

  document.getElementById('trigger-backup-btn').addEventListener('click', async () => {
    try {
      const res = await api('/api/superadmin/backups', { method: 'POST' });
      toast(`Backup verified: ${res.backup.filename} (${res.backup.totalRows} rows)`, 'success');
      await loadBackups();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await loadOverview();
})();
