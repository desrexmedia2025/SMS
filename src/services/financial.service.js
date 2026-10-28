const db = require('../config/database');
const systemModel = require('../models/system.model');
const financeModel = require('../models/finance.model');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');
const { toCents, fromCents } = require('../utils/currency');
const { parsePagination, buildPaginatedResult } = require('../utils/pagination');

async function computeManagedFinancialMetrics(settings) {
  const today = new Date().toISOString().slice(0, 10);

  const [totalsRow, todayRow, pskRow] = await Promise.all([
    db.get(
      `SELECT
         COALESCE(SUM(amount_due), 0) AS gross_billed,
         COALESCE(SUM(discount_amount), 0) AS total_discounts,
         COALESCE(SUM(amount_paid), 0) AS total_collected
       FROM fee_assignments`
    ),
    db.get(
      `SELECT COALESCE(SUM(amount), 0) AS today_collected, COUNT(*) AS today_count
       FROM payments
       WHERE payment_date = ? AND status = 'completed'`,
      [today]
    ),
    db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0) AS psk_collected,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS psk_success_cnt,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS psk_pending_cnt
       FROM paystack_transactions`
    ),
  ]);

  const ledgerGrossCents = toCents(totalsRow?.gross_billed || 0);
  const ledgerDiscCents = toCents(totalsRow?.total_discounts || 0);
  const ledgerNetBilledCents = Math.max(0, ledgerGrossCents - ledgerDiscCents);
  const ledgerCollectedCents = toCents(totalsRow?.total_collected || 0);
  const ledgerArrearsCents = Math.max(0, ledgerNetBilledCents - ledgerCollectedCents);

  const billedAdjCents = toCents(settings?.billed_stat_adjustment || 0);
  const collectedAdjCents = toCents(settings?.collected_stat_adjustment || 0);
  const openingBalCents = toCents(settings?.opening_balance_adjustment || 0);
  const targetCents = Math.max(0, toCents(settings?.term_revenue_target || 0));

  const effectiveNetBilledCents = Math.max(0, ledgerNetBilledCents + billedAdjCents);
  const effectiveCollectedCents = Math.max(0, ledgerCollectedCents + collectedAdjCents);
  const effectiveOutstandingCents = Math.max(0, effectiveNetBilledCents - effectiveCollectedCents);
  const treasuryPositionCents = openingBalCents + effectiveCollectedCents;

  const collectionRate =
    effectiveNetBilledCents > 0
      ? Math.round((effectiveCollectedCents / effectiveNetBilledCents) * 1000) / 10
      : 0;
  const targetAttainmentRate =
    targetCents > 0 ? Math.round((effectiveCollectedCents / targetCents) * 1000) / 10 : 0;

  return {
    ledgerGrossBilled: fromCents(ledgerGrossCents),
    ledgerNetBilled: fromCents(ledgerNetBilledCents),
    ledgerCollected: fromCents(ledgerCollectedCents),
    ledgerOutstanding: fromCents(ledgerArrearsCents),

    billedAdjustment: fromCents(billedAdjCents),
    collectedAdjustment: fromCents(collectedAdjCents),
    openingBalance: fromCents(openingBalCents),
    termRevenueTarget: fromCents(targetCents),

    grossBilled: fromCents(Math.max(0, ledgerGrossCents + billedAdjCents)),
    totalDiscounts: fromCents(ledgerDiscCents),
    totalDiscount: fromCents(ledgerDiscCents),
    netBilled: fromCents(effectiveNetBilledCents),
    totalCollected: fromCents(effectiveCollectedCents),
    totalOutstanding: fromCents(effectiveOutstandingCents),
    treasuryPosition: fromCents(treasuryPositionCents),

    collectionRate,
    targetAttainmentRate,

    paystackCollected: fromCents(toCents(pskRow?.psk_collected || 0)),
    paystackSuccessCount: Number(pskRow?.psk_success_cnt || 0),
    paystackPendingCount: Number(pskRow?.psk_pending_cnt || 0),

    todayCollected: fromCents(toCents(todayRow?.today_collected || 0)),
    todayTransactions: Number(todayRow?.today_count || 0),
    todayPaymentsCount: Number(todayRow?.today_count || 0),
  };
}

async function getOverview() {
  const context = await systemModel.getSchoolContext();

  const [
    metrics,
    byMethod,
    feeCategories,
    recentReceipts,
    paystackTransactions,
    recentPayments,
    allAssignments,
    classes,
    years,
    terms,
    reconciliations,
    announcements,
  ] = await Promise.all([
    computeManagedFinancialMetrics(context.settings),
    db.query(
      `SELECT payment_method, COUNT(*) AS tx_count, COALESCE(SUM(amount), 0) AS total_amount
       FROM payments
       WHERE status = 'completed'
       GROUP BY payment_method
       ORDER BY total_amount DESC`
    ),
    db.query('SELECT * FROM fee_categories ORDER BY id ASC'),
    db.query(
      `SELECT
         r.*,
         p.payment_method, p.reference_number, p.payment_date, p.status AS payment_status,
         s.admission_number, s.first_name, s.last_name,
         u.full_name AS cashier_name
       FROM receipts r
       INNER JOIN payments p ON p.id = r.payment_id
       INNER JOIN students s ON s.id = r.student_id
       LEFT JOIN users u ON u.id = r.issued_by_user_id
       ORDER BY r.id DESC
       LIMIT 25`
    ),
    db.query(
      `SELECT
         pt.*,
         s.admission_number, s.first_name, s.last_name,
         u.full_name AS initiated_by_name
       FROM paystack_transactions pt
       INNER JOIN students s ON s.id = pt.student_id
       LEFT JOIN users u ON u.id = pt.initiated_by_user_id
       ORDER BY pt.id DESC
       LIMIT 30`
    ),
    db.query(
      `SELECT
         p.*,
         r.receipt_number,
         s.admission_number, s.first_name, s.last_name,
         u.full_name AS cashier_name
       FROM payments p
       LEFT JOIN receipts r ON r.payment_id = p.id
       INNER JOIN students s ON s.id = p.student_id
       LEFT JOIN users u ON u.id = p.received_by_user_id
       ORDER BY p.id DESC
       LIMIT 30`
    ),
    db.query(
      `SELECT
         fa.*,
         fc.code AS fee_code, fc.name AS fee_name,
         s.admission_number, s.first_name, s.last_name,
         tr.name AS term_name
       FROM fee_assignments fa
       INNER JOIN fee_categories fc ON fc.id = fa.fee_category_id
       INNER JOIN students s ON s.id = fa.student_id
       INNER JOIN terms tr ON tr.id = fa.term_id
       ORDER BY fa.id DESC
       LIMIT 50`
    ),
    db.query("SELECT id, name FROM classes WHERE status = 'active' ORDER BY level_order ASC"),
    db.query('SELECT * FROM academic_years ORDER BY id DESC'),
    db.query('SELECT * FROM terms ORDER BY id ASC'),
    db.query(
      `SELECT rec.*, u.full_name AS reconciled_by_name
       FROM reconciliations rec
       LEFT JOIN users u ON u.id = rec.reconciled_by_user_id
       ORDER BY rec.id DESC
       LIMIT 15`
    ),
    systemModel.listAnnouncementsForAudience(['all', 'financial']),
  ]);

  return {
    ...context,
    metrics,
    byMethod: byMethod.map((m) => ({
      ...m,
      cnt: Number(m.tx_count || 0),
      total: fromCents(toCents(m.total_amount)),
      total_amount: fromCents(toCents(m.total_amount)),
    })),
    feeCategories,
    recentReceipts,
    paystackTransactions,
    recentPayments,
    feeAssignments: allAssignments.map((fa) => {
      const net = Math.max(0, toCents(fa.amount_due) - toCents(fa.discount_amount));
      const bal = Math.max(0, net - toCents(fa.amount_paid));
      return { ...fa, net_due: fromCents(net), balance: fromCents(bal) };
    }),
    classes,
    years,
    terms,
    reconciliations,
    announcements,
  };
}

async function updateFinancialStatsConfig({
  termRevenueTarget,
  openingBalanceAdjustment,
  billedStatAdjustment,
  collectedStatAdjustment,
  paystackEnabled,
  paystackChannels,
  actor,
  ipAddress,
}) {
  const targetStr = fromCents(Math.max(0, toCents(termRevenueTarget)));
  const openStr = fromCents(toCents(openingBalanceAdjustment));
  const billedAdjStr = fromCents(toCents(billedStatAdjustment));
  const collAdjStr = fromCents(toCents(collectedStatAdjustment));
  const channelsStr =
    Array.isArray(paystackChannels) && paystackChannels.length > 0
      ? paystackChannels.join(',')
      : String(paystackChannels || 'card,mobile_money,bank_transfer,ussd');

  await db.run(
    `UPDATE school_settings
     SET term_revenue_target = ?,
         opening_balance_adjustment = ?,
         billed_stat_adjustment = ?,
         collected_stat_adjustment = ?,
         paystack_enabled = ?,
         paystack_channels = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [targetStr, openStr, billedAdjStr, collAdjStr, paystackEnabled ? 1 : 0, channelsStr]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'FINANCIAL_STATS_CONFIG_UPDATED',
    targetType: 'school_settings',
    targetId: '1',
    ipAddress,
    metadata: {
      termRevenueTarget: targetStr,
      openingBalanceAdjustment: openStr,
      billedStatAdjustment: billedAdjStr,
      collectedStatAdjustment: collAdjStr,
      paystackEnabled: Boolean(paystackEnabled),
      paystackChannels: channelsStr,
    },
  });

  const ctx = await systemModel.getSchoolContext();
  const metrics = await computeManagedFinancialMetrics(ctx.settings);
  return { ...ctx, metrics };
}

