(async function initFinancialDashboard() {
  const { esc, money, api, toast, statusBadge, exportCsv, openPaystackCheckout, activateSection } = window.SMS;
  let state = {
    overview: null,
    accounts: [],
    reports: null,
  };

  await SMS.initSession();
  SMS.initPrivacyToggle('privacy-toggle-btn');
  SMS.configureGoogleLinkButton('google-link-btn');
  document.getElementById('logout-btn').addEventListener('click', SMS.logout);
  document.getElementById('rec-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('print-rcp-btn').addEventListener('click', () => window.print());

  const user = SMS.getUser();
  if (user) {
    document.getElementById('sb-user-info').textContent = `${user.fullName} | ${user.email}`;
  }

  async function onSectionChange(sec) {
    try {
      if (sec === 'overview') await loadOverview();
      if (sec === 'categories' || sec === 'assignments') {
        await loadCategories();
        await loadAccounts();
      }
      if (sec === 'payment') {
        await loadAccounts();
        await loadPaystackTransactions();
        await loadPaystackTransfers();
      }
      if (sec === 'adjustments') await loadAccounts();
      if (sec === 'receipts') await loadOverview();
      if (sec === 'accounts') await loadAccounts();
      if (sec === 'reports') await loadReports();
      if (sec === 'reconciliation') await loadReconciliations();
      if (sec === 'timetable') await loadSchoolTimetable();
      if (sec === 'audit') await loadAudits();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function loadOverview() {
    const data = await api('/api/financial/overview');
    state.overview = data;
    SMS.setCurrency(data.settings.currency_code, data.settings.currency_symbol);
    document.getElementById('sb-school-name').textContent = data.settings.school_name;
    document.getElementById('active-period-badge').textContent =
      `${data.activeYear?.name || ''} - ${data.activeTerm?.name || ''}`;
    document.getElementById('paystack-mode-badge').textContent =
      data.paystack?.enabled === false ? 'Paystack Disabled' : 'Paystack Active';

    SMS.populateCurrencyOptions('fin-currency-select', data.currencies, data.settings.currency_code);

    const m = data.metrics;
    document.getElementById('fin-kpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Net Fees Billed</div><div class="kpi-value">${money(m.netBilled)}</div><div class="kpi-sub">Discounts: ${money(m.totalDiscount)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Collected</div><div class="kpi-value">${money(m.totalCollected)}</div><div class="kpi-sub">Collection Rate: ${m.collectionRate}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Paystack Volume</div><div class="kpi-value">${money(m.paystackCollected)}</div><div class="kpi-sub">${m.paystackSuccessCount} verified Paystack payments</div></div>
      <div class="kpi-card"><div class="kpi-label">Outstanding Arrears</div><div class="kpi-value">${money(m.totalOutstanding)}</div><div class="kpi-sub">Target Attainment: ${m.targetAttainmentRate}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Today's Collections</div><div class="kpi-value">${money(m.todayCollected)}</div><div class="kpi-sub">${m.todayPaymentsCount} receipt(s) issued today</div></div>
    `;

    const pRows = (data.recentPayments || [])
      .map(
        (p) => `<tr>
          <td class="tabular">${esc(p.payment_date)}</td>
          <td><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong><br><small>${esc(p.admission_number)}</small></td>
          <td><span class="badge badge-primary">${esc(p.payment_method)}</span><br><small>${esc(p.reference_number || '')}</small></td>
          <td><code>${esc(p.receipt_number || '-')}</code></td>
          <td class="num"><strong>${money(p.amount)}</strong></td>
        </tr>`
      )
      .join('');
    document.getElementById('fin-recent-payments').innerHTML = pRows || '<tr><td colspan="5" class="empty-state">No payments yet.</td></tr>';

    document.getElementById('receipts-tbody').innerHTML =
      (data.recentPayments || [])
        .map(
          (p) => `<tr>
            <td><code>${esc(p.receipt_number)}</code></td>
            <td class="tabular">${esc(p.payment_date)}</td>
            <td><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong> (${esc(p.admission_number)})</td>
            <td><span class="badge badge-neutral">${esc(p.payment_method)}</span> ${esc(p.reference_number || '-')}</td>
            <td class="num"><strong>${money(p.amount)}</strong></td>
            <td><button class="btn btn-secondary btn-sm" data-open-rcp="${esc(p.receipt_number)}">View / Print</button></td>
          </tr>`
        )
        .join('') || '<tr><td colspan="6" class="empty-state">No receipts issued yet.</td></tr>';

    document.getElementById('fin-by-method').innerHTML =
      (data.byMethod || [])
        .map(
          (bm) => `<tr><td><strong>${esc(bm.payment_method)}</strong></td><td class="num">${bm.cnt}</td><td class="num">${money(bm.total)}</td></tr>`
        )
        .join('') || '<tr><td colspan="3" class="empty-state">No collections yet.</td></tr>';

    const classSel = document.getElementById('fa-class-select');
    if (classSel && data.classes) {
      classSel.innerHTML =
        '<option value="">-- Select Class --</option>' +
        data.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    }
  }

  async function loadCategories() {
    const data = await api('/api/financial/categories');
    document.getElementById('cat-tbody').innerHTML = data.items
      .map(
        (c) => `<tr>
          <td><code>${esc(c.code)}</code></td>
          <td><strong>${esc(c.name)}</strong><br><small style="color:var(--text-light)">${esc(c.description || '')}</small></td>
          <td>${esc(c.frequency)}</td>
          <td class="num">${money(c.default_amount)}</td>
          <td>${statusBadge(c.status)}</td>
        </tr>`
      )
      .join('');

    document.getElementById('fa-cat-select').innerHTML = data.items
      .map((c) => `<option value="${c.id}">${esc(c.code)} - ${esc(c.name)} (${money(c.default_amount)})</option>`)
      .join('');
  }

  async function loadPaystackTransactions() {
    const data = await api('/api/financial/paystack/transactions');
    document.getElementById('paystack-tx-tbody').innerHTML =
      (data.items || [])
        .map(
          (tx) => `<tr>
            <td><code>${esc(tx.reference)}</code></td>
            <td><strong>${esc(tx.first_name)} ${esc(tx.last_name)}</strong><br><small>${esc(tx.admission_number)}</small></td>
            <td>${esc(tx.payer_email)}</td>
            <td><span class="badge badge-neutral">${esc(tx.channel)}</span></td>
            <td class="num"><strong>${money(tx.amount)}</strong></td>
            <td>${statusBadge(tx.status)}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                ${
                  tx.status === 'success' && tx.receipt_number
                    ? `<button class="btn btn-secondary btn-sm" data-open-rcp="${esc(tx.receipt_number)}">Receipt ${esc(tx.receipt_number)}</button>`
                    : tx.status === 'pending'
                    ? `<button class="btn btn-paystack btn-sm" data-verify-psk="${esc(tx.reference)}">Verify Now</button>`
                    : ''
                }
                ${
                  tx.status === 'success' && tx.payment_id
                    ? `<button class="btn btn-danger btn-sm" data-reverse-pay="${tx.payment_id}">Reverse</button>`
                    : tx.status === 'reversed'
                    ? '<span class="badge badge-neutral">Reversed</span>'
                    : ''
                }
              </div>
            </td>
          </tr>`
        )
        .join('') || '<tr><td colspan="7" class="empty-state">No Paystack transactions yet.</td></tr>';
  }

  async function loadPaystackTransfers() {
    const tbody = document.getElementById('fin-psk-transfers-tbody');
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

  async function loadSchoolTimetable() {
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
      emptyMessage: 'No school timetable slots scheduled yet.',
    });
  }

  async function loadAccounts() {
    const search = document.getElementById('acc-search')?.value.trim() || '';
    const arrearsOnly = document.getElementById('acc-arrears-only')?.checked ? 'true' : 'false';
    const data = await api(`/api/financial/accounts?search=${encodeURIComponent(search)}&onlyArrears=${arrearsOnly}`);
    state.accounts = data.items || [];

    const tbody = document.getElementById('accounts-tbody');
    if (tbody) {
      tbody.innerHTML =
        state.accounts
          .map(
            (a) => `<tr>
              <td><code>${esc(a.admission_number)}</code></td>
              <td><strong>${esc(a.first_name)} ${esc(a.last_name)}</strong></td>
              <td>${esc(a.class_name || '-')}</td>
              <td class="num">${money(a.total_billed)}</td>
              <td class="num">${money(a.total_discount)}</td>
              <td class="num">${money(a.total_paid)}</td>
              <td class="num"><strong>${money(a.balance)}</strong></td>
              <td>
                <button class="btn btn-secondary btn-sm" data-view-ledger="${a.student_id}">Statement</button>
                ${
                  Number(a.balance) > 0
                    ? `<button class="btn btn-paystack btn-sm" data-quick-paystack="${a.student_id}" data-due="${a.balance}">Paystack</button>`
                    : ''
                }
              </td>
            </tr>`
          )
          .join('') || '<tr><td colspan="8" class="empty-state">No student accounts match filter.</td></tr>';
    }

    const allStudentsRes = await api('/api/financial/accounts?limit=100');
    const allItems = allStudentsRes.items || [];
    const stuOpts = allItems
      .map(
        (s) => `<option value="${s.student_id}" data-balance="${s.balance}">${esc(s.admission_number)} - ${esc(s.first_name)} ${esc(s.last_name)} (Due: ${money(s.balance)})</option>`
      )
      .join('');

    const paySel = document.getElementById('pay-student-select');
    if (paySel) {
      paySel.innerHTML = stuOpts;
      const syncPayAmount = () => {
        const opt = paySel.options[paySel.selectedIndex];
        if (opt && Number(opt.dataset.balance) > 0) {
          document.getElementById('pay-amount-input').value = Number(opt.dataset.balance).toFixed(2);
        }
      };
      paySel.onchange = syncPayAmount;
      if (!document.getElementById('pay-amount-input').value) syncPayAmount();
    }
    const offSel = document.getElementById('off-student-select');
    if (offSel) offSel.innerHTML = stuOpts;
    const faStuSel = document.getElementById('fa-student-select');
    if (faStuSel) faStuSel.innerHTML = '<option value="">-- Entire Selected Class --</option>' + stuOpts;
    const adjStuSel = document.getElementById('adj-student-select');
    if (adjStuSel) {
      adjStuSel.innerHTML = '<option value="">-- Select Student --</option>' + stuOpts;
    }
  }

  document.getElementById('adj-student-select').addEventListener('change', async (e) => {
    const sid = e.target.value;
    if (!sid) return;
    const ledger = await api(`/api/financial/accounts/${sid}`);
    document.getElementById('adj-fa-select').innerHTML = ledger.assignments
      .map(
        (fa) => `<option value="${fa.id}">#${fa.id} - ${esc(fa.fee_name)} (Billed: ${money(fa.amount_due)}, Paid: ${money(fa.amount_paid)})</option>`
      )
      .join('');
  });

  async function openReceiptModal(identifier) {
    const data = await api(`/api/financial/receipts/${encodeURIComponent(identifier)}`);
    const r = data.receipt;
    const snap = r.snapshot || {};
    const sym = r.currency_symbol;
    const allocRows = (snap.allocations || [])
      .map((al) => `<tr><td>${esc(al.feeName)}</td><td class="num">${money(al.allocated, sym)}</td></tr>`)
      .join('');

    document.getElementById('receipt-printable').innerHTML = `
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
        <div><strong>Student:</strong> ${esc(r.first_name)} ${esc(r.last_name)}<br><strong>Admission #:</strong> ${esc(r.admission_number)}<br><strong>Class:</strong> ${esc(snap.className || r.class_name || '-')}</div>
        <div><strong>Channel:</strong> ${esc(r.payment_method).toUpperCase()}<br><strong>Reference:</strong> ${esc(r.reference_number || 'N/A')}<br><strong>Issued By:</strong> ${esc(r.issued_by_name)}</div>
      </div>
      <table>
        <thead><tr><th>Allocated Fee Item</th><th class="num">Amount Paid (${esc(r.currency_code)})</th></tr></thead>
        <tbody>${allocRows || `<tr><td>School Fee Settlement</td><td class="num">${money(r.issued_amount, sym)}</td></tr>`}</tbody>
        <tfoot>
          <tr><th>Total Received</th><th class="num">${money(r.issued_amount, sym)}</th></tr>
          ${snap.balanceAfter !== undefined ? `<tr><th>Remaining Account Balance</th><th class="num">${money(snap.balanceAfter, sym)}</th></tr>` : ''}
        </tfoot>
      </table>
    `;
    document.getElementById('receipt-modal').classList.add('open');
  }

  async function loadReports() {
    const data = await api('/api/financial/reports');
    state.reports = data;
    document.getElementById('rep-daily-tbody').innerHTML =
      data.dailyCollections
        .map(
          (d) => `<tr><td class="tabular">${esc(d.payment_date)}</td><td>${esc(d.payment_method)}</td><td class="num">${d.transactions}</td><td class="num">${money(d.collected)}</td></tr>`
        )
        .join('') || '<tr><td colspan="4" class="empty-state">No collections recorded.</td></tr>';

    document.getElementById('rep-class-tbody').innerHTML = data.arrearsByClass
      .map(
        (c) => `<tr><td><strong>${esc(c.class_name)}</strong></td><td class="num">${c.students_count}</td><td class="num">${money(c.net_billed)}</td><td class="num">${money(c.collected)}</td><td class="num"><strong>${money(c.outstanding)}</strong></td></tr>`
      )
      .join('');
  }

  async function loadReconciliations() {
    const data = await api('/api/financial/reconciliations');
    document.getElementById('rec-history-tbody').innerHTML =
      data.items
        .map(
          (r) => `<tr>
            <td class="tabular">${esc(r.reconciliation_date)}</td>
            <td class="num">${money(r.expected_system_total)}</td>
            <td class="num">${money(r.declared_total)}</td>
            <td class="num">${money(r.variance)}</td>
            <td>${statusBadge(r.status)}</td>
          </tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty-state">No reconciliations logged yet.</td></tr>';
  }

  async function loadAudits() {
    const data = await api('/api/financial/audit-logs');
    document.getElementById('fin-audit-tbody').innerHTML =
      data.items
        .map(
          (a) => `<tr>
            <td class="tabular">${esc(a.created_at)}</td>
            <td>${esc(a.actor_name || a.actor_role)}</td>
            <td><code>${esc(a.action)}</code></td>
            <td>${esc(a.target_type)} #${esc(a.target_id)}</td>
            <td><small style="color:var(--text-light)">${esc(a.metadata_json || '')}</small></td>
          </tr>`
        )
        .join('') || '<tr><td colspan="5" class="empty-state">No financial audit entries yet.</td></tr>';
  }

  SMS.initNavigation(onSectionChange);

  SMS.bindCurrencySelect('fin-currency-select', '/api/financial/currency', async () => {
    await loadOverview();
    if (!document.getElementById('sec-accounts').classList.contains('hidden')) await loadAccounts();
    if (!document.getElementById('sec-payment').classList.contains('hidden')) await loadPaystackTransactions();
    if (!document.getElementById('sec-reports').classList.contains('hidden')) await loadReports();
  });

  document.getElementById('create-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/api/financial/categories', { method: 'POST', body: fd });
      e.target.reset();
      toast('Fee category created.', 'success');
      await loadCategories();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('assign-fee-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/assignments', { method: 'POST', body: fd });
      toast(res.message, 'success');
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Initialize Paystack Checkout
  document.getElementById('paystack-init-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    fd.callbackUrl = `${window.location.origin}/dashboard/financial`;
    try {
      const res = await api('/api/financial/paystack/initialize', { method: 'POST', body: fd });
      openPaystackCheckout(res.transaction, {
        verifyEndpoint: '/api/financial/paystack/verify',
        abandonEndpoint: '/api/financial/paystack/abandon',
        onSuccess: async (verified) => {
          await loadOverview();
          await loadAccounts();
          await loadPaystackTransactions();
          if (verified.receiptNumber) await openReceiptModal(verified.receiptNumber);
        },
      });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Verify Paystack Reference manually
  document.getElementById('paystack-verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/paystack/verify', { method: 'POST', body: fd });
      toast(`Paystack reference verified - Receipt ${res.receiptNumber}`, 'success');
      e.target.reset();
      await loadOverview();
      await loadPaystackTransactions();
      if (res.receiptNumber) await openReceiptModal(res.receiptNumber);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  // Offline walk-in cash fallback
  document.getElementById('offline-payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/payments', { method: 'POST', body: fd });
      toast(`Counter receipt ${res.receiptNumber} issued.`, 'success');
      e.target.reset();
      await loadOverview();
      await openReceiptModal(res.receiptNumber);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('sec-payment').addEventListener('click', async (e) => {
    const rcpBtn = e.target.closest('[data-open-rcp]');
    if (rcpBtn) await openReceiptModal(rcpBtn.dataset.openRcp);

    const verBtn = e.target.closest('[data-verify-psk]');
    if (verBtn) {
      try {
        const res = await api('/api/financial/paystack/verify', {
          method: 'POST',
          body: { reference: verBtn.dataset.verifyPsk },
        });
        toast(`Paystack reference verified - ${res.receiptNumber}`, 'success');
        await loadPaystackTransactions();
        await loadOverview();
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  });

  document.getElementById('receipts-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open-rcp]');
    if (btn) openReceiptModal(btn.dataset.openRcp).catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('rcp-lookup-btn').addEventListener('click', () => {
    const val = document.getElementById('rcp-lookup-input').value.trim();
    if (val) openReceiptModal(val).catch((err) => toast(err.message, 'error'));
  });

  document.getElementById('close-rcp-modal').addEventListener('click', () => {
    document.getElementById('receipt-modal').classList.remove('open');
  });

  document.getElementById('acc-filter-btn').addEventListener('click', loadAccounts);
  document.getElementById('acc-export-btn').addEventListener('click', () => {
    exportCsv(
      'student_arrears_ledger.csv',
      ['Admission #', 'Student', 'Class', 'Billed', 'Discount', 'Paid', 'Outstanding'],
      state.accounts.map((a) => [
        a.admission_number,
        `${a.first_name} ${a.last_name}`,
        a.class_name || '',
        a.total_billed,
        a.total_discount,
        a.total_paid,
        a.balance,
      ])
    );
  });

  document.getElementById('accounts-tbody').addEventListener('click', async (e) => {
    const qPay = e.target.closest('[data-quick-paystack]');
    if (qPay) {
      const sid = qPay.dataset.quickPaystack;
      const due = qPay.dataset.due;
      activateSection('payment', async () => {
        await loadAccounts();
        await loadPaystackTransactions();
        document.getElementById('pay-student-select').value = sid;
        document.getElementById('pay-amount-input').value = Number(due).toFixed(2);
      });
      return;
    }

    const btn = e.target.closest('[data-view-ledger]');
    if (!btn) return;
    try {
      const data = await api(`/api/financial/accounts/${btn.dataset.viewLedger}`);
      document.getElementById('drawer-student-title').textContent =
        `Fee Statement - ${data.student.first_name} ${data.student.last_name} (${data.student.admission_number})`;
      document.getElementById('drawer-assignments-tbody').innerHTML = data.assignments
        .map(
          (fa) => `<tr>
            <td><strong>${esc(fa.fee_name)}</strong></td>
            <td>${esc(fa.term_name)}</td>
            <td class="num">${money(fa.amount_due)}</td>
            <td class="num">${money(fa.discount_amount)}</td>
            <td class="num">${money(fa.amount_paid)}</td>
            <td class="num"><strong>${money(fa.balance)}</strong></td>
            <td>${statusBadge(fa.status)}</td>
            <td><code>#${fa.id}</code></td>
          </tr>`
        )
        .join('');
      document.getElementById('student-ledger-drawer').classList.remove('hidden');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('close-drawer-btn').addEventListener('click', () => {
    document.getElementById('student-ledger-drawer').classList.add('hidden');
  });

  document.getElementById('adjustment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/adjustments', { method: 'POST', body: fd });
      toast(res.message, 'success');
      e.target.reset();
      await loadOverview();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('reconcile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/reconciliations', { method: 'POST', body: fd });
      toast(`Reconciled (${res.status}) - Variance: ${money(res.variance)}`, res.status === 'balanced' ? 'success' : 'info');
      await loadReconciliations();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('export-fin-report-btn').addEventListener('click', () => {
    if (!state.reports) return;
    exportCsv(
      'daily_collections.csv',
      ['Date', 'Payment Method', 'Transactions', 'Collected'],
      state.reports.dailyCollections.map((d) => [d.payment_date, d.payment_method, d.transactions, d.collected])
    );
  });

  document.getElementById('fin-psk-transfer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await api('/api/financial/paystack/transfers', { method: 'POST', body: fd });
      e.target.reset();
      toast(`Paystack transfer sent (${res.transfer.reference}).`, 'success');
      await loadPaystackTransfers();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  document.getElementById('fin-tt-filter-class')?.addEventListener('change', () => {
    loadSchoolTimetable().catch((err) => toast(err.message, 'error'));
  });

  document.addEventListener('click', async (e) => {
    const revBtn = e.target.closest('[data-reverse-pay]');
    if (!revBtn) return;
    const reason = prompt('Enter reason for reversing and refunding this transaction:');
    if (!reason || reason.trim().length < 4) return;
    try {
      await api(`/api/financial/payments/${revBtn.dataset.reversePay}/reverse`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast('Payment reversed and Paystack refund processed.', 'success');
      await loadOverview();
      await loadPaystackTransactions();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  await loadOverview();

  // Handle hosted Paystack redirect callback (?reference=PSK-... or ?trxref=PSK-...)
  const params = new URLSearchParams(window.location.search);
  const cbRef = params.get('reference') || params.get('trxref');
  if (cbRef) {
    window.history.replaceState({}, '', window.location.pathname);
    try {
      const verified = await api('/api/financial/paystack/verify', {
        method: 'POST',
        body: { reference: cbRef },
      });
      toast(`Paystack callback verified - Receipt ${verified.receiptNumber}`, 'success');
      await loadOverview();
      if (verified.receiptNumber) await openReceiptModal(verified.receiptNumber);
    } catch (err) {
      toast(err.message, 'error');
    }
  }
})();
