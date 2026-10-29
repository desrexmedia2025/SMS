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
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);
  document.getElementById('print-results-btn')?.addEventListener('click', () => window.print());
  document.getElementById('print-st-rcp-btn')?.addEventListener('click', () => window.print());

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
            : '<span class="badge badge-warning">Pending</span>';

        const dueText = item.due_at
          ? `Due: <strong>${esc(String(item.due_at).replace('T', ' '))}</strong>`
          : 'No deadline';

        const teacherAttachmentsHtml = item.attachments?.length
          ? `<div style="margin-top:8px;">
              <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:4px;">Teacher Materials (${item.attachments.length})</div>
              ${renderMediaAttachments(item.attachments)}
            </div>`
          : '';

        const gradedBanner = isGraded
          ? `<div class="alert alert-success" style="margin-top:10px;margin-bottom:0;">
              <strong>Score: ${sub.score} / ${item.max_score}</strong>
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
              <strong style="font-size:13.5px;color:#0f172a;">Your Answer &amp; Uploads</strong>
              ${
                sub?.submittedAt
                  ? `<span style="font-size:12px;color:var(--text-muted);">Submitted: ${esc(sub.submittedAt)}</span>`
                  : ''
              }
            </div>

            ${existingStudentFiles}

            <form class="student-submit-work-form" data-coursework-id="${item.id}">
              <div class="form-group">
                <label>Your Written Answer</label>
                <textarea name="answerText" rows="4" placeholder="Write your answers here..." ${isGraded ? 'disabled' : ''}>${esc(sub?.answerText || '')}</textarea>
              </div>
              ${
                isGraded
                  ? '<div style="font-size:12.5px;color:var(--text-muted);">Graded by teacher.</div>'
                  : `<div class="form-group">
                      <label>Upload Images, Documents or Videos (Optional)</label>
                      <div class="upload-dropzone-box">
                        <input type="file" name="attachments" class="st-cw-file-input" multiple accept="image/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.rtf,.odt">
                        <div class="upload-hint">Upload photos of your work, PDFs/Word documents, or videos.</div>
                        <div class="st-selected-files subject-badges-wrap" style="margin-top:6px;"></div>
                      </div>
                    </div>
                    <div style="display:flex;justify-content:flex-end;">
                      <button type="submit" class="btn btn-primary">${sub ? 'Update Submission' : 'Submit Answer'}</button>
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
          <div style="font-size:12px;color:var(--text-muted);">${esc(data.school.address || '')} ${data.school.phone ? '| ' + esc(data.school.phone) : ''}</div>
        </div>
        <div style="text-align:right;">
          <div class="badge badge-primary">OFFICIAL RECEIPT</div>
          <div style="font-weight:800;font-size:15px;margin-top:4px;">${esc(r.receipt_number)}</div>
          <div style="font-size:12px;color:var(--text-muted);">Date: ${esc(r.payment_date)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:13px;">
        <div><strong>Student:</strong> ${esc(r.first_name)} ${esc(r.last_name)}<br><strong>Admission #:</strong> ${esc(r.admission_number)}</div>
        <div><strong>Method:</strong> ${esc(r.payment_method).toUpperCase()}<br><strong>Reference:</strong> ${esc(r.reference_number || 'N/A')}</div>
      </div>
      <table>
        <thead><tr><th>Fee Item</th><th class="num">Amount Paid (${esc(r.currency_code)})</th></tr></thead>
        <tbody>${allocRows || `<tr><td>School Fee Payment</td><td class="num">${money(r.issued_amount, sym)}</td></tr>`}</tbody>
        <tfoot>
          <tr><th>Total Paid</th><th class="num">${money(r.issued_amount, sym)}</th></tr>
        </tfoot>
      </table>
    `;
    document.getElementById('st-receipt-modal').classList.add('open');
  }

  async function loadPortal() {
    const data = await api('/api/student/overview');
    SMS.setCurrency(data.school.currency_code, data.school.currency_symbol);
    document.getElementById('sb-school-name').textContent = data.school.school_name;

    const s = data.student;
    const fee = data.feeStatement;
    const courseworkItems = data.coursework || [];
    const pendingCoursework = courseworkItems.filter((cw) => !cw.submission).length;
    const gradedCoursework = courseworkItems.filter((cw) => cw.submission?.status === 'graded');

    if (!fee) {
      document.getElementById('nav-fees-btn').classList.add('hidden');
    } else {
      document.getElementById('nav-fees-btn').classList.remove('hidden');
    }

    const stKpiCards = [
      SMS.kpiCard({
        label: 'Class',
        value: esc(s.class_name || 'Unassigned'),
        sub: `Adm #: ${esc(s.admission_number)}`,
        icon: 'graduation',
        tone: 'blue',
        valueStyle: 'font-size:21px;',
      }),
      SMS.kpiCard({
        label: 'Works & Exams',
        value: courseworkItems.length,
        sub: `${pendingCoursework} pending`,
        icon: 'clipboard',
        tone: 'indigo',
      }),
      SMS.kpiCard({
        label: 'Subjects',
        value: data.subjects.length,
        sub: 'Enrolled subjects',
        icon: 'book',
        tone: 'sky',
      }),
    ];
    if (fee) {
      stKpiCards.push(
        SMS.kpiCard({
          label: 'Fee Balance',
          value: money(fee.summary.balance),
          sub: `Paid: ${money(fee.summary.totalPaid)}`,
          icon: 'wallet',
          tone: 'teal',
        })
      );
    }
    document.getElementById('st-kpis').innerHTML = stKpiCards.join('');

    document.getElementById('st-subjects-tbody').innerHTML =
      data.subjects
        .map(
          (sub) => `<tr><td><code>${esc(sub.code)}</code></td><td><strong>${esc(sub.name)}</strong></td><td>${esc(sub.teacher_name || 'TBA')}</td></tr>`
        )
        .join('') || '<tr><td colspan="3" class="empty-state">No subjects assigned yet.</td></tr>';

    renderStudentCoursework(courseworkItems);

    // Unified Scores table (graded coursework + published assessment marks)
    const cwScoreRows = gradedCoursework.map(
      (cw) => `<tr>
        <td><span class="cw-type-badge cw-type-${esc(String(cw.work_type || 'homework').toLowerCase())}">${esc(formatWorkTypeLabel(cw.work_type))}</span></td>
        <td><strong>${esc(cw.subject_code)} - ${esc(cw.subject_name)}</strong></td>
        <td>${esc(cw.title)}</td>
        <td class="num"><strong>${cw.submission.score} / ${cw.max_score}</strong></td>
        <td>${esc(cw.submission.feedback || '-')}</td>
      </tr>`
    );
    const pubScoreRows = (data.publishedResults || []).map(
      (r) => `<tr>
        <td><span class="badge badge-neutral">${esc(r.assessment_type)}</span></td>
        <td><strong>${esc(r.subject_code)} - ${esc(r.subject_name)}</strong></td>
        <td>${esc(r.assessment_title)}</td>
        <td class="num"><strong>${r.score} / ${r.max_score}</strong> (${r.percentage}%)</td>
        <td>${esc(r.remarks || '-')}</td>
      </tr>`
    );
    const allScoreRows = [...cwScoreRows, ...pubScoreRows];
    document.getElementById('st-results-tbody').innerHTML =
      allScoreRows.join('') || '<tr><td colspan="5" class="empty-state">No graded scores yet.</td></tr>';

    const annHtml =
      (data.announcements || [])
        .map((a) => {
          const classBadges =
            Array.isArray(a.target_classes) && a.target_classes.length
              ? `<div class="subject-badges-wrap" style="margin-top:6px;">${a.target_classes
                  .map((c) => `<span class="subject-badge-tag">Class: ${esc(c.name)}</span>`)
                  .join('')}</div>`
              : '';
          return `<div class="feed-item">
            <div class="feed-item-head">
              <div>
                <strong>${esc(a.title)}</strong>
                ${a.author_name ? `<small class="feed-item-meta">by ${esc(a.author_name)}</small>` : ''}
              </div>
              ${statusBadge(a.priority)}
            </div>
            ${classBadges}
            <div class="feed-item-body">${esc(a.body)}</div>
          </div>`;
        })
        .join('') || '<div class="empty-state">No announcements posted.</div>';
    document.getElementById('st-ov-announcements').innerHTML = annHtml;
    document.getElementById('st-all-announcements').innerHTML = annHtml;

    document.getElementById('st-profile-details').innerHTML = `
      <div class="profile-kv-grid">
        <div class="profile-kv-row"><span class="profile-kv-label">Name</span><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong></div>
        <div class="profile-kv-row"><span class="profile-kv-label">Admission #</span><code>${esc(s.admission_number)}</code></div>
        <div class="profile-kv-row"><span class="profile-kv-label">Class</span><span>${esc(s.class_name || '-')}</span></div>
        <div class="profile-kv-row"><span class="profile-kv-label">Email</span><span>${esc(s.email)}</span></div>
        <div class="profile-kv-row"><span class="profile-kv-label">Guardian</span><span>${esc(s.guardian_name || '-')} ${s.guardian_phone ? '(' + esc(s.guardian_phone) + ')' : ''}</span></div>
      </div>
    `;
    document.getElementById('st-phone-input').value = s.phone || '';

    SMS.renderTimetableMatrix('st-tt-matrix', data.timetable || [], {
      showClass: false,
      showTeacher: true,
      emptyMessage: 'No timetable scheduled for your class yet.',
    });

    if (fee) {
      document.getElementById('st-fee-kpis').innerHTML = [
        SMS.kpiCard({
          label: 'Total Billed',
          value: money(fee.summary.totalBilled),
          sub: 'Assigned school fees',
          icon: 'layers',
          tone: 'blue',
        }),
        SMS.kpiCard({
          label: 'Total Paid',
          value: money(fee.summary.totalPaid),
          sub: 'Verified payments',
          icon: 'check',
          tone: 'teal',
        }),
        SMS.kpiCard({
          label: 'Balance Due',
          value: money(fee.summary.balance),
          sub: 'Remaining balance',
          icon: 'wallet',
          tone: 'indigo',
        }),
      ].join('');

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
              <td class="num">${money(fa.amount_due)}</td>
              <td class="num">${money(fa.amount_paid)}</td>
              <td class="num"><strong>${money(fa.balance)}</strong></td>
              <td>${statusBadge(fa.status)}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="5" class="empty-state">No fee items billed.</td></tr>';

      document.getElementById('st-fee-payments-tbody').innerHTML =
        fee.payments
          .map(
            (p) => `<tr>
              <td class="tabular">${esc(p.payment_date)}</td>
              <td><code>${esc(p.receipt_number || '-')}</code></td>
              <td class="num"><strong>${money(p.amount)}</strong></td>
              <td>${p.receipt_number ? `<button class="btn btn-secondary btn-sm" data-st-rcp="${esc(p.receipt_number)}">Print</button>` : '-'}</td>
            </tr>`
          )
          .join('') || '<tr><td colspan="4" class="empty-state">No payments yet.</td></tr>';
    }
  }

  SMS.initNavigation(async (sec) => {
    try {
      if (sec === 'overview' || sec === 'results') await loadPortal();
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
      toast('Your answer and files have been submitted!', 'success');
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

  document.getElementById('st-contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/student/profile/contact', { method: 'PATCH', body: fd });
      toast('Phone updated.', 'success');
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
      toast(res.message || 'Password updated.', 'success');
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
      toast(`Payment verified - Receipt ${verified.receiptNumber}`, 'success');
      await loadPortal();
      if (verified.receiptNumber) await openOwnReceipt(verified.receiptNumber);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
})();
