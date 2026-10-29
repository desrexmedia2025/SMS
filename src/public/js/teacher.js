(async function initTeacherDashboard() {
  const {
    esc,
    api,
    toast,
    statusBadge,
    activateSection,
    renderMediaAttachments,
    formatBytes,
  } = window.SMS;

  let overviewData = null;
  let activeSubmissionsCourseworkId = null;

  await SMS.initSession();
  SMS.configureGoogleLinkButton('google-link-btn');
  SMS.initOverviewCalendar();
  SMS.initMessageBell();
  SMS.initMessaging();
  SMS.initProfileAvatar();
  SMS.initProfileAvatar({
    imgId: 'prof-avatar-img',
    initialsId: 'prof-avatar-initials',
    changeId: 'prof-photo-btn',
    removeId: 'prof-photo-remove-btn',
    inputId: 'prof-avatar-input',
  });
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);

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
        '<span class="multi-subject-hint">No classes assigned yet. Ask the Superadmin to assign your classes under Teachers.</span>';
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
        return `<div class="feed-item">
          <div class="feed-item-head">
            <div>
              <strong>${esc(a.title)}</strong>
              ${a.author_name ? `<small class="feed-item-meta">by ${esc(a.author_name)}</small>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              ${statusBadge(a.priority)}
              ${isOwn ? `<button type="button" class="btn btn-danger btn-sm" data-del-ann="${a.id}">Delete</button>` : ''}
            </div>
          </div>
          ${classPills}
          <div class="feed-item-body">${esc(a.body)}</div>
        </div>`;
      })
      .join('');
  }

  function renderTeacherCourseworkList(items = []) {
    const wrap = document.getElementById('tc-coursework-list');
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML =
        '<div class="empty-state">No classwork, homework, tests, or exams published yet.</div>';
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
          : 'No deadline';
        const mediaHtml = item.attachments?.length
          ? `<div style="margin-top:8px;"><div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">Uploaded Files (${item.attachments.length})</div>${renderMediaAttachments(item.attachments)}</div>`
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
                <span style="font-size:12px;color:var(--text-muted);margin-right:2px;">Classes:</span>
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
    document.getElementById('cw-submissions-title').textContent = `${formatWorkTypeLabel(cw.work_type)}: ${cw.title}`;
    const targetNames = (cw.target_classes || []).map((c) => c.name).join(', ');
    document.getElementById('cw-submissions-subtitle').textContent = `Classes: ${targetNames || '-'} | Max Score: ${cw.max_score} | ${learners.filter((l) => l.submitted).length} of ${learners.length} submitted`;

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
                <span class="badge badge-neutral">Not Submitted</span>
              </div>
            </div>`;
          }

          const answerBlock = sub.answerText
            ? `<div class="coursework-instructions" style="border-left-color:#10b981;">${esc(sub.answerText)}</div>`
            : '';

          const filesBlock = sub.attachments?.length
            ? `<div style="margin:8px 0;"><div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">Student Uploaded Files (${sub.attachments.length})</div>${renderMediaAttachments(sub.attachments)}</div>`
            : '';

          return `<div class="coursework-card" data-sub-card="${sub.id}">
            <div class="coursework-card-head">
              <div>
                <strong>${esc(row.firstName)} ${esc(row.lastName)}</strong>
                <span style="color:var(--text-light);font-size:12.5px;margin-left:6px;"><code>${esc(row.admissionNumber)}</code> &middot; ${esc(row.className)}</span>
              </div>
              <div>
                ${
                  sub.status === 'graded'
                    ? `<span class="badge badge-success">Graded: ${sub.score} / ${cw.max_score}</span>`
                    : '<span class="badge badge-warning">Submitted</span>'
                }
              </div>
            </div>
            ${answerBlock}
            ${filesBlock}
            <form class="grade-submission-form" data-submission-id="${sub.id}" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;">
              <div class="form-group" style="margin:0;width:150px;">
                <label>Score (/ ${cw.max_score})</label>
                <input type="number" name="score" step="0.01" min="0" max="${cw.max_score}" value="${sub.score !== null && sub.score !== undefined ? sub.score : ''}" required>
              </div>
              <div class="form-group" style="margin:0;flex:1 1 260px;">
                <label>Feedback (Optional)</label>
                <input type="text" name="feedback" value="${esc(sub.feedback || '')}" placeholder="Write feedback for student...">
              </div>
              <button type="submit" class="btn btn-primary btn-sm">Save Score</button>
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
    document.getElementById('sb-user-info').textContent =
      `${data.teacher.full_name} | ${data.teacher.staff_number}`;

    if (data.teacher.googleLinked) {
      document.getElementById('google-link-btn').textContent = 'Google Linked';
    }

    const regSubjects = data.registeredSubjects || data.teacher.subjects || [];
    const subjectsSummary = regSubjects.length
      ? regSubjects.map((s) => s.name).join(', ')
      : 'No subjects linked yet';

    const m = data.metrics;
    document.getElementById('tc-kpis').innerHTML = [
      SMS.kpiCard({
        label: 'Assigned Classes',
        value: m.assignedClasses,
        sub: 'Active teaching classes',
        icon: 'layers',
        tone: 'blue',
      }),
      SMS.kpiCard({
        label: 'Subjects I Teach',
        value: m.assignedSubjects,
        sub: esc(subjectsSummary),
        icon: 'book',
        tone: 'indigo',
      }),
      SMS.kpiCard({
        label: 'Published Works & Exams',
        value: m.courseworkCount || 0,
        sub: 'Classwork, homework, tests & exams',
        icon: 'clipboard',
        tone: 'teal',
      }),
    ].join('');

    document.getElementById('tc-ov-subjects-wrap').innerHTML = regSubjects.length
      ? `<div class="subject-badges-wrap">${regSubjects
          .map(
            (s) =>
              `<span class="subject-badge-tag"><strong>${esc(s.code)}</strong> &middot; ${esc(s.name)}</span>`
          )
          .join('')}</div>`
      : '<div class="empty-state" style="padding:14px 0;">No subjects linked yet.</div>';

    document.getElementById('cw-subject-select').innerHTML = regSubjects.length
      ? regSubjects
          .map((s) => `<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`)
          .join('')
      : '<option value="">No subjects linked yet</option>';

    const assignedClasses = data.assignedClasses || [];
    trcAssignedClasses = assignedClasses;
    const trcClassSel = document.getElementById('trc-class');
    if (trcClassSel && !trcClassSel.value && assignedClasses.length) {
      trcClassSel.innerHTML = assignedClasses
        .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
        .join('');
    }
    renderAssignedClassCheckboxes('cw-target-classes-grid', assignedClasses);
    renderAssignedClassCheckboxes('tc-ann-classes-grid', assignedClasses);

    const cwFilterCls = document.getElementById('cw-filter-class');
    if (cwFilterCls) {
      const prev = cwFilterCls.value;
      cwFilterCls.innerHTML =
        '<option value="">All My Classes</option>' +
        assignedClasses.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      if (prev) cwFilterCls.value = prev;
    }

    const rosterSel = document.getElementById('roster-class-select');
    if (rosterSel) {
      rosterSel.innerHTML = assignedClasses.length
        ? assignedClasses.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
        : '<option value="">No assigned classes yet</option>';
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
      : '<tr><td colspan="2" class="empty-state">No classes assigned yet.</td></tr>';

    SMS.renderTimetableMatrix('tc-tt-matrix', data.timetable || [], {
      showClass: true,
      showTeacher: false,
      emptyMessage: 'No timetable lessons scheduled yet.',
    });

    renderAnnouncementsFeed(data.announcements || []);

    document.getElementById('prof-staff-no').value = data.teacher.staff_number || '';
    document.getElementById('prof-phone').value = data.teacher.phone || '';
    document.getElementById('prof-qual').value = data.teacher.qualification || '';
  }

  async function loadClassRoster() {
    const classId = document.getElementById('roster-class-select')?.value;
    if (!classId) {
      document.getElementById('roster-tbody').innerHTML =
        '<tr><td colspan="4" class="empty-state">No assigned class selected.</td></tr>';
      return;
    }
    const data = await api(`/api/teacher/class-list?classId=${encodeURIComponent(classId)}`);
    document.getElementById('roster-tbody').innerHTML =
      data.students
        .map(
          (s) => `<tr>
            <td><code>${esc(s.admission_number)}</code></td>
            <td><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong></td>
            <td>${esc(s.gender || '-')}</td>
            <td>${esc(s.guardian_name || '-')} ${s.guardian_phone ? '(' + esc(s.guardian_phone) + ')' : ''}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No students enrolled in this class yet.</td></tr>';
  }


  // ---------------- REPORT CARDS ----------------
  let trcAssignedClasses = [];
  let trcCards = [];

  async function loadTeacherReportCards() {
    const classSel = document.getElementById('trc-class');
    const yearSel = document.getElementById('trc-year');
    const termSel = document.getElementById('trc-term');
    const qs = new URLSearchParams();
    if (classSel.value) qs.set('classId', classSel.value);
    if (yearSel.value) qs.set('academicYearId', yearSel.value);
    if (termSel.value) qs.set('termId', termSel.value);
    const data = await api(`/api/teacher/report-cards?${qs.toString()}`);
    if (data.years) {
      yearSel.innerHTML = (data.years || [])
        .map((y) => `<option value="${y.id}"${y.isActive ? ' selected' : ''}>${esc(y.name)}</option>`)
        .join('');
    }
    if (data.terms) {
      const yearId = Number(yearSel.value);
      const filtered = (data.terms || []).filter((t) => !yearId || t.academicYearId === yearId);
      termSel.innerHTML = filtered
        .map((t) => `<option value="${t.id}"${t.isActive ? ' selected' : ''}>${esc(t.name)}</option>`)
        .join('');
    }
    trcCards = data.items || [];
    renderTeacherReportCards();
  }

  function renderTeacherReportCards() {
    document.getElementById('trc-tbody').innerHTML =
      trcCards
        .map(
          (r) => `<tr>
            <td>${r.classPosition ? `<strong>${esc(String(r.classPosition))}</strong> / ${esc(String(r.classSize))}` : '-'}</td>
            <td><strong>${esc(r.studentName)}</strong><div class="muted-sm">${esc(r.admissionNumber)}</div></td>
            <td>${esc(String(r.overallAverage))}%</td>
            <td><span class="badge badge-neutral">${esc(r.overallGrade)}</span></td>
            <td class="tabular">${esc(r.attendanceSummary)}</td>
            <td>${esc(r.teacherRemark || '-')}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
              <button type="button" class="btn btn-secondary btn-sm" data-trc-print="${r.studentId}">Print</button>
              <button type="button" class="btn btn-secondary btn-sm" data-trc-remark="${r.studentId}">Remark</button>
            </td>
          </tr>`
        )
        .join('') ||
      '<tr><td colspan="7" class="empty-state">No report cards available yet. Ask the Superadmin to generate them.</td></tr>';
  }

  document.getElementById('trc-load-btn')?.addEventListener('click', () => {
    loadTeacherReportCards().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('trc-class')?.addEventListener('change', () => {
    loadTeacherReportCards().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('trc-year')?.addEventListener('change', () => {
    loadTeacherReportCards().catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('trc-tbody')?.addEventListener('click', async (e) => {
    const yearId = document.getElementById('trc-year').value;
    const termId = document.getElementById('trc-term').value;

    const printBtn = e.target.closest('[data-trc-print]');
    if (printBtn) {
      try {
        const res = await api(
          `/api/teacher/report-cards/student/${printBtn.dataset.trcPrint}?academicYearId=${encodeURIComponent(
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

    const remarkBtn = e.target.closest('[data-trc-remark]');
    if (remarkBtn) {
      const studentId = remarkBtn.dataset.trcRemark;
      const card = trcCards.find((c) => String(c.studentId) === String(studentId));
      const remark = window.prompt(
        `Class teacher's remark for ${card ? card.studentName : 'this student'}:`,
        card?.teacherRemark || ''
      );
      if (remark === null) return;
      try {
        const res = await api('/api/teacher/report-cards/remark', {
          method: 'POST',
          body: { studentId, academicYearId: yearId, termId, teacherRemark: remark },
        });
        toast(res.message || 'Remark saved.', 'success');
        await loadTeacherReportCards();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  SMS.initNavigation(async (sec) => {
    try {
      if (sec === 'overview') await loadOverview();
      if (sec === 'coursework') await loadCourseworkList();
      if (sec === 'classes') await loadClassRoster();
      if (sec === 'report-cards') await loadTeacherReportCards();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('ov-quick-coursework-btn')?.addEventListener('click', () => {
    activateSection('coursework');
    loadCourseworkList().catch(() => {});
  });
  document.getElementById('ov-quick-announce-btn')?.addEventListener('click', () => {
    activateSection('announcements');
  });

  // Two-way All Assigned Classes checkbox sync
  document.getElementById('cw-all-classes-chk')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('#cw-target-classes-grid input[type="checkbox"]').forEach((cb) => {
      cb.checked = checked;
    });
  });

  document.getElementById('cw-target-classes-grid')?.addEventListener('change', () => {
    const boxes = Array.from(
      document.querySelectorAll('#cw-target-classes-grid input[type="checkbox"]')
    );
    const allChk = document.getElementById('cw-all-classes-chk');
    if (allChk && boxes.length > 0) allChk.checked = boxes.every((b) => b.checked);
  });

  document.getElementById('tc-ann-all-classes')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('#tc-ann-classes-grid input[type="checkbox"]').forEach((cb) => {
      cb.checked = checked;
    });
  });

  document.getElementById('tc-ann-classes-grid')?.addEventListener('change', () => {
    const boxes = Array.from(
      document.querySelectorAll('#tc-ann-classes-grid input[type="checkbox"]')
    );
    const allChk = document.getElementById('tc-ann-all-classes');
    if (allChk && boxes.length > 0) allChk.checked = boxes.every((b) => b.checked);
  });

  document.getElementById('cw-files-input')?.addEventListener('change', (e) => {
    const listEl = document.getElementById('cw-selected-files-list');
    if (!listEl) return;
    const files = Array.from(e.target.files || []);
    listEl.innerHTML = files
      .map((f) => `<span class="subject-badge-tag">${esc(f.name)} (${esc(formatBytes(f.size))})</span>`)
      .join('');
  });

  document.getElementById('create-coursework-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const allChecked = document.getElementById('cw-all-classes-chk')?.checked;
    const selectedClassIds = getCheckedClassIds('cw-target-classes-grid');
    if (!allChecked && !selectedClassIds.length) {
      toast('Select at least one assigned class or check All My Assigned Classes.', 'error');
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
      document.getElementById('cw-selected-files-list').innerHTML = '';
      toast(
        `${formatWorkTypeLabel(res.coursework.workType)} sent to ${res.coursework.targetClassIds.length} class(es).`,
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
      if (!confirm('Delete this item and its submissions?')) return;
      try {
        await api(`/api/teacher/coursework/${delBtn.dataset.deleteCw}`, { method: 'DELETE' });
        toast('Deleted.', 'info');
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
      toast('Score saved.', 'success');
      if (activeSubmissionsCourseworkId) {
        await openCourseworkSubmissions(activeSubmissionsCourseworkId);
      }
      await loadCourseworkList();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('tc-create-announcement-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const allChecked = document.getElementById('tc-ann-all-classes')?.checked;
    const classIds = getCheckedClassIds('tc-ann-classes-grid');
    if (!allChecked && !classIds.length) {
      toast('Select at least one assigned class or check All My Assigned Classes.', 'error');
      return;
    }

    try {
      const res = await api('/api/teacher/announcements', {
        method: 'POST',
        body: {
          title: form.elements.title.value,
          priority: form.elements.priority.value,
          body: form.elements.body.value,
          applyToAllClasses: Boolean(allChecked),
          classIds,
        },
      });
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
    if (!confirm('Delete this announcement?')) return;
    try {
      await api(`/api/teacher/announcements/${delBtn.dataset.delAnn}`, { method: 'DELETE' });
      toast('Announcement deleted.', 'info');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('load-roster-btn')?.addEventListener('click', loadClassRoster);
  document.getElementById('roster-class-select')?.addEventListener('change', loadClassRoster);

  document.getElementById('tc-profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/teacher/profile', { method: 'PATCH', body: fd });
      toast('Profile saved.', 'success');
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
      toast('Password updated.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await loadOverview();
})();
