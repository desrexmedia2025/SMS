const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Point tests at an isolated temporary database & uploads folder so live dev data is never touched
const TEST_DB_PATH = path.join('/tmp', `sms_integration_${process.pid}.sqlite`);
const TEST_UPLOADS_DIR = path.join('/tmp', `sms_uploads_${process.pid}`);
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_PATH = TEST_DB_PATH;
process.env.SMS_UPLOADS_DIR = TEST_UPLOADS_DIR;
process.env.AUTO_SEED_DEMO = 'true';
process.env.PAYSTACK_WEBHOOK_SECRET = 'psk_test_webhook_secret_key_2026';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';

const db = require('../src/config/database');
const { seedDemoData } = require('../database/seeds/seed');
const { createApp } = require('../src/app');
const accountLinkingService = require('../src/services/accountLinking.service');
const userModel = require('../src/models/user.model');

let server;
let baseUrl;

// Lightweight cookie + CSRF session client for multi-role HTTP tests
class SessionClient {
  constructor() {
    this.cookie = '';
    this.csrfToken = '';
  }

  async request(
    urlPath,
    { method = 'GET', body = null, redirect = 'manual', sendCsrf = true, extraHeaders = {} } = {}
  ) {
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (this.cookie) headers.Cookie = this.cookie;
    if (sendCsrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) && this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }
    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const res = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: payload,
      redirect,
    });

    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (setCookies.length > 0) {
      this.cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json = null;
    try {
      json = JSON.parse(text);
      if (json && json.csrfToken) this.csrfToken = json.csrfToken;
    } catch (_) {
      // HTML or binary response
    }
    return { status: res.status, headers: res.headers, json, text, buffer: buf };
  }

  async login(identifier, password) {
    await this.request('/api/auth/session');
    const res = await this.request('/api/auth/login', {
      method: 'POST',
      body: { identifier, password },
    });
    return res;
  }
}

test.before(async () => {
  await db.initDatabase({ driver: 'sqlite', sqlitePath: TEST_DB_PATH, forceReinit: true });
  await seedDemoData();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await db.closeDatabase();
  for (const suffix of ['', '-shm', '-wal']) {
    if (fs.existsSync(TEST_DB_PATH + suffix)) {
      fs.unlinkSync(TEST_DB_PATH + suffix);
    }
  }
  if (fs.existsSync(TEST_UPLOADS_DIR)) {
    fs.rmSync(TEST_UPLOADS_DIR, { recursive: true, force: true });
  }
});

test('1. Health check confirms database connection and exactly four dashboards', async () => {
  const client = new SessionClient();
  const res = await client.request('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.db.connected, true);
  assert.deepEqual(res.json.dashboards, ['superadmin', 'teacher', 'student', 'financial']);
});

test('2. Unauthenticated access and missing CSRF tokens are rejected on the server', async () => {
  const anon = new SessionClient();

  const apiRes = await anon.request('/api/superadmin/overview');
  assert.equal(apiRes.status, 401);

  const htmlRes = await fetch(`${baseUrl}/dashboard/superadmin`, { redirect: 'manual' });
  assert.equal(htmlRes.status, 302);
  assert.equal(htmlRes.headers.get('location'), '/login');

  await anon.request('/api/auth/session');
  const noCsrfLogin = await anon.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'admin@school.edu.gh', password: 'Admin@2026!' },
    sendCsrf: false,
  });
  assert.equal(noCsrfLogin.status, 403);
});

test('3. All four roles route to their exact dashboard and cross-role access returns 403', async () => {
  const admin = new SessionClient();
  const teacher = new SessionClient();
  const student = new SessionClient();
  const finance = new SessionClient();

  const rAdmin = await admin.login('admin@school.edu.gh', 'Admin@2026!');
  assert.equal(rAdmin.status, 200);
  assert.equal(rAdmin.json.redirectTo, '/dashboard/superadmin');

  const rTeacher = await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  assert.equal(rTeacher.status, 200);
  assert.equal(rTeacher.json.redirectTo, '/dashboard/teacher');

  const rStudent = await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  assert.equal(rStudent.status, 200);
  assert.equal(rStudent.json.redirectTo, '/dashboard/student');

  const rFinance = await finance.login('finance@school.edu.gh', 'Finance@2026!');
  assert.equal(rFinance.status, 200);
  assert.equal(rFinance.json.redirectTo, '/dashboard/financial');

  // Teacher blocked from Financial & Superadmin
  assert.equal((await teacher.request('/api/financial/overview')).status, 403);
  assert.equal((await teacher.request('/dashboard/financial')).status, 403);

  // Student blocked from Superadmin, Teacher & Financial
  assert.equal((await student.request('/api/superadmin/users')).status, 403);
  assert.equal((await student.request('/dashboard/superadmin')).status, 403);

  // Financial staff blocked from editing marks or managing Superadmin users
  assert.equal((await finance.request('/api/superadmin/users')).status, 403);
  assert.equal(
    (await finance.request('/api/teacher/assessments/1/marks', { method: 'POST', body: { entries: [] } })).status,
    403
  );
});

test('4. Student IDOR protection blocks viewing another student’s private records', async () => {
  const student1 = new SessionClient();
  await student1.login('kwame.asante@student.school.edu.gh', 'Student@2026!');

  // Own record works
  const own = await student1.request('/api/student/overview');
  assert.equal(own.status, 200);
  assert.equal(own.json.student.admission_number, 'ADM-2026-001');

  // Tampering with URL/query to view student #2 is strictly denied on the server
  const tamperedQuery = await student1.request('/api/student/overview?studentId=2');
  assert.equal(tamperedQuery.status, 403);

  const tamperedPath = await student1.request('/api/student/records/2');
  assert.equal(tamperedPath.status, 403);
});

test('5. Academic workflows: duplicate attendance prevention, draft publication control & mark corrections', async () => {
  const teacher = new SessionClient();
  const student = new SessionClient();
  const admin = new SessionClient();

  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  await admin.login('admin@school.edu.gh', 'Admin@2026!');

  const tOv = await teacher.request('/api/teacher/overview');
  const firstAsg = tOv.json.assignments[0];

  // Submit attendance twice for the exact same class/date/student -> no duplicate rows created
  const attPayload = {
    classId: firstAsg.class_id,
    subjectId: firstAsg.subject_id,
    sessionDate: '2026-10-28',
    notes: 'Integration test roll call',
    entries: [
      { studentId: 1, status: 'present', remarks: 'First pass' },
      { studentId: 2, status: 'absent', remarks: 'Sick leave' },
    ],
  };
  const att1 = await teacher.request('/api/teacher/attendance/session', { method: 'POST', body: attPayload });
  assert.equal(att1.status, 200);

  attPayload.entries[1].status = 'excused';
  const att2 = await teacher.request('/api/teacher/attendance/session', { method: 'POST', body: attPayload });
  assert.equal(att2.status, 200);
  assert.equal(att2.json.sessionId, att1.json.sessionId);

  const countRow = await db.get('SELECT COUNT(*) AS cnt FROM attendance_records WHERE session_id = ?', [
    att1.json.sessionId,
  ]);
  assert.equal(Number(countRow.cnt), 2);

  // Unpublished draft ICT assessment (#5) is NOT visible to student until Superadmin publishes it
  const stBefore = await student.request('/api/student/overview');
  const hasDraftBefore = stBefore.json.publishedResults.some((r) => r.subject_code === 'ICT103');
  assert.equal(hasDraftBefore, false);

  const draftAssess = tOv.json.assessments.find((a) => a.is_published === 0);
  assert.ok(draftAssess);

  const pubRes = await admin.request(`/api/superadmin/exams/assessments/${draftAssess.id}/publish`, {
    method: 'PATCH',
    body: { isPublished: true },
  });
  assert.equal(pubRes.status, 200);

  const stAfter = await student.request('/api/student/overview');
  const hasDraftAfter = stAfter.json.publishedResults.some((r) => r.subject_code === 'ICT103');
  assert.equal(hasDraftAfter, true);

  // Teacher cannot overwrite published marks directly; Superadmin approves pending Mark Correction Request
  const directEditAttempt = await teacher.request(`/api/teacher/assessments/${draftAssess.id}/marks`, {
    method: 'POST',
    body: { entries: [{ studentId: 1, score: 50 }] },
  });
  assert.equal(directEditAttempt.status, 403);

  const examsGov = await admin.request('/api/superadmin/exams');
  const pendingCorr = examsGov.json.correctionRequests.find((c) => c.status === 'pending');
  assert.ok(pendingCorr);

  const approveRes = await admin.request(`/api/superadmin/exams/corrections/${pendingCorr.id}/review`, {
    method: 'POST',
    body: { decision: 'approved', reviewNote: 'Verified lab sheet' },
  });
  assert.equal(approveRes.status, 200);
});

