const crypto = require('crypto');
const db = require('../config/database');
const env = require('../config/environment');
const systemModel = require('../models/system.model');
const financeModel = require('../models/finance.model');
const financialService = require('./financial.service');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');
const { toCents, fromCents } = require('../utils/currency');

const ALLOWED_PAYSTACK_CHANNELS = ['card', 'mobile_money', 'bank_transfer', 'ussd'];

function generatePaystackReference() {
  const yr = new Date().getUTCFullYear();
  const ts = Date.now().toString().slice(-6);
  const rnd = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PSK-${yr}-${ts}-${rnd}`;
}

async function initializePaystackTransaction({
  studentId,
  amount,
  payerEmail,
  channel = 'mobile_money',
  callbackUrl = '',
  actor,
  ipAddress = '',
}) {
  const context = await systemModel.getSchoolContext();
  if (!context.paystack.enabled) {
    throw new AppError(403, 'Paystack online payments are currently disabled in Financial Settings.');
  }
  if (!context.activeYear || !context.activeTerm) {
    throw new AppError(400, 'An active academic year and term must be configured before accepting payments.');
  }

  const student = await db.get(
    `SELECT s.*, u.email AS portal_email
     FROM students s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.id = ? LIMIT 1`,
    [studentId]
  );
  if (!student) throw new AppError(404, 'Student record not found.');

  const ledger = await financeModel.getStudentFeeLedger(studentId);
  const outstandingCents = toCents(ledger.summary.outstandingBalance);
  const amountSubunits = toCents(amount);

  if (amountSubunits <= 0) {
    throw new AppError(400, 'Payment amount must be greater than zero.');
  }
  if (outstandingCents <= 0) {
    throw new AppError(400, 'This student currently has zero unpaid fee balance.');
  }
  if (amountSubunits > outstandingCents) {
    throw new AppError(
      400,
      `Payment amount (${fromCents(amountSubunits)}) exceeds the student's outstanding balance (${fromCents(outstandingCents)}).`
    );
  }

  const effectiveEmail = (payerEmail || student.guardian_email || student.portal_email || 'bursar@school.edu.gh')
    .trim()
    .toLowerCase();
  const cleanChannel = ALLOWED_PAYSTACK_CHANNELS.includes(channel) ? channel : 'mobile_money';
  const currencyCode = (context.settings?.currency_code || 'GHS').toUpperCase();
  const currencySymbol = context.settings?.currency_symbol || 'GH₵';
  const reference = generatePaystackReference();
  const amountStr = fromCents(amountSubunits);

  const pskSecrets = await systemModel.getPaystackRuntimeSecrets();
  let gatewayMode = 'sandbox';
  let accessCode = `acc_sbx_${crypto.randomBytes(6).toString('hex')}`;
  let authorizationUrl = '';

  if (pskSecrets.isLiveConfigured) {
    gatewayMode = pskSecrets.mode;
    const response = await fetch(`${env.paystack.apiBaseUrl}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pskSecrets.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: effectiveEmail,
        amount: amountSubunits,
        currency: currencyCode,
        reference,
        channels: context.paystack.channels,
        callback_url: callbackUrl || env.paystack.callbackUrl,
        metadata: {
          studentId: student.id,
          admissionNumber: student.admission_number,
          studentName: `${student.first_name} ${student.last_name}`,
          initiatedByUserId: actor.id,
        },
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.status || !payload.data) {
      throw new AppError(
        502,
        payload.message || 'Paystack gateway rejected transaction initialization. Verify currency and API keys.'
      );
    }
    accessCode = payload.data.access_code || '';
    authorizationUrl = payload.data.authorization_url || '';
  }

  await db.run(
    `INSERT INTO paystack_transactions
     (reference, access_code, authorization_url, student_id, academic_year_id, term_id, payer_email, amount, amount_subunits, currency_code, channel, gateway_mode, status, initiated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      reference,
      accessCode,
      authorizationUrl,
      student.id,
      context.activeYear.id,
      context.activeTerm.id,
      effectiveEmail,
      amountStr,
      amountSubunits,
      currencyCode,
      cleanChannel,
      gatewayMode,
      actor.id,
    ]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'PAYSTACK_TX_INITIALIZED',
    targetType: 'paystack_transaction',
    targetId: reference,
    ipAddress,
    metadata: {
      studentId: student.id,
      amount: amountStr,
      currency: currencyCode,
      channel: cleanChannel,
      gatewayMode,
    },
  });

  return {
    reference,
    accessCode,
    authorizationUrl,
    gatewayMode,
    publicKey: pskSecrets.publicKey || null,
    amount: amountStr,
    amountSubunits,
    currencyCode,
    currencySymbol,
    payerEmail: effectiveEmail,
    channel: cleanChannel,
    allowedChannels: context.paystack.channels,
    student: {
      id: student.id,
      name: `${student.first_name} ${student.last_name}`,
      admissionNumber: student.admission_number,
    },
  };
}

