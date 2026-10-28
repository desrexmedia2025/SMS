(async function initTeacherDashboard() {
  const { esc, api, toast, statusBadge, exportCsv } = window.SMS;
  let overviewData = null;
  let currentAssessment = null;
  let reportRows = [];

  await SMS.initSession();
  SMS.configureGoogleLinkButton('google-link-btn');
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);
  document.getElementById('att-date-input').value = new Date().toISOString().slice(0, 10);

  async function loadOverview() {
    const data = await api('/api/teacher/overview');
    overviewData = data;
    document.getElementById('sb-school-name').textContent = data.settings?.school_name || 'SMS';
    document.getElementById('active-period-badge').textContent =
      `${data.activeYear?.name || ''} · ${data.activeTerm?.name || ''}`;
    document.getElementById('sb-user-info').textContent =
      `${data.teacher.full_name} · ${data.teacher.staff_number}`;

    if (data.teacher.googleLinked) {
      document.getElementById('google-link-btn').textContent = 'Google Linked';
    }

    const m = data.metrics;
    document.getElementById('tc-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Assigned Classes</div><div class="kpi-value">${m.assignedClasses}</div><div class="kpi-sub">Active teaching groups</div></div>
      <div class="kpi-card"><div class="kpi-label">Subjects Taught</div><div class="kpi-value">${m.assignedSubjects}</div><div class="kpi-sub">${esc(data.teacher.department || 'Academic Staff')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Weekly Timetable Slots</div><div class="kpi-value">${m.weeklyLessons}</div><div class="kpi-sub">Scheduled periods</div></div>
      <div class="kpi-card"><div class="kpi-label">Assessments</div><div class="kpi-value">${m.assessmentsCount}</div><div class="kpi-sub">Created for assigned subjects</div></div>
    `;

    document.getElementById('tc-ov-assignments').innerHTML = data.assignments
      .map(
        (a) => `<tr>
          <td><strong>${esc(a.class_name)}</strong>${a.stream_name ? ' · ' + esc(a.stream_name) : ''}</td>
          <td>${esc(a.subject_code)} — ${esc(a.subject_name)}</td>
          <td>${esc(a.room_number || '-')}</td>
        </tr>`
      )
      .join('');

    document.getElementById('tc-assignments-tbody').innerHTML = data.assignments
      .map(
        (a) => `<tr>
          <td><strong>${esc(a.class_name)}</strong></td>
          <td>${esc(a.stream_name || 'All')}</td>
          <td>${esc(a.room_number || '-')}</td>
          <td><code>${esc(a.subject_code)}</code></td>
          <td>${esc(a.subject_name)}</td>
          <td class="num">${a.pass_mark}%</td>
        </tr>`
      )
      .join('');

    document.getElementById('tc-ov-sessions').innerHTML =
      data.recentSessions
        .slice(0, 6)
        .map(
          (s) => `<tr>
            <td class="tabular">${esc(s.session_date)}</td>
            <td>${esc(s.class_name)}</td>
            <td>${esc(s.subject_name || 'Homeroom')}</td>
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

    // Assignment dropdowns
    const asgOptions = data.assignments
      .map(
        (a, idx) =>
          `<option value="${idx}">${esc(a.class_name)}${a.stream_name ? ' (' + esc(a.stream_name) + ')' : ''} — ${esc(a.subject_code)} ${esc(a.subject_name)}</option>`
      )
      .join('');
    ['roster-assignment-select', 'att-assignment-select', 'new-assess-assignment'].forEach((id) => {
      document.getElementById(id).innerHTML = asgOptions;
    });

    // Assessments dropdown
    document.getElementById('select-assessment').innerHTML = data.assessments
      .map(
        (a) =>
          `<option value="${a.id}">${esc(a.title)} · ${esc(a.class_name)} (${a.is_published ? 'Published' : 'Draft'})</option>`
      )
      .join('');

    document.getElementById('tc-corr-tbody').innerHTML =
      data.myCorrectionRequests
        .map(
          (c) => `<tr>
            <td>${esc(c.first_name)} ${esc(c.last_name)}</td>
            <td>${esc(c.assessment_title)}</td>
            <td class="tabular">${c.previous_score} → <strong>${c.proposed_score}</strong></td>
            <td>${statusBadge(c.status)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No correction requests submitted.</td></tr>';

    document.getElementById('tc-announcements').innerHTML =
      data.announcements
        .map(
          (a) => `<div style="padding:12px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;"><strong>${esc(a.title)}</strong>${statusBadge(a.priority)}</div>
            <p style="margin:6px 0;color:var(--text-muted);">${esc(a.body)}</p>
          </div>`
        )
        .join('') || '<div class="empty-state">No announcements.</div>';

    // Profile fields
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
    if (asg.stream_id) q.set('streamId', asg.stream_id);
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
            <td>${esc(s.guardian_name || '-')} · ${esc(s.guardian_phone || '')}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty-state">No learners enrolled in this class/stream.</td></tr>';
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
    if (asg.stream_id) q.set('streamId', asg.stream_id);

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
        .join('') || '<tr><td colspan="4" class="empty-state">No learners enrolled.</td></tr>';
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
        'This assessment is already PUBLISHED to students. Direct overwriting is locked; use "Request Correction" on any row to submit an audited correction for Superadmin approval.';
      banner.classList.remove('hidden');
      saveBtn.disabled = true;
    } else {
      banner.classList.add('hidden');
      saveBtn.disabled = false;
    }

    document.getElementById('marksheet-tbody').innerHTML = data.students
      .map(
        (s) => `<tr data-mark-student="${s.student_id}" data-mark-id="${s.mark_id || ''}">
          <td><code>${esc(s.admission_number)}</code></td>
          <td><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong></td>
          <td class="num" style="width:130px;">
            <input type="number" step="0.01" min="0" max="${data.assessment.max_score}" class="mark-score-inp" value="${s.score !== '' ? s.score : ''}" ${data.lockedForDirectEdit ? 'disabled' : ''}>
          </td>
          <td class="num">${s.percentage !== null ? s.percentage + '%' : '—'}</td>
          <td><strong>${esc(s.grade || '—')}</strong></td>
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
      .join('');
  }

  async function loadProgressReports() {
    const data = await api('/api/teacher/reports');
    reportRows = data.reports || [];
    document.getElementById('tc-reports-tbody').innerHTML = reportRows
      .map(
        (r) => `<tr>
          <td><strong>${esc(r.class_name)}</strong> · ${esc(r.stream_name)}</td>
          <td>${esc(r.subject_code)} — ${esc(r.subject_name)}</td>
          <td class="num">${r.entries_count || 0}</td>
          <td class="num">${r.average_pct !== null ? r.average_pct + '%' : '—'}</td>
          <td class="num">${r.highest_pct !== null ? r.highest_pct + '%' : '—'}</td>
          <td class="num">${r.lowest_pct !== null ? r.lowest_pct + '%' : '—'}</td>
          <td class="num">${r.pass_count || 0}</td>
        </tr>`
      )
      .join('');
  }

  SMS.initNavigation(async (sec) => {
    try {
      if (sec === 'overview') await loadOverview();
      if (sec === 'classlists') await loadClassRoster();
      if (sec === 'attendance') await loadAttendanceSheet();
      if (sec === 'marks') await loadMarksheet();
      if (sec === 'reports') await loadProgressReports();
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
          streamId: asg.stream_id,
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
    fd.streamId = asg.stream_id;
    fd.subjectId = asg.subject_id;
    try {
      await api('/api/teacher/assessments', { method: 'POST', body: fd });
      e.target.reset();
      toast('Assessment created.', 'success');
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
      ['Class', 'Stream', 'Subject Code', 'Subject', 'Entries', 'Average %', 'Passed'],
      reportRows.map((r) => [
        r.class_name,
        r.stream_name,
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