test('6. Financial workflows: currency switching, transactional payment, receipt reconciliation & idempotency', async () => {
  const finance = new SessionClient();
  await finance.login('finance@school.edu.gh', 'Finance@2026!');

  // Switch currency to USD ($) and verify
  const currUsd = await finance.request('/api/financial/currency', {
    method: 'PATCH',
    body: { currencyCode: 'USD' },
  });
  assert.equal(currUsd.status, 200);
  assert.equal(currUsd.json.currency.code, 'USD');
  assert.equal(currUsd.json.currency.symbol, '$');

  // Switch back to GHS (GH₵)
  const currGhs = await finance.request('/api/financial/currency', {
    method: 'PATCH',
    body: { currencyCode: 'GHS' },
  });
  assert.equal(currGhs.json.currency.symbol, 'GH₵');

  // Student #3 (Yaw Osei) owes 3,050.00 initially; pay 1,050.00 with idempotency key
  const beforeAcc = await finance.request('/api/financial/accounts/3');
  assert.equal(beforeAcc.json.summary.outstandingBalance, '3050.00');

  const idemKey = 'test-idempotent-pay-001';
  const pay1 = await finance.request('/api/financial/payments', {
    method: 'POST',
    body: {
      studentId: 3,
      amount: 1050.0,
      paymentMethod: 'cash',
      referenceNumber: 'CASH-TEST-01',
      idempotencyKey: idemKey,
      paymentDate: '2026-10-27',
    },
  });
  assert.equal(pay1.status, 201);
  assert.equal(pay1.json.balanceAfter, '2000.00');
  assert.match(pay1.json.receiptNumber, /^RCP-\d{4}-\d{5}$/);

  // Re-submitting the identical idempotency key does NOT double-charge or issue a second receipt!
  const payDuplicate = await finance.request('/api/financial/payments', {
    method: 'POST',
    body: {
      studentId: 3,
      amount: 1050.0,
      paymentMethod: 'cash',
      referenceNumber: 'CASH-TEST-01',
      idempotencyKey: idemKey,
      paymentDate: '2026-10-27',
    },
  });
  assert.equal(payDuplicate.status, 200);
  assert.equal(payDuplicate.json.duplicatePrevented, true);
  assert.equal(payDuplicate.json.receiptNumber, pay1.json.receiptNumber);

  const afterAcc = await finance.request('/api/financial/accounts/3');
  assert.equal(afterAcc.json.summary.outstandingBalance, '2000.00');
});

test('7. Real-Time Google OAuth 2.0 account-linking policy & all Revision 2.1 acceptance cases', async () => {
  // 7a. Approved Teacher Google sign-in
  const tOut = await accountLinkingService.resolveOrLinkGoogleAccount({
    googleSubjectId: 'google-sub-teacher-101',
    email: 'kofi.mensah@school.edu.gh',
    emailVerified: true,
    displayName: 'Kofi Mensah',
  });
  assert.equal(tOut.ok, true);
  assert.equal(tOut.user.role, 'teacher');
  assert.equal(userModel.dashboardPathForRole(tOut.user.role), '/dashboard/teacher');

  // 7b. Approved Student Google sign-in
  const sOut = await accountLinkingService.resolveOrLinkGoogleAccount({
    googleSubjectId: 'google-sub-student-202',
    email: 'kwame.asante@student.school.edu.gh',
    emailVerified: true,
    displayName: 'Kwame Asante',
  });
  assert.equal(sOut.ok, true);
  assert.equal(sOut.user.role, 'student');
  assert.equal(userModel.dashboardPathForRole(sOut.user.role), '/dashboard/student');

  // 7c. Approved Financial Google sign-in
  const fOut = await accountLinkingService.resolveOrLinkGoogleAccount({
    googleSubjectId: 'google-sub-fin-303',
    email: 'finance@school.edu.gh',
    emailVerified: true,
    displayName: 'Efua Nyarko',
  });
  assert.equal(fOut.ok, true);
  assert.equal(fOut.user.role, 'financial');
  assert.equal(userModel.dashboardPathForRole(fOut.user.role), '/dashboard/financial');

  // 7d. Approved Superadmin Google sign-in
  const aOut = await accountLinkingService.resolveOrLinkGoogleAccount({
    googleSubjectId: 'google-sub-admin-404',
    email: 'admin@school.edu.gh',
    emailVerified: true,
    displayName: 'Dr. Kwesi Mensah-Bonsu',
  });
  assert.equal(aOut.ok, true);
  assert.equal(aOut.user.role, 'superadmin');

  // 7e. Unknown Google email -> denied; NO account silently created
  const beforeCount = await db.get('SELECT COUNT(*) AS cnt FROM users');
  const unknownOut = await accountLinkingService.resolveOrLinkGoogleAccount({
    googleSubjectId: 'google-sub-stranger-999',
    email: 'random.stranger@gmail.com',
    emailVerified: true,
    displayName: 'Random Stranger',
  });
  assert.equal(unknownOut.ok, false);
  assert.equal(unknownOut.reason, 'unregistered_google');
  const afterCount = await db.get('SELECT COUNT(*) AS cnt FROM users');
  assert.equal(afterCount.cnt, beforeCount.cnt);

  // 7f. Disabled local account -> rejected even when Google authentication succeeds
  await db.run("UPDATE users SET status = 'suspended' WHERE email = 'ama.owusu@school.edu.gh'");
  const disabledOut = await accountLinkingService.resolveOrLinkGoogleAccount({
    googleSubjectId: 'google-sub-disabled-505',
    email: 'ama.owusu@school.edu.gh',
    emailVerified: true,
    displayName: 'Ama Owusu',
  });
  assert.equal(disabledOut.ok, false);
  assert.equal(disabledOut.reason, 'account_disabled');
  await db.run("UPDATE users SET status = 'active' WHERE email = 'ama.owusu@school.edu.gh'");

  // 7g. Cancelled OAuth callback redirects safely to /login?error=oauth_cancelled
  const cancelRes = await fetch(`${baseUrl}/auth/google/callback?error=access_denied`, { redirect: 'manual' });
  assert.equal(cancelRes.status, 302);
  assert.equal(cancelRes.headers.get('location'), '/login?error=oauth_cancelled');
});

test('8. Paystack gateway integration: initialize, verify, idempotency, HMAC webhook & student Paystack anti-IDOR', async () => {
  const finance = new SessionClient();
  await finance.login('finance@school.edu.gh', 'Finance@2026!');

  // Student #4 (Esi Darko) owes 3,050.00 -> Initialize 850.00 Paystack Mobile Money transaction
  const initRes = await finance.request('/api/financial/paystack/initialize', {
    method: 'POST',
    body: {
      studentId: 4,
      amount: 850.0,
      channel: 'mobile_money',
      payerEmail: 'k.darko@example.com',
    },
  });
  assert.equal(initRes.status, 201);
  assert.match(initRes.json.transaction.reference, /^PSK-\d{4}-/);
  assert.equal(initRes.json.transaction.amountSubunits, 85000);

  // Verify Paystack transaction -> issues official receipt & updates ledger
  const ref1 = initRes.json.transaction.reference;
  const verRes = await finance.request('/api/financial/paystack/verify', {
    method: 'POST',
    body: { reference: ref1, channel: 'mobile_money' },
  });
  assert.equal(verRes.status, 200);
  assert.equal(verRes.json.status, 'success');
  assert.equal(verRes.json.balanceAfter, '2200.00');
  assert.match(verRes.json.receiptNumber, /^RCP-\d{4}-\d{5}$/);

  // Re-verifying the same Paystack reference is idempotent
  const verDup = await finance.request('/api/financial/paystack/verify', {
    method: 'POST',
    body: { reference: ref1 },
  });
  assert.equal(verDup.status, 200);
  assert.equal(verDup.json.duplicatePrevented, true);
  assert.equal(verDup.json.receiptNumber, verRes.json.receiptNumber);

  // Initialize a second Paystack transaction (200.00) and settle via signed HMAC-SHA512 webhook
  const initWebhook = await finance.request('/api/financial/paystack/initialize', {
    method: 'POST',
    body: { studentId: 4, amount: 200.0, channel: 'card' },
  });
  const ref2 = initWebhook.json.transaction.reference;
  const webhookPayload = JSON.stringify({
    event: 'charge.success',
    data: { reference: ref2, status: 'success', channel: 'card', amount: 20000 },
  });

  // Invalid signature rejected with 401
  const badWh = await fetch(`${baseUrl}/api/paystack/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'invalid_sig' },
    body: webhookPayload,
  });
  assert.equal(badWh.status, 401);

  // Valid HMAC-SHA512 signature settles transaction
  const validSig = crypto
    .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET)
    .update(Buffer.from(webhookPayload, 'utf8'))
    .digest('hex');
  const goodWh = await fetch(`${baseUrl}/api/paystack/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': validSig },
    body: webhookPayload,
  });
  assert.equal(goodWh.status, 200);
  const whJson = await goodWh.json();
  assert.equal(whJson.handled, true);

  const accAfterWh = await finance.request('/api/financial/accounts/4');
  assert.equal(accAfterWh.json.summary.outstandingBalance, '2000.00');

  // Student self-service Paystack checkout + anti-IDOR receipt protection
  const kwame = new SessionClient();
  await kwame.login('kwame.asante@student.school.edu.gh', 'Student@2026!');

  // Kwame owes 450.00; pay 150.00 via Student Paystack endpoint
  const stInit = await kwame.request('/api/student/paystack/initialize', {
    method: 'POST',
    body: { amount: 150.0, channel: 'mobile_money' },
  });
  assert.equal(stInit.status, 201);
  const stVer = await kwame.request('/api/student/paystack/verify', {
    method: 'POST',
    body: { reference: stInit.json.transaction.reference },
  });
  assert.equal(stVer.status, 200);
  assert.equal(stVer.json.balanceAfter, '300.00');

  // Kwame can view his own receipt, but is blocked (403) from viewing Abena's receipt RCP-2026-00002
  const ownRcp = await kwame.request(`/api/student/receipts/${stVer.json.receiptNumber}`);
  assert.equal(ownRcp.status, 200);
  const otherRcp = await kwame.request('/api/student/receipts/RCP-2026-00002');
  assert.equal(otherRcp.status, 403);
});

