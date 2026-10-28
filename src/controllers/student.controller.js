const studentService = require('../services/student.service');
const paystackService = require('../services/paystack.service');
const financialService = require('../services/financial.service');
const db = require('../config/database');
const { AppError } = require('../middleware/errorHandler');
const { requireString, optionalString, requireMoney, requireEnum } = require('../validators/schemas');

async function getOverview(req, res) {
  const data = await studentService.getPortalData(req.user, req.query, req.ip);
  return res.json({ ok: true, ...data });
}

async function getSpecificStudentGuard(req, res) {
  const data = await studentService.getPortalData(
    req.user,
    { studentId: req.params.studentId },
    req.ip
  );
  return res.json({ ok: true, ...data });
}

async function updateContact(req, res) {
  await studentService.updateAllowedProfile(req.user, {
    phone: optionalString(req.body.phone, 50),
    ipAddress: req.ip,
  });
  return res.json({ ok: true, message: 'Contact phone updated.' });
}

async function requestProfileCorrection(req, res) {
  const created = await studentService.submitSensitiveProfileChangeRequest(req.user, {
    fieldName: requireString(req.body.fieldName, 'Field name', { min: 2, max: 50 }),
    requestedValue: requireString(req.body.requestedValue, 'Requested value', { min: 1, max: 240 }),
    reason: optionalString(req.body.reason, 240),
    ipAddress: req.ip,
  });
  return res.status(201).json({
    ok: true,
    ...created,
    message: 'Profile correction request submitted for School Administration approval.',
  });
}

async function initializeOwnPaystackPayment(req, res) {
  const student = await studentService.requireOwnStudentRecord(req.user, null, req.ip);
  const initData = await paystackService.initializePaystackTransaction({
    studentId: student.id,
    amount: requireMoney(req.body.amount, 'Payment amount'),
    payerEmail: optionalString(req.body.payerEmail, 160) || student.email,
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

async function verifyOwnPaystackPayment(req, res) {
  const student = await studentService.requireOwnStudentRecord(req.user, null, req.ip);
  const reference = requireString(req.body.reference, 'Paystack reference', { min: 4, max: 120 });
  const txRow = await db.get('SELECT student_id FROM paystack_transactions WHERE reference = ?', [
    reference,
  ]);
  if (!txRow || Number(txRow.student_id) !== Number(student.id)) {
    throw new AppError(403, 'Access denied: you can only verify your own Paystack fee payments.');
  }

  const result = await paystackService.verifyPaystackTransaction({
    reference,
    selectedChannel: optionalString(req.body.channel, 40) || null,
    actor: req.user,
    ipAddress: req.ip,
  });
  return res.json({ ok: true, ...result });
}

async function getOwnReceipt(req, res) {
  const student = await studentService.requireOwnStudentRecord(req.user, null, req.ip);
  const data = await financialService.getReceiptByNumberOrId(req.params.identifier);
  if (Number(data.receipt.student_id) !== Number(student.id)) {
    throw new AppError(403, 'Access denied: you can only view your own receipts.');
  }
  return res.json({ ok: true, ...data });
}

module.exports = {
  getOverview,
  getSpecificStudentGuard,
  updateContact,
  requestProfileCorrection,
  initializeOwnPaystackPayment,
  verifyOwnPaystackPayment,
  getOwnReceipt,
};