async function createFeeCategory({ code, name, description, defaultAmount, frequency, isMandatory, actor, ipAddress }) {
  const existing = await db.get('SELECT id FROM fee_categories WHERE code = ?', [code.toUpperCase()]);
  if (existing) throw new AppError(409, 'A fee category with that code already exists.');

  const amtStr = fromCents(toCents(defaultAmount));
  const ins = await db.run(
    `INSERT INTO fee_categories (code, name, description, default_amount, frequency, is_mandatory, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [code.toUpperCase(), name, description || '', amtStr, frequency, isMandatory ? 1 : 0]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'FEE_CATEGORY_CREATED',
    targetType: 'fee_category',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { code: code.toUpperCase(), name, defaultAmount: amtStr },
  });

  return { id: ins.insertId };
}

async function updateFeeCategory({ id, name, defaultAmount, frequency, status, actor, ipAddress }) {
  const cat = await db.get('SELECT * FROM fee_categories WHERE id = ?', [id]);
  if (!cat) throw new AppError(404, 'Fee category not found.');

  const amtStr = defaultAmount !== undefined ? fromCents(toCents(defaultAmount)) : cat.default_amount;
  const nextName = name || cat.name;
  const nextFreq = frequency || cat.frequency;
  const nextStatus = status || cat.status;

  await db.run(
    `UPDATE fee_categories
     SET name = ?, default_amount = ?, frequency = ?, status = ?
     WHERE id = ?`,
    [nextName, amtStr, nextFreq, nextStatus, id]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'FEE_CATEGORY_UPDATED',
    targetType: 'fee_category',
    targetId: String(id),
    ipAddress,
    metadata: { name: nextName, defaultAmount: amtStr, status: nextStatus },
  });
}

async function assignFeeToTarget({
  targetType,
  studentId,
  classId,
  feeCategoryId,
  academicYearId,
  termId,
  amountDue,
  dueDate,
  actor,
  ipAddress,
}) {
  const cat = await db.get('SELECT * FROM fee_categories WHERE id = ?', [feeCategoryId]);
  if (!cat) throw new AppError(404, 'Fee category not found.');

  const effectiveAmount = amountDue ? fromCents(toCents(amountDue)) : fromCents(toCents(cat.default_amount));
  if (toCents(effectiveAmount) <= 0) {
    throw new AppError(400, 'Assigned fee amount must be greater than zero.');
  }

  let studentIds = [];
  if (targetType === 'student') {
    if (!studentId) throw new AppError(400, 'Student ID is required.');
    studentIds = [studentId];
  } else {
    if (!classId) throw new AppError(400, 'Class ID is required for bulk class billing.');
    const enrolled = await db.query(
      `SELECT student_id FROM student_enrolments WHERE class_id = ? AND status = 'enrolled'`,
      [classId]
    );
    studentIds = enrolled.map((r) => r.student_id);
    if (studentIds.length === 0) {
      throw new AppError(400, 'No enrolled students found in the selected class.');
    }
  }

  return db.withTransaction(async (tx) => {
    let assignedCount = 0;
    let skippedCount = 0;
    for (const sid of studentIds) {
      const exists = await tx.get(
        `SELECT id FROM fee_assignments
         WHERE student_id = ? AND fee_category_id = ? AND academic_year_id = ? AND term_id = ?`,
        [sid, feeCategoryId, academicYearId, termId]
      );
      if (exists) {
        skippedCount++;
        continue;
      }
      await tx.run(
        `INSERT INTO fee_assignments
         (student_id, fee_category_id, academic_year_id, term_id, amount_due, discount_amount, amount_paid, due_date, status, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, '0.00', '0.00', ?, 'unpaid', ?)`,
        [sid, feeCategoryId, academicYearId, termId, effectiveAmount, dueDate || '', actor.id]
      );
      assignedCount++;
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'FEE_ASSIGNED',
        targetType,
        targetId: String(targetType === 'student' ? studentId : classId),
        ipAddress,
        metadata: { feeCategoryId, effectiveAmount, assignedCount, skippedCount },
      },
      tx
    );

    return { assignedCount, skippedCount };
  });
}

async function updateFeeAssignmentByAdmin({ assignmentId, amountDue, discountAmount, actor, ipAddress }) {
  const fa = await db.get('SELECT * FROM fee_assignments WHERE id = ?', [assignmentId]);
  if (!fa) throw new AppError(404, 'Fee assignment not found.');

  const dueCents = amountDue !== undefined ? toCents(amountDue) : toCents(fa.amount_due);
  const discCents = discountAmount !== undefined ? toCents(discountAmount) : toCents(fa.discount_amount);
  const paidCents = toCents(fa.amount_paid);

  if (dueCents < 0 || discCents < 0) {
    throw new AppError(400, 'Amounts cannot be negative.');
  }
  const netDueCents = Math.max(0, dueCents - discCents);
  if (paidCents > netDueCents) {
    throw new AppError(
      400,
      `Net due (${fromCents(netDueCents)}) cannot be set lower than already paid amount (${fromCents(paidCents)}).`
    );
  }

  let status = 'unpaid';
  if (netDueCents === 0) status = 'waived';
  else if (paidCents >= netDueCents) status = 'paid';
  else if (paidCents > 0) status = 'partial';

  await db.run(
    `UPDATE fee_assignments SET amount_due = ?, discount_amount = ?, status = ? WHERE id = ?`,
    [fromCents(dueCents), fromCents(discCents), status, assignmentId]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'FEE_ASSIGNMENT_UPDATED_BY_ADMIN',
    targetType: 'fee_assignment',
    targetId: String(assignmentId),
    ipAddress,
    metadata: {
      previousDue: fa.amount_due,
      newDue: fromCents(dueCents),
      previousDiscount: fa.discount_amount,
      newDiscount: fromCents(discCents),
    },
  });
}

async function deleteUnpaidFeeAssignmentByAdmin({ assignmentId, actor, ipAddress }) {
  const fa = await db.get('SELECT * FROM fee_assignments WHERE id = ?', [assignmentId]);
  if (!fa) throw new AppError(404, 'Fee assignment not found.');
  if (toCents(fa.amount_paid) > 0) {
    throw new AppError(
      400,
      'This fee assignment already has allocated payments. Reverse the payment first or apply a waiver instead.'
    );
  }

  await db.withTransaction(async (tx) => {
    await tx.run('DELETE FROM fee_adjustments WHERE fee_assignment_id = ?', [assignmentId]);
    await tx.run('DELETE FROM fee_assignments WHERE id = ?', [assignmentId]);
    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'FEE_ASSIGNMENT_DELETED_BY_ADMIN',
        targetType: 'fee_assignment',
        targetId: String(assignmentId),
        ipAddress,
        metadata: { studentId: fa.student_id, amountDue: fa.amount_due },
      },
      tx
    );
  });
}

async function reversePaymentByAdmin({ paymentId, reason, actor, ipAddress }) {
  const pay = await db.get('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!pay) throw new AppError(404, 'Payment record not found.');
  if (pay.status === 'reversed') {
    throw new AppError(400, 'This payment has already been reversed.');
  }

  let gatewayRefundNote = `Reversed by ${actor.role || 'Admin'}: ${reason}`;
  const linkedPsk = await db.get(
    'SELECT * FROM paystack_transactions WHERE payment_id = ? LIMIT 1',
    [paymentId]
  );
  if (linkedPsk) {
    const { refundPaystackGatewayTransaction } = require('./paystack.service');
    const refundOut = await refundPaystackGatewayTransaction({
      reference: linkedPsk.reference,
      amountSubunits: linkedPsk.amount_subunits,
      reason,
    });
    if (refundOut?.gatewayResponse) {
      gatewayRefundNote = refundOut.gatewayResponse;
    }
  }

  await db.withTransaction(async (tx) => {
    const allocations = await tx.query(
      'SELECT * FROM payment_allocations WHERE payment_id = ?',
      [paymentId]
    );

    for (const al of allocations) {
      const fa = await tx.get('SELECT * FROM fee_assignments WHERE id = ?', [al.fee_assignment_id]);
      if (!fa) continue;
      const newPaidCents = Math.max(0, toCents(fa.amount_paid) - toCents(al.allocated_amount));
      const netDueCents = Math.max(0, toCents(fa.amount_due) - toCents(fa.discount_amount));
      let newStatus = 'unpaid';
      if (netDueCents === 0) newStatus = 'waived';
      else if (newPaidCents >= netDueCents) newStatus = 'paid';
      else if (newPaidCents > 0) newStatus = 'partial';

      await tx.run(
        'UPDATE fee_assignments SET amount_paid = ?, status = ? WHERE id = ?',
        [fromCents(newPaidCents), newStatus, fa.id]
      );
    }

    await tx.run(
      `UPDATE payments SET status = 'reversed', notes = ? WHERE id = ?`,
      [`REVERSED: ${reason}`, paymentId]
    );
    await tx.run(
      `UPDATE paystack_transactions SET status = 'reversed', gateway_response = ? WHERE payment_id = ?`,
      [gatewayRefundNote, paymentId]
    );

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'PAYMENT_REVERSED_BY_ADMIN',
        targetType: 'payment',
        targetId: String(paymentId),
        ipAddress,
        metadata: {
          amount: pay.amount,
          studentId: pay.student_id,
          reason,
          paystackRefunded: Boolean(linkedPsk),
        },
      },
      tx
    );
  });
}

async function listStudentAccounts(query = {}) {
  const { page, limit, offset } = parsePagination(query, { page: 1, limit: 25, maxLimit: 100 });
  const params = [];
  let where = "WHERE s.status = 'active'";

  if (query.classId) {
    where += ' AND se.class_id = ?';
    params.push(Number(query.classId));
  }
  if (query.search) {
    const q = `%${String(query.search).trim().toLowerCase()}%`;
    where +=
      ' AND (LOWER(s.first_name) LIKE ? OR LOWER(s.last_name) LIKE ? OR LOWER(s.admission_number) LIKE ?)';
    params.push(q, q, q);
  }

  const rows = await db.query(
    `SELECT
       s.id AS student_id,
       s.admission_number,
       s.first_name,
       s.last_name,
       s.guardian_name,
       s.guardian_phone,
       s.guardian_email,
       u.email AS student_email,
       c.name AS class_name,
       st.name AS stream_name,
       COALESCE(SUM(fa.amount_due), 0) AS billed,
       COALESCE(SUM(fa.discount_amount), 0) AS discount,
       COALESCE(SUM(fa.amount_paid), 0) AS paid
     FROM students s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN student_enrolments se ON se.student_id = s.id
     LEFT JOIN classes c ON c.id = se.class_id
     LEFT JOIN streams st ON st.id = se.stream_id
     LEFT JOIN fee_assignments fa ON fa.student_id = s.id
     ${where}
     GROUP BY s.id, s.admission_number, s.first_name, s.last_name, s.guardian_name, s.guardian_phone, s.guardian_email, u.email, c.name, st.name
     ORDER BY s.id ASC`,
    params
  );

  let mapped = rows.map((r) => {
    const netDueCents = Math.max(0, toCents(r.billed) - toCents(r.discount));
    const paidCents = toCents(r.paid);
    const balCents = Math.max(0, netDueCents - paidCents);
    return {
      ...r,
      billed: fromCents(toCents(r.billed)),
      discount: fromCents(toCents(r.discount)),
      net_due: fromCents(netDueCents),
      paid: fromCents(paidCents),
      balance: fromCents(balCents),
      balanceCents: balCents,
    };
  });

  if (query.onlyArrears === 'true' || query.onlyArrears === '1') {
    mapped = mapped.filter((m) => m.balanceCents > 0);
  }

  const total = mapped.length;
  const paged = mapped.slice(offset, offset + limit).map(({ balanceCents, ...rest }) => rest);
  return buildPaginatedResult(paged, total, { page, limit });
}

async function getSingleStudentAccount(studentId) {
  const student = await db.get(
    `SELECT s.*, u.email AS portal_email, c.name AS class_name, st.name AS stream_name
     FROM students s
     LEFT JOIN users u ON u.id = s.user_id
     LEFT JOIN student_enrolments se ON se.student_id = s.id
     LEFT JOIN classes c ON c.id = se.class_id
     LEFT JOIN streams st ON st.id = se.stream_id
     WHERE s.id = ? LIMIT 1`,
    [studentId]
  );
  if (!student) throw new AppError(404, 'Student not found.');
  const ledger = await financeModel.getStudentFeeLedger(studentId);
  return { student, ...ledger };
}

async function recordPayment({
  studentId,
  amount,
  paymentMethod,
  referenceNumber,
  idempotencyKey,
  paymentDate,
  notes,
  actor,
  ipAddress,
}) {
  const existingPay = await db.get(
    `SELECT p.*, r.id AS receipt_id, r.receipt_number
     FROM payments p
     LEFT JOIN receipts r ON r.payment_id = p.id
     WHERE p.idempotency_key = ?`,
    [idempotencyKey]
  );
  if (existingPay) {
    return {
      duplicatePrevented: true,
      paymentId: existingPay.id,
      receiptId: existingPay.receipt_id,
      receiptNumber: existingPay.receipt_number,
    };
  }

  const context = await systemModel.getSchoolContext();
  if (!context.activeYear || !context.activeTerm) {
    throw new AppError(400, 'Active academic year and term are required before recording payments.');
  }

  const student = await db.get(
    `SELECT s.*, c.name AS class_name, st.name AS stream_name
     FROM students s
     LEFT JOIN student_enrolments se ON se.student_id = s.id
     LEFT JOIN classes c ON c.id = se.class_id
     LEFT JOIN streams st ON st.id = se.stream_id
     WHERE s.id = ? LIMIT 1`,
    [studentId]
  );
  if (!student) throw new AppError(404, 'Student record not found.');

  const payCents = toCents(amount);
  if (payCents <= 0) throw new AppError(400, 'Payment amount must be greater than zero.');

  return db.withTransaction(async (tx) => {
    const openAssignments = await tx.query(
      `SELECT fa.*, fc.name AS fee_name
       FROM fee_assignments fa
       INNER JOIN fee_categories fc ON fc.id = fa.fee_category_id
       WHERE fa.student_id = ?
       ORDER BY fa.id ASC`,
      [studentId]
    );

    let totalUnpaidCents = 0;
    const allocatable = [];
    for (const fa of openAssignments) {
      const netDueCents = Math.max(0, toCents(fa.amount_due) - toCents(fa.discount_amount));
      const paidCents = toCents(fa.amount_paid);
      const remCents = Math.max(0, netDueCents - paidCents);
      if (remCents > 0) {
        totalUnpaidCents += remCents;
        allocatable.push({ ...fa, netDueCents, paidCents, remCents });
      }
    }

    if (totalUnpaidCents === 0) {
      throw new AppError(400, 'This student currently has no unpaid fee balance to allocate against.');
    }
    if (payCents > totalUnpaidCents) {
      throw new AppError(
        400,
        `Payment amount (${fromCents(payCents)}) exceeds the student's total outstanding balance (${fromCents(totalUnpaidCents)}).`
      );
    }

    const payAmountStr = fromCents(payCents);
    const payDateStr = paymentDate || new Date().toISOString().slice(0, 10);

    const payIns = await tx.run(
      `INSERT INTO payments
       (student_id, academic_year_id, term_id, amount, payment_method, reference_number, idempotency_key, payment_date, received_by_user_id, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [
        studentId,
        context.activeYear.id,
        context.activeTerm.id,
        payAmountStr,
        paymentMethod,
        referenceNumber || '',
        idempotencyKey,
        payDateStr,
        actor.id,
        notes || '',
      ]
    );

    let remainingToAllocate = payCents;
    const receiptAllocations = [];

    for (const item of allocatable) {
      if (remainingToAllocate <= 0) break;
      const allocCents = Math.min(remainingToAllocate, item.remCents);
      const newPaidCents = item.paidCents + allocCents;
      const newStatus = newPaidCents >= item.netDueCents ? 'paid' : 'partial';

      await tx.run(
        `INSERT INTO payment_allocations (payment_id, fee_assignment_id, allocated_amount)
         VALUES (?, ?, ?)`,
        [payIns.insertId, item.id, fromCents(allocCents)]
      );
      await tx.run(
        `UPDATE fee_assignments SET amount_paid = ?, status = ? WHERE id = ?`,
        [fromCents(newPaidCents), newStatus, item.id]
      );

      receiptAllocations.push({
        feeAssignmentId: item.id,
        feeName: item.fee_name,
        allocated: fromCents(allocCents),
      });
      remainingToAllocate -= allocCents;
    }

    const balanceAfterCents = Math.max(0, totalUnpaidCents - payCents);
    const receiptNumber = await financeModel.generateNextReceiptNumber(tx);
    const currCode = context.settings?.currency_code || 'GHS';
    const currSym = context.settings?.currency_symbol || 'GH₵';

    const snapshot = {
      schoolName: context.settings?.school_name || 'School Management System',
      schoolAddress: context.settings?.address || '',
      schoolPhone: context.settings?.phone || '',
      studentName: `${student.first_name} ${student.last_name}`,
      admissionNumber: student.admission_number,
      className: [student.class_name, student.stream_name].filter(Boolean).join(' - '),
      paymentMethod,
      referenceNumber: referenceNumber || '',
      paymentDate: payDateStr,
      allocations: receiptAllocations,
      balanceAfter: fromCents(balanceAfterCents),
      cashierName: actor.fullName || 'Paystack Gateway',
    };

    const rcpIns = await tx.run(
      `INSERT INTO receipts
       (receipt_number, payment_id, student_id, issued_amount, currency_code, currency_symbol, issued_by_user_id, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptNumber,
        payIns.insertId,
        studentId,
        payAmountStr,
        currCode,
        currSym,
        actor.id,
        JSON.stringify(snapshot),
      ]
    );

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'PAYMENT_RECORDED',
        targetType: 'receipt',
        targetId: receiptNumber,
        ipAddress,
        metadata: {
          paymentId: payIns.insertId,
          studentId,
          amount: payAmountStr,
          currency: currCode,
          paymentMethod,
          referenceNumber: referenceNumber || '',
        },
      },
      tx
    );

    return {
      duplicatePrevented: false,
      paymentId: payIns.insertId,
      receiptId: rcpIns.insertId,
      receiptNumber,
      balanceAfter: fromCents(balanceAfterCents),
    };
  });
}