test('9. Superadmin ("admin") manages financial stats, fee assignments & payment reversals', async () => {
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');

  const finance = new SessionClient();
  await finance.login('finance@school.edu.gh', 'Finance@2026!');

  // Non-superadmin cannot modify Superadmin financial stats config
  const forbiddenCfg = await finance.request('/api/superadmin/finance/stats-config', {
    method: 'PUT',
    body: {
      termRevenueTarget: 20000,
      openingBalanceAdjustment: 0,
      billedStatAdjustment: 0,
      collectedStatAdjustment: 0,
      paystackEnabled: true,
    },
  });
  assert.equal(forbiddenCfg.status, 403);

  const beforeStats = await admin.request('/api/superadmin/finance/stats');
  assert.equal(beforeStats.status, 200);
  const baseLedgerBilled = Number(beforeStats.json.metrics.ledgerNetBilled);
  const baseLedgerCollected = Number(beforeStats.json.metrics.ledgerCollected);

  // Superadmin updates revenue target, opening treasury balance, and stat adjustments
  const updCfg = await admin.request('/api/superadmin/finance/stats-config', {
    method: 'PUT',
    body: {
      termRevenueTarget: 25000.0,
      openingBalanceAdjustment: 5000.0,
      billedStatAdjustment: 500.0,
      collectedStatAdjustment: 250.0,
      paystackEnabled: true,
      paystackChannels: 'card,mobile_money,bank_transfer,ussd',
    },
  });
  assert.equal(updCfg.status, 200);
  assert.equal(Number(updCfg.json.metrics.netBilled), baseLedgerBilled + 500);
  assert.equal(Number(updCfg.json.metrics.totalCollected), baseLedgerCollected + 250);
  assert.equal(Number(updCfg.json.metrics.treasuryPosition), baseLedgerCollected + 250 + 5000);

  // Verify Financial Dashboard overview reflects Superadmin's managed financial stats
  const finOv = await finance.request('/api/financial/overview');
  assert.equal(Number(finOv.json.metrics.netBilled), baseLedgerBilled + 500);
  assert.equal(Number(finOv.json.metrics.termRevenueTarget), 25000);

  // Superadmin reverses a completed payment and verifies ledger rollback
  const targetPayment = beforeStats.json.recentPayments.find((p) => p.status === 'completed');
  assert.ok(targetPayment);
  const revRes = await admin.request(`/api/superadmin/finance/payments/${targetPayment.id}/reverse`, {
    method: 'POST',
    body: { reason: 'Admin audit test reversal of duplicate bank advice' },
  });
  assert.equal(revRes.status, 200);

  const afterRevStats = await admin.request('/api/superadmin/finance/stats');
  assert.equal(
    Number(afterRevStats.json.metrics.ledgerCollected).toFixed(2),
    (baseLedgerCollected - Number(targetPayment.amount)).toFixed(2)
  );
});

test('10. Zero-emoji policy verified across all HTML views, client JS, and documentation', async () => {
  const dirsToScan = [
    path.join(__dirname, '..', 'src', 'views'),
    path.join(__dirname, '..', 'src', 'public', 'js'),
  ];
  const emojiRegex = /\p{Extended_Pictographic}/u;
  for (const dir of dirsToScan) {
    for (const file of fs.readdirSync(dir)) {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      assert.equal(
        emojiRegex.test(content),
        false,
        `Unexpected emoji found in ${file}`
      );
    }
  }
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.equal(emojiRegex.test(readme), false, 'Unexpected emoji found in README.md');
});

test('11. Enterprise security hardening: CSP, no-store cache, cross-origin CSRF, session hijack block & brute-force lockout', async () => {
  // 11a. Security headers & Cache-Control: no-store
  const healthRes = await fetch(`${baseUrl}/api/health`);
  assert.equal(healthRes.headers.get('x-powered-by'), null);
  assert.match(healthRes.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.match(healthRes.headers.get('content-security-policy') || '', /script-src-attr 'none'/);
  assert.match(healthRes.headers.get('permissions-policy') || '', /camera=\(\)/);
  assert.match(healthRes.headers.get('cache-control') || '', /no-store/);
  assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');

  // 11b. Cross-Origin CSRF defence blocks evil Origin even when valid CSRF token is sent
  const victim = new SessionClient();
  await victim.login('finance@school.edu.gh', 'Finance@2026!');
  const evilOriginRes = await fetch(`${baseUrl}/api/financial/currency`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Cookie: victim.cookie,
      'X-CSRF-Token': victim.csrfToken,
      Origin: 'https://evil-attacker.example.com',
    },
    body: JSON.stringify({ currencyCode: 'USD' }),
  });
  assert.equal(evilOriginRes.status, 403);

  // 11c. User-Agent Session Fingerprint Binding blocks replayed session cookies from different UA
  const hijackAttempt = await fetch(`${baseUrl}/api/financial/overview`, {
    headers: {
      Accept: 'application/json',
      Cookie: victim.cookie,
      'User-Agent': 'StolenCookieReplayBot/9.9',
    },
  });
  assert.equal(hijackAttempt.status, 401);

  // 11d. Strong password enforcement + 5-attempt Brute-Force Lockout + Superadmin Unlock
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');

  const weakUserRes = await admin.request('/api/superadmin/users', {
    method: 'POST',
    body: {
      username: 'weak_pw_user',
      email: 'weak.user@school.edu.gh',
      fullName: 'Weak Password User',
      role: 'teacher',
      password: 'password123',
    },
  });
  assert.equal(weakUserRes.status, 400);

  const lockUserRes = await admin.request('/api/superadmin/users', {
    method: 'POST',
    body: {
      username: 'lockout_test',
      email: 'lockout.test@school.edu.gh',
      fullName: 'Lockout Test Staff',
      role: 'financial',
      password: 'Strong#Pass2026!',
    },
  });
  assert.equal(lockUserRes.status, 201);
  const createdUserId = lockUserRes.json.id;

  const attacker = new SessionClient();
  await attacker.request('/api/auth/session');

  for (let i = 1; i <= 4; i += 1) {
    const fail = await attacker.request('/api/auth/login', {
      method: 'POST',
      body: { identifier: 'lockout.test@school.edu.gh', password: `WrongPass#${i}!` },
    });
    assert.equal(fail.status, 401);
  }

  // 5th consecutive failure triggers 423 Account Lockout
  const fifthFail = await attacker.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'lockout.test@school.edu.gh', password: 'WrongPass#5!' },
  });
  assert.equal(fifthFail.status, 423);

  // Even the CORRECT password is rejected while locked
  const whileLocked = await attacker.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'lockout.test@school.edu.gh', password: 'Strong#Pass2026!' },
  });
  assert.equal(whileLocked.status, 423);

  // Superadmin unlocks the account -> valid login succeeds immediately
  const unlockRes = await admin.request(`/api/superadmin/users/${createdUserId}/unlock`, {
    method: 'POST',
  });
  assert.equal(unlockRes.status, 200);

  const afterUnlock = await attacker.login('lockout.test@school.edu.gh', 'Strong#Pass2026!');
  assert.equal(afterUnlock.status, 200);
});

test('12. Confidential data & credentials hiding verified across public routes, lower-privilege roles & HTML', async () => {
  // 12a. Public /login HTML exposes ONLY a clean split-curve login form (zero dashboard listings, demo credentials, or reset codes)
  const loginHtmlRes = await fetch(`${baseUrl}/login`);
  const loginHtml = await loginHtmlRes.text();
  assert.equal(/Admin@2026!|Teacher@2026!|Student@2026!|Finance@2026!|data-pass|demo-helper/.test(loginHtml), false);
  assert.equal(/Superadmin|Teachers|Students|Financial|Four-Dashboard|role-pills-grid|login-brand-panel/.test(loginHtml), false);
  assert.equal(loginHtml.includes('login-split-card') && loginHtml.includes('login-hero-side') && loginHtml.includes('login-pill-field'), true);

  const anon = new SessionClient();
  const sessRes = await anon.request('/api/auth/session');
  assert.equal(sessRes.json.demoHelperEnabled, undefined);

  const resetReq = await anon.request('/api/auth/password-reset/request', {
    method: 'POST',
    body: { email: 'admin@school.edu.gh' },
  });
  assert.equal(resetReq.status, 200);
  assert.equal(resetReq.json.devResetCode, undefined);

  // 12b. Public /api/health hides DB driver, database filename, and gateway secrets
  const healthRes = await anon.request('/api/health');
  assert.equal(healthRes.json.db.driver, undefined);
  assert.equal(healthRes.json.db.database, undefined);
  assert.equal(healthRes.json.paystackMode, undefined);

  // 12c. Student & Teacher portals never receive internal treasury targets or financial adjustments
  const student = new SessionClient();
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  const stOv = await student.request('/api/student/overview');
  assert.equal(stOv.status, 200);
  assert.equal(stOv.json.settings.term_revenue_target, undefined);
  assert.equal(stOv.json.settings.opening_balance_adjustment, undefined);
  assert.equal(stOv.json.settings.billed_stat_adjustment, undefined);
  assert.equal(stOv.json.settings.collected_stat_adjustment, undefined);

  const teacher = new SessionClient();
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  const tcOv = await teacher.request('/api/teacher/overview');
  assert.equal(tcOv.status, 200);
  assert.equal(tcOv.json.settings.term_revenue_target, undefined);
  assert.equal(tcOv.json.settings.opening_balance_adjustment, undefined);

  // 12d. Zero inline JS handlers across all HTML views (strict CSP compliance)
  const viewsDir = path.join(__dirname, '..', 'src', 'views');
  for (const file of fs.readdirSync(viewsDir)) {
    const html = fs.readFileSync(path.join(viewsDir, file), 'utf8');
    assert.equal(/\bon(click|change|submit|load|error)=/i.test(html), false, `Inline handler in ${file}`);
  }
});

