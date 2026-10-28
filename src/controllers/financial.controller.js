const crypto = require('crypto');
const db = require('../config/database');
const financialService = require('../services/financial.service');
const paystackService = require('../services/paystack.service');
const superadminService = require('../services/superadmin.service');
const systemModel = require('../models/system.model');
const { recordAudit } = require('../services/audit.service');
const { AppError } = require('../middleware/errorHandler');
const {
  requireString,
  optionalString,
  requirePositiveInt,
  optionalPositiveInt,
  requireMoney,
  requireEnum,
} = require('../validators/schemas');

async function getOverview(_req, res) {
  const data = await financialService.getOverview();
  return res.json({ ok: true, ...data });
}

async function listFeeCategories(_req, res) {
  const data = await financialService.listFeeCategories();
  return res.json({ ok: true, ...data });
}

async function createFeeCategory(req, res) {
  const created = await financialService.createFeeCategory({
    code: requireString(req.body.code, 'Category code', { min: 2, max: 30 }),
    name: requireString(req.body.name, 'Category name', { min: 2, max: 120 }),
    description: optionalString(req.body.description, 255),
    defaultAmount: requireMoney(req.body.defaultAmount, 'Default amount'),
    frequency: requireEnum(
      req.body.frequency || 'termly',
      ['termly', 'annual', 'one_time'],
      'Frequency'
    ),
    isMandatory: req.body.isMandatory !== false,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function updateFeeCategory(req, res) {
  await financialService.updateFeeCategory({
    id: requirePositiveInt(req.params.id, 'Fee category ID'),
    name: req.body.name ? requireString(req.body.name, 'Name', { min: 2, max: 120 }) : undefined,
    defaultAmount:
      req.body.defaultAmount !== undefined
        ? requireMoney(req.body.defaultAmount, 'Default amount')
        : undefined,
    frequency: req.body.frequency
      ? requireEnum(req.body.frequency, ['termly', 'annual', 'one_time'], 'Frequency')
      : undefined,
    status: req.body.status
      ? requireEnum(req.body.status, ['active', 'inactive'], 'Status')
      : undefined,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Fee category updated.' });
}

async function assignFee(req, res) {
  const context = await systemModel.getSchoolContext();
  const studentId = optionalPositiveInt(req.body.studentId);
  const classId = optionalPositiveInt(req.body.classId);

  const rawTargetType =
    req.body.targetType || (studentId ? 'student' : classId ? 'class' : '');
  if (!rawTargetType) {
    throw new AppError(400, 'Please select either a target class or a specific student.');
  }
  const targetType = requireEnum(rawTargetType, ['student', 'class'], 'Target type');

  let academicYearId =
    optionalPositiveInt(req.body.academicYearId) || context.activeYear?.id;
  let termId = optionalPositiveInt(req.body.termId) || context.activeTerm?.id;
  if (!academicYearId || !termId) {
    const ensured = await systemModel.ensureActiveAcademicPeriod();
    academicYearId = academicYearId || ensured.yearId;
    termId = termId || ensured.termId;
  }

  const result = await financialService.assignFeeToTarget({
    targetType,
    studentId,
    classId,
    feeCategoryId: requirePositiveInt(req.body.feeCategoryId, 'Fee category'),
    academicYearId,
    termId,
    amountDue: req.body.amountDue ? requireMoney(req.body.amountDue, 'Amount due') : null,
    dueDate: optionalString(req.body.dueDate, 20),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({
    ok: true,
    ...result,
    message: `Assigned fee to ${result.assignedCount ?? 1} student account(s).`,
  });
}

async function listStudentAccounts(req, res) {
  const data = await financialService.listStudentAccounts(req.query);
  return res.json({ ok: true, ...data });
}

async function getStudentAccount(req, res) {
  const studentId = requirePositiveInt(req.params.studentId, 'Student ID');
  const data = await financialService.getSingleStudentAccount(studentId);
  return res.json({ ok: true, ...data });
}

async function initializePaystack(req, res) {
  const initData = await paystackService.initializePaystackTransaction({
    studentId: requirePositiveInt(req.body.studentId, 'Student ID'),
    amount: requireMoney(req.body.amount, 'Payment amount'),
    payerEmail: optionalString(req.body.payerEmail, 160),
    channel: requireEnum(
      req.body.channel || 'mobile_money',
      ['card', 'mobile_money', 'bank_transfer', 'ussd'],
      'Paystack channel'
    ),
    callbackUrl: optionalString(req.body.callbackUrl, 400),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, transaction: initData });
}

async function verifyPaystack(req, res) {
  const reference = requireString(
    req.body.reference || req.query.reference,
    'Paystack reference',
    { min: 4, max: 120 }
  );
  const selectedChannel = optionalString(req.body.channel, 40) || null;
  const result = await paystackService.verifyPaystackTransaction({
    reference,
    selectedChannel,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...result });
}

async function abandonPaystack(req, res) {
  const reference = requireString(req.body.reference, 'Paystack reference', { min: 4, max: 120 });
  const result = await paystackService.abandonPaystackTransaction({
    reference,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...result });
}

async function listPaystackTransactions(req, res) {
  const items = await paystackService.listPaystackTransactions(req.query);
  return res.json({ ok: true, items });
}

async function recordPayment(req, res) {
  const idempotencyKey =
    optionalString(req.body.idempotencyKey, 120) || crypto.randomBytes(16).toString('hex');

  const result = await financialService.recordPayment({
    studentId: requirePositiveInt(req.body.studentId, 'Student ID'),
    amount: requireMoney(req.body.amount, 'Payment amount'),
    paymentMethod: requireEnum(
      req.body.paymentMethod,
      ['paystack', 'cash', 'mobile_money', 'bank_transfer', 'card', 'cheque'],
      'Payment method'
    ),
    referenceNumber: optionalString(req.body.referenceNumber, 100),
    idempotencyKey,
    paymentDate: optionalString(req.body.paymentDate, 20),
    notes: optionalString(req.body.notes, 255),
    actor: req.user,
    ipAddress: req.ip,
  });

  return res.status(result.duplicatePrevented ? 200 : 201).json({ ok: true, ...result });
}

async function applyAdjustment(req, res) {
  const rawType = req.body.adjustmentType === 'debit_adjustment' ? 'surcharge' : req.body.adjustmentType;
  const created = await financialService.applyFeeAdjustment({
    feeAssignmentId: requirePositiveInt(req.body.feeAssignmentId, 'Fee assignment ID'),
    adjustmentType: requireEnum(
      rawType,
      ['discount', 'scholarship', 'waiver', 'surcharge'],
      'Adjustment type'
    ),
    amount: requireMoney(req.body.amount, 'Adjustment amount'),
    reason: requireString(req.body.reason, 'Reason', { min: 4, max: 255 }),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({
    ok: true,
    ...created,
    message: 'Authorized fee adjustment applied and logged.',
  });
}

async function getReceipt(req, res) {
  const data = await financialService.getReceiptByNumberOrId(req.params.identifier);
  return res.json({ ok: true, ...data });
}

async function getReports(req, res) {
  const data = await financialService.getCollectionReports(req.query);
  return res.json({ ok: true, ...data });
}

async function listReconciliations(_req, res) {
  const data = await financialService.listReconciliations();
  return res.json({ ok: true, ...data });
}

async function createReconciliation(req, res) {
  const rawCounted = req.body.countedTotal ?? req.body.declaredTotal;
  const created = await financialService.createReconciliation({
    reconciliationDate: requireString(req.body.reconciliationDate, 'Reconciliation date', {
      min: 8,
      max: 20,
    }),
    paymentMethod: requireEnum(
      req.body.paymentMethod || 'all',
      ['all', 'paystack', 'cash', 'mobile_money', 'bank_transfer', 'card', 'cheque'],
      'Payment method'
    ),
    countedTotal: requireMoney(rawCounted, 'Declared treasury total', { allowZero: true }),
    notes: optionalString(req.body.notes, 255),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, ...created });
}

async function listAuditLogs(req, res) {
  const data = await financialService.listFinancialAuditLogs(req.query);
  return res.json({ ok: true, ...data });
}

async function switchCurrency(req, res) {
  const currencyCode = requireString(req.body.currencyCode, 'Currency code', { min: 2, max: 10 });
  const currencySymbol = optionalString(req.body.currencySymbol, 16);
  const resolved = await systemModel.updateCurrency({ currencyCode, currencySymbol });
  await recordAudit({
    actorUserId: req.user.id,
    actorRole: req.user.role,
    action: 'CURRENCY_CHANGED',
    targetType: 'school_settings',
    targetId: '1',
    ipAddress: req.ip,
    metadata: resolved,
  });
  return res.json({ ok: true, currency: resolved });
}

async function listPaystackTransfers(req, res) {
  const items = await paystackService.listPaystackTransfers(req.query.limit || 50);
  return res.json({ ok: true, items });
}

async function sendPaystackTransfer(req, res) {
  const result = await paystackService.sendPaystackTransfer({
    recipientName: requireString(req.body.recipientName, 'Recipient name', { min: 2, max: 160 }),
    recipientAccount: requireString(req.body.recipientAccount, 'Account or wallet number', {
      min: 4,
      max: 64,
    }),
    bankOrNetwork: requireString(req.body.bankOrNetwork, 'Bank or network code', {
      min: 2,
      max: 80,
    }),
    channel: requireEnum(
      req.body.channel || 'mobile_money',
      ['mobile_money', 'bank_account'],
      'Transfer channel'
    ),
    amount: requireMoney(req.body.amount, 'Transfer amount'),
    reason: optionalString(req.body.reason, 255),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.status(201).json({ ok: true, transfer: result });
}

async function reversePayment(req, res) {
  await financialService.reversePaymentByAdmin({
    paymentId: requirePositiveInt(req.params.id, 'Payment ID'),
    reason: requireString(req.body.reason, 'Reversal reason', { min: 4, max: 255 }),
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Payment reversed and Paystack refund processed.' });
}

async function getSchoolTimetable(req, res) {
  const [items, classes] = await Promise.all([
    superadminService.listTimetables(req.query),
    db.query("SELECT id, name FROM classes WHERE status = 'active' ORDER BY level_order ASC, name ASC"),
  ]);
  return res.json({ ok: true, items, classes });
}

module.exports = {
  getOverview,
  listFeeCategories,
  createFeeCategory,
  updateFeeCategory,
  assignFee,
  listStudentAccounts,
  getStudentAccount,
  initializePaystack,
  verifyPaystack,
  abandonPaystack,
  listPaystackTransactions,
  listPaystackTransfers,
  sendPaystackTransfer,
  recordPayment,
  reversePayment,
  applyAdjustment,
  getReceipt,
  getReports,
  listReconciliations,
  createReconciliation,
  listAuditLogs,
  switchCurrency,
  getSchoolTimetable,
};
