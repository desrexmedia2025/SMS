(async function initStudentDashboard() {
  const { esc, money, api, toast, statusBadge, openPaystackCheckout } = window.SMS;

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
  SMS.initNavigation();

  const user = SMS.getUser();
  if (user) {
    document.getElementById('sb-user-info').textContent = `${user.fullName} | ${user.email}`;
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
    document.getElementById('active-period-badge').textContent =
      `${data.activeYear?.name || ''} - ${data.activeTerm?.name || ''}`;

    const s = data.student;
    const att = data.attendanceSummary;
    const fee = data.feeStatement;

    if (!fee) {
      document.getElementById('nav-fees-btn').classList.add('hidden');
    }

    const rcItems = Array.isArray(data.reportCard) ? data.reportCard : data.reportCard?.rows || [];
    document.getElementById('st-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Admission Number</div><div class="kpi-value" style="font-size:19px;">${esc(s.admission_number)}</div><div class="kpi-sub">${esc(s.class_name || '')} ${esc(s.stream_name || '')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Attendance Rate</div><div class="kpi-value">${att.rate !== null ? att.rate + '%' : 'N/A'}</div><div class="kpi-sub">${att.present + att.late} attended of ${att.totalSessions}</div></div>
      <div class="kpi-card"><div class="kpi-label">Published Subjects</div><div class="kpi-value">${rcItems.length}</div><div class="kpi-sub">${data.subjects.length} enrolled subjects</div></div>
      ${
        fee
          ? `<div class="kpi-card"><div class="kpi-label">Fee Balance</div><div class="kpi-value">${money(fee.summary.balance)}</div><div class="kpi-sub">Paid: ${money(fee.summary.totalPaid)}</div></div>`
          : ''
      }
    `;

    document.getElementById('st-snapshot-box').innerHTML = `
      <p><strong>Student Name:</strong> ${esc(s.first_name)} ${esc(s.last_name)}</p>
      <p><strong>Class &amp; Stream:</strong> ${esc(s.class_name || '-')} - ${esc(s.stream_name || 'General')} (${esc(s.room_number || 'Main')})</p>
      <p><strong>Guardian:</strong> ${esc(s.guardian_name || '-')} (${esc(s.guardian_phone || '-')})</p>
    `;

    const annHtml =
      (data.announcements || [])
        .map(
          (a) => `<div style="padding:10px 0;border-bottom:1px solid var(--border);">
            <div style="display:flex;justify-content:space-between;"><strong>${esc(a.title)}</strong>${statusBadge(a.priority)}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">${esc(a.body)}</div>
          </div>`
        )
        .join('') || '<div class="empty-state">No announcements posted.</div>';
    document.getElementById('st-ov-announcements').innerHTML = annHtml;
    document.getElementById('st-all-announcements').innerHTML = annHtml;

    document.getElementById('st-profile-details').innerHTML = `
      <div style="display:grid;gap:8px;font-size:13.5px;">
        <div><strong>Full Name:</strong> ${esc(s.first_name)} ${esc(s.last_name)}</div>
        <div><strong>Admission #:</strong> <code>${esc(s.admission_number)}</code></div>
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
        <div><strong>Class:</strong> ${esc(s.class_name || '')} - ${esc(s.stream_name || '')}</div>
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
