(async function initStudentDashboard() {
  const {
    esc,
    money,
    api,
    toast,
    statusBadge,
    openPaystackCheckout,
    activateSection,
    renderMediaAttachments,
    formatBytes,
  } = window.SMS;

  await SMS.initSession();
  SMS.configureGoogleLinkButton('google-link-btn');
  SMS.configureGoogleLinkButton('st-account-google-btn');
  const stUser = SMS.getUser();
  const stGoogleStatus = document.getElementById('st-google-status-text');
  if (stGoogleStatus && stUser) {
    stGoogleStatus.textContent = stUser.googleLinked
      ? 'Google Sign-In is linked to your student account.'
      : 'Link your Google account for one-click sign-in.';
  }
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);
  document.getElementById('print-report-card-btn').addEventListener('click', () => window.print());
  document.getElementById('print-st-rcp-btn').addEventListener('click', () => window.print());

  const user = SMS.getUser();
  if (user) {
    document.getElementById('sb-user-info').textContent = `${user.fullName} | ${user.email}`;
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

  function renderStudentCoursework(items = []) {
    const wrap = document.getElementById('st-coursework-list');
    if (!wrap) return;
    if (!items.length) {
      wrap.innerHTML =
        '<div class="empty-state">No classwork, homework, tests, or exams assigned to your class yet.</div>';
      return;
    }

    wrap.innerHTML = items
      .map((item) => {
        const wType = String(item.work_type || 'homework').toLowerCase();
        const sub = item.submission;
        const isGraded = sub?.status === 'graded';
        const statusMarkup = isGraded
          ? `<span class="badge badge-success">Graded: ${sub.score} / ${item.max_score}</span>`
          : sub
            ? '<span class="badge badge-info">Submitted</span>'
            : '<span class="badge badge-warning">Pending Your Answer</span>';

        const dueText = item.due_at
          ? `Due: <strong>${esc(String(item.due_at).replace('T', ' '))}</strong>`
          : 'No fixed deadline';

        const teacherAttachmentsHtml = item.attachments?.length
          ? `<div style="margin-top:8px;">
              <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">Teacher Uploaded Materials (${item.attachments.length})</div>
              ${renderMediaAttachments(item.attachments)}
            </div>`
          : '';

        const gradedBanner = isGraded
          ? `<div class="alert alert-success" style="margin-top:10px;margin-bottom:0;">
              <strong>Teacher Score: ${sub.score} / ${item.max_score}</strong>
              ${sub.feedback ? `<div style="margin-top:4px;">Feedback: ${esc(sub.feedback)}</div>` : ''}
            </div>`
          : '';

        const existingStudentFiles = sub?.attachments?.length
          ? `<div style="margin-bottom:10px;">
              <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">Your Uploaded Files (${sub.attachments.length})</div>
              ${renderMediaAttachments(sub.attachments)}
            </div>`
          : '';

        return `<div class="coursework-card">
          <div class="coursework-card-head">
            <div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                <span class="cw-type-badge cw-type-${esc(wType)}">${esc(formatWorkTypeLabel(wType))}</span>
                <span class="badge badge-neutral">${esc(item.subject_code)} - ${esc(item.subject_name)}</span>
                <span style="font-size:12px;color:var(--text-muted);">Teacher: <strong>${esc(item.teacher_name || 'Subject Teacher')}</strong> &middot; Max Score: <strong>${item.max_score}</strong> &middot; ${dueText}</span>
              </div>
              <h3 style="margin:4px 0;font-size:16px;color:var(--text);">${esc(item.title)}</h3>
            </div>
            <div>${statusMarkup}</div>
          </div>

          <div class="coursework-instructions">${esc(item.instructions)}</div>
          ${teacherAttachmentsHtml}
          ${gradedBanner}

          <div class="student-answer-workspace">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
              <strong style="font-size:13.5px;color:#0f172a;">Your Answer &amp; File Upload Workspace</strong>
              ${
                sub?.submittedAt
                  ? `<span style="font-size:12px;color:var(--text-muted);">Last submitted: ${esc(sub.submittedAt)}</span>`
                  : '<span style="font-size:12px;color:var(--text-muted);">Write your response and/or attach images, documents, or videos</span>'
              }
            </div>

            ${existingStudentFiles}

            <form class="student-submit-work-form" data-coursework-id="${item.id}">
              <div class="form-group">
                <label>Written Answer / Solution</label>
                <textarea name="answerText" rows="4" placeholder="Type your answers, workings, or essay response here..." ${isGraded ? 'disabled' : ''}>${esc(sub?.answerText || '')}</textarea>
              </div>
              ${
                isGraded
                  ? '<div style="font-size:12.5px;color:var(--text-muted);">This submission has been graded by your teacher and is locked.</div>'
                  : `<div class="form-group">
                      <label>Upload Images, Documents (PDF / Word / Slides / Sheets), or Videos</label>
                      <div class="upload-dropzone-box">
                        <input type="file" name="attachments" class="st-cw-file-input" multiple accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.rtf,.odt">
                        <div class="upload-hint">Attach photos of handwritten work, PDFs, Word documents, spreadsheets, or video demonstrations (up to 10 files, max 100 MB per file).</div>
                        <div class="st-selected-files subject-badges-wrap" style="margin-top:6px;"></div>
                      </div>
                    </div>
                    <div style="display:flex;justify-content:flex-end;">
                      <button type="submit" class="btn btn-primary">${sub ? 'Update My Answer & Uploads' : 'Submit Answer & Uploads'}</button>
                    </div>`
              }
            </form>
          </div>
        </div>`;
      })
      .join('');
  }

  async function loadStudentCoursework() {
    const filterType = document.getElementById('st-cw-filter-type')?.value || '';
    const qs = filterType ? `?workType=${encodeURIComponent(filterType)}` : '';
    const data = await api(`/api/student/coursework${qs}`);
    renderStudentCoursework(data.items || []);
  }

  async function openOwnReceipt(identifier) {
    const data = await api(`/api/student/receipts/${encodeURIComponent(identifier)}`);
    const r = data.receipt;
    const snap = r.snapshot || {};
    const sym = r.currency_symbol;
    const allocRows = (snap.allocations || [])
      .map((al) => `<tr><td>${esc(al.feeName)}</td><td class="num">${money(al.allocated, sym)}</td></tr>`)
      .join('');
    document.getElementById('st-receipt-printable').innerHTML = `
      <div class="receipt-header">
        <div>
          <h2 style="font-size:18px;font-weight:800;">${esc(data.school.school_name)}</h2>
          <div style="font-size:12px;color:var(--text-muted);">${esc(data.school.address || '')} | ${esc(data.school.phone || '')}</div>
        </div>
        <div style="text-align:right;">
          <div class="badge badge-primary">OFFICIAL FEE RECEIPT</div>
          <div style="font-weight:800;font-size:15px;margin-top:4px;">${esc(r.receipt_number)}</div>
          <div style="font-size:12px;color:var(--text-muted);">Date: ${esc(r.payment_date)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:13px;">
        <div><strong>Student:</strong> ${esc(r.first_name)} ${esc(r.last_name)}<br><strong>Admission #:</strong> ${esc(r.admission_number)}</div>
        <div><strong>Channel:</strong> ${esc(r.payment_method).toUpperCase()}<br><strong>Reference:</strong> ${esc(r.reference_number || 'N/A')}</div>
      </div>
      <table>
        <thead><tr><th>Allocated Fee Item</th><th class="num">Amount Paid (${esc(r.currency_code)})</th></tr></thead>
        <tbody>${allocRows || `<tr><td>School Fee Settlement</td><td class="num">${money(r.issued_amount, sym)}</td></tr>`}</tbody>
        <tfoot>
          <tr><th>Total Paid</th><th class="num">${money(r.issued_amount, sym)}</th></tr>
          ${snap.balanceAfter !== undefined ? `<tr><th>Balance After Payment</th><th class="num">${money(snap.balanceAfter, sym)}</th></tr>` : ''}
        </tfoot>
      </table>
    `;
    document.getElementById('st-receipt-modal').classList.add('open');
  }

  async function loadPortal() {
    const data = await api('/api/student/overview');
    SMS.setCurrency(data.school.currency_code, data.school.currency_symbol);
    document.getElementById('sb-school-name').textContent = data.school.school_name;
    const periodLabel = [data.activeYear?.name, data.activeTerm?.name].filter(Boolean).join(' - ');
    document.getElementById('active-period-badge').textContent = periodLabel || 'Term';

    const s = data.student;
    const att = data.attendanceSummary;
    const fee = data.feeStatement;
    const courseworkItems = data.coursework || [];
    const pendingCoursework = courseworkItems.filter((cw) => !cw.submission).length;

    if (!fee) {
      document.getElementById('nav-fees-btn').classList.add('hidden');
    }

    const rcItems = Array.isArray(data.reportCard) ? data.reportCard : data.reportCard?.rows || [];
    document.getElementById('st-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Admission Number</div><div class="kpi-value" style="font-size:19px;">${esc(s.admission_number)}</div><div class="kpi-sub">${esc(s.class_name || 'Unassigned Class')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Classwork &amp; Exams</div><div class="kpi-value">${courseworkItems.length}</div><div class="kpi-sub">${pendingCoursework} pending your submission</div></div>
      <div class="kpi-card"><div class="kpi-label">Attendance Rate</div><div class="kpi-value">${att.rate !== null ? att.rate + '%' : 'N/A'}</div><div class="kpi-sub">${att.present + att.late} attended of ${att.totalSessions}</div></div>
      ${
        fee
          ? `<div class="kpi-card"><div class="kpi-label">Fee Balance</div><div class="kpi-value">${money(fee.summary.balance)}</div><div class="kpi-sub">Paid: ${money(fee.summary.totalPaid)}</div></div>`
          : `<div class="kpi-card"><div class="kpi-label">Published Subjects</div><div class="kpi-value">${rcItems.length}</div><div class="kpi-sub">${data.subjects.length} enrolled subjects</div></div>`
      }
    `;

    document.getElementById('st-snapshot-box').innerHTML = `
      <p><strong>Student Name:</strong> ${esc(s.first_name)} ${esc(s.last_name)}</p>
      <p><strong>Assigned Class:</strong> ${esc(s.class_name || '-')} ${s.room_number ? '(' + esc(s.room_number) + ')' : ''}</p>
      <p><strong>Enrolled Subjects:</strong> ${data.subjects.length} &middot; <strong>Assigned Works/Exams:</strong> ${courseworkItems.length}</p>
      <p><strong>Guardian:</strong> ${esc(s.guardian_name || '-')} (${esc(s.guardian_phone || '-')})</p>
    `;

    renderStudentCoursework(courseworkItems);

    const annHtml =
      (data.announcements || [])
        .map((a) => {
          const classBadges =
            Array.isArray(a.target_classes) && a.target_classes.length
              ? `<div class="subject-badges-wrap" style="margin-top:4px;">${a.target_classes
                  .map((c) => `<span class="subject-badge-tag">Class: ${esc(c.name)}</span>`)
                  .join('')}</div>`
              : '';
          return `<div style="padding:12px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
              <div>
                <strong>${esc(a.title)}</strong>
                ${a.author_name ? `<small style="color:var(--text-light);margin-left:6px;">by ${esc(a.author_name)}</small>` : ''}
              </div>
              ${statusBadge(a.priority)}
            </div>
            ${classBadges}
            <div style="font-size:13px;color:var(--text-muted);margin-top:6px;white-space:pre-wrap;">${esc(a.body)}</div>
          </div>`;
        })
        .join('') || '<div class="empty-state">No announcements posted.</div>';
    document.getElementById('st-ov-announcements').innerHTML = annHtml;
    document.getElementById('st-all-announcements').innerHTML = annHtml;

    document.getElementById('st-profile-details').innerHTML = `
      <div style="display:grid;gap:8px;font-size:13.5px;">
        <div><strong>Full Name:</strong> ${esc(s.first_name)} ${esc(s.last_name)}</div>
        <div><strong>Admission #:</strong> <code>${esc(s.admission_number)}</code></div>
        <div><strong>Assigned Class:</strong> ${esc(s.class_name || '-')}</div>
        <div><strong>Gender:</strong> ${esc(s.gender || '-')}</div>
        <div><strong>Date of Birth:</strong> ${esc(s.date_of_birth || '-')}</div>
        <div><strong>Email:</strong> ${esc(s.email)}</div>
        <div><strong>Contact Phone:</strong> ${esc(s.phone || '-')}</div>
        <div><strong>Guardian:</strong> ${esc(s.guardian_name || '-')} (${esc(s.guardian_phone || '-')})</div>
        <div><strong>Address:</strong> ${esc(s.address || '-')}</div>
        <div><strong>Enrolment Status:</strong> ${statusBadge(s.status)}</div>
      </div>
    `;
    document.getElementById('st-phone-input').value = s.phone || '';

    document.getElementById('st-prof-requests-list').innerHTML = (data.profileRequests || [])
      .map(
        (r) => `<div style="padding:8px 0;border-top:1px solid var(--border);font-size:12.5px;">
          <code>${esc(r.field_name)}</code> to <strong>${esc(r.requested_value)}</strong> ${statusBadge(r.status)}
        </div>`
      )
      .join('');

    document.getElementById('st-subjects-tbody').innerHTML =
      data.subjects
        .map(
          (sub) => `<tr><td><code>${esc(sub.code)}</code></td><td><strong>${esc(sub.name)}</strong></td><td>${esc(sub.teacher_name || 'TBA')}</td><td class="num">${sub.pass_mark}%</td></tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No subjects assigned yet.</td></tr>';

    SMS.renderTimetableMatrix('st-tt-matrix', data.timetable || [], {
      showClass: false,
      showTeacher: true,
      emptyMessage: 'No timetable scheduled for your class yet.',
    });

    document.getElementById('st-att-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Present</div><div class="kpi-value">${att.present}</div></div>
      <div class="kpi-card"><div class="kpi-label">Late</div><div class="kpi-value">${att.late}</div></div>
      <div class="kpi-card"><div class="kpi-label">Excused</div><div class="kpi-value">${att.excused}</div></div>
      <div class="kpi-card"><div class="kpi-label">Absent</div><div class="kpi-value">${att.absent}</div></div>
    `;
    document.getElementById('st-att-tbody').innerHTML =
      data.attendanceHistory
        .map(
          (h) => `<tr><td class="tabular">${esc(h.session_date)}</td><td>${esc(h.subject_name || 'Daily Roll Call')}</td><td>${statusBadge(h.status)}</td><td>${esc(h.remark || '-')}</td></tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No attendance history yet.</td></tr>';

    document.getElementById('st-results-tbody').innerHTML =
      data.publishedResults
        .map(
          (r) => `<tr>
            <td>${esc(r.term_name)}</td>
            <td><strong>${esc(r.subject_code)} - ${esc(r.subject_name)}</strong></td>
            <td>${esc(r.assessment_title)}</td>
            <td><span class="badge badge-neutral">${esc(r.assessment_type)}</span></td>
            <td class="num">${r.score} / ${r.max_score}</td>
            <td class="num"><strong>${r.percentage}%</strong></td>
            <td>${esc(r.remarks || '-')}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No published results yet.</td></tr>';

    const rcRows = rcItems
      .map(
        (rc) => `<tr>
          <td><code>${esc(rc.subjectCode)}</code></td>
          <td><strong>${esc(rc.subjectName)}</strong></td>
          <td class="num">${rc.finalPercentage}%</td>
          <td><strong>${esc(rc.grade)}</strong> (${rc.gradePoint})</td>
          <td>${esc(rc.remark)}</td>
        </tr>`
      )
      .join('');
    document.getElementById('st-report-card-sheet').innerHTML = `
      <div class="receipt-header">
        <div>
          <h2 style="font-size:18px;font-weight:800;">${esc(data.school.school_name)}</h2>
          <div style="font-size:12px;color:var(--text-muted);">${esc(data.school.motto || '')}</div>
        </div>
        <div style="text-align:right;font-size:12.5px;">
          <div><strong>OFFICIAL STUDENT REPORT CARD</strong></div>
          <div>${esc(data.activeYear?.name || '')} - ${esc(data.activeTerm?.name || '')}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;font-size:13px;">
        <div><strong>Student:</strong> ${esc(s.first_name)} ${esc(s.last_name)} (${esc(s.admission_number)})</div>
        <div><strong>Class:</strong> ${esc(s.class_name || '-')}</div>
        <div><strong>Attendance Rate:</strong> ${att.rate !== null ? att.rate + '%' : 'N/A'}</div>
      </div>
      <table>
        <thead><tr><th>Code</th><th>Subject</th><th class="num">Weighted Score</th><th>Grade (GP)</th><th>Remark</th></tr></thead>
        <tbody>${rcRows || '<tr><td colspan="5" class="empty-state">No published term grades yet.</td></tr>'}</tbody>
      </table>
    `;

    if (fee) {
      document.getElementById('st-fee-kpis').innerHTML = `
        <div class="kpi-card"><div class="kpi-label">Gross Billed</div><div class="kpi-value">${money(fee.summary.totalBilled)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Scholarships / Discounts</div><div class="kpi-value">${money(fee.summary.totalDiscount)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Total Paid</div><div class="kpi-value">${money(fee.summary.totalPaid)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Balance Due</div><div class="kpi-value">${money(fee.summary.balance)}</div></div>
      `;

      const pskCard = document.getElementById('st-paystack-card');
      if (Number(fee.summary.balance) > 0 && data.school.paystack?.enabled !== false) {
        pskCard.classList.remove('hidden');
        document.getElementById('st-pay-amount').value = Number(fee.summary.balance).toFixed(2);
        document.getElementById('st-pay-email').value = s.guardian_email || s.email || '';
      } else {
        pskCard.classList.add('hidden');
      }

      document.getElementById('st-fee-items-tbody').innerHTML =
        fee.assignments
          .map(
            (fa) => `<tr>
              <td><strong>${esc(fa.fee_name)}</strong></td>
              <td>${esc(fa.term_name)}</td>
              <td class="num">${money(fa.amount_due)}</td>
              <td class="num">${money(fa.discount_amount)}</td>
              <td class="num">${money(fa.amount_paid)}</td>
              <td class="num"><strong>${money(fa.balance)}</strong></td>
              <td>${statusBadge(fa.status)}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="7" class="empty-state">No fee items billed.</td></tr>';

      document.getElementById('st-fee-payments-tbody').innerHTML =
        fee.payments
          .map(
            (p) => `<tr>
              <td class="tabular">${esc(p.payment_date)}</td>
              <td><code>${esc(p.receipt_number || '-')}</code></td>
              <td>${esc(p.payment_method)}</td>
              <td class="num"><strong>${money(p.amount)}</strong></td>
              <td>${p.receipt_number ? `<button class="btn btn-secondary btn-sm" data-st-rcp="${esc(p.receipt_number)}">Receipt</button>` : '-'}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="5" class="empty-state">No payments recorded yet.</td></tr>';
    }
  }

  SMS.initNavigation(async (sec) => {
    try {
      if (sec === 'overview') await loadPortal();
      if (sec === 'coursework') await loadStudentCoursework();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('st-open-coursework-btn')?.addEventListener('click', () => {
    activateSection('coursework');
    loadStudentCoursework().catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('st-cw-filter-type')?.addEventListener('change', () => {
    loadStudentCoursework().catch((err) => toast(err.message, 'error'));
  });
  document.getElementById('st-cw-refresh-btn')?.addEventListener('click', () => {
    loadStudentCoursework().catch((err) => toast(err.message, 'error'));
  });

  // Preview file names when student picks files to upload
  document.getElementById('st-coursework-list')?.addEventListener('change', (e) => {
    const fileInput = e.target.closest('.st-cw-file-input');
    if (!fileInput) return;
    const badgeWrap = fileInput.closest('.upload-dropzone-box')?.querySelector('.st-selected-files');
    if (!badgeWrap) return;
    const files = Array.from(fileInput.files || []);
    badgeWrap.innerHTML = files
      .map((f) => `<span class="subject-badge-tag">${esc(f.name)} (${esc(formatBytes(f.size))})</span>`)
      .join('');
  });

  // Submit student text answer + uploaded images/documents/videos
  document.getElementById('st-coursework-list')?.addEventListener('submit', async (e) => {
    const form = e.target.closest('.student-submit-work-form');
    if (!form) return;
    e.preventDefault();
    const courseworkId = Number(form.dataset.courseworkId);
    const answerText = form.elements.answerText?.value || '';
    const fileInput = form.querySelector('.st-cw-file-input');
    const files = Array.from(fileInput?.files || []);

    const fd = new FormData();
    fd.set('answerText', answerText);
    for (const file of files) {
      fd.append('attachments', file);
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await api(`/api/student/coursework/${courseworkId}/submit`, {
        method: 'POST',
        body: fd,
      });
      toast('Your answer and uploaded files have been submitted!', 'success');
      await loadPortal();
      await loadStudentCoursework();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  document.getElementById('st-paystack-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.callbackUrl = `${window.location.origin}/dashboard/student`;
    try {
      const res = await api('/api/student/paystack/initialize', { method: 'POST', body: fd });
      openPaystackCheckout(res.transaction, {
        verifyEndpoint: '/api/student/paystack/verify',
        onSuccess: async (verified) => {
          await loadPortal();
          if (verified.receiptNumber) await openOwnReceipt(verified.receiptNumber);
        },
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('st-fee-payments-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-st-rcp]');
    if (btn) openOwnReceipt(btn.dataset.stRcp).catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('close-st-rcp-modal').addEventListener('click', () => {
    document.getElementById('st-receipt-modal').classList.remove('open');
  });

  document.getElementById('profile-req-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/student/profile/change-request', { method: 'POST', body: fd });
      toast(res.message, 'success');
      e.target.reset();
      await loadPortal();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('st-contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/student/profile/contact', { method: 'PATCH', body: fd });
      toast('Contact phone updated.', 'success');
      await loadPortal();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('st-pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/auth/password/change', { method: 'POST', body: fd });
      toast(res.message || 'Password updated successfully.', 'success');
      e.target.reset();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await loadPortal();

  const params = new URLSearchParams(window.location.search);
  const cbRef = params.get('reference') || params.get('trxref');
  if (cbRef) {
    window.history.replaceState({}, '', window.location.pathname);
    try {
      const verified = await api('/api/student/paystack/verify', {
        method: 'POST',
        body: { reference: cbRef },
      });
      toast(`Paystack fee payment verified - Receipt ${verified.receiptNumber}`, 'success');
      await loadPortal();
      if (verified.receiptNumber) await openOwnReceipt(verified.receiptNumber);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
})();
