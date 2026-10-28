(async function initSuperadminDashboard() {
  const { esc, money, api, toast, statusBadge, openPaystackCheckout, activateSection } = window.SMS;

  await SMS.initSession();
  SMS.configureGoogleLinkButton('google-link-btn');
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);

  const user = SMS.getUser();
  if (user) {
    document.getElementById('sb-user-info').textContent = `${user.fullName} | ${user.email}`;
  }

  let acadCache = { classes: [], subjects: [], years: [], terms: [] };
  let teachersCache = [];
  let customRegSubjects = [];

  // Sub-tab controller
  function activateSubtab(group, subtabId) {
    document
      .querySelectorAll(`.subtab-bar[data-tab-group="${group}"] .subtab-btn`)
      .forEach((btn) => btn.classList.toggle('active', btn.dataset.subtab === subtabId));
    document
      .querySelectorAll(`.subtab-panel[data-tab-panel-group="${group}"]`)
      .forEach((panel) => panel.classList.toggle('hidden', panel.id !== subtabId));
  }

  document.querySelectorAll('.subtab-bar').forEach((bar) => {
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
    const badge = document.getElementById('tch-selected-subjects-count');
    if (badge) badge.textContent = `${total} selected`;
  }

  function renderCustomRegChips() {
    const wrap = document.getElementById('tch-custom-subject-chips');
    if (!wrap) return;
    wrap.innerHTML = customRegSubjects
      .map(
        (name, idx) =>
          `<span class="subject-badge-tag">${esc(name)} <button type="button" data-del-reg-chip="${idx}" style="border:none;background:none;color:#1d4ed8;font-weight:800;cursor:pointer;margin-left:4px;">&times;</button></span>`
      )
      .join('');
    updateTeacherSubjectCountBadge();
  }

  function showCredentialsBanner(boxId, creds, label) {
    const el = document.getElementById(boxId);
    if (!el || !creds) return;
    el.innerHTML = `<strong>${esc(label)}:</strong> Email: <code>${esc(creds.email)}</code> | Username: <code>${esc(creds.username)}</code> | Initial Password: <code>${esc(creds.initialPassword)}</code>`;
    el.classList.remove('hidden');
  }

  function populateSettingsForm(data) {
    const s = data.settings;
    if (!s) return;
    document.getElementById('set-school-name').value = s.school_name || 'School Management System';
    document.getElementById('set-school-code').value = s.school_code || '';
    document.getElementById('set-school-email').value = s.email || '';
    document.getElementById('set-school-phone').value = s.phone || '';
    document.getElementById('set-school-address').value = s.address || '';
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

    // Paystack Keys & Transaction Policies
    document.getElementById('set-paystack-public-key').value =
      s.paystack_public_key || data.paystack?.publicKey || '';
    const pskSecInput = document.getElementById('set-paystack-secret-key');
    pskSecInput.value = '';
    pskSecInput.placeholder = s.paystack_secret_configured
      ? 'Configured (leave blank to keep current Secret Key)'
      : 'sk_live_... or sk_test_...';
    const pskWhInput = document.getElementById('set-paystack-webhook-secret');
    pskWhInput.value = '';
    pskWhInput.placeholder = s.paystack_webhook_secret_configured
      ? 'Configured (leave blank to keep current Webhook Secret)'
      : 'Optional';
    document.getElementById('set-clear-paystack-secret').checked = false;
    document.getElementById('set-paystack-enabled').checked =
      s.paystack_enabled === undefined ? true : Boolean(s.paystack_enabled);
    document.getElementById('set-paystack-transfers').checked =
      s.paystack_transfers_enabled === undefined ? true : Boolean(s.paystack_transfers_enabled);
    document.getElementById('set-paystack-refunds').checked =
      s.paystack_refunds_enabled === undefined ? true : Boolean(s.paystack_refunds_enabled);

    const pskBadge = document.getElementById('set-paystack-status-badge');
    const pMode = data.paystack?.mode || 'sandbox';
    pskBadge.textContent =
      data.paystack?.enabled === false
        ? 'Disabled'
        : pMode === 'live'
          ? 'Live Keys Active'
          : pMode === 'test'
            ? 'Test Keys Active'
            : 'Sandbox Mode';

    // Google OAuth
    document.getElementById('set-google-client-id').value = s.google_client_id || '';
    const gSec = document.getElementById('set-google-client-secret');
    gSec.value = '';
    gSec.placeholder = s.google_secret_configured
      ? 'Configured (leave blank to keep current Client Secret)'
      : 'GOCSPX-...';
    document.getElementById('set-clear-google-secret').checked = false;
    document.getElementById('set-google-enabled').checked =
      s.google_oauth_enabled === undefined ? true : Boolean(s.google_oauth_enabled);
  }

  // ---------------- LOADERS ----------------
  async function loadOverview() {
    const data = await api('/api/superadmin/overview');
    SMS.setCurrency(data.settings.currency_code, data.settings.currency_symbol);
    document.getElementById('sb-school-name').textContent =
      data.settings.school_name || 'School Management System';

    SMS.populateCurrencyOptions(
      'header-currency-select',
      data.currencies || [],
      data.settings.currency_code
    );

    const m = data.metrics;
    const pendingCount = Number(m.pendingStudentRequests || 0);
    const pill = document.getElementById('nav-pending-proposals-pill');
    if (pill) {
      pill.textContent = String(pendingCount);
      pill.classList.toggle('hidden', pendingCount === 0);
    }

    document.getElementById('ov-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Classes</div><div class="kpi-value">${m.activeClasses || 0}</div><div class="kpi-sub">Active classes</div></div>
      <div class="kpi-card"><div class="kpi-label">Teachers</div><div class="kpi-value">${m.activeTeachers || 0}</div><div class="kpi-sub">${m.activeUsers || 0} active accounts</div></div>
      <div class="kpi-card"><div class="kpi-label">Students</div><div class="kpi-value">${m.activeStudents || 0}</div><div class="kpi-sub">${pendingCount} pending join proposal(s)</div></div>
      <div class="kpi-card"><div class="kpi-label">Fees Collected</div><div class="kpi-value">${money(m.finance?.collected || 0)}</div><div class="kpi-sub">Balance: ${money(m.finance?.outstanding || 0)}</div></div>
    `;

    const annHtml =
      (data.announcements || [])
        .map(
          (a) => `<div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
              <strong>${esc(a.title)}</strong>
              ${statusBadge(a.priority)}
            </div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:4px;white-space:pre-wrap;">${esc(a.body)}</div>
          </div>`
        )
        .join('') || '<div class="empty-state">No announcements published yet.</div>';

    document.getElementById('ov-announcements').innerHTML = annHtml;
    document.getElementById('all-announcements-list').innerHTML = annHtml;

    populateSettingsForm(data);
  }

  async function loadAcademicAndTeachers() {
    const [acad, tData] = await Promise.all([
      api('/api/superadmin/academic'),
      api('/api/superadmin/teachers'),
    ]);
    acadCache = acad;
    teachersCache = tData.teachers || [];

    const dl = document.getElementById('subject-suggestions-list');
    if (dl) {
      dl.innerHTML = acad.subjects.map((s) => `<option value="${esc(s.name)}"></option>`).join('');
    }

    document.getElementById('classes-tbody').innerHTML =
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

    document.getElementById('subjects-tbody').innerHTML =
      acad.subjects
        .map(
          (s) => `<tr>
            <td><code>${esc(s.code)}</code></td>
            <td><strong>${esc(s.name)}</strong></td>
            <td>${esc(s.department || '-')}</td>
            <td class="num">${s.pass_mark}%</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No subjects created yet.</td></tr>';

    const classOpts = acad.classes
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
      .join('');
    const subOpts = acad.subjects
      .map((s) => `<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`)
      .join('');
    const teacherOpts = teachersCache
      .map(
        (t) =>
          `<option value="${t.id}">${esc(t.first_name)} ${esc(t.last_name)} (${esc(t.staff_number)})</option>`
      )
      .join('');

    const stuClassSel = document.getElementById('stu-class-select');
    if (stuClassSel) stuClassSel.innerHTML = '<option value="">Unassigned</option>' + classOpts;

    const ttClassSel = document.getElementById('tt-class');
    if (ttClassSel) ttClassSel.innerHTML = classOpts || '<option value="">Add a Class first</option>';
    const ttFilterSel = document.getElementById('tt-filter-class');
    if (ttFilterSel) {
      const prev = ttFilterSel.value;
      ttFilterSel.innerHTML = '<option value="">All Classes</option>' + classOpts;
      if (prev) ttFilterSel.value = prev;
    }
    const ttSubSel = document.getElementById('tt-subject');
    if (ttSubSel) ttSubSel.innerHTML = subOpts || '<option value="">Add a Subject first</option>';
    const ttTeacherSel = document.getElementById('tt-teacher');
    if (ttTeacherSel) ttTeacherSel.innerHTML = teacherOpts || '<option value="">Register a Teacher first</option>';

    const asgTeacherSel = document.getElementById('asg-teacher');
    if (asgTeacherSel) asgTeacherSel.innerHTML = teacherOpts || '<option value="">Register a Teacher first</option>';

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

    document.getElementById('teachers-list-tbody').innerHTML =
      teachersCache
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
            <td><button type="button" class="btn btn-secondary btn-sm" data-edit-tch-subs="${t.id}">Edit Subjects</button></td>
          </tr>`;
        })
        .join('') || '<tr><td colspan="6" class="empty-state">No teachers registered yet.</td></tr>';

    document.getElementById('teacher-assignments-tbody').innerHTML =
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

  function syncAssignTeacherSubjects() {
    const tid = Number(document.getElementById('asg-teacher')?.value || 0);
    const found = teachersCache.find((t) => Number(t.id) === tid);
    const prechecked = found?.subjectIds || [];
    renderSubjectCheckPills('asg-subjects-checkboxes', acadCache.subjects, prechecked);
  }

  async function loadStudents() {
    const search = document.getElementById('stu-search')?.value.trim() || '';
    const data = await api(`/api/superadmin/students?search=${encodeURIComponent(search)}`);
    const items = data.items || [];
    document.getElementById('students-tbody').innerHTML =
      items
        .map(
          (s) => `<tr>
            <td><code>${esc(s.admission_number)}</code></td>
            <td><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong></td>
            <td>${esc(s.class_name || 'Unassigned')}</td>
            <td>${esc(s.email)}</td>
            <td>${esc(s.guardian_name || '-')} ${s.guardian_phone ? '(' + esc(s.guardian_phone) + ')' : ''}</td>
            <td>${statusBadge(s.status)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty-state">No students enrolled yet.</td></tr>';

    const stuOpts = items
      .map(
        (s) =>
          `<option value="${s.id}">${esc(s.admission_number)} - ${esc(s.first_name)} ${esc(s.last_name)}</option>`
      )
      .join('');
    ['fin-student-select', 'fin-psk-student'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = stuOpts || '<option value="">No enrolled students yet</option>';
    });
  }

  async function loadStudentRequests() {
    const status = document.getElementById('srr-status-filter')?.value || 'pending';
    const data = await api(`/api/superadmin/student-requests?status=${encodeURIComponent(status)}`);
    const classOpts =
      '<option value="">Select Class</option>' +
      acadCache.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

    document.getElementById('student-requests-tbody').innerHTML =
      (data.items || [])
        .map((r) => {
          const isPending = r.status === 'pending';
          return `<tr>
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
        .join('') || '<tr><td colspan="6" class="empty-state">No student join proposals found.</td></tr>';

    (data.items || []).forEach((r) => {
      if (r.status === 'pending' && r.requested_class_id) {
        const sel = document.querySelector(`[data-srr-class="${r.id}"]`);
        if (sel) sel.value = String(r.requested_class_id);
      }
    });
  }

  async function loadTimetable() {
    const classId = document.getElementById('tt-filter-class')?.value || '';
    const qs = classId ? `?classId=${encodeURIComponent(classId)}` : '';
    const data = await api(`/api/superadmin/timetables${qs}`);
    SMS.renderTimetableMatrix('tt-matrix-container', data.items || [], {
      showClass: !classId,
      showTeacher: true,
      emptyMessage: 'No timetable lessons scheduled yet.',
    });
  }

  async function loadFinance() {
    const [fin, acad, stuData] = await Promise.all([
      api('/api/superadmin/finance/stats'),
      api('/api/superadmin/academic'),
      api('/api/superadmin/students?limit=200'),
    ]);
    const m = fin.metrics;
    document.getElementById('adm-fin-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Total Billed</div><div class="kpi-value">${money(m.netBilled)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Collected</div><div class="kpi-value">${money(m.totalCollected)}</div><div class="kpi-sub">${m.collectionRate}% collected</div></div>
      <div class="kpi-card"><div class="kpi-label">Paystack Collected</div><div class="kpi-value">${money(m.paystackCollected || 0)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Outstanding Balance</div><div class="kpi-value">${money(m.totalOutstanding)}</div></div>
    `;

    const cats = fin.feeCategories || [];
    document.getElementById('fin-cats-tbody').innerHTML =
      cats
        .map(
          (c) => `<tr>
            <td><code>${esc(c.code)}</code></td>
            <td><strong>${esc(c.name)}</strong></td>
            <td class="num">${money(c.default_amount)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="3" class="empty-state">No fee items created yet.</td></tr>';

    document.getElementById('fin-cat-select').innerHTML =
      cats
        .map((c) => `<option value="${c.id}">${esc(c.name)} (${money(c.default_amount)})</option>`)
        .join('') || '<option value="">Create a Fee Item first</option>';

    document.getElementById('fin-class-select').innerHTML =
      acad.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') ||
      '<option value="">Add a Class first</option>';

    const stuOpts = (stuData.items || [])
      .map(
        (s) =>
          `<option value="${s.id}">${esc(s.admission_number)} - ${esc(s.first_name)} ${esc(s.last_name)}</option>`
      )
      .join('');
    ['fin-student-select', 'fin-psk-student'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = stuOpts || '<option value="">No enrolled students yet</option>';
    });

    document.getElementById('fin-payments-tbody').innerHTML =
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
  }

  async function loadUsers() {
    const data = await api('/api/superadmin/users');
    document.getElementById('users-tbody').innerHTML =
      (data.items || [])
        .map(
          (u) => `<tr>
            <td><strong>${esc(u.full_name)}</strong></td>
            <td>${esc(u.email)}</td>
            <td><span class="badge badge-neutral">${esc(u.role)}</span></td>
            <td>${statusBadge(u.status)}</td>
            <td>
              ${
                u.role !== 'superadmin'
                  ? `<button type="button" class="btn btn-secondary btn-sm" data-toggle-user="${u.id}" data-cur-status="${esc(u.status)}">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>`
                  : '-'
              }
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty-state">No user accounts found.</td></tr>';
  }

  // ---------------- NAVIGATION ----------------
  SMS.initNavigation(async (sec) => {
    try {
      if (sec === 'overview') await loadOverview();
      if (sec === 'academic' || sec === 'teachers') await loadAcademicAndTeachers();
      if (sec === 'students') {
        await loadAcademicAndTeachers();
        await loadStudents();
        await loadStudentRequests();
      }
      if (sec === 'timetable') {
        await loadAcademicAndTeachers();
        await loadTimetable();
      }
      if (sec === 'finance') await loadFinance();
      if (sec === 'users') {
        await loadAcademicAndTeachers();
        await loadUsers();
      }
      if (sec === 'announcements' || sec === 'settings') await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Overview quick buttons
  document.querySelectorAll('[data-jump-sec]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sec = btn.dataset.jumpSec;
      activateSection(sec);
      if (sec === 'academic' || sec === 'teachers') loadAcademicAndTeachers().catch(() => {});
      if (sec === 'students') {
        loadAcademicAndTeachers()
          .then(() => Promise.all([loadStudents(), loadStudentRequests()]))
          .catch(() => {});
      }
      if (sec === 'timetable') {
        loadAcademicAndTeachers().then(loadTimetable).catch(() => {});
      }
      if (sec === 'settings') loadOverview().catch(() => {});
    });
  });

  // Topbar currency switcher
  SMS.bindCurrencySelect('header-currency-select', '/api/superadmin/settings/currency', async () => {
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
    row.className = 'subject-input-row';
    row.setAttribute('data-subject-row', '');
    row.innerHTML = `
      <span class="subject-row-label">Subject ${idx}</span>
      <input type="text" class="tch-subject-row-input" list="subject-suggestions-list" placeholder="Type another subject">
      <button type="button" class="btn btn-danger btn-sm" data-del-sub-row>&times;</button>
    `;
    wrap.appendChild(row);
  });

  document.getElementById('tch-subject-rows-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-sub-row]');
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
      showCredentialsBanner('issued-teacher-creds-box', res.issuedCredentials, 'Teacher Login Ready');
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
      `Edit Subjects — ${teacher.first_name} ${teacher.last_name}`;
    renderSubjectCheckPills('edit-tch-subject-checkboxes', acadCache.subjects, teacher.subjectIds || []);
    document.getElementById('edit-tch-custom-subject-input').value = '';
    document.getElementById('edit-teacher-subjects-card').classList.remove('hidden');
  });

  document.getElementById('btn-cancel-edit-teacher-subjects').addEventListener('click', () => {
    document.getElementById('edit-teacher-subjects-card').classList.add('hidden');
  });

  document.getElementById('edit-teacher-subjects-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tid = Number(document.getElementById('edit-tch-id').value);
    const subjectIds = getCheckedValues('edit-tch-subject-checkboxes');
    const customRaw = document.getElementById('edit-tch-custom-subject-input').value;
    const customSubjects = customRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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

  // Students & Join Proposals
  document.getElementById('stu-search-btn').addEventListener('click', loadStudents);
  document.getElementById('srr-status-filter').addEventListener('change', loadStudentRequests);

  document.getElementById('create-student-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/superadmin/students', { method: 'POST', body: fd });
      e.target.reset();
      showCredentialsBanner('issued-student-creds-box', res.issuedCredentials, 'Student Login Ready');
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
  document.getElementById('create-timetable-form').addEventListener('submit', async (e) => {
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
  document.getElementById('fin-target-type').addEventListener('change', (e) => {
    const isClass = e.target.value === 'class';
    document.getElementById('fin-target-class-wrap').classList.toggle('hidden', !isClass);
    document.getElementById('fin-target-student-wrap').classList.toggle('hidden', isClass);
  });

  document.getElementById('fin-create-cat-form').addEventListener('submit', async (e) => {
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

  document.getElementById('fin-assign-fee-form').addEventListener('submit', async (e) => {
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

  document.getElementById('fin-paystack-collect-form').addEventListener('submit', async (e) => {
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

  document.getElementById('fin-paystack-transfer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/paystack/transfers', { method: 'POST', body: fd });
      toast(`Transfer sent (${res.transfer.reference}).`, 'success');
      e.target.reset();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('fin-payments-tbody').addEventListener('click', async (e) => {
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
      ?.classList.toggle('hidden', usrRoleSel.value !== 'teacher');
  };
  usrRoleSel.addEventListener('change', syncUsrTeacherFields);
  syncUsrTeacherFields();

  document.getElementById('btn-add-usr-subject-row').addEventListener('click', () => {
    const wrap = document.getElementById('usr-tch-subject-rows');
    const idx = wrap.querySelectorAll('[data-subject-row]').length + 1;
    const row = document.createElement('div');
    row.className = 'subject-input-row';
    row.setAttribute('data-subject-row', '');
    row.innerHTML = `
      <span class="subject-row-label">Subject ${idx}</span>
      <input type="text" class="usr-tch-subject-row-input" list="subject-suggestions-list" placeholder="Type subject name">
      <button type="button" class="btn btn-danger btn-sm" data-del-usr-sub>&times;</button>
    `;
    wrap.appendChild(row);
  });

  document.getElementById('usr-tch-subject-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-usr-sub]');
    if (btn) btn.closest('[data-subject-row]')?.remove();
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
      showCredentialsBanner('issued-user-creds-box', res.issuedCredentials, 'Staff Account Ready');
      toast('Staff account created.', 'success');
      await loadUsers();
      await loadAcademicAndTeachers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('users-tbody').addEventListener('click', async (e) => {
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

  // Announcements
  document.getElementById('create-announcement-form').addEventListener('submit', async (e) => {
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
      schoolCode: document.getElementById('set-school-code').value.trim(),
      email: document.getElementById('set-school-email').value.trim(),
      phone: document.getElementById('set-school-phone').value.trim(),
      address: document.getElementById('set-school-address').value.trim(),
      currencyCode: document.getElementById('set-currency-code').value,
      currencySymbol: document.getElementById('set-currency-symbol').value.trim(),
      studentFeePortalEnabled: document.getElementById('set-fee-portal').checked,
      paystackPublicKey: document.getElementById('set-paystack-public-key').value.trim(),
      paystackSecretKey: document.getElementById('set-paystack-secret-key').value.trim(),
      paystackWebhookSecret: document.getElementById('set-paystack-webhook-secret').value.trim(),
      clearPaystackSecret: document.getElementById('set-clear-paystack-secret').checked,
      paystackEnabled: document.getElementById('set-paystack-enabled').checked,
      paystackTransfersEnabled: document.getElementById('set-paystack-transfers').checked,
      paystackRefundsEnabled: document.getElementById('set-paystack-refunds').checked,
      googleClientId: document.getElementById('set-google-client-id').value.trim(),
      googleClientSecret: document.getElementById('set-google-client-secret').value.trim(),
      clearGoogleSecret: document.getElementById('set-clear-google-secret').checked,
      googleOAuthEnabled: document.getElementById('set-google-enabled').checked,
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