async function verifyPaystackTransaction({ reference, selectedChannel = null, actor, ipAddress = '' }) {
  const cleanRef = String(reference || '').trim();
  if (!cleanRef) throw new AppError(400, 'Paystack transaction reference is required.');

  const txRow = await db.get('SELECT * FROM paystack_transactions WHERE reference = ?', [cleanRef]);
  if (!txRow) {
    throw new AppError(404, `No Paystack transaction found for reference ${cleanRef}.`);
  }

  // Idempotent return if already verified
  if (txRow.status === 'success' && txRow.receipt_number) {
    return {
      status: 'success',
      alreadyVerified: true,
      duplicatePrevented: true,
      reference: txRow.reference,
      channel: txRow.channel,
      paymentId: txRow.payment_id,
      receiptNumber: txRow.receipt_number,
      amount: txRow.amount,
    };
  }

  if (txRow.status === 'reversed') {
    throw new AppError(400, 'This Paystack transaction has been reversed and cannot be re-verified.');
  }

  const pskSecrets = await systemModel.getPaystackRuntimeSecrets();
  let verifiedChannel = selectedChannel && ALLOWED_PAYSTACK_CHANNELS.includes(selectedChannel)
    ? selectedChannel
    : txRow.channel;
  let gatewayResponse = 'Approved (Paystack Sandbox)';

  if (txRow.gateway_mode !== 'sandbox' && pskSecrets.isLiveConfigured) {
    const response = await fetch(
      `${env.paystack.apiBaseUrl}/transaction/verify/${encodeURIComponent(cleanRef)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${pskSecrets.secretKey}`,
          Accept: 'application/json',
        },
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.status || !payload.data) {
      throw new AppError(502, payload.message || 'Unable to verify reference with Paystack API.');
    }

    if (payload.data.status !== 'success') {
      await db.run(
        `UPDATE paystack_transactions SET status = ?, gateway_response = ? WHERE id = ?`,
        [payload.data.status || 'failed', payload.data.gateway_response || 'Not successful', txRow.id]
      );
      throw new AppError(
        400,
        `Paystack transaction status is "${payload.data.status}" (${payload.data.gateway_response || 'Unpaid'}).`
      );
    }

    if (Number(payload.data.amount) !== Number(txRow.amount_subunits)) {
      throw new AppError(400, 'Paystack amount mismatch detected during verification.');
    }

    verifiedChannel = payload.data.channel || verifiedChannel;
    gatewayResponse = payload.data.gateway_response || 'Approved by Paystack';
  }

  // Record payment & allocate against student fees atomically
  const effectiveActor = actor || { id: txRow.initiated_by_user_id, role: 'financial', fullName: 'Paystack Gateway' };
  const payOutcome = await financialService.recordPayment({
    studentId: txRow.student_id,
    amount: Number(txRow.amount),
    paymentMethod: 'paystack',
    referenceNumber: txRow.reference,
    idempotencyKey: `psk:${txRow.reference}`,
    paymentDate: new Date().toISOString().slice(0, 10),
    notes: `Paystack (${verifiedChannel}) - ${gatewayResponse}`,
    actor: effectiveActor,
    ipAddress,
  });

  await db.run(
    `UPDATE paystack_transactions
     SET status = 'success',
         channel = ?,
         gateway_response = ?,
         payment_id = ?,
         receipt_number = ?,
         verified_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [verifiedChannel, gatewayResponse, payOutcome.paymentId, payOutcome.receiptNumber, txRow.id]
  );

  await recordAudit({
    actorUserId: effectiveActor.id,
    actorRole: effectiveActor.role,
    action: 'PAYSTACK_TX_VERIFIED',
    targetType: 'paystack_transaction',
    targetId: txRow.reference,
    ipAddress,
    metadata: {
      paymentId: payOutcome.paymentId,
      receiptNumber: payOutcome.receiptNumber,
      channel: verifiedChannel,
      amount: txRow.amount,
    },
  });

  return {
    status: 'success',
    alreadyVerified: false,
    duplicatePrevented: false,
    reference: txRow.reference,
    channel: verifiedChannel,
    paymentId: payOutcome.paymentId,
    receiptId: payOutcome.receiptId,
    receiptNumber: payOutcome.receiptNumber,
    balanceAfter: payOutcome.balanceAfter,
    amount: txRow.amount,
  };
}

async function abandonPaystackTransaction({ reference, actor, ipAddress = '' }) {
  const txRow = await db.get('SELECT * FROM paystack_transactions WHERE reference = ?', [reference]);
  if (!txRow) throw new AppError(404, 'Transaction not found.');
  if (txRow.status !== 'pending') return { status: txRow.status };

  await db.run(
    `UPDATE paystack_transactions SET status = 'abandoned', gateway_response = 'Cancelled by user' WHERE id = ?`,
    [txRow.id]
  );

  await recordAudit({
    actorUserId: actor?.id || null,
    actorRole: actor?.role || '',
    action: 'PAYSTACK_TX_ABANDONED',
    targetType: 'paystack_transaction',
    targetId: reference,
    ipAddress,
  });

  return { status: 'abandoned' };
}

async function handlePaystackWebhook({ rawBody, signature, ipAddress = '' }) {
  const pskSecrets = await systemModel.getPaystackRuntimeSecrets();
  const secret = pskSecrets.webhookSecret;
  if (!secret) {
    throw new AppError(400, 'Paystack Secret Key / Webhook Secret is not configured for webhook verification.');
  }
  const expectedSig = crypto
    .createHmac('sha512', secret)
    .update(rawBody)
    .digest('hex');

  const sigBuf = Buffer.from(String(signature || ''), 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (!signature || sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new AppError(401, 'Invalid Paystack webhook signature.');
  }

  let handled = false;
  const event = JSON.parse(rawBody.toString('utf8'));
  if (event?.event === 'charge.success' && event.data?.reference) {
    const existing = await db.get('SELECT * FROM paystack_transactions WHERE reference = ?', [
      event.data.reference,
    ]);
    if (existing && existing.status !== 'success') {
      await verifyPaystackTransaction({
        reference: event.data.reference,
        selectedChannel: event.data.channel,
        actor: { id: existing.initiated_by_user_id, role: 'financial', fullName: 'Paystack Webhook' },
        ipAddress,
      });
      handled = true;
    } else if (existing?.status === 'success') {
      handled = true;
    }
  }
  return { received: true, handled };
}

async function listPaystackTransactions(query = {}) {
  const params = [];
  let where = 'WHERE 1=1';

  if (query.status) {
    where += ' AND pt.status = ?';
    params.push(String(query.status));
  }
  if (query.studentId) {
    where += ' AND pt.student_id = ?';
    params.push(Number(query.studentId));
  }
  if (query.search) {
    const q = `%${String(query.search).trim().toLowerCase()}%`;
    where +=
      ' AND (LOWER(pt.reference) LIKE ? OR LOWER(s.admission_number) LIKE ? OR LOWER(s.first_name) LIKE ? OR LOWER(s.last_name) LIKE ?)';
    params.push(q, q, q, q);
  }

  return db.query(
    `SELECT
       pt.*,
       s.admission_number,
       s.first_name,
       s.last_name,
       u.full_name AS initiated_by_name
     FROM paystack_transactions pt
     INNER JOIN students s ON s.id = pt.student_id
     LEFT JOIN users u ON u.id = pt.initiated_by_user_id
     ${where}
     ORDER BY pt.id DESC
     LIMIT 60`,
    params
  );
}

async function refundPaystackGatewayTransaction({ reference, amountSubunits, reason = '' }) {
  const pskSecrets = await systemModel.getPaystackRuntimeSecrets();
  if (!pskSecrets.refundsEnabled) {
    throw new AppError(403, 'Paystack transaction reversals/refunds are disabled in School Settings.');
  }

  const txRow = reference
    ? await db.get('SELECT * FROM paystack_transactions WHERE reference = ? LIMIT 1', [reference])
    : null;

  if (txRow && txRow.gateway_mode !== 'sandbox' && pskSecrets.isLiveConfigured) {
    const response = await fetch(`${env.paystack.apiBaseUrl}/refund`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pskSecrets.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transaction: txRow.reference,
        ...(amountSubunits ? { amount: Number(amountSubunits) } : {}),
        merchant_note: reason || 'Reversed by School Administration',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.status) {
      throw new AppError(
        502,
        payload.message || 'Paystack gateway rejected the refund request. Verify your Paystack Secret Key.'
      );
    }
    return {
      gatewayRefunded: true,
      gatewayMode: pskSecrets.mode,
      gatewayResponse: payload.message || 'Refund initiated via Paystack API',
    };
  }

  return {
    gatewayRefunded: Boolean(txRow),
    gatewayMode: 'sandbox',
    gatewayResponse: `Refunded via Paystack Sandbox: ${reason}`,
  };
}

async function sendPaystackTransfer({
  recipientName,
  recipientAccount,
  bankOrNetwork,
  channel = 'mobile_money',
  amount,
  reason = '',
  actor,
  ipAddress = '',
}) {
  const [context, pskSecrets] = await Promise.all([
    systemModel.getSchoolContext(),
    systemModel.getPaystackRuntimeSecrets(),
  ]);

  if (!pskSecrets.transfersEnabled) {
    throw new AppError(403, 'Paystack outbound transfers are currently disabled in School Settings.');
  }

  const amountSubunits = toCents(amount);
  if (amountSubunits <= 0) {
    throw new AppError(400, 'Transfer amount must be greater than zero.');
  }

  const currencyCode = (context.settings?.currency_code || 'GHS').toUpperCase();
  const amountStr = fromCents(amountSubunits);
  const yr = new Date().getUTCFullYear();
  const reference = `TRF-${yr}-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const cleanChannel = channel === 'bank_account' ? 'bank_account' : 'mobile_money';

  let gatewayMode = 'sandbox';
  let transferCode = `TRF_SBX_${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  let status = 'success';
  let gatewayResponse = 'Transfer Completed (Paystack Sandbox)';

  if (pskSecrets.isLiveConfigured) {
    gatewayMode = pskSecrets.mode;
    const recipientType = cleanChannel === 'mobile_money' ? 'mobile_money' : 'nuban';
    const recRes = await fetch(`${env.paystack.apiBaseUrl}/transferrecipient`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pskSecrets.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: recipientType,
        name: recipientName,
        account_number: recipientAccount,
        bank_code: bankOrNetwork,
        currency: currencyCode,
      }),
    });
    const recPayload = await recRes.json().catch(() => ({}));
    if (!recRes.ok || !recPayload.status || !recPayload.data?.recipient_code) {
      throw new AppError(
        502,
        recPayload.message ||
          'Paystack rejected transfer recipient details. Verify bank/network code and Secret Key.'
      );
    }

    const trfRes = await fetch(`${env.paystack.apiBaseUrl}/transfer`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pskSecrets.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'balance',
        amount: amountSubunits,
        recipient: recPayload.data.recipient_code,
        reason: reason || 'School Disbursement',
        reference,
        currency: currencyCode,
      }),
    });
    const trfPayload = await trfRes.json().catch(() => ({}));
    if (!trfRes.ok || !trfPayload.status || !trfPayload.data) {
      throw new AppError(
        502,
        trfPayload.message || 'Paystack rejected outbound transfer. Verify Paystack balance & Transfers permission.'
      );
    }
    transferCode = trfPayload.data.transfer_code || '';
    status = trfPayload.data.status || 'pending';
    gatewayResponse = trfPayload.message || 'Transfer queued via Paystack';
  }

  const ins = await db.run(
    `INSERT INTO paystack_transfers
     (reference, transfer_code, recipient_name, recipient_account, bank_or_network, channel, amount, amount_subunits, currency_code, reason, gateway_mode, status, gateway_response, initiated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reference,
      transferCode,
      recipientName,
      recipientAccount,
      bankOrNetwork,
      cleanChannel,
      amountStr,
      amountSubunits,
      currencyCode,
      reason || '',
      gatewayMode,
      status,
      gatewayResponse,
      actor.id,
    ]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'PAYSTACK_TRANSFER_SENT',
    targetType: 'paystack_transfer',
    targetId: reference,
    ipAddress,
    metadata: {
      recipientName,
      channel: cleanChannel,
      amount: amountStr,
      currency: currencyCode,
      gatewayMode,
      status,
    },
  });

  return {
    id: ins.insertId,
    reference,
    transferCode,
    recipientName,
    channel: cleanChannel,
    amount: amountStr,
    currencyCode,
    gatewayMode,
    status,
    gatewayResponse,
  };
}

async function listPaystackTransfers(limit = 50) {
  return db.query(
    `SELECT pt.*, u.full_name AS initiated_by_name
     FROM paystack_transfers pt
     LEFT JOIN users u ON u.id = pt.initiated_by_user_id
     ORDER BY pt.id DESC
     LIMIT ?`,
    [Number(limit) || 50]
  );
}

module.exports = {
  ALLOWED_PAYSTACK_CHANNELS,
  initializePaystackTransaction,
  verifyPaystackTransaction,
  abandonPaystackTransaction,
  handlePaystackWebhook,
  listPaystackTransactions,
  refundPaystackGatewayTransaction,
  sendPaystackTransfer,
  listPaystackTransfers,
};