test('13. School Management System branding, student-only join proposals (Superadmin accept/reject), and admin-only staff creation', async () => {
  // 13a. Branding is "School Management System" and /login shows "create one"
  const loginHtmlRes = await fetch(`${baseUrl}/login`);
  const loginHtml = await loginHtmlRes.text();
  assert.equal(loginHtml.includes('Accra Crest'), false);
  assert.equal(loginHtml.includes('School Management System'), true);
  assert.equal(loginHtml.includes('create one'), true);

  const publicClient = new SessionClient();
  const sessRes = await publicClient.request('/api/auth/session');
  assert.equal(sessRes.json.school.school_name, 'School Management System');
  assert.ok(Array.isArray(sessRes.json.registrationClasses) && sessRes.json.registrationClasses.length >= 1);
  const firstClassId = sessRes.json.registrationClasses[0].id;

  // 13b. Public registration strictly blocks teacher or financial account creation
  const tryTeacherReg = await publicClient.request('/api/auth/register-student', {
    method: 'POST',
    body: {
      role: 'teacher',
      firstName: 'Unauth',
      lastName: 'Teacher',
      email: 'unauth.teacher@school.edu.gh',
      password: 'Valid#Pass2026!',
    },
  });
  assert.equal(tryTeacherReg.status, 403);

  const tryFinanceReg = await publicClient.request('/api/auth/register-student', {
    method: 'POST',
    body: {
      role: 'financial',
      firstName: 'Unauth',
      lastName: 'Finance',
      email: 'unauth.finance@school.edu.gh',
      password: 'Valid#Pass2026!',
    },
  });
  assert.equal(tryFinanceReg.status, 403);

  // 13c. Student submits join proposal -> blocked before approval -> Superadmin accepts -> student signs in
  const studentProposalRes = await publicClient.request('/api/auth/register-student', {
    method: 'POST',
    body: {
      firstName: 'Nana',
      lastName: 'Adjei',
      email: 'nana.adjei@student.school.edu.gh',
      requestedClassId: firstClassId,
      gender: 'Female',
      guardianPhone: '+233 24 900 1122',
      password: 'Nana#Student2026!',
    },
  });
  assert.equal(studentProposalRes.status, 201);
  const proposalId = studentProposalRes.json.id;

  // Before Superadmin accepts, student cannot log in
  const preApproveLogin = await publicClient.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'nana.adjei@student.school.edu.gh', password: 'Nana#Student2026!' },
  });
  assert.equal(preApproveLogin.status, 403);

  // Superadmin reviews & accepts the proposal
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');

  const pendingList = await admin.request('/api/superadmin/student-requests?status=pending');
  assert.equal(pendingList.status, 200);
  const foundPending = pendingList.json.items.find((r) => r.id === proposalId);
  assert.ok(foundPending);
  assert.equal(foundPending.password_hash, undefined);

  const approveRes = await admin.request(`/api/superadmin/student-requests/${proposalId}/review`, {
    method: 'POST',
    body: { decision: 'approved', classId: firstClassId },
  });
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.json.status, 'approved');
  assert.match(approveRes.json.admissionNumber, /^ADM-/);

  // Student can now sign in and access their personal Student Dashboard
  const approvedStudent = new SessionClient();
  const stuLogin = await approvedStudent.login('nana.adjei@student.school.edu.gh', 'Nana#Student2026!');
  assert.equal(stuLogin.status, 200);
  assert.equal(stuLogin.json.redirectTo, '/dashboard/student');
  const stuOv = await approvedStudent.request('/api/student/overview');
  assert.equal(stuOv.status, 200);
  assert.equal(stuOv.json.student.first_name, 'Nana');

  // 13d. Rejected student proposal cannot sign in
  const rejectedProposal = await publicClient.request('/api/auth/register-student', {
    method: 'POST',
    body: {
      firstName: 'Kojo',
      lastName: 'Declined',
      email: 'kojo.declined@student.school.edu.gh',
      requestedClassId: firstClassId,
      password: 'Kojo#Student2026!',
    },
  });
  assert.equal(rejectedProposal.status, 201);

  const rejectRes = await admin.request(`/api/superadmin/student-requests/${rejectedProposal.json.id}/review`, {
    method: 'POST',
    body: { decision: 'rejected', reviewNote: 'Incomplete admission records' },
  });
  assert.equal(rejectRes.status, 200);

  const afterRejectLogin = await publicClient.request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'kojo.declined@student.school.edu.gh', password: 'Kojo#Student2026!' },
  });
  assert.equal(afterRejectLogin.status, 403);

  // 13e. Superadmin solely provisions Teacher and Financial accounts and receives issued logins
  const newTeacherRes = await admin.request('/api/superadmin/teachers', {
    method: 'POST',
    body: {
      staffNumber: 'STF-2026-099',
      firstName: 'Efua',
      lastName: 'Sarpong',
      email: 'efua.sarpong@school.edu.gh',
      department: 'Mathematics',
    },
  });
  assert.equal(newTeacherRes.status, 201);
  assert.ok(newTeacherRes.json.issuedCredentials?.initialPassword);

  const issuedTeacherClient = new SessionClient();
  const tcLogin = await issuedTeacherClient.login(
    newTeacherRes.json.issuedCredentials.email,
    newTeacherRes.json.issuedCredentials.initialPassword
  );
  assert.equal(tcLogin.status, 200);
  assert.equal(tcLogin.json.redirectTo, '/dashboard/teacher');

  const newFinRes = await admin.request('/api/superadmin/users', {
    method: 'POST',
    body: {
      fullName: 'Bursar Mensah',
      username: 'bursar.mensah',
      email: 'bursar.mensah@school.edu.gh',
      role: 'financial',
    },
  });
  assert.equal(newFinRes.status, 201);
  assert.ok(newFinRes.json.issuedCredentials?.initialPassword);

  const issuedFinClient = new SessionClient();
  const finLogin = await issuedFinClient.login(
    newFinRes.json.issuedCredentials.email,
    newFinRes.json.issuedCredentials.initialPassword
  );
  assert.equal(finLogin.status, 200);
  assert.equal(finLogin.json.redirectTo, '/dashboard/financial');
});

