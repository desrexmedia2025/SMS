(async function initFinancialDashboard() {
  const { esc, money, api, toast, statusBadge, openPaystackCheckout } = window.SMS;

  await SMS.initSession();
  SMS.configureGoogleLinkButton('google-link-btn');
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);
  document.getElementById('print-fin-rcp-btn')?.addEventListener('click', () => window.print());

  const user = SMS.getUser();
  if (user) {
    document.getElementById('sb-user-info').textContent = `${user.fullName} | ${user.email}`;
  }

  function renderPaymentRows(payments = []) {
    return (
      payments
        .map(
          (p) => `<tr>
            <td class="tabular">${esc(p.payment_date)}</td>
            <td><code>${esc(p.receipt_number || '-')}</code></td>
            <td><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong> <small>(${esc(p.admission_number)})</small></td>
            <td><span class="badge ${p.payment_method === 'paystack' ? 'badge-primary' : 'badge-neutral'}">${esc(p.payment_method)}</span></td>
            <td class="num"><strong>${money(p.amount)}</strong></td>
            <td>${statusBadge(p.status)}</td>
            <td style="display:flex;gap:6px;">
              ${p.receipt_number ? `<button class="btn btn-secondary btn-sm" data-open-rcp="${esc(p.receipt_number)}">Receipt</button>` : ''}
              ${p.status === 'completed' ? `<button class="btn btn-danger btn-sm" data-reverse-pay="${p.id}">Reverse</button>` : ''}
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No payments recorded yet.</td></tr>'
    );
  }

  async function loadOverview() {
    const data = await api('/api/financial/overview');
    SMS.setCurrency(data.settings.currency_code, data.settings.currency_symbol);
    document.getElementById('sb-school-name').textContent = data.settings.school_name;
    SMS.populateCurrencyOptions(
      'fin-currency-switcher',
      data.currencies || [],
      data.settings.currency_code
    );

    const classOpts = (data.classes || [])
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
      .join('');
    const finClassSel = document.getElementById('fin-class-sel');
    if (finClassSel) {
      finClassSel.innerHTML = classOpts || '<option value="">No classes yet</option>';
    }

    const m = data.metrics;
    document.getElementById('fin-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Total Billed</div><div class="kpi-value">${money(m.netBilled)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Collected</div><div class="kpi-value">${money(m.totalCollected)}</div><div class="kpi-sub">${m.collectionRate}% collected</div></div>
      <div class="kpi-card"><div class="kpi-label">Paystack Collected</div><div class="kpi-value">${money(m.paystackCollected || 0)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Outstanding Balance</div><div class="kpi-value">${money(m.totalOutstanding)}</div></div>
    `;

    const rowsHtml = renderPaymentRows(data.recentPayments || []);
    document.getElementById('fin-ov-payments-tbody').innerHTML = rowsHtml;
    document.getElementById('fin-payments-tbody').innerHTML = rowsHtml;
  }

  async function loadFeeCategories() {
    const data = await api('/api/financial/categories');
    const items = data.items || [];
    document.getElementById('fee-cats-tbody').innerHTML =
      items
        .map(
          (c) => `<tr>
            <td><code>${esc(c.code)}</code></td>
            <td><strong>${esc(c.name)}</strong></td>
            <td class="num">${money(c.default_amount)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="3" class="empty-state">No fee items created yet.</td></tr>';

    document.getElementById('fin-cat-sel').innerHTML =
      items
        .map((c) => `<option value="${c.id}">${esc(c.name)} (${money(c.default_amount)})</option>`)
        .join('') || '<option value="">Create a fee item first</option>';
  }

  async function loadStudentDropdowns() {
    const res = await api('/api/financial/accounts?limit=100');
    const items = res.items || [];
    const stuOpts = items
      .map(
        (s) =>
          `<option value="${s.student_id}" data-balance="${s.balance}">${esc(s.admission_number)} - ${esc(s.first_name)} ${esc(s.last_name)} (Due: ${money(s.balance)})</option>`
      )
      .join('');
    ['fin-student-sel', 'psk-student-sel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = stuOpts || '<option value="">No students yet</option>';
    });
  }

  async function loadAccounts() {
    const search = document.getElementById('acc-search')?.value.trim() || '';
    const data = await api(`/api/financial/accounts?search=${encodeURIComponent(search)}`);
    const items = data.items || [];
    document.getElementById('fin-accounts-tbody').innerHTML =
      items
        .map(
          (a) => `<tr>
            <td><code>${esc(a.admission_number)}</code></td>
            <td><strong>${esc(a.first_name)} ${esc(a.last_name)}</strong></td>
            <td>${esc(a.class_name || '-')}</td>
            <td class="num">${money(a.total_billed)}</td>
            <td class="num">${money(a.total_paid)}</td>
            <td class="num"><strong>${money(a.balance)}</strong></td>
          </tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty-state">No student accounts yet.</td></tr>';
  }

  async function loadTimetable() {
    const filterEl = document.getElementById('fin-tt-filter-class');
    const classId = filterEl?.value || '';
    const qs = classId ? `?classId=${encodeURIComponent(classId)}` : '';
    const data = await api(`/api/financial/timetable${qs}`);
    if (filterEl && data.classes) {
      const prev = filterEl.value;
      filterEl.innerHTML =
        '<option value="">All Classes</option>' +
        data.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      if (prev) filterEl.value = prev;
    }
    SMS.renderTimetableMatrix('fin-tt-matrix', data.items || [], {
      showClass: !classId,
      showTeacher: true,
      emptyMessage: 'No timetable scheduled yet.',
    });
  }

  async function openReceipt(identifier) {
    const data = await api(`/api/financial/receipts/${encodeURIComponent(identifier)}`);
    const r = data.receipt;
    const snap = r.snapshot || {};
    const sym = r.currency_symbol;
    const allocRows = (snap.allocations || [])
      .map((al) => `<tr><td>${esc(al.feeName)}</td><td class="num">${money(al.allocated, sym)}</td></tr>`)
      .join('');
    document.getElementById('fin-receipt-printable').innerHTML = `
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
    document.getElementById('fin-receipt-modal').classList.add('open');
  }

  SMS.initNavigation(async (sec) => {
    try {
      if (sec === 'overview') await loadOverview();
      if (sec === 'billing') {
        await loadOverview();
        await loadFeeCategories();
        await loadStudentDropdowns();
      }
      if (sec === 'payments') {
        await loadOverview();
        await loadStudentDropdowns();
      }
      if (sec === 'accounts') await loadAccounts();
      if (sec === 'timetable') await loadTimetable();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('fin-tt-filter-class')?.addEventListener('change', () => {
    loadTimetable().catch((err) => toast(err.message, 'error'));
  });

  SMS.bindCurrencySelect('fin-currency-switcher', '/api/financial/currency', async () => {
    await loadOverview();
    if (!document.getElementById('sec-billing').classList.contains('hidden')) await loadFeeCategories();
    if (!document.getElementById('sec-accounts').classList.contains('hidden')) await loadAccounts();
  });

  document.getElementById('fin-target-type').addEventListener('change', (e) => {
    const isClass = e.target.value === 'class';
    document.getElementById('fin-target-class-wrap').classList.toggle('hidden', !isClass);
    document.getElementById('fin-target-student-wrap').classList.toggle('hidden', isClass);
  });

  document.getElementById('create-fee-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/financial/categories', { method: 'POST', body: fd });
      e.target.reset();
      toast('Fee item created.', 'success');
      await loadFeeCategories();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('assign-fee-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/assignments', { method: 'POST', body: fd });
      toast(res.message || 'Fee assigned.', 'success');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('paystack-init-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.callbackUrl = `${window.location.origin}/dashboard/financial`;
    try {
      const res = await api('/api/financial/paystack/initialize', { method: 'POST', body: fd });
      openPaystackCheckout(res.transaction, {
        verifyEndpoint: '/api/financial/paystack/verify',
        onSuccess: async (verified) => {
          e.target.reset();
          await loadOverview();
          if (verified.receiptNumber) await openReceipt(verified.receiptNumber);
        },
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('fin-transfer-form').addEventListener('submit', async (e) => {
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

  document.getElementById('acc-filter-btn').addEventListener('click', () => {
    loadAccounts().catch((err) => toast(err.message, 'error'));
  });

  document.body.addEventListener('click', async (e) => {
    const rcpBtn = e.target.closest('[data-open-rcp]');
    if (rcpBtn) {
      openReceipt(rcpBtn.dataset.openRcp).catch((err) => toast(err.message, 'error'));
      return;
    }

    const revBtn = e.target.closest('[data-reverse-pay]');
    if (revBtn) {
      const reason = prompt('Reason for reversing this payment:');
      if (!reason) return;
      try {
        await api(`/api/financial/payments/${revBtn.dataset.reversePay}/reverse`, {
          method: 'POST',
          body: { reason },
        });
        toast('Payment reversed.', 'info');
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  document.getElementById('lookup-rcp-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const val = document.getElementById('rcp-lookup-input').value.trim();
    if (val) openReceipt(val).catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('close-fin-rcp-modal').addEventListener('click', () => {
    document.getElementById('fin-receipt-modal').classList.remove('open');
  });

  await loadOverview();

  const params = new URLSearchParams(window.location.search);
  const cbRef = params.get('reference') || params.get('trxref');
  if (cbRef) {
    window.history.replaceState({}, '', window.location.pathname);
    try {
      const verified = await api('/api/financial/paystack/verify', {
        method: 'POST',
        body: { reference: cbRef },
      });
      toast(`Payment verified - Receipt ${verified.receiptNumber}`, 'success');
      await loadOverview();
      if (verified.receiptNumber) await openReceipt(verified.receiptNumber);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
})();
