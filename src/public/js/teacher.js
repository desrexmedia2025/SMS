(async function initTeacherDashboard() {
  const {
    esc,
    api,
    toast,
    statusBadge,
    exportCsv,
    activateSection,
    renderMediaAttachments,
    formatBytes,
  } = window.SMS;

  let overviewData = null;
  let currentAssessment = null;
  let reportRows = [];
  let activeSubmissionsCourseworkId = null;

  await SMS.initSession();
  SMS.configureGoogleLinkButton('google-link-btn');
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);
  document.getElementById('att-date-input').value = new Date().toISOString().slice(0, 10);

  function getCheckedClassIds(containerId) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return [];
    return Array.from(wrap.querySelectorAll('input[type="checkbox"]:checked'))
      .map((cb) => Number(cb.value))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  function renderAssignedClassCheckboxes(containerId, classes = []) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    const prev = new Set(getCheckedClassIds(containerId));
    if (!classes.length) {
      wrap.innerHTML =
        '<span class="multi-subject-hint">No classes assigned to you yet. Ask the Superadmin to assign your classes under Teachers &amp; Assignments.</span>';
      return;
    }
    wrap.innerHTML = classes
      .map(
        (c) => `<label class="subject-check-pill">
          <input type="checkbox" value="${c.id}" ${prev.has(Number(c.id)) ? 'checked' : ''}>
          <span>${esc(c.name)}</span>
        </label>`
      )
      .join('');
  }

  function formatWorkTypeLabel(type) {
    const map = {
      classwork: 'Classwork',
      homework: 'Homework',
      test: 'Test',
      exam: 'Exam',
    };
    return map[String(type || '').toLowerCase()] || String(type || 'Work');
  }

  function renderAnnouncementsFeed(items = []) {
    const container = document.getElementById('tc-announcements');
    if (!container) return;
    if (!items.length) {
      container.innerHTML = '<div class="empty-state">No announcements yet.</div>';
      return;
    }
    const currentUserId = Number(SMS.getUser()?.id || 0);
    container.innerHTML = items
      .map((a) => {
        const classPills =
          Array.isArray(a.target_classes) && a.target_classes.length
            ? `<div class="subject-badges-wrap" style="margin-top:6px;">${a.target_classes
                .map((c) => `<span class="subject-badge-tag">Class: ${esc(c.name)}</span>`)
                .join('')}</div>`
            : `<div style="margin-top:4px;"><span class="badge badge-neutral">Audience: ${esc(a.audience)}</span></div>`;
        const isOwn = currentUserId > 0 && Number(a.author_user_id) === currentUserId;
        return `<div style="padding:14px 0;border-bottom:1px solid var(--border);">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
            <div>
              <strong>${esc(a.title)}</strong>
              ${a.author_name ? `<small style="color:var(--text-light);margin-left:8px;">by ${esc(a.author_name)}</small>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              ${statusBadge(a.priority)}
              ${isOwn ? `<button type="button" class="btn btn-danger btn-sm" data-del-ann="${a.id}">Delete</button>` : ''}
            </div>
          </div>
          ${classPills}
          <p style="margin:8px 0 0;color:var(--text-muted);white-space:pre-wrap;">${esc(a.body)}</p>
        </div>`;
      })
      .join('');
  }

  function renderTeacherCourseworkList(items = []) {
    const wrap = document.getElementById('tc-coursework-list');
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML =
        '<div class="empty-state">No classwork, homework, tests, or exams published yet. Use the form above to send work to your classes.</div>';
      return;
    }

    wrap.innerHTML = items
      .map((item) => {
        const wType = String(item.work_type || 'homework').toLowerCase();
        const classBadges = (item.target_classes || [])
          .map((c) => `<span class="subject-badge-tag">${esc(c.name)}</span>`)
          .join('');
        const dueLabel = item.due_at
          ? `Due: <strong>${esc(String(item.due_at).replace('T', ' '))}</strong>`
          : 'No due deadline';
        const mediaHtml = item.attachments?.length
          ? `<div style="margin-top:8px;"><div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">Teacher Uploaded Materials (${item.attachments.length})</div>${renderMediaAttachments(item.attachments)}</div>`
          : '';

        return `<div class="coursework-card">
          <div class="coursework-card-head">
            <div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                <span class="cw-type-badge cw-type-${esc(wType)}">${esc(formatWorkTypeLabel(wType))}</span>
                <span class="badge badge-neutral">${esc(item.subject_code)} - ${esc(item.subject_name)}</span>
                <span style="font-size:12px;color:var(--text-muted);">Max Score: <strong>${item.max_score}</strong> &middot; ${dueLabel}</span>
              </div>
              <h3 style="margin:4px 0;font-size:16px;color:var(--text);">${esc(item.title)}</h3>
              <div class="subject-badges-wrap" style="margin-top:4px;">
                <span style="font-size:12px;color:var(--text-muted);margin-right:2px;">Assigned to:</span>
                ${classBadges || '<span class="multi-subject-hint">-</span>'}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span class="badge badge-info">${item.submitted_count || 0} Submitted | ${item.graded_count || 0} Graded</span>
              <button type="button" class="btn btn-primary btn-sm" data-open-cw-subs="${item.id}">View Answers &amp; Grade</button>
              <button type="button" class="btn btn-danger btn-sm" data-delete-cw="${item.id}">Delete</button>
            </div>
          </div>
          <div class="coursework-instructions">${esc(item.instructions)}</div>
          ${mediaHtml}
        </div>`;
      })
      .join('');
  }

  async function loadCourseworkList() {
    const filterType = document.getElementById('cw-filter-type')?.value || '';
    const filterClass = document.getElementById('cw-filter-class')?.value || '';
    const params = new URLSearchParams();
    if (filterType) params.set('workType', filterType);
    if (filterClass) params.set('classId', filterClass);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const data = await api(`/api/teacher/coursework${qs}`);
    renderTeacherCourseworkList(data.items || []);
  }

  async function openCourseworkSubmissions(courseworkId) {
    activeSubmissionsCourseworkId = Number(courseworkId);
    const data = await api(`/api/teacher/coursework/${courseworkId}/submissions`);
    const cw = data.coursework;
    const learners = data.learners || [];

    const panel = document.getElementById('cw-submissions-panel');
    document.getElementById('cw-submissions-title').textContent = `${formatWorkTypeLabel(cw.work_type)}: ${cw.title} (${cw.subject_code} - ${cw.subject_name})`;
    const targetNames = (cw.target_classes || []).map((c) => c.name).join(', ');
    document.getElementById('cw-submissions-subtitle').textContent = `Classes: ${targetNames || '-'} | Max Score: ${cw.max_score} | ${learners.filter((l) => l.submitted).length} of ${learners.length} learners submitted`;

    const bodyEl = document.getElementById('cw-submissions-body');
    if (!learners.length) {
      bodyEl.innerHTML =
        '<div class="empty-state">No enrolled students found in the targeted class(es) yet.</div>';
    } else {
      bodyEl.innerHTML = `<div class="coursework-list">${learners
        .map((row) => {
          const sub = row.submission;
          if (!sub) {
            return `<div class="coursework-card" style="padding:14px 16px;background:#f8fafc;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
                <div>
                  <strong>${esc(row.firstName)} ${esc(row.lastName)}</strong>
                  <span style="color:var(--text-light);font-size:12px;margin-left:6px;">(${esc(row.admissionNumber)} &middot; ${esc(row.className)})</span>
                </div>
                <span class="badge badge-neutral">Not Submitted Yet</span>
              </div>
            </div>`;
          }

          const answerBlock = sub.answerText
            ? `<div class="coursework-instructions" style="border-left-color:#10b981;">${esc(sub.answerText)}</div>`
            : '<div style="font-size:12.5px;color:var(--text-muted);margin:8px 0;">No written text entered (file upload submission).</div>';

          const filesBlock = sub.attachments?.length
            ? `<div style="margin:8px 0;"><div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">Student Uploaded Files (${sub.attachments.length})</div>${renderMediaAttachments(sub.attachments)}</div>`
            : '';

          return `<div class="coursework-card" data-sub-card="${sub.id}">
            <div class="coursework-card-head">
              <div>
                <strong>${esc(row.firstName)} ${esc(row.lastName)}</strong>
                <span style="color:var(--text-light);font-size:12.5px;margin-left:6px;"><code>${esc(row.admissionNumber)}</code> &middot; ${esc(row.className)}</span>
                <div style="font-size:11.5px;color:var(--text-muted);margin-top:2px;">Submitted: ${esc(sub.submittedAt || '')}</div>
              </div>
              <div>
                ${
                  sub.status === 'graded'
                    ? `<span class="badge badge-success">Graded: ${sub.score} / ${cw.max_score}</span>`
                    : '<span class="badge badge-warning">Submitted - Awaiting Grade</span>'
                }
              </div>
            </div>
            ${answerBlock}
            ${filesBlock}
            <form class="grade-submission-form" data-submission-id="${sub.id}" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
              <div class="form-group" style="margin:0;width:150px;">
                <label>Score (out of ${cw.max_score})</label>
                <input type="number" name="score" step="0.01" min="0" max="${cw.max_score}" value="${sub.score !== null && sub.score !== undefined ? sub.score : ''}" required>
              </div>
              <div class="form-group" style="margin:0;flex:1 1 260px;">
                <label>Teacher Feedback (Optional)</label>
                <input type="text" name="feedback" value="${esc(sub.feedback || '')}" placeholder="Well done! Check question 3 working...">
              </div>
              <button type="submit" class="btn btn-primary btn-sm">Save Grade</button>
            </form>
          </div>`;
        })
        .join('')}</div>`;
    }

    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadOverview() {
    const data = await api('/api/teacher/overview');
    overviewData = data;
    document.getElementById('sb-school-name').textContent =
      data.settings?.school_name || 'School Management System';
    const periodLabel = [data.activeYear?.name, data.activeTerm?.name].filter(Boolean).join(' - ');
    document.getElementById('active-period-badge').textContent = periodLabel || 'No Active Period Set';
    document.getElementById('sb-user-info').textContent =
      `${data.teacher.full_name} | ${data.teacher.staff_number}`;

    if (data.teacher.googleLinked) {
      document.getElementById('google-link-btn').textContent = 'Google Linked';
    }

    const regSubjects = data.registeredSubjects || data.teacher.subjects || [];
    const subjectsSummary = regSubjects.length
      ? regSubjects.map((s) => s.name).join(', ')
      : data.teacher.department || 'Academic Staff';

    const m = data.metrics;
    document.getElementById('tc-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Assigned Classes</div><div class="kpi-value">${m.assignedClasses}</div><div class="kpi-sub">Active teaching classes</div></div>
      <div class="kpi-card"><div class="kpi-label">Subjects Taught</div><div class="kpi-value">${m.assignedSubjects}</div><div class="kpi-sub">${esc(subjectsSummary)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Weekly Timetable Slots</div><div class="kpi-value">${m.weeklyLessons}</div><div class="kpi-sub">Scheduled periods</div></div>
      <div class="kpi-card"><div class="kpi-label">Published Works &amp; Exams</div><div class="kpi-value">${m.courseworkCount || 0}</div><div class="kpi-sub">${data.assessments.length} official marksheets</div></div>
    `;

    const subjectBadgesMarkup = regSubjects.length
      ? `<div class="subject-badges-wrap">${regSubjects
          .map(
            (s) =>
              `<span class="subject-badge-tag"><strong>${esc(s.code)}</strong> &middot; ${esc(s.name)}${s.department ? ' (' + esc(s.department) + ')' : ''}</span>`
          )
          .join('')}</div>`
      : '<div class="empty-state" style="padding:14px 0;">No teaching subjects linked to your profile yet.</div>';

    const ovSubjectsEl = document.getElementById('tc-ov-subjects-wrap');
    if (ovSubjectsEl) ovSubjectsEl.innerHTML = subjectBadgesMarkup;

    const regSubjectsEl = document.getElementById('tc-registered-subjects-wrap');
    if (regSubjectsEl) regSubjectsEl.innerHTML = subjectBadgesMarkup;

    const profBadgesEl = document.getElementById('prof-subjects-badges');
    if (profBadgesEl) {
      profBadgesEl.innerHTML = regSubjects.length
        ? `<div class="subject-badges-wrap">${regSubjects
            .map((s) => `<span class="subject-badge-tag"><strong>${esc(s.code)}</strong> &middot; ${esc(s.name)}</span>`)
            .join('')}</div>`
        : '<span class="multi-subject-hint">No subjects linked yet.</span>';
    }

    // Populate Coursework Subject selector & Assigned Classes checkboxes
    const cwSubjectSel = document.getElementById('cw-subject-select');
    if (cwSubjectSel) {
      cwSubjectSel.innerHTML = regSubjects.length
        ? regSubjects
            .map((s) => `<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`)
            .join('')
        : '<option value="">No subjects linked yet</option>';
    }

    const assignedClasses = data.assignedClasses || [];
    renderAssignedClassCheckboxes('cw-target-classes-grid', assignedClasses);
    renderAssignedClassCheckboxes('tc-ann-classes-grid', assignedClasses);

    const cwFilterCls = document.getElementById('cw-filter-class');
    if (cwFilterCls) {
      const prevClsFilter = cwFilterCls.value;
      cwFilterCls.innerHTML =
        '<option value="">All My Classes</option>' +
        assignedClasses.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      if (prevClsFilter) cwFilterCls.value = prevClsFilter;
    }

    renderTeacherCourseworkList(data.coursework || []);

    document.getElementById('tc-ov-assignments').innerHTML = data.assignments.length
      ? data.assignments
          .map(
            (a) => `<tr>
              <td><strong>${esc(a.class_name)}</strong></td>
              <td>${esc(a.subject_code)} - ${esc(a.subject_name)}</td>
            </tr>`
          )
          .join('')
      : regSubjects.length
        ? `<tr><td colspan="2" class="empty-state">Registered to teach <strong>${esc(regSubjects.map((s) => s.name).join(', '))}</strong> — awaiting class assignment from Superadmin.</td></tr>`
        : '<tr><td colspan="2" class="empty-state">No class assignments yet.</td></tr>';

    document.getElementById('tc-assignments-tbody').innerHTML = data.assignments.length
      ? data.assignments
          .map(
            (a) => `<tr>
              <td><strong>${esc(a.class_name)}</strong></td>
              <td><code>${esc(a.subject_code)}</code></td>
              <td>${esc(a.subject_name)}</td>
              <td class="num">${a.pass_mark}%</td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="empty-state">No classes assigned yet.</td></tr>';

    document.getElementById('tc-ov-sessions').innerHTML =
      data.recentSessions
        .slice(0, 6)
        .map(
          (s) => `<tr>
            <td class="tabular">${esc(s.session_date)}</td>
            <td>${esc(s.class_name)}</td>
            <td>${esc(s.subject_name || 'General')}</td>
            <td class="num">${s.present_count || 0}</td>
            <td class="num">${s.absent_count || 0}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty-state">No attendance recorded yet.</td></tr>';

    SMS.renderTimetableMatrix('tc-tt-matrix', data.timetable || [], {
      showClass: true,
      showTeacher: false,
      emptyMessage: 'No timetable slots assigned yet.',
    });

    const asgOptions = data.assignments.length
      ? data.assignments
          .map(
            (a, idx) =>
              `<option value="${idx}">${esc(a.class_name)} - ${esc(a.subject_code)} ${esc(a.subject_name)}</option>`
          )
          .join('')
      : '<option value="">No assigned classes yet</option>';
    ['roster-assignment-select', 'att-assignment-select', 'new-assess-assignment'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = asgOptions;
    });

    document.getElementById('select-assessment').innerHTML = data.assessments.length
      ? data.assessments
          .map(
            (a) =>
              `<option value="${a.id}">${esc(a.title)} - ${esc(a.class_name)} (${a.is_published ? 'Published' : 'Draft'})</option>`
          )
          .join('')
      : '<option value="">No marksheets created yet</option>';

    document.getElementById('tc-corr-tbody').innerHTML =
      data.myCorrectionRequests
        .map(
          (c) => `<tr>
            <td>${esc(c.first_name)} ${esc(c.last_name)}</td>
            <td>${esc(c.assessment_title)}</td>
            <td class="tabular">${c.previous_score} to <strong>${c.proposed_score}</strong></td>
            <td>${statusBadge(c.status)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No correction requests submitted.</td></tr>';

    renderAnnouncementsFeed(data.announcements || []);

    document.getElementById('prof-staff-no').value = data.teacher.staff_number || '';
    document.getElementById('prof-phone').value = data.teacher.phone || '';
    document.getElementById('prof-qual').value = data.teacher.qualification || '';
    document.getElementById('prof-spec').value = data.teacher.specialization || '';
  }

  async function loadClassRoster() {
    const idx = Number(document.getElementById('roster-assignment-select').value || 0);
    const asg = overviewData?.assignments?.[idx];
    if (!asg) return;
    const q = new URLSearchParams({ classId: asg.class_id });
    const data = await api(`/api/teacher/class-list?${q.toString()}`);
    document.getElementById('roster-tbody').innerHTML =
      data.students
        .map(
          (s) => `<tr>
            <td>${esc(s.roll_number || '-')}</td>
            <td><code>${esc(s.admission_number)}</code></td>
            <td><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong></td>
            <td>${esc(s.gender || '-')}</td>
            <td class="tabular">${esc(s.date_of_birth || '-')}</td>
            <td>${esc(s.guardian_name || '-')} ${s.guardian_phone ? '(' + esc(s.guardian_phone) + ')' : ''}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty-state">No learners enrolled in this class yet.</td></tr>';
  }

  async function loadAttendanceSheet() {
    const idx = Number(document.getElementById('att-assignment-select').value || 0);
    const asg = overviewData?.assignments?.[idx];
    const sessionDate = document.getElementById('att-date-input').value;
    if (!asg || !sessionDate) return;

    const q = new URLSearchParams({
      classId: asg.class_id,
      subjectId: asg.subject_id,
      sessionDate,
    });

    const data = await api(`/api/teacher/attendance/session?${q.toString()}`);
    document.getElementById('att-notes').value = data.session?.notes || '';
    document.getElementById('att-roster-tbody').innerHTML =
      data.roster
        .map(
          (st) => `<tr data-att-student="${st.student_id}">
            <td><code>${esc(st.admission_number)}</code></td>
            <td><strong>${esc(st.first_name)} ${esc(st.last_name)}</strong></td>
            <td>
              <select class="att-status-sel" style="width:130px;">
                ${['present', 'late', 'absent', 'excused']
                  .map((opt) => `<option value="${opt}" ${st.attendance_status === opt ? 'selected' : ''}>${opt}</option>`)
                  .join('')}
              </select>
            </td>
            <td><input type="text" class="att-remark-inp" value="${esc(st.remarks || '')}" placeholder="Optional note"></td>
          </tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No learners enrolled in this class yet.</td></tr>';
  }

  async function loadMarksheet() {
    const assessId = document.getElementById('select-assessment').value;
    if (!assessId) return;
    const data = await api(`/api/teacher/assessments/${assessId}/marksheet`);
    currentAssessment = data;

    const banner = document.getElementById('marksheet-lock-banner');
    const saveBtn = document.getElementById('save-marks-btn');
    if (data.lockedForDirectEdit) {
      banner.textContent =
        'This marksheet is already PUBLISHED to students. Direct overwriting is locked; use "Request Correction" on any row to submit an audited correction for Superadmin approval.';
      banner.classList.remove('hidden');
      saveBtn.disabled = true;
    } else {
      banner.classList.add('hidden');
      saveBtn.disabled = false;
    }

    document.getElementById('marksheet-tbody').innerHTML =
      data.students
        .map(
          (s) => `<tr data-mark-student="${s.student_id}" data-mark-id="${s.mark_id || ''}">
            <td><code>${esc(s.admission_number)}</code></td>
            <td><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong></td>
            <td class="num" style="width:130px;">
              <input type="number" step="0.01" min="0" max="${data.assessment.max_score}" class="mark-score-inp" value="${s.score !== '' ? s.score : ''}" ${data.lockedForDirectEdit ? 'disabled' : ''}>
            </td>
            <td class="num">${s.percentage !== null ? s.percentage + '%' : '-'}</td>
            <td><strong>${esc(s.grade || '-')}</strong></td>
            <td>
              ${esc(s.remark || '')}
              ${
                data.lockedForDirectEdit && s.mark_id
                  ? `<button type="button" class="btn btn-secondary btn-sm" data-req-corr="${s.mark_id}" data-cur-score="${s.score}">Request Correction</button>`
                  : ''
              }
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty-state">No learners enrolled in this class yet.</td></tr>';
  }

  async function loadProgressReports() {
    const data = await api('/api/teacher/reports');
    reportRows = data.reports || [];
    document.getElementById('tc-reports-tbody').innerHTML =
      reportRows
        .map(
          (r) => `<tr>
            <td><strong>${esc(r.class_name)}</strong></td>
            <td>${esc(r.subject_code)} - ${esc(r.subject_name)}</td>
            <td class="num">${r.entries_count || 0}</td>
            <td class="num">${r.average_pct !== null ? r.average_pct + '%' : '-'}</td>
            <td class="num">${r.highest_pct !== null ? r.highest_pct + '%' : '-'}</td>
            <td class="num">${r.lowest_pct !== null ? r.lowest_pct + '%' : '-'}</td>
            <td class="num">${r.pass_count || 0}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No class progress data yet.</td></tr>';
  }

  SMS.initNavigation(async (sec) => {
    try {
      if (sec === 'overview') await loadOverview();
      if (sec === 'coursework') await loadCourseworkList();
      if (sec === 'classlists') await loadClassRoster();
      if (sec === 'attendance') await loadAttendanceSheet();
      if (sec === 'marks') await loadMarksheet();
      if (sec === 'reports') await loadProgressReports();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Quick action buttons on Overview
  document.getElementById('ov-quick-coursework-btn')?.addEventListener('click', () => {
    activateSection('coursework');
    loadCourseworkList().catch(() => {});
  });

  document.getElementById('ov-quick-announce-btn')?.addEventListener('click', () => {
    activateSection('announcements');
  });

  // Toggle All Assigned Classes checkboxes for Coursework & Announcements (with two-way sync)
  document.getElementById('cw-all-classes-chk')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document
      .querySelectorAll('#cw-target-classes-grid input[type="checkbox"]')
      .forEach((cb) => {
        cb.checked = checked;
      });
  });

  document.getElementById('cw-target-classes-grid')?.addEventListener('change', () => {
    const boxes = Array.from(
      document.querySelectorAll('#cw-target-classes-grid input[type="checkbox"]')
    );
    const allChk = document.getElementById('cw-all-classes-chk');
    if (allChk && boxes.length > 0) {
      allChk.checked = boxes.every((b) => b.checked);
    }
  });

  document.getElementById('tc-ann-all-classes')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document
      .querySelectorAll('#tc-ann-classes-grid input[type="checkbox"]')
      .forEach((cb) => {
        cb.checked = checked;
      });
  });

  document.getElementById('tc-ann-classes-grid')?.addEventListener('change', () => {
    const boxes = Array.from(
      document.querySelectorAll('#tc-ann-classes-grid input[type="checkbox"]')
    );
    const allChk = document.getElementById('tc-ann-all-classes');
    if (allChk && boxes.length > 0) {
      allChk.checked = boxes.every((b) => b.checked);
    }
  });

  // Show selected upload files before publishing coursework
  document.getElementById('cw-files-input')?.addEventListener('change', (e) => {
    const listEl = document.getElementById('cw-selected-files-list');
    if (!listEl) return;
    const files = Array.from(e.target.files || []);
    listEl.innerHTML = files
      .map(
        (f) =>
          `<span class="subject-badge-tag">${esc(f.name)} (${esc(formatBytes(f.size))})</span>`
      )
      .join('');
  });

  // Publish Classwork / Homework / Test / Exam (with multipart file upload)
  document.getElementById('create-coursework-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const allChecked = document.getElementById('cw-all-classes-chk')?.checked;
    const selectedClassIds = getCheckedClassIds('cw-target-classes-grid');
    if (!allChecked && !selectedClassIds.length) {
      toast('Please select at least one assigned class or check All My Assigned Classes.', 'error');
      return;
    }

    const fd = new FormData();
    fd.set('workType', form.elements.workType.value);
    fd.set('subjectId', form.elements.subjectId.value);
    fd.set('title', form.elements.title.value);
    fd.set('maxScore', form.elements.maxScore.value);
    if (form.elements.dueAt.value) fd.set('dueAt', form.elements.dueAt.value);
    fd.set('instructions', form.elements.instructions.value);
    if (allChecked) {
      fd.set('applyToAllClasses', '1');
    } else {
      fd.set('classIds', JSON.stringify(selectedClassIds));
    }

    const fileInput = document.getElementById('cw-files-input');
    for (const file of Array.from(fileInput?.files || [])) {
      fd.append('attachments', file);
    }

    const submitBtn = document.getElementById('cw-submit-btn');
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await api('/api/teacher/coursework', { method: 'POST', body: fd });
      form.reset();
      const filesList = document.getElementById('cw-selected-files-list');
      if (filesList) filesList.innerHTML = '';
      toast(
        `${formatWorkTypeLabel(res.coursework.workType)} published to ${res.coursework.targetClassIds.length} class(es).`,
        'success'
      );
      await loadOverview();
      await loadCourseworkList();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  document.getElementById('cw-filter-type')?.addEventListener('change', () => {
    loadCourseworkList().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('cw-filter-class')?.addEventListener('change', () => {
    loadCourseworkList().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('cw-refresh-btn')?.addEventListener('click', () => {
    loadCourseworkList().catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('close-cw-submissions-btn')?.addEventListener('click', () => {
    document.getElementById('cw-submissions-panel')?.classList.add('hidden');
    activeSubmissionsCourseworkId = null;
  });

  // View Student Submissions or Delete Coursework
  document.getElementById('tc-coursework-list')?.addEventListener('click', async (e) => {
    const viewBtn = e.target.closest('[data-open-cw-subs]');
    if (viewBtn) {
      try {
        await openCourseworkSubmissions(Number(viewBtn.dataset.openCwSubs));
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }

    const delBtn = e.target.closest('[data-delete-cw]');
    if (delBtn) {
      if (!confirm('Delete this coursework item and its submissions?')) return;
      try {
        await api(`/api/teacher/coursework/${delBtn.dataset.deleteCw}`, { method: 'DELETE' });
        toast('Coursework deleted.', 'info');
        if (Number(delBtn.dataset.deleteCw) === activeSubmissionsCourseworkId) {
          document.getElementById('cw-submissions-panel')?.classList.add('hidden');
        }
        await loadOverview();
        await loadCourseworkList();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  // Grade Student Submission inline
  document.getElementById('cw-submissions-body')?.addEventListener('submit', async (e) => {
    const form = e.target.closest('.grade-submission-form');
    if (!form) return;
    e.preventDefault();
    const submissionId = Number(form.dataset.submissionId);
    const score = form.elements.score.value;
    const feedback = form.elements.feedback.value;
    try {
      await api(`/api/teacher/coursework/submissions/${submissionId}/grade`, {
        method: 'POST',
        body: { score: Number(score), feedback },
      });
      toast('Student grade and feedback saved.', 'success');
      if (activeSubmissionsCourseworkId) {
        await openCourseworkSubmissions(activeSubmissionsCourseworkId);
      }
      await loadCourseworkList();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Send Teacher Class Announcement
  document.getElementById('tc-create-announcement-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const allChecked = document.getElementById('tc-ann-all-classes')?.checked;
    const classIds = getCheckedClassIds('tc-ann-classes-grid');
    if (!allChecked && !classIds.length) {
      toast('Please select at least one assigned class or check All My Assigned Classes.', 'error');
      return;
    }

    const payload = {
      title: form.elements.title.value,
      priority: form.elements.priority.value,
      body: form.elements.body.value,
      applyToAllClasses: Boolean(allChecked),
      classIds,
    };

    try {
      const res = await api('/api/teacher/announcements', { method: 'POST', body: payload });
      form.reset();
      toast(`Announcement sent to ${res.targetClassIds.length} class(es).`, 'success');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('tc-announcements')?.addEventListener('click', async (e) => {
    const delBtn = e.target.closest('[data-del-ann]');
    if (!delBtn) return;
    if (!confirm('Delete this class announcement?')) return;
    try {
      await api(`/api/teacher/announcements/${delBtn.dataset.delAnn}`, { method: 'DELETE' });
      toast('Class announcement deleted.', 'info');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('load-roster-btn').addEventListener('click', loadClassRoster);
  document.getElementById('load-att-btn').addEventListener('click', loadAttendanceSheet);
  document.getElementById('load-marksheet-btn').addEventListener('click', loadMarksheet);

  document.getElementById('submit-att-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idx = Number(document.getElementById('att-assignment-select').value || 0);
    const asg = overviewData?.assignments?.[idx];
    if (!asg) return;

    const entries = Array.from(document.querySelectorAll('#att-roster-tbody tr[data-att-student]')).map((tr) => ({
      studentId: Number(tr.dataset.attStudent),
      status: tr.querySelector('.att-status-sel').value,
      remarks: tr.querySelector('.att-remark-inp').value,
    }));

    try {
      const res = await api('/api/teacher/attendance/session', {
        method: 'POST',
        body: {
          classId: asg.class_id,
          subjectId: asg.subject_id,
          sessionDate: document.getElementById('att-date-input').value,
          notes: document.getElementById('att-notes').value,
          entries,
        },
      });
      toast(`Attendance recorded for ${res.count} learners.`, 'success');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('create-assess-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const idx = Number(document.getElementById('new-assess-assignment').value || 0);
    const asg = overviewData?.assignments?.[idx];
    if (!asg) return;
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.classId = asg.class_id;
    fd.subjectId = asg.subject_id;
    try {
      await api('/api/teacher/assessments', { method: 'POST', body: fd });
      e.target.reset();
      toast('Official marksheet created.', 'success');
      await loadOverview();
      await loadMarksheet();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('submit-marks-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentAssessment) return;
    const entries = Array.from(document.querySelectorAll('#marksheet-tbody tr[data-mark-student]')).map((tr) => ({
      studentId: Number(tr.dataset.markStudent),
      score: tr.querySelector('.mark-score-inp').value,
    }));
    try {
      const res = await api(`/api/teacher/assessments/${currentAssessment.assessment.id}/marks`, {
        method: 'POST',
        body: { entries },
      });
      toast(`Saved ${res.savedCount} student mark(s).`, 'success');
      await loadMarksheet();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('marksheet-tbody').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-req-corr]');
    if (!btn) return;
    const proposed = prompt(`Current score is ${btn.dataset.curScore}. Enter proposed corrected score:`);
    if (proposed === null || proposed.trim() === '') return;
    const reason = prompt('Enter reason for this mark correction (logged for Superadmin approval):');
    if (!reason || reason.trim().length < 5) {
      toast('Please provide a clear reason (at least 5 characters).', 'error');
      return;
    }
    try {
      await api('/api/teacher/marks/correction-request', {
        method: 'POST',
        body: {
          markId: Number(btn.dataset.reqCorr),
          proposedScore: Number(proposed),
          reason: reason.trim(),
        },
      });
      toast('Mark correction request submitted for approval.', 'success');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('export-tc-report-btn').addEventListener('click', () => {
    exportCsv(
      'teacher_class_progress.csv',
      ['Class', 'Subject Code', 'Subject', 'Entries', 'Average %', 'Passed'],
      reportRows.map((r) => [
        r.class_name,
        r.subject_code,
        r.subject_name,
        r.entries_count || 0,
        r.average_pct ?? '',
        r.pass_count || 0,
      ])
    );
  });

  document.getElementById('tc-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/teacher/profile', { method: 'PATCH', body: fd });
      toast('Profile updated.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('tc-pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/auth/password/change', { method: 'POST', body: fd });
      e.target.reset();
      toast('Password changed.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await loadOverview();
})();