test('14. End-to-end Google Authentication: Login button, OAuth flow, Google Student Join Proposal -> Admin Approval -> Google Login & Secret Redaction', async () => {
  // 14a. Google Sign-In & Sign-Up buttons rendered on /login and enabled in /api/auth/session
  const loginRes = await fetch(`${baseUrl}/login`);
  const loginHtml = await loginRes.text();
  assert.equal(loginHtml.includes('id="google-login-btn"'), true);
  assert.equal(loginHtml.includes('id="google-register-btn"'), true);

  const gClient = new SessionClient();
  const sess = await gClient.request('/api/auth/session');
  assert.equal(sess.json.googleAuthEnabled, true);
  const classId = sess.json.registrationClasses[0].id;

  // 14b. Approved Teacher completes Google OAuth sign-in -> lands on /dashboard/teacher
  const startTeacherOAuth = await gClient.request('/auth/google');
  assert.equal(startTeacherOAuth.status, 302);
  const consentLoc = startTeacherOAuth.headers.get('location');
  assert.match(consentLoc, /^\/auth\/google\/dev-consent\?state=/);
  const stateParam = new URL(`http://localhost${consentLoc}`).searchParams.get('state');

  const consentPage = await gClient.request(consentLoc);
  assert.equal(consentPage.status, 200);
  await gClient.request('/api/auth/session');

  const authTeacher = await gClient.request('/auth/google/dev-authorize', {
    method: 'POST',
    body: {
      state: stateParam,
      email: 'ama.owusu@school.edu.gh',
      displayName: 'Ama Owusu',
    },
  });
  assert.equal(authTeacher.status, 302);
  assert.equal(authTeacher.headers.get('location'), '/dashboard/teacher');

  const teacherSessAfter = await gClient.request('/api/auth/session');
  assert.equal(teacherSessAfter.json.authenticated, true);
  assert.equal(teacherSessAfter.json.user.role, 'teacher');
  assert.equal(teacherSessAfter.json.user.googleLinked, true);

  // 14c. Student signs up with Google -> pending proposal -> Superadmin approves -> Student signs in with Google
  const stuGoogleClient = new SessionClient();
  await stuGoogleClient.request('/api/auth/session');
  const startReg = await stuGoogleClient.request(`/auth/google?mode=register&classId=${classId}&gender=Female`);
  assert.equal(startReg.status, 302);
  const regState = new URL(`http://localhost${startReg.headers.get('location')}`).searchParams.get('state');
  await stuGoogleClient.request('/api/auth/session');

  const submitGoogleProposal = await stuGoogleClient.request('/auth/google/dev-authorize', {
    method: 'POST',
    body: {
      state: regState,
      email: 'akosua.google@student.school.edu.gh',
      displayName: 'Akosua Mensima',
    },
  });
  assert.equal(submitGoogleProposal.status, 302);
  assert.equal(submitGoogleProposal.headers.get('location'), '/login?info=google_proposal_submitted');

  // Attempting Google Sign-In BEFORE Superadmin approval redirects with google_proposal_pending
  const preApproveStart = await stuGoogleClient.request('/auth/google');
  const preApproveState = new URL(`http://localhost${preApproveStart.headers.get('location')}`).searchParams.get('state');
  await stuGoogleClient.request('/api/auth/session');
  const preApproveAuth = await stuGoogleClient.request('/auth/google/dev-authorize', {
    method: 'POST',
    body: {
      state: preApproveState,
      email: 'akosua.google@student.school.edu.gh',
      displayName: 'Akosua Mensima',
    },
  });
  assert.equal(preApproveAuth.status, 302);
  assert.equal(preApproveAuth.headers.get('location'), '/login?error=google_proposal_pending');

  // Superadmin accepts the Google Student Proposal
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  const reqList = await admin.request('/api/superadmin/student-requests?status=pending');
  const googleReq = reqList.json.items.find((r) => r.email === 'akosua.google@student.school.edu.gh');
  assert.ok(googleReq);
  assert.equal(googleReq.auth_provider, 'google');
  assert.equal(googleReq.google_subject_id, undefined);

  const acceptGoogleStu = await admin.request(`/api/superadmin/student-requests/${googleReq.id}/review`, {
    method: 'POST',
    body: { decision: 'approved', classId },
  });
  assert.equal(acceptGoogleStu.status, 200);

  // Student now signs in with Google in one step -> redirected to /dashboard/student
  const postApproveStart = await stuGoogleClient.request('/auth/google');
  const postApproveState = new URL(`http://localhost${postApproveStart.headers.get('location')}`).searchParams.get('state');
  await stuGoogleClient.request('/api/auth/session');
  const postApproveAuth = await stuGoogleClient.request('/auth/google/dev-authorize', {
    method: 'POST',
    body: {
      state: postApproveState,
      email: 'akosua.google@student.school.edu.gh',
      displayName: 'Akosua Mensima',
    },
  });
  assert.equal(postApproveAuth.status, 302);
  assert.equal(postApproveAuth.headers.get('location'), '/dashboard/student');

  const stuSessAfter = await stuGoogleClient.request('/api/auth/session');
  assert.equal(stuSessAfter.json.authenticated, true);
  assert.equal(stuSessAfter.json.user.role, 'student');
  assert.equal(stuSessAfter.json.user.googleLinked, true);

  // 14d. Cookie-less iframe navigation + CHIPS Partitioned cookie + Popup Handoff exchange (prevents oauth_state_invalid)
  const rawStart = await fetch(`${baseUrl}/auth/google?popup=1`, { redirect: 'manual' });
  assert.equal(rawStart.status, 302);
  const rawConsentPath = rawStart.headers.get('location');
  const rawState = new URL(`http://localhost${rawConsentPath}`).searchParams.get('state');

  // Even with ZERO cookies sent, consent page & consent-context succeed without oauth_state_invalid
  const rawConsentRes = await fetch(`${baseUrl}${rawConsentPath}`, { redirect: 'manual' });
  assert.equal(rawConsentRes.status, 200);
  const rawCtxRes = await fetch(
    `${baseUrl}/api/auth/google/consent-context?state=${encodeURIComponent(rawState)}`
  );
  assert.equal(rawCtxRes.status, 200);

  // Authorize inside simulated HTTPS preview proxy -> emits Secure; Partitioned; SameSite=None cookie + single-use handoff token
  const rawAuthRes = await fetch(`${baseUrl}/auth/google/dev-authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-Proto': 'https',
    },
    body: JSON.stringify({
      state: rawState,
      email: 'akosua.google@student.school.edu.gh',
      displayName: 'Akosua Mensima',
    }),
  });
  assert.equal(rawAuthRes.status, 302);
  const popupCookie = (rawAuthRes.headers.getSetCookie?.() || []).join('; ');
  assert.match(popupCookie, /Partitioned/i);
  assert.match(popupCookie, /SameSite=None/i);

  const popupCompleteLoc = rawAuthRes.headers.get('location');
  assert.match(popupCompleteLoc, /^\/auth\/google\/popup-complete\?/);
  const handoffToken = new URL(`http://localhost${popupCompleteLoc}`).searchParams.get('handoff');
  assert.ok(handoffToken);

  // Separate iframe client (with zero prior cookies) exchanges single-use handoffToken for its own authenticated session
  const iframeClient = new SessionClient();
  const handoffRes = await iframeClient.request('/api/auth/google/handoff', {
    method: 'POST',
    body: { handoffToken },
    sendCsrf: false,
  });
  assert.equal(handoffRes.status, 200);
  assert.equal(handoffRes.json.redirectTo, '/dashboard/student');
  const iframeSess = await iframeClient.request('/api/auth/session');
  assert.equal(iframeSess.json.authenticated, true);

  // Replaying the same handoffToken a second time is rejected (401)
  const replayHandoff = await iframeClient.request('/api/auth/google/handoff', {
    method: 'POST',
    body: { handoffToken },
    sendCsrf: false,
  });
  assert.equal(replayHandoff.status, 401);

  // 14e. Superadmin Google OAuth settings save & client secret redaction
  const saveSet = await admin.request('/api/superadmin/settings', {
    method: 'PUT',
    body: {
      schoolName: 'School Management System',
      schoolCode: 'SMS-PORTAL',
      currencyCode: 'GHS',
      studentFeePortalEnabled: true,
      googleOauthEnabled: true,
      googleClientId: '1234567890-live.apps.googleusercontent.com',
      googleClientSecret: 'GOCSPX-TopSecretKeyValue999',
    },
  });
  assert.equal(saveSet.status, 200);
  assert.equal(saveSet.json.googleOAuth.mode, 'live');
  assert.equal(saveSet.json.settings.google_secret_configured, true);
  assert.equal(saveSet.json.settings.google_client_secret, undefined);

  // Restore sandbox mode for subsequent tests
  await admin.request('/api/superadmin/settings', {
    method: 'PUT',
    body: {
      schoolName: 'School Management System',
      schoolCode: 'SMS-PORTAL',
      currencyCode: 'GHS',
      studentFeePortalEnabled: true,
      googleOauthEnabled: true,
      googleClientId: '',
      googleClientSecret: '',
    },
  });
});

test('15. Zero-Cookie Cross-Origin Preview Iframe Sign-In (All 4 Roles + CSRF + Google OAuth)', async () => {
  class ZeroCookieIframeClient {
    constructor() {
      this.csrfToken = '';
      this.sessionToken = '';
    }

    async request(urlPath, { method = 'GET', body, redirect = 'manual' } = {}) {
      const headers = {
        Accept: 'application/json',
        Origin: 'https://3000-sandbox-preview.e2b.app',
        'User-Agent': 'Safari/18.0 CookieBlockedIframeTest',
      };
      if (this.sessionToken) {
        headers['X-SMS-Session'] = this.sessionToken;
      }
      if (this.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
        headers['X-CSRF-Token'] = this.csrfToken;
      }
      let payload = body;
      if (body && typeof body === 'object') {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const res = await fetch(`${baseUrl}${urlPath}`, {
        method,
        headers,
        body: payload,
        redirect,
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (_) {
        // HTML response
      }
      if (json && json.sessionToken) this.sessionToken = json.sessionToken;
      if (json && json.csrfToken) this.csrfToken = json.csrfToken;
      return { status: res.status, headers: res.headers, json, text };
    }
  }

  const demoAccounts = [
    ['admin@school.edu.gh', 'Admin@2026!', '/dashboard/superadmin', '/api/superadmin/overview'],
    ['kofi.mensah@school.edu.gh', 'Teacher@2026!', '/dashboard/teacher', '/api/teacher/overview'],
    [
      'kwame.asante@student.school.edu.gh',
      'Student@2026!',
      '/dashboard/student',
      '/api/student/overview',
    ],
    ['finance@school.edu.gh', 'Finance@2026!', '/dashboard/financial', '/api/financial/overview'],
  ];

  for (const [email, password, expectedDashboard, overviewEndpoint] of demoAccounts) {
    const client = new ZeroCookieIframeClient();

    // 1. Load initial session without cookies
    const initRes = await client.request('/api/auth/session');
    assert.equal(initRes.status, 200);
    assert.ok(client.sessionToken);
    assert.ok(client.csrfToken);

    // 2. Password login without cookies (and with .e2b.app Origin against 127.0.0.1 Host)
    const loginRes = await client.request('/api/auth/login', {
      method: 'POST',
      body: { identifier: email, password },
    });
    assert.equal(loginRes.status, 200, `Login failed for ${email}`);
    assert.equal(loginRes.json.redirectTo, expectedDashboard);

    // 3. Navigate to protected HTML dashboard using one-time _st query carrier (zero cookies)
    const dashRes = await client.request(
      `${expectedDashboard}?_st=${encodeURIComponent(client.sessionToken)}`
    );
    assert.equal(dashRes.status, 200);
    assert.match(dashRes.text, /<!DOCTYPE html>/i);

    // 4. Fetch protected dashboard JSON data via X-SMS-Session header (zero cookies)
    const ovRes = await client.request(overviewEndpoint);
    assert.equal(ovRes.status, 200);
    assert.equal(ovRes.json.ok, true);

    // 5. Logout destroys the SQL session so token cannot be reused
    const logoutRes = await client.request('/api/auth/logout', { method: 'POST' });
    assert.equal(logoutRes.status, 200);
    const afterLogout = await client.request(overviewEndpoint);
    assert.equal(afterLogout.status, 401);
  }

  // Forged session token signature is rejected
  const forged = new ZeroCookieIframeClient();
  forged.sessionToken = 'forged_session_id_12345.InvalidSignatureValue999';
  const forgedRes = await forged.request('/api/superadmin/overview');
  assert.equal(forgedRes.status, 401);

  // Zero-cookie in-frame Google Sign-In auto-bridges via handoff token
  const gZero = new ZeroCookieIframeClient();
  const gStart = await gZero.request('/auth/google');
  assert.equal(gStart.status, 302);
  const gState = new URL(`http://localhost${gStart.headers.get('location')}`).searchParams.get(
    'state'
  );
  const gAuth = await fetch(`${baseUrl}/auth/google/dev-authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      state: gState,
      email: 'ama.owusu@school.edu.gh',
      displayName: 'Ama Owusu',
      googleSub: 'google-sub-ama-owusu-zero-cookie',
      emailVerified: '1',
    }).toString(),
    redirect: 'manual',
  });
  assert.equal(gAuth.status, 302);
  const bridgeUrl = gAuth.headers.get('location');
  assert.match(bridgeUrl, /^\/auth\/google\/popup-complete\?/);
  const gHandoff = new URL(`http://localhost${bridgeUrl}`).searchParams.get('handoff');
  assert.ok(gHandoff);

  const exchange = await gZero.request('/api/auth/google/handoff', {
    method: 'POST',
    body: { handoffToken: gHandoff },
  });
  assert.equal(exchange.status, 200);
  assert.equal(exchange.json.redirectTo, '/dashboard/teacher');
  assert.ok(gZero.sessionToken);

  const teacherDash = await gZero.request(
    `/dashboard/teacher?_st=${encodeURIComponent(gZero.sessionToken)}`
  );
  assert.equal(teacherDash.status, 200);
});

test('16. Superadmin Custom Grading Scale Management & Clean Sub-Tabbed Workspace UI', async () => {
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');

  // Verify clean sub-tabbed Superadmin HTML loads with structured sub-navigation
  const htmlRes = await admin.request('/dashboard/superadmin');
  assert.equal(htmlRes.status, 200);
  assert.match(htmlRes.text, /data-tab-group="academic"/);
  assert.match(htmlRes.text, /data-tab-group="students"/);
  assert.match(htmlRes.text, /data-tab-group="teachers"/);
  assert.match(htmlRes.text, /data-tab-group="finance"/);
  assert.match(htmlRes.text, /data-tab-group="exams"/);

  // Create and remove a custom grading band
  const createBand = await admin.request('/api/superadmin/exams/grading-scales', {
    method: 'POST',
    body: {
      grade: 'A+',
      minScore: 95,
      maxScore: 100,
      gradePoint: 4.5,
      remark: 'Distinction',
    },
  });
  assert.equal(createBand.status, 201);
  assert.ok(createBand.json.id);

  const delBand = await admin.request(
    `/api/superadmin/exams/grading-scales/${createBand.json.id}`,
    { method: 'DELETE' }
  );
  assert.equal(delBand.status, 200);
});

test('17. Show/Hide Menu, Settings Paystack Keys (Receive, Send, Reverse), and Tabular Timetables across all 4 Dashboards', async () => {
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');

  // 17a. Save Paystack keys in Settings & verify secret redaction
  const curRes = await admin.request('/api/superadmin/settings');
  assert.equal(curRes.status, 200);
  const s = curRes.json.settings;

  const savePsk = await admin.request('/api/superadmin/settings', {
    method: 'PUT',
    body: {
      schoolName: s.school_name,
      schoolCode: s.school_code,
      currencyCode: s.currency_code || 'GHS',
      currencySymbol: s.currency_symbol || 'GH₵',
      studentFeePortalEnabled: true,
      paystackEnabled: true,
      paystackTransfersEnabled: true,
      paystackRefundsEnabled: true,
      paystackPublicKey: 'pk_test_demo_public_1234567890',
      paystackSecretKey: 'sk_test_demo_secret_9876543210',
      paystackWebhookSecret: 'whsec_demo_secret_1122334455',
    },
  });
  assert.equal(savePsk.status, 200);
  assert.equal(savePsk.json.settings.paystack_public_key, 'pk_test_demo_public_1234567890');
  assert.equal(savePsk.json.settings.paystack_secret_configured, true);
  assert.equal(savePsk.json.settings.paystack_webhook_secret_configured, true);
  // Secrets must NEVER leak in API responses
  assert.equal(savePsk.json.settings.paystack_secret_key, undefined);
  assert.equal(savePsk.json.settings.paystack_webhook_secret, undefined);
  assert.equal(savePsk.json.paystack.mode, 'test');
  assert.equal(savePsk.json.paystack.transfersEnabled, true);
  assert.equal(savePsk.json.paystack.refundsEnabled, true);

  // Revert secret back to sandbox so sandbox transfers & refunds work offline
  const clearPsk = await admin.request('/api/superadmin/settings', {
    method: 'PUT',
    body: {
      schoolName: s.school_name,
      schoolCode: s.school_code,
      currencyCode: s.currency_code || 'GHS',
      currencySymbol: s.currency_symbol || 'GH₵',
      studentFeePortalEnabled: true,
      paystackEnabled: true,
      paystackTransfersEnabled: true,
      paystackRefundsEnabled: true,
      paystackPublicKey: '',
      clearPaystackSecret: true,
    },
  });
  assert.equal(clearPsk.status, 200);
  assert.equal(clearPsk.json.settings.paystack_secret_configured, false);
  assert.equal(clearPsk.json.paystack.mode, 'sandbox');

  // 17b. Send an outbound Paystack Transfer & list transfers
  const sendTrf = await admin.request('/api/financial/paystack/transfers', {
    method: 'POST',
    body: {
      recipientName: 'Kwame Boateng Supplies',
      recipientAccount: '0241234567',
      bankOrNetwork: 'MTN',
      channel: 'mobile_money',
      amount: 150.0,
      reason: 'Laboratory Equipment Payout',
    },
  });
  assert.equal(sendTrf.status, 201);
  assert.match(sendTrf.json.transfer.reference, /^TRF-/);
  assert.equal(sendTrf.json.transfer.status, 'success');

  const listTrf = await admin.request('/api/financial/paystack/transfers');
  assert.equal(listTrf.status, 200);
  assert.ok(listTrf.json.items.some((t) => t.reference === sendTrf.json.transfer.reference));

  // 17c. Receive & Reverse a Paystack Payment via /api/financial/payments/:id/reverse
  const stuAccRes = await admin.request('/api/financial/accounts?onlyArrears=true');
  const targetStu = stuAccRes.json.items[0];
  assert.ok(targetStu, 'Expected at least one student account with arrears');

  const initPay = await admin.request('/api/financial/paystack/initialize', {
    method: 'POST',
    body: {
      studentId: targetStu.student_id,
      amount: Math.min(25, Number(targetStu.balance)),
      channel: 'mobile_money',
      payerEmail: 'reversal.test@school.edu.gh',
    },
  });
  assert.equal(initPay.status, 201);

  const verPay = await admin.request('/api/financial/paystack/verify', {
    method: 'POST',
    body: { reference: initPay.json.transaction.reference },
  });
  assert.equal(verPay.status, 200);
  assert.ok(verPay.json.paymentId);

  const revPay = await admin.request(`/api/financial/payments/${verPay.json.paymentId}/reverse`, {
    method: 'POST',
    body: { reason: 'Duplicate guardian mobile money payment' },
  });
  assert.equal(revPay.status, 200);

  // 17d. Verify Financial Timetable endpoint + all 4 dashboard views have Show/Hide Menu & Tabular Timetable Matrix
  const finTt = await admin.request('/api/financial/timetable');
  assert.equal(finTt.status, 200);
  assert.ok(Array.isArray(finTt.json.items));

  const commonJsRes = await fetch(`${baseUrl}/js/common.js`);
  const commonJsText = await commonJsRes.text();
  assert.match(commonJsText, /Hide Menu/);
  assert.match(commonJsText, /Show Menu/);
  assert.match(commonJsText, /renderTimetableMatrix/);
  assert.match(commonJsText, /timetable-matrix/);

  const saHtml = await (await admin.request('/dashboard/superadmin')).text;
  assert.match(saHtml, /id="mobile-menu-btn"/);
  assert.match(saHtml, /id="tt-matrix-container"/);
  assert.match(saHtml, /id="set-paystack-secret-key"/);
  assert.match(saHtml, /id="tch-reg-subject-checkboxes"/);
  assert.match(saHtml, /id="tch-custom-subject-input"/);
  assert.match(saHtml, /id="asg-subjects-checkboxes"/);
});

test('18. Multi-Subject Teacher Registration, Subject Updates, Bulk Class Assignment & Teachers Dashboard Sync', async () => {
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');

  const acadRes = await admin.request('/api/superadmin/academic');
  assert.equal(acadRes.status, 200);
  const existingSubjectId = acadRes.json.subjects[0].id;
  const targetClassId = acadRes.json.classes[0].id;

  // 18a. Register a teacher teaching 3 subjects (1 existing catalogue subject + 2 new inline subjects)
  const regRes = await admin.request('/api/superadmin/teachers', {
    method: 'POST',
    body: {
      staffNumber: 'STF-MULTI-2026',
      firstName: 'Kwabena',
      lastName: 'Ofori',
      email: 'kwabena.ofori@school.edu.gh',
      department: 'Sciences & Mathematics',
      qualification: 'M.Sc, B.Ed',
      subjectIds: [existingSubjectId],
      customSubjects: ['Further Mathematics', 'Applied Physics'],
    },
  });
  assert.equal(regRes.status, 201);
  assert.equal(regRes.json.subjects.length, 3);
  assert.ok(regRes.json.issuedCredentials?.initialPassword);

  const teacherId = regRes.json.teacherId;

  // 18b. Verify Superadmin Teachers Directory returns all 3 subjects on the teacher record
  const listRes = await admin.request('/api/superadmin/teachers');
  assert.equal(listRes.status, 200);
  const createdTeacher = listRes.json.teachers.find((t) => Number(t.id) === Number(teacherId));
  assert.ok(createdTeacher);
  assert.equal(createdTeacher.subjects.length, 3);
  assert.match(createdTeacher.specialization, /Further Mathematics/);
  assert.match(createdTeacher.specialization, /Applied Physics/);

  // 18c. Teacher signs into Teachers Dashboard immediately (even before class assignments) and sees all 3 subjects
  const multiTeacherClient = new SessionClient();
  const loginRes = await multiTeacherClient.login(
    regRes.json.issuedCredentials.email,
    regRes.json.issuedCredentials.initialPassword
  );
  assert.equal(loginRes.status, 200);

  const ovBeforeAssign = await multiTeacherClient.request('/api/teacher/overview');
  assert.equal(ovBeforeAssign.status, 200);
  assert.equal(ovBeforeAssign.json.metrics.assignedSubjects, 3);
  assert.equal(ovBeforeAssign.json.registeredSubjects.length, 3);

  // 18d. Update teacher subjects via PUT /api/superadmin/teachers/:id/subjects to add a 4th subject
  const updRes = await admin.request(`/api/superadmin/teachers/${teacherId}/subjects`, {
    method: 'PUT',
    body: {
      subjectIds: createdTeacher.subjectIds,
      customSubjects: ['Organic Chemistry'],
    },
  });
  assert.equal(updRes.status, 200);
  assert.equal(updRes.json.subjects.length, 4);

  // 18e. Bulk-assign multiple subjects to a class in a single request
  const bulkAssignRes = await admin.request('/api/superadmin/teachers/assign', {
    method: 'POST',
    body: {
      teacherId,
      classId: targetClassId,
      subjectIds: updRes.json.subjects.map((s) => s.id),
    },
  });
  assert.equal(bulkAssignRes.status, 201);
  assert.equal(bulkAssignRes.json.assignedCount, 4);

  // 18f. Verify Teachers Dashboard now reflects 1 assigned class and 4 taught subjects
  const ovAfterAssign = await multiTeacherClient.request('/api/teacher/overview');
  assert.equal(ovAfterAssign.status, 200);
  assert.equal(ovAfterAssign.json.metrics.assignedClasses, 1);
  assert.equal(ovAfterAssign.json.metrics.assignedSubjects, 4);
  assert.equal(ovAfterAssign.json.assignments.length, 4);

  // 18g. Provisioning a Teacher via Users & Roles (/api/superadmin/users) also links multiple subjects & creates teacher staff profile
  const usrTeacherRes = await admin.request('/api/superadmin/users', {
    method: 'POST',
    body: {
      fullName: 'Esi Mensah',
      username: 'esi.mensah.multi',
      email: 'esi.mensah.multi@school.edu.gh',
      role: 'teacher',
      department: 'Languages & Humanities',
      customSubjects: ['English Language', 'Literature in English', 'French'],
    },
  });
  assert.equal(usrTeacherRes.status, 201);
  assert.ok(usrTeacherRes.json.teacherId);
  assert.equal(usrTeacherRes.json.subjects.length, 3);

  const usrTeacherClient = new SessionClient();
  const usrTcLogin = await usrTeacherClient.login(
    usrTeacherRes.json.issuedCredentials.email,
    usrTeacherRes.json.issuedCredentials.initialPassword
  );
  assert.equal(usrTcLogin.status, 200);

  const usrTcOv = await usrTeacherClient.request('/api/teacher/overview');
  assert.equal(usrTcOv.status, 200);
  assert.equal(usrTcOv.json.metrics.assignedSubjects, 3);
  assert.equal(usrTcOv.json.registeredSubjects.length, 3);

  const saHtmlAfter = await (await admin.request('/dashboard/superadmin')).text;
  assert.match(saHtmlAfter, /id="tch-subject-rows-list"/);
  assert.match(saHtmlAfter, /id="btn-add-tch-subject-row"/);
  assert.match(saHtmlAfter, /id="usr-teacher-extra-fields"/);
});

test('19. Class stream removal, teacher coursework/exams with PDF/image/video uploads, student answer & media workspace, grading & class announcements', async () => {
  const admin = new SessionClient();
  const teacher = new SessionClient();
  const studentG10A = new SessionClient();
  const studentG10B = new SessionClient();
  const studentG11 = new SessionClient();

  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  await studentG10A.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  await studentG10B.login('abena.boateng@student.school.edu.gh', 'Student@2026!');
  await studentG11.login('esi.darko@student.school.edu.gh', 'Student@2026!');

  // 19a. Verify Class Stream endpoints & UI elements are completely removed
  const removedStreamEndpoint = await admin.request('/api/superadmin/streams', {
    method: 'POST',
    body: { classId: 1, name: 'Legacy Stream' },
  });
  assert.equal(removedStreamEndpoint.status, 404);

  const saDashHtml = (await admin.request('/dashboard/superadmin')).text;
  const tcDashHtml = (await teacher.request('/dashboard/teacher')).text;
  const stDashHtml = (await studentG10A.request('/dashboard/student')).text;
  assert.doesNotMatch(saDashHtml, /create-stream-form/i);
  assert.doesNotMatch(tcDashHtml, /Class \/ Stream/i);
  assert.doesNotMatch(stDashHtml, /Class &amp; Stream/i);
  assert.match(tcDashHtml, /id="create-coursework-form"/);
  assert.match(tcDashHtml, /id="tc-create-announcement-form"/);
  assert.match(stDashHtml, /id="sec-coursework"/);

  // 19b. Inspect teacher's assigned classes & subjects (Grade 10 & Grade 11)
  const tcOv = await teacher.request('/api/teacher/overview');
  assert.equal(tcOv.status, 200);
  assert.ok(Array.isArray(tcOv.json.assignedClasses));
  assert.equal(tcOv.json.assignedClasses.length, 2);
  const grade10 = tcOv.json.assignedClasses.find((c) => c.name === 'Grade 10');
  const grade11 = tcOv.json.assignedClasses.find((c) => c.name === 'Grade 11');
  assert.ok(grade10 && grade11);
  const mathSub = tcOv.json.registeredSubjects.find((s) => s.code === 'MTH101');
  assert.ok(mathSub);

  // 19c. Teacher publishes Classwork to Grade 10 ONLY with PDF + Image + Video attachments
  const cwForm = new FormData();
  cwForm.set('workType', 'classwork');
  cwForm.set('subjectId', String(mathSub.id));
  cwForm.set('title', 'Quadratic Equations Classwork Sheet');
  cwForm.set('instructions', 'Solve questions 1-5 from the attached PDF and watch the short walkthrough video.');
  cwForm.set('maxScore', '25');
  cwForm.set('dueAt', '2026-11-05T16:00');
  cwForm.set('classIds', JSON.stringify([grade10.id]));
  cwForm.append(
    'attachments',
    new Blob([Buffer.from('%PDF-1.4\n%Sample Teacher Worksheet PDF\n%%EOF')], { type: 'application/pdf' }),
    'quadratics_worksheet.pdf'
  );
  cwForm.append(
    'attachments',
    new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03])], {
      type: 'image/png',
    }),
    'graph_diagram.png'
  );
  cwForm.append(
    'attachments',
    new Blob([Buffer.from('00000018ftypmp4200000000mp42isomSampleTeacherLessonVideoBytes')], {
      type: 'video/mp4',
    }),
    'lesson_walkthrough.mp4'
  );

  const cwCreateRes = await teacher.request('/api/teacher/coursework', {
    method: 'POST',
    body: cwForm,
  });
  assert.equal(cwCreateRes.status, 201);
  assert.equal(cwCreateRes.json.coursework.workType, 'classwork');
  assert.deepEqual(cwCreateRes.json.coursework.targetClassIds, [grade10.id]);
  assert.equal(cwCreateRes.json.coursework.attachments.length, 3);
  const g10CourseworkId = cwCreateRes.json.coursework.id;
  const teacherVideoAtt = cwCreateRes.json.coursework.attachments.find((a) => a.mediaKind === 'video');
  const teacherPdfAtt = cwCreateRes.json.coursework.attachments.find((a) => a.mediaKind === 'pdf');
  assert.ok(teacherVideoAtt && teacherPdfAtt);

  // 19d. Teacher publishes an Exam to ALL Assigned Classes (Grade 10 & Grade 11)
  const examForm = new FormData();
  examForm.set('workType', 'exam');
  examForm.set('subjectId', String(mathSub.id));
  examForm.set('title', 'End of Term Core Mathematics Mock Exam');
  examForm.set('instructions', 'Answer all sections clearly and attach photos/PDFs of your workings.');
  examForm.set('maxScore', '100');
  examForm.set('applyToAllClasses', '1');

  const examCreateRes = await teacher.request('/api/teacher/coursework', {
    method: 'POST',
    body: examForm,
  });
  assert.equal(examCreateRes.status, 201);
  assert.equal(examCreateRes.json.coursework.workType, 'exam');
  assert.equal(examCreateRes.json.coursework.targetClassIds.length, 2);
  const allClassExamId = examCreateRes.json.coursework.id;

  // 19e. Verify class-scoped visibility: Grade 10 student sees both; Grade 11 student only sees the all-classes Exam
  const g10CwList = await studentG10A.request('/api/student/coursework');
  assert.equal(g10CwList.status, 200);
  assert.ok(g10CwList.json.items.some((i) => i.id === g10CourseworkId));
  assert.ok(g10CwList.json.items.some((i) => i.id === allClassExamId));

  const g11CwList = await studentG11.request('/api/student/coursework');
  assert.equal(g11CwList.status, 200);
  assert.equal(g11CwList.json.items.some((i) => i.id === g10CourseworkId), false);
  assert.equal(g11CwList.json.items.some((i) => i.id === allClassExamId), true);

  // Grade 11 student cannot download Grade 10 teacher PDF or submit to Grade 10 classwork (Anti-IDOR)
  const g11ForbiddenMedia = await studentG11.request(`/api/media/${teacherPdfAtt.id}`);
  assert.equal(g11ForbiddenMedia.status, 403);

  const g11ForbiddenSub = new FormData();
  g11ForbiddenSub.set('answerText', 'Trying to submit to another class');
  const g11SubAttempt = await studentG11.request(`/api/student/coursework/${g10CourseworkId}/submit`, {
    method: 'POST',
    body: g11ForbiddenSub,
  });
  assert.equal(g11SubAttempt.status, 403);

  // 19f. Grade 10 student streams teacher PDF (200) and Video with HTTP Range (206 Partial Content)
  const pdfDownload = await studentG10A.request(`/api/media/${teacherPdfAtt.id}`);
  assert.equal(pdfDownload.status, 200);
  assert.match(pdfDownload.headers.get('content-type') || '', /application\/pdf/);

  const videoRangeDownload = await studentG10A.request(`/api/media/${teacherVideoAtt.id}`, {
    extraHeaders: { Range: 'bytes=0-15' },
  });
  assert.equal(videoRangeDownload.status, 206);
  assert.equal(videoRangeDownload.buffer.length, 16);

  // 19g. Grade 10 student submits written answer + Image + Document + Video uploads
  const stSubForm = new FormData();
  stSubForm.set('answerText', '1) x = 3 or x = -5. Full step-by-step factorization attached.');
  stSubForm.append(
    'attachments',
    new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }),
    'handwritten_working.png'
  );
  stSubForm.append(
    'attachments',
    new Blob([Buffer.from('PK\x03\x04SampleDocxAnswerContent')], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    'solutions_notes.docx'
  );
  stSubForm.append(
    'attachments',
    new Blob([Buffer.from('00000018ftypmp42StudentExplanationClip')], { type: 'video/mp4' }),
    'explanation_clip.mp4'
  );

  const stSubmitRes = await studentG10A.request(`/api/student/coursework/${g10CourseworkId}/submit`, {
    method: 'POST',
    body: stSubForm,
  });
  assert.equal(stSubmitRes.status, 201);
  assert.equal(stSubmitRes.json.submission.attachments.length, 3);
  const studentPrivateImg = stSubmitRes.json.submission.attachments[0];

  // Another student in the SAME class (abena.boateng) CANNOT access kwame.asante's uploaded submission file!
  const peerIdorMedia = await studentG10B.request(`/api/media/${studentPrivateImg.id}`);
  assert.equal(peerIdorMedia.status, 403);

  // Teacher CAN access kwame.asante's uploaded submission file and grade the submission
  const teacherViewsStudentMedia = await teacher.request(`/api/media/${studentPrivateImg.id}`);
  assert.equal(teacherViewsStudentMedia.status, 200);

  const subsView = await teacher.request(`/api/teacher/coursework/${g10CourseworkId}/submissions`);
  assert.equal(subsView.status, 200);
  const kwameRow = subsView.json.learners.find((l) => l.admissionNumber === 'ADM-2026-001');
  assert.ok(kwameRow && kwameRow.submitted && kwameRow.submission);
  assert.equal(kwameRow.submission.attachments.length, 3);

  const gradeRes = await teacher.request(
    `/api/teacher/coursework/submissions/${kwameRow.submission.id}/grade`,
    {
      method: 'POST',
      body: { score: 23.5, feedback: 'Great quadratic factorization and clear video explanation!' },
    }
  );
  assert.equal(gradeRes.status, 200);

  // Student now sees graded score & feedback, and graded submission is locked from edits
  const g10AfterGrade = await studentG10A.request('/api/student/coursework');
  const gradedItem = g10AfterGrade.json.items.find((i) => i.id === g10CourseworkId);
  assert.equal(gradedItem.submission.status, 'graded');
  assert.equal(gradedItem.submission.score, 23.5);
  assert.match(gradedItem.submission.feedback, /Great quadratic factorization/);

  const editAfterGradeForm = new FormData();
  editAfterGradeForm.set('answerText', 'Trying to alter answer after grading');
  const lockedRes = await studentG10A.request(`/api/student/coursework/${g10CourseworkId}/submit`, {
    method: 'POST',
    body: editAfterGradeForm,
  });
  assert.equal(lockedRes.status, 403);

  // 19h. Teacher Class Announcements — single assigned class vs All Assigned Classes
  const g10OnlyAnn = await teacher.request('/api/teacher/announcements', {
    method: 'POST',
    body: {
      title: 'Grade 10 Calculator Reminder',
      body: 'Bring your non-programmable scientific calculators for tomorrow morning lesson.',
      priority: 'important',
      classIds: [grade10.id],
    },
  });
  assert.equal(g10OnlyAnn.status, 201);
  assert.deepEqual(g10OnlyAnn.json.targetClassIds, [grade10.id]);

  const allAssignedAnn = await teacher.request('/api/teacher/announcements', {
    method: 'POST',
    body: {
      title: 'Mathematics Department Revision Clinic',
      body: 'All my Mathematics classes will hold revision clinic on Friday at 2:00 PM.',
      priority: 'urgent',
      applyToAllClasses: true,
    },
  });
  assert.equal(allAssignedAnn.status, 201);
  assert.equal(allAssignedAnn.json.targetClassIds.length, 2);

  const g10Ov = await studentG10A.request('/api/student/overview');
  const g11Ov = await studentG11.request('/api/student/overview');
  assert.equal(
    g10Ov.json.announcements.some((a) => a.title === 'Grade 10 Calculator Reminder'),
    true
  );
  assert.equal(
    g10Ov.json.announcements.some((a) => a.title === 'Mathematics Department Revision Clinic'),
    true
  );
  assert.equal(
    g11Ov.json.announcements.some((a) => a.title === 'Grade 10 Calculator Reminder'),
    false
  );
  assert.equal(
    g11Ov.json.announcements.some((a) => a.title === 'Mathematics Department Revision Clinic'),
    true
  );

  // 19i. Verify Homework & Test categories + Teacher deleting own class announcement
  for (const wType of ['homework', 'test']) {
    const wf = new FormData();
    wf.set('workType', wType);
    wf.set('subjectId', String(mathSub.id));
    wf.set('title', `Weekly ${wType.toUpperCase()} Exercise`);
    wf.set('instructions', `Complete all ${wType} problems and upload your work.`);
    wf.set('maxScore', '40');
    wf.set('classIds', JSON.stringify([grade10.id, grade11.id]));
    const r = await teacher.request('/api/teacher/coursework', { method: 'POST', body: wf });
    assert.equal(r.status, 201);
    assert.equal(r.json.coursework.workType, wType);
    assert.equal(r.json.coursework.targetClassIds.length, 2);
  }

  const delOwnAnn = await teacher.request(`/api/teacher/announcements/${g10OnlyAnn.json.id}`, {
    method: 'DELETE',
  });
  assert.equal(delOwnAnn.status, 200);
  const g10OvAfterDel = await studentG10A.request('/api/student/overview');
  assert.equal(
    g10OvAfterDel.json.announcements.some((a) => a.title === 'Grade 10 Calculator Reminder'),
    false
  );
});