async function applyFeeAdjustment({ feeAssignmentId, adjustmentType, amount, reason, actor, ipAddress }) {
  const fa = await db.get('SELECT * FROM fee_assignments WHERE id = ?', [feeAssignmentId]);
  if (!fa) throw new AppError(404, 'Fee assignment not found.');

  const adjCents = toCents(amount);
  if (adjCents <= 0) throw new AppError(400, 'Adjustment amount must be greater than zero.');

  return db.withTransaction(async (tx) => {
    let dueCents = toCents(fa.amount_due);
    let discCents = toCents(fa.discount_amount);
    const paidCents = toCents(fa.amount_paid);

    if (adjustmentType === 'surcharge') {
      dueCents += adjCents;
    } else {
      const maxAllowableDisc = Math.max(0, dueCents - paidCents);
      if (discCents + adjCents > maxAllowableDisc) {
        throw new AppError(400, 'Discount/waiver cannot exceed the remaining unpaid portion of this fee item.');
      }
      discCents += adjCents;
    }

    const netDueCents = Math.max(0, dueCents - discCents);
    let newStatus = 'unpaid';
    if (netDueCents === 0) newStatus = 'waived';
    else if (paidCents >= netDueCents) newStatus = 'paid';
    else if (paidCents > 0) newStatus = 'partial';

    await tx.run(
      `UPDATE fee_assignments
       SET amount_due = ?, discount_amount = ?, status = ?
       WHERE id = ?`,
      [fromCents(dueCents), fromCents(discCents), newStatus, fa.id]
    );

    const ins = await tx.run(
      `INSERT INTO fee_adjustments
       (student_id, fee_assignment_id, adjustment_type, amount, reason, approved_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [fa.student_id, fa.id, adjustmentType, fromCents(adjCents), reason, actor.id]
    );

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'FEE_ADJUSTMENT_APPLIED',
        targetType: 'fee_adjustment',
        targetId: String(ins.insertId),
        ipAddress,
        metadata: {
          studentId: fa.student_id,
          feeAssignmentId: fa.id,
          adjustmentType,
          amount: fromCents(adjCents),
          reason,
        },
      },
      tx
    );

    return { id: ins.insertId };
  });
}

async function getReceiptByNumberOrId(identifier) {
  const isNumeric = /^\d+$/.test(String(identifier));
  const row = await db.get(
    `SELECT
       r.*,
       p.payment_method, p.reference_number, p.payment_date, p.notes, p.status AS payment_status,
       s.admission_number, s.first_name, s.last_name,
       u.full_name AS cashier_name
     FROM receipts r
     INNER JOIN payments p ON p.id = r.payment_id
     INNER JOIN students s ON s.id = r.student_id
     LEFT JOIN users u ON u.id = r.issued_by_user_id
     WHERE ${isNumeric ? 'r.id = ?' : 'r.receipt_number = ?'}
     LIMIT 1`,
    [isNumeric ? Number(identifier) : String(identifier)]
  );
  if (!row) throw new AppError(404, 'Receipt not found.');

  let snapshot = {};
  try {
    snapshot = JSON.parse(row.snapshot_json || '{}');
  } catch (_) {
    snapshot = {};
  }
  const settings = await db.get(
    'SELECT school_name, address, phone, email, currency_code, currency_symbol FROM school_settings WHERE id = 1'
  );

  return {
    school: settings,
    receipt: {
      ...row,
      issued_by_name: row.cashier_name || 'Finance Office',
      snapshot,
      school: settings,
    },
  };
}

async function listFeeCategories() {
  const items = await db.query('SELECT * FROM fee_categories ORDER BY id ASC');
  return { items };
}

async function listReconciliations() {
  const items = await db.query(
    `SELECT
       rec.*,
       rec.system_total AS expected_system_total,
       rec.counted_total AS declared_total,
       u.full_name AS reconciled_by_name
     FROM reconciliations rec
     LEFT JOIN users u ON u.id = rec.reconciled_by_user_id
     ORDER BY rec.id DESC
     LIMIT 30`
  );
  return { items };
}

async function getCollectionReports(query = {}) {
  const context = await systemModel.getSchoolContext();
  const params = [];
  let dateFilter = "WHERE p.status = 'completed'";

  if (query.startDate) {
    dateFilter += ' AND p.payment_date >= ?';
    params.push(String(query.startDate));
  }
  if (query.endDate) {
    dateFilter += ' AND p.payment_date <= ?';
    params.push(String(query.endDate));
  }

  const [dailyRows, categoryRows, arrearsClassRows, adjustments] = await Promise.all([
    db.query(
      `SELECT
         p.payment_date,
         p.payment_method,
         COUNT(*) AS transactions_count,
         COALESCE(SUM(p.amount), 0) AS total_collected
       FROM payments p
       ${dateFilter}
       GROUP BY p.payment_date, p.payment_method
       ORDER BY p.payment_date DESC, p.payment_method ASC`,
      params
    ),
    db.query(
      `SELECT
         fc.code, fc.name,
         COALESCE(SUM(fa.amount_due), 0) AS billed,
         COALESCE(SUM(fa.discount_amount), 0) AS discounts,
         COALESCE(SUM(fa.amount_paid), 0) AS collected
       FROM fee_categories fc
       LEFT JOIN fee_assignments fa ON fa.fee_category_id = fc.id
       GROUP BY fc.id, fc.code, fc.name
       ORDER BY fc.id ASC`
    ),
    db.query(
      `SELECT
         c.name AS class_name,
         COUNT(DISTINCT se.student_id) AS students_count,
         COALESCE(SUM(fa.amount_due - fa.discount_amount), 0) AS net_billed,
         COALESCE(SUM(fa.amount_paid), 0) AS collected
       FROM classes c
       LEFT JOIN student_enrolments se ON se.class_id = c.id
       LEFT JOIN fee_assignments fa ON fa.student_id = se.student_id
       WHERE c.status = 'active'
       GROUP BY c.id, c.name
       ORDER BY c.level_order ASC`
    ),
    db.query(
      `SELECT
         adj.*,
         s.admission_number, s.first_name, s.last_name,
         fc.name AS fee_name,
         u.full_name AS approved_by_name
       FROM fee_adjustments adj
       INNER JOIN students s ON s.id = adj.student_id
       INNER JOIN fee_assignments fa ON fa.id = adj.fee_assignment_id
       INNER JOIN fee_categories fc ON fc.id = fa.fee_category_id
       LEFT JOIN users u ON u.id = adj.approved_by_user_id
       ORDER BY adj.id DESC
       LIMIT 50`
    ),
  ]);

  return {
    ...context,
    dailyCollections: dailyRows.map((r) => ({
      ...r,
      transactions: Number(r.transactions_count || 0),
      collected: fromCents(toCents(r.total_collected)),
      total_collected: fromCents(toCents(r.total_collected)),
    })),
    arrearsByClass: arrearsClassRows.map((c) => {
      const nb = Math.max(0, toCents(c.net_billed));
      const coll = toCents(c.collected);
      return {
        class_name: c.class_name,
        students_count: Number(c.students_count || 0),
        net_billed: fromCents(nb),
        collected: fromCents(coll),
        outstanding: fromCents(Math.max(0, nb - coll)),
      };
    }),
    byCategory: categoryRows.map((c) => {
      const net = Math.max(0, toCents(c.billed) - toCents(c.discounts));
      const coll = toCents(c.collected);
      return {
        ...c,
        billed: fromCents(toCents(c.billed)),
        discounts: fromCents(toCents(c.discounts)),
        net_billed: fromCents(net),
        collected: fromCents(coll),
        outstanding: fromCents(Math.max(0, net - coll)),
      };
    }),
    adjustments,
  };
}

async function createReconciliation({
  reconciliationDate,
  paymentMethod,
  countedTotal,
  notes,
  actor,
  ipAddress,
}) {
  const params = [reconciliationDate];
  let methodClause = '';
  if (paymentMethod && paymentMethod !== 'all') {
    methodClause = ' AND payment_method = ?';
    params.push(paymentMethod);
  }

  const sysRow = await db.get(
    `SELECT COALESCE(SUM(amount), 0) AS sys_total
     FROM payments
     WHERE payment_date = ? AND status = 'completed' ${methodClause}`,
    params
  );

  const sysCents = toCents(sysRow?.sys_total || 0);
  const countedCents = toCents(countedTotal);
  const varianceCents = countedCents - sysCents;
  const status = varianceCents === 0 ? 'balanced' : 'discrepancy';

  const ins = await db.run(
    `INSERT INTO reconciliations
     (reconciliation_date, payment_method, system_total, counted_total, variance, notes, status, reconciled_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reconciliationDate,
      paymentMethod || 'all',
      fromCents(sysCents),
      fromCents(countedCents),
      fromCents(varianceCents),
      notes || '',
      status,
      actor.id,
    ]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'RECONCILIATION_RECORDED',
    targetType: 'reconciliation',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: {
      reconciliationDate,
      paymentMethod: paymentMethod || 'all',
      systemTotal: fromCents(sysCents),
      countedTotal: fromCents(countedCents),
      variance: fromCents(varianceCents),
      status,
    },
  });

  return {
    id: ins.insertId,
    systemTotal: fromCents(sysCents),
    countedTotal: fromCents(countedCents),
    variance: fromCents(varianceCents),
    status,
  };
}

async function listFinancialAuditLogs(query = {}) {
  const { page, limit, offset } = parsePagination(query, { page: 1, limit: 25, maxLimit: 100 });
  const finActions = [
    'FEE_CATEGORY_CREATED',
    'FEE_CATEGORY_UPDATED',
    'FEE_ASSIGNED',
    'FEE_ASSIGNMENT_UPDATED_BY_ADMIN',
    'FEE_ASSIGNMENT_DELETED_BY_ADMIN',
    'PAYMENT_RECORDED',
    'PAYMENT_REVERSED_BY_ADMIN',
    'PAYSTACK_TX_INITIALIZED',
    'PAYSTACK_TX_VERIFIED',
    'PAYSTACK_TX_ABANDONED',
    'FEE_ADJUSTMENT_APPLIED',
    'RECONCILIATION_RECORDED',
    'FINANCIAL_STATS_CONFIG_UPDATED',
    'CURRENCY_CHANGED',
  ];
  const placeholders = finActions.map(() => '?').join(', ');

  const countRow = await db.get(
    `SELECT COUNT(*) AS cnt FROM audit_logs WHERE actor_role = 'financial' OR action IN (${placeholders})`,
    finActions
  );
  const items = await db.query(
    `SELECT al.*, u.full_name AS actor_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id
     WHERE al.actor_role = 'financial' OR al.action IN (${placeholders})
     ORDER BY al.id DESC
     LIMIT ? OFFSET ?`,
    [...finActions, limit, offset]
  );

  return buildPaginatedResult(items, countRow?.cnt || 0, { page, limit });
}

module.exports = {
  computeManagedFinancialMetrics,
  getOverview,
  updateFinancialStatsConfig,
  createFeeCategory,
  updateFeeCategory,
  assignFeeToTarget,
  updateFeeAssignmentByAdmin,
  deleteUnpaidFeeAssignmentByAdmin,
  reversePaymentByAdmin,
  listStudentAccounts,
  getSingleStudentAccount,
  recordPayment,
  applyFeeAdjustment,
  getReceiptByNumberOrId,
  listFeeCategories,
  listReconciliations,
  getCollectionReports,
  createReconciliation,
  listFinancialAuditLogs,
};
