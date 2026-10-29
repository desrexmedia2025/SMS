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

  // 13c. Student registration requires Terms & Conditions acceptance
  const missingTermsRes = await publicClient.request('/api/auth/register-student', {
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
  assert.equal(missingTermsRes.status, 400);

  // Student submits join proposal with accepted Terms -> blocked before approval -> Superadmin accepts -> student signs in
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
      acceptTerms: true,
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
      acceptTerms: true,
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

  // Verify clean sub-tabbed Superadmin HTML loads with structured sub-navigation & zero bloat
  const htmlRes = await admin.request('/dashboard/superadmin');
  assert.equal(htmlRes.status, 200);
  assert.match(htmlRes.text, /data-tab-group="academic"/);
  assert.match(htmlRes.text, /data-tab-group="students"/);
  assert.match(htmlRes.text, /data-section="teacher-register"/);
  assert.match(htmlRes.text, /data-section="teachers"/);
  assert.match(htmlRes.text, /data-section="teacher-assign"/);
  assert.match(htmlRes.text, /data-tab-group="finance"/);
  assert.doesNotMatch(htmlRes.text, /Security Audit Logs/i);
  assert.doesNotMatch(htmlRes.text, /Database Backups/i);
  assert.doesNotMatch(htmlRes.text, /Hide Figures/i);

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

test('20. Simplified Dashboard UI across all 4 roles & Frictionless Academic Period Auto-Bootstrap', async () => {
  const admin = new SessionClient();
  const teacher = new SessionClient();
  const student = new SessionClient();
  const finance = new SessionClient();

  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  await finance.login('finance@school.edu.gh', 'Finance@2026!');

  const [saHtml, tcHtml, stHtml, fnHtml] = await Promise.all([
    admin.request('/dashboard/superadmin').then((r) => r.text),
    teacher.request('/dashboard/teacher').then((r) => r.text),
    student.request('/dashboard/student').then((r) => r.text),
    finance.request('/dashboard/financial').then((r) => r.text),
  ]);

  // Every dashboard includes Show/Hide Menu button, modern action tiles & clean v3.x assets
  for (const html of [saHtml, tcHtml, stHtml, fnHtml]) {
    assert.match(html, /id="mobile-menu-btn"/);
    assert.match(html, /\?v=3\.20/);
    assert.match(html, /class="action-tile-grid"/);
    assert.doesNotMatch(html, /Hide Figures/i);
    assert.doesNotMatch(html, /Audit Log/i);
    assert.doesNotMatch(html, /Database Backups/i);
    assert.doesNotMatch(html, /Reconciliation/i);
    assert.doesNotMatch(html, /Mark Correction/i);
    assert.doesNotMatch(html, /Profile Correction/i);
    assert.doesNotMatch(html, /Record Attendance/i);
  }

  // Verify every getElementById, sidebar data-section, and data-subtab in client JS exists in its HTML view
  const viewPairs = [
    ['src/views/superadmin.html', 'src/public/js/superadmin.js'],
    ['src/views/teacher.html', 'src/public/js/teacher.js'],
    ['src/views/student.html', 'src/public/js/student.js'],
    ['src/views/financial.html', 'src/public/js/financial.js'],
    ['src/views/login.html', 'src/public/js/login.js'],
  ];
  for (const [hRel, jRel] of viewPairs) {
    const hSrc = fs.readFileSync(path.join(__dirname, '..', hRel), 'utf8');
    const jSrc = fs.readFileSync(path.join(__dirname, '..', jRel), 'utf8');
    const idSet = new Set([...hSrc.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of jSrc.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
      const targetId = m[1];
      const dynamicallyCreated =
        jSrc.includes(`id="${targetId}"`) || jSrc.includes(`id='${targetId}'`);
      assert.equal(
        idSet.has(targetId) || dynamicallyCreated,
        true,
        `Missing #${targetId} in ${hRel} (referenced in ${jRel})`
      );
    }
    for (const m of hSrc.matchAll(/data-section="([^"]+)"/g)) {
      assert.equal(idSet.has(`sec-${m[1]}`), true, `Missing #sec-${m[1]} in ${hRel}`);
    }
    for (const m of hSrc.matchAll(/data-subtab="([^"]+)"/g)) {
      assert.equal(
        idSet.has(`subtab-${m[1]}`) || idSet.has(m[1]),
        true,
        `Missing subtab pane for ${m[1]} in ${hRel}`
      );
    }

    if (hRel !== 'src/views/login.html') {
      const asideMatch = hSrc.match(/<aside[^>]*class="sidebar"[^>]*>([\s\S]*?)<\/aside>/);
      assert.ok(asideMatch, `Expected <aside class="sidebar"> in ${hRel}`);
      const asideHtml = asideMatch[1];
      assert.equal(asideHtml.includes('class="sidebar-bottom"'), true, `Missing .sidebar-bottom in ${hRel}`);
      assert.equal(asideHtml.includes('id="logout-btn"'), true, `Expected #logout-btn inside sidebar in ${hRel}`);
      assert.equal(asideHtml.includes('id="sb-user-info"'), true, `Expected #sb-user-info inside sidebar in ${hRel}`);
      assert.equal(asideHtml.includes('id="google-link-btn"'), true, `Expected #google-link-btn inside sidebar in ${hRel}`);
      assert.equal(
        asideHtml.includes('currency-switcher') || asideHtml.includes('id="sb-currency-display"'),
        true,
        `Expected currency control/readout inside sidebar in ${hRel}`
      );
      assert.equal(hSrc.includes('class="topbar-right"'), false, `Unexpected .topbar-right clutter in ${hRel}`);
    }
  }

  const cssSrc = fs.readFileSync(path.join(__dirname, '..', 'src/public/css/styles.css'), 'utf8');
  assert.equal(cssSrc.includes('--sidebar-top: #163f8c'), true);
  assert.equal(cssSrc.includes('.sidebar-bottom'), true);
  assert.equal(cssSrc.includes('.sidebar-logout-btn'), true);
  assert.equal(cssSrc.includes('.kpi-icon-box'), true);
  assert.equal(cssSrc.includes('.action-tile-grid'), true);
  assert.equal(cssSrc.includes('.topbar-date-chip'), true);

  // Styled form system: full-width fields must span the grid and fields must be themed
  assert.match(cssSrc, /\.form-grid-full/, 'full-width form fields need a spanning CSS rule');
  assert.match(cssSrc, /\.form-group > label/, 'form labels are styled');
  assert.match(cssSrc, /\.form-group:focus-within > label/, 'focused fields highlight their label');
  assert.match(cssSrc, /appearance: none;/, 'selects use a custom chevron');
  assert.match(cssSrc, /file-selector-button/, 'file inputs are styled');
  assert.match(cssSrc, /user-invalid/, 'invalid fields are highlighted after interaction');

  for (const hRel of [
    'src/views/superadmin.html',
    'src/views/teacher.html',
    'src/views/student.html',
    'src/views/financial.html',
  ]) {
    const hSrc = fs.readFileSync(path.join(__dirname, '..', hRel), 'utf8');
    assert.match(hSrc, /class="form-group"/, `${hRel} must use .form-group field wrappers`);
    const fullWidthFields = (hSrc.match(/form-grid-full/g) || []).length;
    if (fullWidthFields > 0) {
      assert.match(
        cssSrc,
        /\.form-group\.form-grid-full[\s\S]{0,80}grid-column: 1 \/ -1;/,
        `${hRel} uses .form-grid-full which must span every grid column`
      );
    }
  }

  // Simulate a fresh school with no active academic year/term and verify auto-bootstrap
  await db.run('UPDATE academic_years SET is_active = 0');
  await db.run('UPDATE terms SET is_active = 0');

  const clsRes = await admin.request('/api/superadmin/academic/classes', {
    method: 'POST',
    body: { name: 'Simple Form 1', levelOrder: 21, capacity: 35 },
  });
  assert.equal(clsRes.status, 201);

  const stuRes = await admin.request('/api/superadmin/students', {
    method: 'POST',
    body: {
      firstName: 'Efua',
      lastName: 'Mensima',
      email: 'efua.mensima.simple@student.school.edu.gh',
      classId: clsRes.json.id,
    },
  });
  assert.equal(stuRes.status, 201);

  const catRes = await finance.request('/api/financial/categories', {
    method: 'POST',
    body: {
      code: 'SIMP-FEE',
      name: 'Simple Term Fee',
      defaultAmount: 300,
      frequency: 'termly',
    },
  });
  assert.equal(catRes.status, 201);

  const billRes = await finance.request('/api/financial/assignments', {
    method: 'POST',
    body: {
      targetType: 'class',
      classId: clsRes.json.id,
      feeCategoryId: catRes.json.id,
    },
  });
  assert.equal(billRes.status, 201);
  assert.equal(billRes.json.assignedCount, 1);
});

test('21. Superadmin Lite Site Analytics & Usage Graphs: real-time page hits, sessions, daily trend, role breakdown & RBAC', async () => {
  const admin = new SessionClient();
  const teacher = new SessionClient();
  const student = new SessionClient();

  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');

  // Non-superadmin roles must be denied access to /api/superadmin/analytics
  const tcDenied = await teacher.request('/api/superadmin/analytics?days=14');
  assert.equal(tcDenied.status, 403);
  const stDenied = await student.request('/api/superadmin/analytics?days=14');
  assert.equal(stDenied.status, 403);

  // Trigger real page visits across /login and role dashboards
  const beforeRes = await admin.request('/api/superadmin/analytics?days=7');
  assert.equal(beforeRes.status, 200);
  assert.equal(beforeRes.json.analytics.windowDays, 7);
  assert.equal(beforeRes.json.analytics.dailyTrend.length, 7);
  const beforeViews = beforeRes.json.analytics.summary.pageViewsToday;

  await fetch(`${baseUrl}/login`);
  await admin.request('/dashboard/superadmin');
  await teacher.request('/dashboard/teacher');
  await student.request('/dashboard/student');

  const afterRes = await admin.request('/api/superadmin/analytics?days=30');
  assert.equal(afterRes.status, 200);
  const an = afterRes.json.analytics;
  assert.equal(an.windowDays, 30);
  assert.equal(an.dailyTrend.length, 30);
  assert.equal(an.summary.pageViewsToday >= beforeViews + 4, true);
  assert.equal(an.summary.activeSessions >= 3, true);
  assert.equal(an.summary.signInsPeriod >= 3, true);
  assert.equal(an.portalUsageByRole.length, 4);
  assert.equal(an.moduleActivity.length, 5);
  assert.equal(Array.isArray(an.classSnapshot), true);
  assert.equal(an.liveFeed.length > 0, true);

  // Overview payload also embeds 14-day analytics for instant landing graphs
  const ovRes = await admin.request('/api/superadmin/overview');
  assert.equal(ovRes.status, 200);
  assert.ok(ovRes.json.analytics);
  assert.equal(ovRes.json.analytics.dailyTrend.length, 14);
});

test('22. Universal Search Buttons across all 4 Dashboards & Server-Side Search APIs', async () => {
  const admin = new SessionClient();
  const teacher = new SessionClient();
  const student = new SessionClient();
  const finance = new SessionClient();

  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  await finance.login('finance@school.edu.gh', 'Finance@2026!');

  // 1. Verify Topbar Search + Section Search Bars & Target ID parity across all 4 dashboards
  const dashboards = [
    await admin.request('/dashboard/superadmin'),
    await teacher.request('/dashboard/teacher'),
    await student.request('/dashboard/student'),
    await finance.request('/dashboard/financial'),
  ];

  for (const dash of dashboards) {
    assert.equal(dash.status, 200);
    assert.match(dash.text, /id="topbar-search-form"/);
    assert.match(dash.text, /id="topbar-search-btn"/);
    assert.match(dash.text, /class="search-bar"/);

    // Every data-search-tbody / data-search-list / data-search-matrix target exists in the same HTML
    const targetMatches = [
      ...dash.text.matchAll(/data-search-(?:tbody|list|matrix)="([^"]+)"/g),
    ];
    assert.equal(targetMatches.length >= 4, true);
    for (const m of targetMatches) {
      const targetId = m[1];
      assert.match(
        dash.text,
        new RegExp(`id="${targetId}"`),
        `Missing search target #${targetId}`
      );
    }
  }

  // 2. Verify server-side search endpoints filter accurately
  const tchSearch = await admin.request('/api/superadmin/teachers?search=Mensah');
  assert.equal(tchSearch.status, 200);
  assert.equal(tchSearch.json.teachers.length >= 1, true);
  assert.equal(
    tchSearch.json.teachers.every((t) =>
      `${t.first_name} ${t.last_name} ${t.email}`.toLowerCase().includes('mensah')
    ),
    true
  );

  const tchNoMatch = await admin.request('/api/superadmin/teachers?search=ZZZ_NONEXISTENT_999');
  assert.equal(tchNoMatch.status, 200);
  assert.equal(tchNoMatch.json.teachers.length, 0);

  const stuSearch = await admin.request('/api/superadmin/students?search=Kwame');
  assert.equal(stuSearch.status, 200);
  assert.equal(stuSearch.json.items.length >= 1, true);

  const usrSearch = await admin.request('/api/superadmin/users?search=finance&role=financial');
  assert.equal(usrSearch.status, 200);
  assert.equal(usrSearch.json.items.length >= 1, true);

  const finAccSearch = await finance.request('/api/financial/accounts?search=Kwame');
  assert.equal(finAccSearch.status, 200);
  assert.equal(finAccSearch.json.items.length >= 1, true);
});

test('23. Terms & Conditions (Registration + First Dashboard Visit), Themes, Languages & Glass Navbars', async () => {
  const pub = new SessionClient();
  const loginPage = await pub.request('/login');
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.text, /id="reg-accept-terms"/);
  assert.match(loginPage.text, /id="open-reg-terms-btn"/);
  assert.match(loginPage.text, /id="login-terms-modal"/);

  const teacher = new SessionClient();
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');

  // First-time dashboard visit check: termsAccepted starts false before acceptance
  const initialSess = await teacher.request('/api/auth/session');
  assert.equal(initialSess.status, 200);
  assert.equal(initialSess.json.user.termsAccepted, false);

  // Accept Terms & Conditions on first dashboard visit
  const acceptRes = await teacher.request('/api/auth/terms/accept', {
    method: 'POST',
    body: { accept: true },
  });
  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.json.user.termsAccepted, true);
  assert.equal(acceptRes.json.termsVersion, '2026.1');

  const afterSess = await teacher.request('/api/auth/session');
  assert.equal(afterSess.json.user.termsAccepted, true);

  // Persist Theme & Language preferences on user profile
  const prefRes = await teacher.request('/api/auth/preferences', {
    method: 'PATCH',
    body: { theme: 'dark', language: 'fr' },
  });
  assert.equal(prefRes.status, 200);
  assert.equal(prefRes.json.themePreference, 'dark');
  assert.equal(prefRes.json.languagePreference, 'fr');

  const badPrefRes = await teacher.request('/api/auth/preferences', {
    method: 'PATCH',
    body: { theme: 'neon-pink' },
  });
  assert.equal(badPrefRes.status, 400);

  // Verify Theme, Language & Terms controls across all 4 dashboards + Glass Navbar CSS
  const admin = new SessionClient();
  const student = new SessionClient();
  const finance = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  await finance.login('finance@school.edu.gh', 'Finance@2026!');

  const pages = [
    await admin.request('/dashboard/superadmin'),
    await teacher.request('/dashboard/teacher'),
    await student.request('/dashboard/student'),
    await finance.request('/dashboard/financial'),
  ];
  for (const p of pages) {
    assert.equal(p.status, 200);
    assert.match(p.text, /id="sb-theme-select"/);
    assert.match(p.text, /id="sb-lang-select"/);
    assert.match(p.text, /id="open-terms-btn"/);
  }

  const cssText = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'css', 'styles.css'),
    'utf8'
  );
  assert.match(cssText, /--glass-topbar-bg:/);
  assert.match(cssText, /backdrop-filter:\s*blur\(20px\)/);
  assert.match(cssText, /html\[data-theme="dark"\]/);
  assert.match(cssText, /html\[data-theme="ocean"\]/);

  // Intense glass navbar: strong blur + high-saturation translucent backdrop
  assert.match(cssText, /\.topbar \{[^}]*backdrop-filter:\s*blur\(34px\) saturate\(230%\)/s);
  assert.match(cssText, /--glass-topbar-bg:\s*rgba\(255, 255, 255, 0\.30\)/);
  assert.match(cssText, /body\.is-scrolled \.topbar/);

  // Side panel is a single scrolling list: whole panel scrolls, nothing is pinned
  assert.match(cssText, /\.sidebar \{[^}]*overflow-y:\s*auto/s);
  assert.match(cssText, /\.sidebar-nav \{[^}]*flex:\s*0 0 auto/s);
  assert.match(cssText, /\.sidebar-bottom \{[^}]*flex:\s*0 0 auto/s);
  assert.doesNotMatch(cssText, /\.sidebar-header \{[^}]*position:\s*sticky/s);
  assert.doesNotMatch(cssText, /\.sidebar-bottom \{[^}]*position:\s*sticky/s);

  // Currency, Theme & Language sit in the same list flow as the nav items
  for (const p of pages) {
    assert.match(p.text, /nav-section-label">Preferences/);
    assert.match(p.text, /nav-section-label">Session/);
    const bottom = p.text.slice(p.text.indexOf('class="sidebar-bottom"'));
    assert.match(bottom, /id="sb-theme-select"/);
    assert.match(bottom, /id="sb-lang-select"/);
  }
});

test('24. Overview Calendar on all four dashboards: small widget in the right corner, content beside it & role-scoped feed', async () => {
  const admin = new SessionClient();
  const teacher = new SessionClient();
  const student = new SessionClient();
  const finance = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  await finance.login('finance@school.edu.gh', 'Finance@2026!');

  const pages = {
    superadmin: await admin.request('/dashboard/superadmin'),
    teacher: await teacher.request('/dashboard/teacher'),
    student: await student.request('/dashboard/student'),
    financial: await finance.request('/dashboard/financial'),
  };

  // The Calendar card is the FIRST card of every Overview (left corner) across all 4 dashboards
  for (const [role, p] of Object.entries(pages)) {
    assert.equal(p.status, 200, `${role} dashboard must load`);
    const start = p.text.indexOf('id="sec-overview"');
    assert.ok(start > -1, `${role} overview section exists`);
    const nextSection = p.text.indexOf('id="sec-', start + 10);
    const overview = p.text.slice(start, nextSection === -1 ? undefined : nextSection);
    assert.match(overview, /overview-calendar-card/, `${role} has a calendar card`);
    assert.match(overview, /id="ov-calendar"/, `${role} has a calendar mount`);
    assert.match(overview, /id="ov-calendar-agenda"/, `${role} has a calendar agenda`);
    assert.ok(
      overview.indexOf('overview-calendar-card') < overview.indexOf('kpi-grid'),
      `${role} calendar must appear before the KPI cards`
    );
    assert.ok(
      overview.indexOf('class="calendar-pane"') < overview.indexOf('class="calendar-agenda"'),
      `${role} calendar grid must sit to the left of the agenda`
    );
  }

  // Month range used by the client grid
  const now = new Date();
  const monthFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    lastDay
  ).padStart(2, '0')}`;
  const rangeQuery = `from=${monthFrom}&to=${monthTo}`;

  // Teacher publishes work due inside the current month so the calendar has a real entry
  const tcOv = await teacher.request('/api/teacher/overview');
  const mathSub = tcOv.json.registeredSubjects.find((s) => s.code === 'MTH101');
  const dueDay = String(Math.min(28, Math.max(2, now.getDate() + 1))).padStart(2, '0');
  const dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${dueDay}`;

  const cwForm = new FormData();
  cwForm.set('workType', 'homework');
  cwForm.set('subjectId', String(mathSub.id));
  cwForm.set('title', 'Calendar Deadline Homework');
  cwForm.set('instructions', 'Confirm this work shows on the overview calendar.');
  cwForm.set('maxScore', '20');
  cwForm.set('dueAt', `${dueDate}T16:00`);
  cwForm.set('applyToAllClasses', '1');

  const cwRes = await teacher.request('/api/teacher/coursework', { method: 'POST', body: cwForm });
  assert.equal(cwRes.status, 201);

  // Role-scoped feeds: teacher & student see the coursework; every role gets a valid payload
  const feedRoles = [
    ['superadmin', admin],
    ['teacher', teacher],
    ['student', student],
    ['financial', finance],
  ];
  for (const [role, client] of feedRoles) {
    const res = await client.request(`/api/calendar/events?${rangeQuery}`);
    assert.equal(res.status, 200, `${role} calendar feed must load`);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.role, role);
    assert.equal(res.json.range.from, monthFrom);
    assert.equal(res.json.range.to, monthTo);
    assert.ok(Array.isArray(res.json.events), `${role} events must be an array`);
    assert.ok(Array.isArray(res.json.days), `${role} days must be an array`);
    res.json.events.forEach((ev) => {
      assert.match(ev.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(['coursework', 'announcement', 'fee', 'payment'].includes(ev.kind));
      assert.ok(ev.title.length > 0);
      assert.ok(ev.date >= monthFrom && ev.date <= monthTo, 'events stay inside the range');
    });
  }

  const teacherFeed = await teacher.request(`/api/calendar/events?${rangeQuery}`);
  const teacherHit = teacherFeed.json.events.find((ev) => ev.title === 'Calendar Deadline Homework');
  assert.ok(teacherHit, 'teacher calendar shows their coursework deadline');
  assert.equal(teacherHit.date, dueDate);
  assert.equal(teacherHit.kind, 'coursework');

  const studentFeed = await student.request(`/api/calendar/events?${rangeQuery}`);
  assert.ok(
    studentFeed.json.events.some((ev) => ev.title === 'Calendar Deadline Homework'),
    'student calendar shows deadlines for their class'
  );

  const adminFeed = await admin.request(`/api/calendar/events?${rangeQuery}`);
  assert.ok(
    adminFeed.json.events.some((ev) => ev.title === 'Calendar Deadline Homework'),
    'superadmin calendar shows school-wide deadlines'
  );

  // Financial feed must never expose another role's private coursework deadlines
  const finFeed = await finance.request(`/api/calendar/events?${rangeQuery}`);
  assert.equal(
    finFeed.json.events.some((ev) => ev.title === 'Calendar Deadline Homework'),
    false,
    'financial calendar is scoped to fees & payments only'
  );

  // Unauthenticated access is rejected
  const anon = new SessionClient();
  const anonRes = await anon.request(`/api/calendar/events?${rangeQuery}`);
  assert.equal(anonRes.status, 401);

  // Invalid ranges are rejected
  const badRange = await teacher.request('/api/calendar/events?from=2026-05-20&to=2026-05-01');
  assert.equal(badRange.status, 400);

  // The calendar stays a small widget pinned to the left column of the Overview
  const cssText = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'css', 'styles.css'),
    'utf8'
  );
  // The calendar is a small widget pinned to the RIGHT column, with the rest of the Overview filling the space beside it
  assert.match(cssText, /#sec-overview \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 268px/s);
  assert.match(cssText, /#sec-overview > \.overview-calendar-card \{[^}]*grid-column:\s*2;/s);
  assert.match(cssText, /#sec-overview > \.overview-calendar-card \{[^}]*position:\s*sticky/s);
  assert.match(cssText, /#sec-overview > \*:not\(\.overview-calendar-card\) \{[^}]*grid-column:\s*1;/s);
  assert.match(cssText, /html\[dir="rtl"\] #sec-overview > \.overview-calendar-card \{[^}]*grid-column:\s*1;/s);
  assert.match(cssText, /html\[dir="rtl"\] #sec-overview > \*:not\(\.overview-calendar-card\) \{[^}]*grid-column:\s*2;/s);
  assert.match(cssText, /\.calendar-layout \{[^}]*display:\s*block/s);
  // The side-by-side layout is kept down to narrow widths so no gap is left beside the calendar
  assert.match(
    cssText,
    /@media \(max-width: 1120px\) \{\s*#sec-overview \{\s*grid-template-columns:\s*minmax\(0, 1fr\) 236px;/s
  );
  assert.match(
    cssText,
    /@media \(max-width: 880px\) \{\s*#sec-overview \{\s*grid-template-columns:\s*minmax\(0, 1fr\);/s
  );

  // Calendar styles are defined for grid, agenda & event tones
  assert.match(cssText, /\.cal-day\.is-today \{/);
  assert.match(cssText, /\.cal-agenda-item \{/);
  assert.match(cssText, /\.cal-legend \{/);

  // Client widget is initialised from every dashboard script
  for (const jsRel of [
    'src/public/js/superadmin.js',
    'src/public/js/teacher.js',
    'src/public/js/student.js',
    'src/public/js/financial.js',
  ]) {
    const jsSrc = fs.readFileSync(path.join(__dirname, '..', jsRel), 'utf8');
    assert.match(jsSrc, /initOverviewCalendar\(\)/);
  }
  const commonSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'common.js'),
    'utf8'
  );
  assert.match(commonSrc, /\/api\/calendar\/events/);
  assert.match(commonSrc, /initOverviewCalendar/);
});

test('25. Profile photos across all four dashboards (upload, serving, admin control & removal)', async () => {
  const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );

  function pngForm(field = 'avatar') {
    const form = new FormData();
    form.append(field, new Blob([PNG_1PX], { type: 'image/png' }), 'photo.png');
    return form;
  }

  // ---------- PROFILE PHOTO UPLOAD, SERVING & REMOVAL ----------
  // Password + Google remain the only sign-in methods: the OTP endpoints are gone
  const pub = new SessionClient();
  await pub.request('/api/auth/session');
  const deadOtpRequest = await pub.request('/api/auth/otp/request', {
    method: 'POST',
    body: { identifier: 'admin@school.edu.gh', channel: 'email' },
  });
  assert.equal(deadOtpRequest.status, 404);
  const deadOtpVerify = await pub.request('/api/auth/otp/verify', {
    method: 'POST',
    body: { identifier: 'admin@school.edu.gh', code: '123456' },
  });
  assert.equal(deadOtpVerify.status, 404);

  const loginPageNoOtp = await pub.request('/login');
  assert.equal(loginPageNoOtp.status, 200);
  assert.doesNotMatch(loginPageNoOtp.text, /id="otp-panel"/);
  assert.doesNotMatch(loginPageNoOtp.text, /one-time code/i);

  const teacher = new SessionClient();
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  const teacherSess = await teacher.request('/api/auth/session');
  const teacherId = teacherSess.json.user.id;

  const anonAvatar = await new SessionClient().request(`/api/users/${teacherId}/avatar`);
  assert.equal(anonAvatar.status, 401);

  const missingAvatar = await teacher.request(`/api/users/${teacherId}/avatar`);
  assert.equal(missingAvatar.status, 404);

  const upload = await teacher.request('/api/auth/avatar', {
    method: 'POST',
    body: pngForm(),
  });
  assert.equal(upload.status, 200);
  assert.match(upload.json.avatarUrl, /^\/api\/users\/\d+\/avatar\?v=\d+$/);

  const served = await teacher.request(upload.json.avatarUrl);
  assert.equal(served.status, 200);
  assert.match(String(served.headers.get('content-type') || ''), /^image\//);
  assert.equal(Buffer.compare(served.buffer, PNG_1PX), 0);

  const sessAfter = await teacher.request('/api/auth/session');
  assert.match(sessAfter.json.user.avatarUrl, /^\/api\/users\/\d+\/avatar/);

  // Non-image uploads are rejected
  const badForm = new FormData();
  badForm.append('avatar', new Blob([Buffer.from('not an image')], { type: 'text/plain' }), 'notes.txt');
  const badUpload = await teacher.request('/api/auth/avatar', { method: 'POST', body: badForm });
  assert.equal(badUpload.status, 400);

  // Superadmin can set any account's photo; other roles cannot
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  const adminSet = await admin.request(`/api/superadmin/users/${teacherId}/avatar`, {
    method: 'POST',
    body: pngForm(),
  });
  assert.equal(adminSet.status, 200);
  assert.match(adminSet.json.avatarUrl, /^\/api\/users\/\d+\/avatar/);

  const student = new SessionClient();
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  const forbiddenSet = await student.request(`/api/superadmin/users/${teacherId}/avatar`, {
    method: 'POST',
    body: pngForm(),
  });
  assert.equal(forbiddenSet.status, 403);

  // Removal clears the stored photo
  const removed = await teacher.request('/api/auth/avatar', { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal(removed.json.avatarUrl, '');
  const afterRemoval = await teacher.request(`/api/users/${teacherId}/avatar`);
  assert.equal(afterRemoval.status, 404);

  for (const [hRel, extraIds] of [
    ['src/views/superadmin.html', ['sb-avatar-img', 'change-photo-btn', 'avatar-file-input']],
    ['src/views/teacher.html', ['sb-avatar-img', 'prof-avatar-img', 'prof-photo-btn']],
    ['src/views/student.html', ['sb-avatar-img', 'prof-avatar-img', 'prof-photo-btn']],
    ['src/views/financial.html', ['sb-avatar-img', 'change-photo-btn', 'avatar-file-input']],
  ]) {
    const html = fs.readFileSync(path.join(__dirname, '..', hRel), 'utf8');
    for (const id of extraIds) {
      assert.match(html, new RegExp(`id="${id}"`), `${hRel} must contain #${id}`);
    }
  }

  const commonSrc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'js', 'common.js'),
    'utf8'
  );
  assert.match(commonSrc, /\/api\/auth\/avatar/);
  assert.match(commonSrc, /initProfileAvatar/);

  const cssText = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'public', 'css', 'styles.css'),
    'utf8'
  );
  assert.match(cssText, /\.profile-avatar \{/);
  assert.match(cssText, /\.profile-avatar-lg \{/);
  assert.match(cssText, /\.sidebar-profile-row \{/);
  assert.doesNotMatch(cssText, /\.otp-/);
});










test('26. Superadmin can edit student records, teacher records and staff accounts end-to-end', async () => {
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');

  const acad = (await admin.request('/api/superadmin/academic')).json;
  const classes = acad.classes || [];
  assert.ok(classes.length >= 1, 'demo academic setup must expose at least one class');

  // ---------- STUDENTS ----------
  const seedEmail = 'edit.target.student@school.edu.gh';
  const otherStudent = ((await admin.request('/api/superadmin/students')).json.items || []).find(
    (s) => s.email !== seedEmail
  );
  assert.ok(otherStudent, 'a demo student must exist for conflict checks');

  const created = await admin.request('/api/superadmin/students', {
    method: 'POST',
    body: {
      firstName: 'Edit',
      lastName: 'Target',
      email: seedEmail,
      classId: null,
    },
  });
  assert.equal(created.status, 201);
  const studentId = created.json.student?.id || created.json.studentId;
  assert.ok(Number(studentId) > 0, 'created student must expose an id');

  const targetClass = classes[classes.length - 1];
  const patchStudent = await admin.request(`/api/superadmin/students/${studentId}`, {
    method: 'PATCH',
    body: {
      admissionNumber: 'ADM-EDIT-9001',
      firstName: 'Akosua',
      lastName: 'Boateng',
      email: 'akosua.boateng@school.edu.gh',
      phone: '+233240001111',
      gender: 'Female',
      dateOfBirth: '2011-04-18',
      guardianName: 'Nana Boateng',
      guardianPhone: '+233247778889',
      guardianEmail: 'nana.boateng@example.com',
      address: '12 Liberation Road, Accra',
      medicalNotes: 'Asthma - inhaler in school bag',
      status: 'active',
      classId: targetClass.id,
      password: 'NewStudent@2026!',
    },
  });
  assert.equal(patchStudent.status, 200);
  const st = patchStudent.json.student;
  assert.equal(st.first_name, 'Akosua');
  assert.equal(st.last_name, 'Boateng');
  assert.equal(st.email, 'akosua.boateng@school.edu.gh');
  assert.equal(st.phone, '+233240001111');
  assert.equal(st.admission_number, 'ADM-EDIT-9001');
  assert.equal(st.gender, 'Female');
  assert.equal(st.guardian_name, 'Nana Boateng');
  assert.equal(st.guardian_phone, '+233247778889');
  assert.equal(st.guardian_email, 'nana.boateng@example.com');
  assert.equal(st.address, '12 Liberation Road, Accra');
  assert.equal(st.medical_notes, 'Asthma - inhaler in school bag');
  assert.equal(Number(st.class_id), Number(targetClass.id));
  assert.equal(st.class_name, targetClass.name);

  const relisted = ((await admin.request('/api/superadmin/students?search=Akosua')).json.items || []).find(
    (s) => Number(s.id) === Number(studentId)
  );
  assert.ok(relisted, 'edited student must be searchable by the new name');
  assert.equal(relisted.class_name, targetClass.name);
  assert.equal(relisted.guardian_phone, '+233247778889');

  const dupEmail = await admin.request(`/api/superadmin/students/${studentId}`, {
    method: 'PATCH',
    body: { email: otherStudent.email },
  });
  assert.equal(dupEmail.status, 409);

  const dupAdmission = await admin.request(`/api/superadmin/students/${studentId}`, {
    method: 'PATCH',
    body: { admissionNumber: otherStudent.admission_number },
  });
  assert.equal(dupAdmission.status, 409);

  const missingStudent = await admin.request('/api/superadmin/students/99999999', {
    method: 'PATCH',
    body: { firstName: 'Ghost' },
  });
  assert.equal(missingStudent.status, 404);

  const noCsrf = await admin.request(`/api/superadmin/students/${studentId}`, {
    method: 'PATCH',
    body: { firstName: 'Nocsrf' },
    sendCsrf: false,
  });
  assert.equal(noCsrf.status, 403);

  // the password issued during the edit must work for the student portal
  const studentClient = new SessionClient();
  const relogin = await studentClient.login('akosua.boateng@school.edu.gh', 'NewStudent@2026!');
  assert.equal(relogin.status, 200);
  assert.equal(relogin.json.user.role, 'student');

  // ---------- TEACHERS ----------
  const existingTeacher = ((await admin.request('/api/superadmin/teachers')).json.teachers || [])[0];
  assert.ok(existingTeacher, 'a demo teacher must exist for conflict checks');

  const tCreated = await admin.request('/api/superadmin/teachers', {
    method: 'POST',
    body: {
      firstName: 'Kwesi',
      lastName: 'Editme',
      email: 'kwesi.editme@school.edu.gh',
      phone: '',
      qualification: 'B.Ed',
    },
  });
  assert.equal(tCreated.status, 201);
  const teacherId = tCreated.json.teacher?.id || tCreated.json.teacherId;
  assert.ok(Number(teacherId) > 0, 'created teacher must expose an id');

  const patchTeacher = await admin.request(`/api/superadmin/teachers/${teacherId}`, {
    method: 'PATCH',
    body: {
      staffNumber: 'STF-EDIT-7001',
      firstName: 'Kwabena',
      lastName: 'Osei',
      email: 'kwabena.osei@school.edu.gh',
      phone: '+233552223344',
      qualification: 'M.Ed Mathematics',
      specialization: 'Mathematics, Science',
      department: 'Sciences',
      hireDate: '2024-01-15',
      status: 'active',
      password: 'NewTeacher@2026!',
    },
  });
  assert.equal(patchTeacher.status, 200);
  const tc = patchTeacher.json.teacher;
  assert.equal(tc.first_name, 'Kwabena');
  assert.equal(tc.last_name, 'Osei');
  assert.equal(tc.email, 'kwabena.osei@school.edu.gh');
  assert.equal(tc.phone, '+233552223344');
  assert.equal(tc.staff_number, 'STF-EDIT-7001');
  assert.equal(tc.qualification, 'M.Ed Mathematics');
  assert.equal(tc.specialization, 'Mathematics, Science');
  assert.equal(tc.department, 'Sciences');
  assert.equal(tc.hire_date, '2024-01-15');

  const tRelisted = ((await admin.request('/api/superadmin/teachers?search=Kwabena')).json.teachers || []).find(
    (t) => Number(t.id) === Number(teacherId)
  );
  assert.ok(tRelisted, 'edited teacher must be searchable by the new name');
  assert.equal(tRelisted.department, 'Sciences');
  assert.equal(tRelisted.phone, '+233552223344');

  const dupStaff = await admin.request(`/api/superadmin/teachers/${teacherId}`, {
    method: 'PATCH',
    body: { staffNumber: existingTeacher.staff_number },
  });
  assert.equal(dupStaff.status, 409);

  const tDupEmail = await admin.request(`/api/superadmin/teachers/${teacherId}`, {
    method: 'PATCH',
    body: { email: existingTeacher.email },
  });
  assert.equal(tDupEmail.status, 409);

  const teacherClient = new SessionClient();
  const tRelogin = await teacherClient.login('kwabena.osei@school.edu.gh', 'NewTeacher@2026!');
  assert.equal(tRelogin.status, 200);
  assert.equal(tRelogin.json.user.role, 'teacher');

  // ---------- STAFF / USER ACCOUNTS ----------
  const uCreated = await admin.request('/api/superadmin/users', {
    method: 'POST',
    body: {
      username: 'edit.staff',
      email: 'edit.staff@school.edu.gh',
      fullName: 'Edit Staff',
      role: 'financial',
      phone: '',
    },
  });
  assert.equal(uCreated.status, 201);
  const userId = uCreated.json.user?.id || uCreated.json.userId || uCreated.json.id;
  assert.ok(Number(userId) > 0, 'created staff account must expose an id');

  const patchStaff = await admin.request(`/api/superadmin/users/${userId}/profile`, {
    method: 'PATCH',
    body: {
      fullName: 'Ama Serwaa',
      username: 'ama.serwaa',
      email: 'ama.serwaa@school.edu.gh',
      phone: '+233201234567',
      role: 'financial',
      status: 'active',
      password: 'NewStaff@2026!',
    },
  });
  assert.equal(patchStaff.status, 200);
  const uc = patchStaff.json.user;
  assert.equal(uc.full_name, 'Ama Serwaa');
  assert.equal(uc.username, 'ama.serwaa');
  assert.equal(uc.email, 'ama.serwaa@school.edu.gh');
  assert.equal(uc.phone, '+233201234567');
  assert.equal(uc.role, 'financial');
  assert.equal(uc.status, 'active');

  const uRelisted = ((await admin.request('/api/superadmin/users?search=Ama')).json.items || []).find(
    (u) => Number(u.id) === Number(userId)
  );
  assert.ok(uRelisted, 'edited staff account must be searchable by the new name');
  assert.equal(uRelisted.phone, '+233201234567');
  assert.equal(uRelisted.email, 'ama.serwaa@school.edu.gh');

  const staffClient = new SessionClient();
  const uRelogin = await staffClient.login('ama.serwaa@school.edu.gh', 'NewStaff@2026!');
  assert.equal(uRelogin.status, 200);
  assert.equal(uRelogin.json.user.role, 'financial');

  const uDupEmail = await admin.request(`/api/superadmin/users/${userId}/profile`, {
    method: 'PATCH',
    body: { email: 'admin@school.edu.gh' },
  });
  assert.equal(uDupEmail.status, 409);

  // a superadmin cannot strip their own superadmin role
  const selfRow = ((await admin.request('/api/superadmin/users?search=admin@school.edu.gh')).json.items || []).find(
    (u) => u.role === 'superadmin'
  );
  assert.ok(selfRow, 'the superadmin account must be listed');
  const selfDemote = await admin.request(`/api/superadmin/users/${selfRow.id}/profile`, {
    method: 'PATCH',
    body: { role: 'teacher' },
  });
  assert.equal(selfDemote.status, 400);

  // ---------- ROLE GUARDS ----------
  const teacherAttempt = new SessionClient();
  await teacherAttempt.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  const forbiddenStudent = await teacherAttempt.request(`/api/superadmin/students/${studentId}`, {
    method: 'PATCH',
    body: { firstName: 'Nope' },
  });
  assert.equal(forbiddenStudent.status, 403);
  const forbiddenTeacher = await teacherAttempt.request(`/api/superadmin/teachers/${teacherId}`, {
    method: 'PATCH',
    body: { firstName: 'Nope' },
  });
  assert.equal(forbiddenTeacher.status, 403);
  const forbiddenStaff = await teacherAttempt.request(`/api/superadmin/users/${userId}/profile`, {
    method: 'PATCH',
    body: { fullName: 'Nope' },
  });
  assert.equal(forbiddenStaff.status, 403);

  // ---------- UI WIRING ----------
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'superadmin.html'), 'utf8');
  for (const id of [
    'edit-student-modal',
    'edit-student-form',
    'edit-stu-id',
    'edit-stu-class',
    'edit-teacher-modal',
    'edit-teacher-form',
    'edit-teacher-id',
    'edit-user-modal',
    'edit-user-form',
    'edit-user-id',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `superadmin.html must contain #${id}`);
  }
  assert.match(html, /Edit Student Record/);
  assert.match(html, /Edit Teacher Record/);
  assert.match(html, /Edit Staff Account/);

  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'superadmin.js'), 'utf8');
  assert.match(js, /data-edit-stu/);
  assert.match(js, /data-edit-tch=/);
  assert.match(js, /data-edit-user/);
  assert.match(js, /\/api\/superadmin\/students\/\$\{id\}/);
  assert.match(js, /\/api\/superadmin\/teachers\/\$\{id\}/);
  assert.match(js, /\/api\/superadmin\/users\/\$\{id\}\/profile/);

  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.record-modal-backdrop \{/);
  assert.match(css, /\.record-modal \{/);
});

test('27. Superadmin publishes school events that appear on all four dashboard calendars in their own colour', async () => {
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');

  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const from = `${year}-${month}-01`;
  const daysInMonth = new Date(year, Number(month), 0).getDate();
  const to = `${year}-${month}-${String(daysInMonth).padStart(2, '0')}`;

  const emptyList = (await admin.request('/api/superadmin/events')).json;
  assert.deepEqual(emptyList.items, [], 'the school event store must start clean');

  // ---------- CREATE ----------
  const holiday = await admin.request('/api/superadmin/events', {
    method: 'POST',
    body: {
      title: 'Independence Day Holiday',
      description: 'School closed',
      eventType: 'holiday',
      startDate: `${year}-${month}-06`,
      endDate: `${year}-${month}-06`,
      color: '#0ea5e9',
      audience: 'all',
    },
  });
  assert.equal(holiday.status, 201);
  assert.equal(holiday.json.event.event_type, 'holiday');
  assert.equal(holiday.json.event.event_type_label, 'Holiday');
  assert.equal(holiday.json.event.color, '#0ea5e9');
  assert.equal(holiday.json.event.audience_label, 'Everyone');
  const holidayId = holiday.json.event.id;

  const examWeek = await admin.request('/api/superadmin/events', {
    method: 'POST',
    body: {
      title: 'End of Term Exam Week',
      eventType: 'exam',
      startDate: `${year}-${month}-10`,
      endDate: `${year}-${month}-12`,
      audience: 'students',
    },
  });
  assert.equal(examWeek.status, 201);
  assert.equal(examWeek.json.event.color, '#dc2626', 'exam events default to their type colour');
  assert.equal(examWeek.json.event.multi_day, true);
  const examId = examWeek.json.event.id;

  const pta = await admin.request('/api/superadmin/events', {
    method: 'POST',
    body: {
      title: 'PTA General Meeting',
      eventType: 'meeting',
      startDate: `${year}-${month}-15`,
      endDate: `${year}-${month}-15`,
      color: '#7c3aed',
      audience: 'staff',
    },
  });
  assert.equal(pta.status, 201);
  const ptaId = pta.json.event.id;

  const listed = (await admin.request('/api/superadmin/events')).json;
  assert.equal((listed.items || []).length, 3);
  assert.deepEqual(
    (listed.items || []).map((e) => e.title).sort(),
    ['End of Term Exam Week', 'Independence Day Holiday', 'PTA General Meeting']
  );

  // ---------- VALIDATION ----------
  const shortTitle = await admin.request('/api/superadmin/events', {
    method: 'POST',
    body: { title: 'AB', startDate: `${year}-${month}-20`, endDate: `${year}-${month}-20` },
  });
  assert.equal(shortTitle.status, 400);

  const badRange = await admin.request('/api/superadmin/events', {
    method: 'POST',
    body: { title: 'Bad range event', startDate: `${year}-${month}-20`, endDate: `${year}-${month}-18` },
  });
  assert.equal(badRange.status, 400);

  const badDate = await admin.request('/api/superadmin/events', {
    method: 'POST',
    body: { title: 'Bad date event', startDate: 'not-a-date', endDate: 'not-a-date' },
  });
  assert.equal(badDate.status, 400);

  const noCsrf = await admin.request('/api/superadmin/events', {
    method: 'POST',
    body: { title: 'No csrf event', startDate: `${year}-${month}-20`, endDate: `${year}-${month}-20` },
    sendCsrf: false,
  });
  assert.equal(noCsrf.status, 403);

  const teacher = new SessionClient();
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  const forbidden = await teacher.request('/api/superadmin/events', {
    method: 'POST',
    body: { title: 'Teacher event', startDate: `${year}-${month}-20`, endDate: `${year}-${month}-20` },
  });
  assert.equal(forbidden.status, 403);

  // ---------- CALENDAR DELIVERY PER ROLE ----------
  const calFor = async (client) =>
    (await client.request(`/api/calendar/events?from=${from}&to=${to}`)).json.events || [];
  const titlesFor = (events) => events.map((e) => e.title);

  const adminEvents = await calFor(admin);
  assert.ok(titlesFor(adminEvents).includes('Independence Day Holiday'));
  assert.ok(titlesFor(adminEvents).includes('PTA General Meeting'));
  assert.ok(titlesFor(adminEvents).includes('End of Term Exam Week'), 'superadmin sees every event');

  const teacherEvents = await calFor(teacher);
  assert.ok(titlesFor(teacherEvents).includes('Independence Day Holiday'));
  assert.ok(titlesFor(teacherEvents).includes('PTA General Meeting'), 'staff audience includes teachers');
  assert.ok(
    !titlesFor(teacherEvents).includes('End of Term Exam Week'),
    'students-only events are hidden from teachers'
  );

  const student = new SessionClient();
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  const studentEvents = await calFor(student);
  assert.ok(titlesFor(studentEvents).includes('Independence Day Holiday'));
  assert.ok(titlesFor(studentEvents).includes('End of Term Exam Week'));
  assert.ok(
    !titlesFor(studentEvents).includes('PTA General Meeting'),
    'staff-only events are hidden from students'
  );

  const finance = new SessionClient();
  await finance.login('finance@school.edu.gh', 'Finance@2026!');
  const financeEvents = await calFor(finance);
  assert.ok(titlesFor(financeEvents).includes('Independence Day Holiday'));
  assert.ok(titlesFor(financeEvents).includes('PTA General Meeting'));
  assert.ok(!titlesFor(financeEvents).includes('End of Term Exam Week'));

  // ---------- COLOUR + MULTI-DAY ----------
  const holidayEntry = studentEvents.find((e) => e.title === 'Independence Day Holiday');
  assert.equal(holidayEntry.kind, 'school_event');
  assert.equal(holidayEntry.kindLabel, 'Holiday');
  assert.equal(holidayEntry.color, '#0ea5e9');
  assert.equal(holidayEntry.date, `${year}-${month}-06`);

  const examEntries = studentEvents.filter((e) => e.title === 'End of Term Exam Week');
  assert.equal(examEntries.length, 3, 'a 3-day event expands into three calendar days');
  assert.deepEqual(
    examEntries.map((e) => e.date).sort(),
    [`${year}-${month}-10`, `${year}-${month}-11`, `${year}-${month}-12`]
  );
  assert.equal(examEntries[0].color, '#dc2626');

  // ---------- UPDATE ----------
  const patched = await admin.request(`/api/superadmin/events/${holidayId}`, {
    method: 'PATCH',
    body: {
      title: 'Independence Day (Public Holiday)',
      eventType: 'holiday',
      startDate: `${year}-${month}-07`,
      endDate: `${year}-${month}-07`,
      color: '#123456',
      audience: 'all',
      description: 'School closed for the national celebration',
    },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.event.title, 'Independence Day (Public Holiday)');
  assert.equal(patched.json.event.color, '#123456');
  assert.equal(patched.json.event.start_date, `${year}-${month}-07`);

  const movedEvents = await calFor(student);
  const movedEntry = movedEvents.find((e) => e.title === 'Independence Day (Public Holiday)');
  assert.ok(movedEntry, 'renamed event must appear on the student calendar');
  assert.equal(movedEntry.date, `${year}-${month}-07`);
  assert.equal(movedEntry.color, '#123456');
  assert.ok(!titlesFor(movedEvents).includes('Independence Day Holiday'), 'old title is gone');

  const missingPatch = await admin.request('/api/superadmin/events/987654321', {
    method: 'PATCH',
    body: { title: 'Ghost event update' },
  });
  assert.equal(missingPatch.status, 404);

  // ---------- DELETE ----------
  const deleted = await admin.request(`/api/superadmin/events/${ptaId}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const afterDelete = await calFor(teacher);
  assert.ok(
    !titlesFor(afterDelete).includes('PTA General Meeting'),
    'deleted events disappear from the calendars'
  );
  assert.ok(titlesFor(afterDelete).includes('Independence Day (Public Holiday)'));

  const missingDelete = await admin.request('/api/superadmin/events/987654321', { method: 'DELETE' });
  assert.equal(missingDelete.status, 404);

  const teacherDelete = await teacher.request(`/api/superadmin/events/${examId}`, { method: 'DELETE' });
  assert.equal(teacherDelete.status, 403);

  // ---------- UI WIRING ----------
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'superadmin.html'), 'utf8');
  for (const id of [
    'sec-events',
    'school-event-form',
    'school-event-id',
    'sev-title',
    'sev-type',
    'sev-start',
    'sev-end',
    'sev-audience',
    'sev-colour',
    'sev-description',
    'school-events-tbody',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `superadmin.html must contain #${id}`);
  }
  assert.match(html, /data-section="events"/);
  assert.match(html, /School Events/);
  assert.match(html, /PTA Meeting/);
  assert.match(html, /Exam Week/);

  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'superadmin.js'), 'utf8');
  assert.match(js, /\/api\/superadmin\/events/);
  assert.match(js, /data-edit-sev=/);
  assert.match(js, /data-del-sev=/);
  assert.match(js, /clearCalendarCache/);

  const common = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'common.js'), 'utf8');
  assert.match(common, /cal-dot-custom/);

  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.sev-colour-chip \{/);
  assert.match(css, /\.cal-dot-school_event \{/);

  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '015_school_events.sql'),
    'utf8'
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS school_events/);
});

test('28. Messaging & notification bell: Superadmin to everyone, teacher to classes, student to teacher', async () => {
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  const teacher = new SessionClient();
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  const student = new SessionClient();
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');
  const finance = new SessionClient();
  await finance.login('finance@school.edu.gh', 'Finance@2026!');

  const adminId = (await admin.request('/api/auth/session')).json.user.id;
  const teacherUserId = (await teacher.request('/api/auth/session')).json.user.id;
  const studentUserId = (await student.request('/api/auth/session')).json.user.id;

  // ---------- RECIPIENT OPTIONS ARE ROLE-SCOPED ----------
  const adminOptions = (await admin.request('/api/messages/recipients')).json;
  assert.ok(
    (adminOptions.options || []).some((o) => o.type === 'all'),
    'only the Superadmin gets the "Everyone" audience'
  );
  assert.equal(adminOptions.canBroadcast, true);

  const teacherOptions = (await teacher.request('/api/messages/recipients')).json;
  assert.ok(
    !(teacherOptions.options || []).some((o) => o.type === 'all'),
    'teachers cannot broadcast to everyone'
  );
  assert.equal(teacherOptions.canBroadcast, false);

  const studentOptions = (await student.request('/api/messages/recipients')).json;
  assert.ok((studentOptions.options || []).length > 0, 'students must have at least one teacher to message');
  assert.ok(
    (studentOptions.options || []).every((o) => o.type === 'user'),
    'students may only message individual teachers/admins'
  );

  // ---------- SUPERADMIN -> EVERYONE ----------
  const broadcast = await admin.request('/api/messages/threads', {
    method: 'POST',
    body: {
      subject: 'School reopens Monday',
      body: 'All staff, teachers and students should report by 7:30am.',
      audienceType: 'all',
      audienceValue: '',
    },
  });
  assert.equal(broadcast.status, 201);
  assert.ok(broadcast.json.recipients >= 3, 'the broadcast must reach several accounts');
  const broadcastId = broadcast.json.threadId;

  for (const [name, client] of [['teacher', teacher], ['student', student], ['finance', finance]]) {
    const unread = (await client.request('/api/messages/unread')).json;
    assert.equal(unread.unreadThreads, 1, `${name} must have one unread notification`);
    assert.equal(unread.items[0].subject, 'School reopens Monday');
    assert.equal(unread.items[0].unreadCount, 1);
  }

  // Sender does not see their own message as unread
  const adminUnread = (await admin.request('/api/messages/unread')).json;
  assert.equal(adminUnread.unreadThreads, 0, 'the sender has no unread notification from their own message');

  // ---------- TEACHER REPLIES IN THE THREAD ----------
  const teacherInbox = (await teacher.request('/api/messages/threads')).json;
  assert.equal(teacherInbox.unreadThreads, 1);
  assert.equal(teacherInbox.items[0].subject, 'School reopens Monday');

  const opened = await teacher.request(`/api/messages/threads/${broadcastId}`);
  assert.equal(opened.status, 200);
  assert.equal(opened.json.thread.id, broadcastId);
  assert.equal(opened.json.messages.length, 1);
  assert.equal(opened.json.messages[0].senderName, 'Superadmin');

  const afterRead = (await teacher.request('/api/messages/unread')).json;
  assert.equal(afterRead.unreadThreads, 0, 'opening a conversation clears its unread badge');

  const reply = await teacher.request(`/api/messages/threads/${broadcastId}/reply`, {
    method: 'POST',
    body: { body: 'Noted, thank you.' },
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.json.messages.length, 2);

  const adminAfterReply = (await admin.request('/api/messages/unread')).json;
  assert.equal(adminAfterReply.unreadThreads, 1, 'the admin is notified about the reply');
  assert.match(adminAfterReply.items[0].lastSender, /Kofi Mensah/);

  // ---------- TEACHER -> THEIR CLASS ----------
  const teacherClasses = (await teacher.request('/api/messages/recipients')).json.options.filter(
    (o) => o.type === 'class'
  );
  assert.ok(teacherClasses.length > 0, 'the teacher must have at least one assigned class');
  const classMessage = await teacher.request('/api/messages/threads', {
    method: 'POST',
    body: {
      subject: 'Maths test on Friday',
      body: 'Please revise chapter 3 and 4.',
      audienceType: 'class',
      audienceValue: teacherClasses[0].value,
    },
  });
  assert.equal(classMessage.status, 201);
  assert.ok(classMessage.json.recipients >= 1);
  const classThreadId = classMessage.json.threadId;

  const studentUnread = (await student.request('/api/messages/unread')).json;
  assert.ok(
    studentUnread.items.some((i) => i.subject === 'Maths test on Friday'),
    'students in the addressed class receive the class message'
  );

  // A teacher may not message a class they do not teach
  const allClasses = (await admin.request('/api/superadmin/academic')).json.classes || [];
  const foreignClass = allClasses.find(
    (c) => !teacherClasses.some((t) => String(t.value) === String(c.id))
  );
  if (foreignClass) {
    const notMine = await teacher.request('/api/messages/threads', {
      method: 'POST',
      body: {
        subject: 'Wrong class',
        body: 'Should be rejected.',
        audienceType: 'class',
        audienceValue: String(foreignClass.id),
      },
    });
    assert.equal(notMine.status, 403);
  }

  // ---------- STUDENT -> TEACHER ----------
  const studentTargets = (await student.request('/api/messages/recipients')).json.options;
  const teacherOption = studentTargets.find((o) => String(o.value) === String(teacherUserId));
  assert.ok(teacherOption, 'the student must be able to message one of their teachers');

  const toTeacher = await student.request('/api/messages/threads', {
    method: 'POST',
    body: {
      subject: 'Question about homework',
      body: 'Please could you explain question 4 again?',
      audienceType: teacherOption.type,
      audienceValue: teacherOption.value,
    },
  });
  assert.equal(toTeacher.status, 201);
  const studentThreadId = toTeacher.json.threadId;

  const teacherUnread2 = (await teacher.request('/api/messages/unread')).json;
  assert.ok(
    teacherUnread2.items.some((i) => i.subject === 'Question about homework'),
    'the teacher is notified about the student message'
  );

  // A student cannot address the whole school or another student
  const illegalBroadcast = await student.request('/api/messages/threads', {
    method: 'POST',
    body: { subject: 'Nope', body: 'Should be rejected.', audienceType: 'all', audienceValue: '' },
  });
  assert.equal(illegalBroadcast.status, 403);

  const toSelf = await student.request('/api/messages/threads', {
    method: 'POST',
    body: {
      subject: 'Me',
      body: 'Should be rejected.',
      audienceType: 'user',
      audienceValue: String(studentUserId),
    },
  });
  assert.equal(toSelf.status, 400);

  // ---------- ATTACHMENTS REUSE THE MEDIA PIPELINE ----------
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082',
    'hex'
  );
  const fd = new FormData();
  fd.append('subject', 'Timetable attached');
  fd.append('body', 'Please find the new timetable attached.');
  fd.append('audienceType', 'user');
  fd.append('audienceValue', String(teacherUserId));
  fd.append('attachments', new Blob([png], { type: 'image/png' }), 'timetable.png');
  const withFile = await admin.request('/api/messages/threads', { method: 'POST', body: fd });
  assert.equal(withFile.status, 201);
  const fileThreadId = withFile.json.threadId;

  const fileThread = (await teacher.request(`/api/messages/threads/${fileThreadId}`)).json;
  const attachments = fileThread.messages[0].attachments || [];
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].originalName, 'timetable.png');
  assert.equal(attachments[0].mediaKind, 'image');

  const mediaRes = await teacher.request(attachments[0].url);
  assert.equal(mediaRes.status, 200);

  // Non-participants cannot stream the attachment
  const outsiderMedia = await finance.request(attachments[0].url);
  assert.equal(outsiderMedia.status, 403);

  // A non-participant cannot open or reply to the thread
  const outsiderOpen = await finance.request(`/api/messages/threads/${studentThreadId}`);
  assert.equal(outsiderOpen.status, 404);
  const outsiderReply = await finance.request(`/api/messages/threads/${studentThreadId}/reply`, {
    method: 'POST',
    body: { body: 'Not my conversation.' },
  });
  assert.equal(outsiderReply.status, 404);

  // ---------- VALIDATION & SECURITY ----------
  const emptyBody = await admin.request('/api/messages/threads', {
    method: 'POST',
    body: { subject: 'Empty', body: '   ', audienceType: 'all', audienceValue: '' },
  });
  assert.equal(emptyBody.status, 400);

  const noCsrf = await admin.request('/api/messages/threads', {
    method: 'POST',
    body: { subject: 'No csrf', body: 'Should fail.', audienceType: 'all', audienceValue: '' },
    sendCsrf: false,
  });
  assert.equal(noCsrf.status, 403);

  const anon = new SessionClient();
  const anonUnread = await anon.request('/api/messages/unread');
  assert.equal(anonUnread.status, 401);

  // ---------- MARK READ ----------
  const readAll = await student.request('/api/messages/read-all', { method: 'POST' });
  assert.equal(readAll.status, 200);
  const studentCleared = (await student.request('/api/messages/unread')).json;
  assert.equal(studentCleared.unreadThreads, 0);

  const markOne = await student.request(`/api/messages/threads/${classThreadId}/read`, {
    method: 'POST',
  });
  assert.equal(markOne.status, 200);

  // ---------- UI WIRING ----------
  for (const view of ['superadmin', 'teacher', 'student', 'financial']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', `${view}.html`), 'utf8');
    for (const id of [
      'msg-bell-btn',
      'msg-bell-badge',
      'msg-bell-panel',
      'msg-bell-list',
      'msg-bell-open',
      'msg-bell-read-all',
      'sec-messages',
      'msg-compose-form',
      'msg-audience',
      'msg-body',
      'msg-files',
      'msg-thread-list',
      'msg-conversation',
    ]) {
      assert.match(html, new RegExp(`id="${id}"`), `${view}.html must contain #${id}`);
    }
    assert.match(html, /data-section="messages"/, `${view}.html needs the Messages nav entry`);

    const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', `${view}.js`), 'utf8');
    assert.match(js, /initMessageBell\(\)/, `${view}.js must initialise the bell`);
    assert.match(js, /initMessaging\(\)/, `${view}.js must initialise the inbox`);
  }

  const common = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'common.js'), 'utf8');
  assert.match(common, /\/api\/messages\/unread/);
  assert.match(common, /initMessageBell/);
  assert.match(common, /initMessaging/);
  assert.match(common, /msg-bell-panel/);

  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.msg-bell-btn \{/);
  assert.match(css, /\.msg-layout \{/);
});

test('29. Printable per-term report cards with class position, grading & remarks, plus one-click class rollover', async () => {
  const admin = new SessionClient();
  await admin.login('admin@school.edu.gh', 'Admin@2026!');
  const teacher = new SessionClient();
  await teacher.login('kofi.mensah@school.edu.gh', 'Teacher@2026!');
  const student = new SessionClient();
  await student.login('kwame.asante@student.school.edu.gh', 'Student@2026!');

  const acad = (await admin.request('/api/superadmin/academic')).json;
  const years = acad.years || [];
  const terms = acad.terms || [];
  const classes = acad.classes || [];
  const activeYear = years.find((y) => y.is_active) || years[0];
  const activeTerm = terms.find((t) => t.is_active && t.academic_year_id === activeYear.id) || terms[0];

  // The seeded class that actually has students enrolled
  let targetClass = null;
  for (const c of classes) {
    const list = (await admin.request(`/api/superadmin/students?classId=${c.id}`)).json;
    if ((list.items || []).length >= 2) {
      targetClass = c;
      break;
    }
  }
  assert.ok(targetClass, 'the demo data must include a class with at least two enrolled students');

  // Publish a fresh, deterministic set of results in the active term so the report
  // card maths does not depend on whichever term earlier tests left active.
  const teacherOverview = (await teacher.request('/api/teacher/overview')).json;
  const pairing = (teacherOverview.assignments || []).find(
    (a) => Number(a.class_id) === Number(targetClass.id)
  );
  assert.ok(pairing, 'the demo teacher must be assigned to the target class');

  const classRoster = (await admin.request(`/api/superadmin/students?classId=${targetClass.id}`)).json;
  const roster = (classRoster.items || []).slice(0, 2);
  assert.equal(roster.length, 2);

  const assessment = await teacher.request('/api/teacher/assessments', {
    method: 'POST',
    body: {
      title: 'Report Card Deterministic Exam',
      assessmentType: 'final_exam',
      classId: targetClass.id,
      subjectId: pairing.subject_id,
      maxScore: 100,
      weightPercent: 100,
      scheduledDate: `${new Date().getFullYear()}-01-15`,
    },
  });
  assert.equal(assessment.status, 201);
  const assessmentId = assessment.json.assessment?.id || assessment.json.id;

  const marks = await teacher.request(`/api/teacher/assessments/${assessmentId}/marks`, {
    method: 'POST',
    body: {
      entries: [
        { studentId: roster[0].id, score: 92 },
        { studentId: roster[1].id, score: 64 },
      ],
    },
  });
  assert.equal(marks.status, 200);

  const published = await admin.request(`/api/superadmin/exams/assessments/${assessmentId}/publish`, {
    method: 'PATCH',
    body: { isPublished: true },
  });
  assert.equal(published.status, 200);

  // ---------- GENERATE ----------
  const generated = await admin.request('/api/superadmin/reports/report-cards/generate', {
    method: 'POST',
    body: { classId: targetClass.id, academicYearId: activeYear.id, termId: activeTerm.id },
  });
  assert.equal(generated.status, 200);
  assert.ok(generated.json.generated >= 2, 'report cards must be generated for the whole class');
  assert.match(generated.json.message, /report card/i);

  const listed = (
    await admin.request(
      `/api/superadmin/reports/report-cards?classId=${targetClass.id}&academicYearId=${activeYear.id}&termId=${activeTerm.id}`
    )
  ).json;
  assert.ok(listed.items.length >= 2);
  assert.ok(listed.years.length >= 1, 'the endpoint exposes academic years for the selectors');
  assert.ok(listed.terms.length >= 1, 'the endpoint exposes terms for the selectors');

  // The two students we just marked must be ranked 1st and 2nd on their results
  const scoredIds = new Set(roster.map((r) => Number(r.id)));
  const sorted = [...listed.items].sort((a, b) => a.classPosition - b.classPosition);
  assert.equal(sorted[0].classPosition, 1);
  assert.equal(sorted[0].classSize, listed.items.length);
  assert.ok(
    sorted[0].overallAverage >= sorted[1].overallAverage,
    'position 1 must hold the highest average'
  );
  for (const card of sorted) {
    assert.ok(card.overallGrade, 'a card must carry an overall grade');
    assert.ok(card.studentName && card.admissionNumber);
    if (card.subjectsCount >= 1) {
      assert.ok(card.overallAverage > 0, 'a card with results must carry a computed average');
    }
  }
  const scored = sorted.filter((c) => c.subjectsCount >= 1);
  assert.ok(scored.length >= 2, 'at least two demo students have published results');
  assert.ok(
    scored.every((c) => c.overallAverage > 0 && c.gpa > 0),
    'scored cards carry an average and a GPA'
  );
  assert.ok(
    scored.slice(0, 2).every((c) => scoredIds.has(Number(c.studentId))),
    'the two marked students hold the top two positions'
  );
  assert.ok(
    scored[0].overallAverage > scored[1].overallAverage,
    'the higher mark ranks above the lower mark'
  );

  // ---------- SINGLE CARD ----------
  const topStudentId = sorted[0].studentId;
  const card = (
    await admin.request(
      `/api/superadmin/reports/report-cards/student/${topStudentId}?academicYearId=${activeYear.id}&termId=${activeTerm.id}`
    )
  ).json;
  assert.equal(card.reportCard.classPosition, 1);
  assert.equal(card.reportCard.classSize, listed.items.length);
  assert.ok(card.reportCard.subjects.length >= 1);
  assert.ok(card.gradingScales.length >= 1, 'the grading scale ships with the card for printing');
  assert.equal(card.reportCard.academicYear.name, activeYear.name);
  assert.equal(card.reportCard.term.name, activeTerm.name);
  assert.ok(card.reportCard.student.admission_number);

  // The unpublished draft assessment must not leak into a report card
  assert.ok(
    !card.reportCard.subjects.some((s) => /Draft/i.test(s.subjectName)),
    'unpublished assessments are excluded from report cards'
  );

  const missingCard = await admin.request(
    `/api/superadmin/reports/report-cards/student/${topStudentId}?academicYearId=${activeYear.id}&termId=999999`
  );
  assert.equal(missingCard.status, 404, 'an unknown period is rejected');

  const missingStudentCard = await admin.request(
    `/api/superadmin/reports/report-cards/student/987654321?academicYearId=${activeYear.id}&termId=${activeTerm.id}`
  );
  assert.equal(missingStudentCard.status, 404);

  // ---------- REMARKS ----------
  const remark = await admin.request('/api/superadmin/reports/report-cards/remark', {
    method: 'POST',
    body: {
      studentId: topStudentId,
      academicYearId: activeYear.id,
      termId: activeTerm.id,
      teacherRemark: 'Excellent result, keep it up.',
      headteacherRemark: 'A brilliant performance this term.',
    },
  });
  assert.equal(remark.status, 200);
  assert.equal(remark.json.teacherRemark, 'Excellent result, keep it up.');
  assert.equal(remark.json.headteacherRemark, 'A brilliant performance this term.');

  const withRemark = (
    await admin.request(
      `/api/superadmin/reports/report-cards/student/${topStudentId}?academicYearId=${activeYear.id}&termId=${activeTerm.id}`
    )
  ).json;
  assert.equal(withRemark.reportCard.teacherRemark, 'Excellent result, keep it up.');
  assert.equal(withRemark.reportCard.headteacherRemark, 'A brilliant performance this term.');

  // ---------- TEACHER ACCESS ----------
  const teacherList = (
    await teacher.request(
      `/api/teacher/report-cards?classId=${targetClass.id}&academicYearId=${activeYear.id}&termId=${activeTerm.id}`
    )
  ).json;
  assert.equal(teacherList.items.length, listed.items.length, 'the teacher sees their class cards');

  const teacherRemark = await teacher.request('/api/teacher/report-cards/remark', {
    method: 'POST',
    body: {
      studentId: topStudentId,
      academicYearId: activeYear.id,
      termId: activeTerm.id,
      teacherRemark: 'Consistent hard work all term.',
    },
  });
  assert.equal(teacherRemark.status, 200);
  assert.equal(teacherRemark.json.teacherRemark, 'Consistent hard work all term.');

  const headByTeacher = await teacher.request('/api/teacher/report-cards/remark', {
    method: 'POST',
    body: {
      studentId: topStudentId,
      academicYearId: activeYear.id,
      termId: activeTerm.id,
      headteacherRemark: 'Signed off by head teacher.',
    },
  });
  assert.equal(headByTeacher.status, 403, 'only the Superadmin signs the head teacher remark');

  const teacherClassIds = new Set(
    (teacherOverview.assignments || []).map((a) => Number(a.class_id))
  );
  const unassignedClass = classes.find((c) => !teacherClassIds.has(Number(c.id)));
  if (unassignedClass) {
    const foreignList = await teacher.request(
      `/api/teacher/report-cards?classId=${unassignedClass.id}&academicYearId=${activeYear.id}&termId=${activeTerm.id}`
    );
    assert.equal(foreignList.status, 403, 'teachers only see their assigned classes');
  }

  // ---------- STUDENT ACCESS ----------
  const studentCards = (await student.request('/api/student/report-cards')).json;
  assert.ok(
    (studentCards.items || []).length >= 1,
    'students can list their own published report cards'
  );
  const ownCard = (studentCards.items || [])[0];
  const studentCardView = (
    await student.request(
      `/api/student/report-cards/view?academicYearId=${ownCard.academicYearId}&termId=${ownCard.termId}`
    )
  ).json;
  assert.equal(studentCardView.reportCard.studentId, ownCard.id === undefined ? studentCardView.reportCard.studentId : studentCardView.reportCard.studentId);
  assert.ok(studentCardView.reportCard.student.first_name);
  assert.ok(Array.isArray(studentCardView.gradingScales));

  const teacherStudentCard = await teacher.request(
    `/api/teacher/report-cards/student/${topStudentId}?academicYearId=${activeYear.id}&termId=${activeTerm.id}`
  );
  assert.equal(teacherStudentCard.status, 200, 'teachers can open a card for their own students');

  // ---------- SECURITY ----------
  const noCsrf = await admin.request('/api/superadmin/reports/report-cards/generate', {
    method: 'POST',
    body: { classId: targetClass.id, academicYearId: activeYear.id, termId: activeTerm.id },
    sendCsrf: false,
  });
  assert.equal(noCsrf.status, 403);

  const teacherGenerate = await teacher.request('/api/superadmin/reports/report-cards/generate', {
    method: 'POST',
    body: { classId: targetClass.id, academicYearId: activeYear.id, termId: activeTerm.id },
  });
  assert.equal(teacherGenerate.status, 403);

  const studentGenerate = await student.request('/api/superadmin/reports/report-cards/generate', {
    method: 'POST',
    body: { classId: targetClass.id, academicYearId: activeYear.id, termId: activeTerm.id },
  });
  assert.equal(studentGenerate.status, 403);

  const anon = new SessionClient();
  const anonCards = await anon.request('/api/student/report-cards');
  assert.equal(anonCards.status, 401);

  // ---------- END-OF-TERM / END-OF-YEAR ROLLOVER ----------
  const nextYear = await admin.request('/api/superadmin/academic/years', {
    method: 'POST',
    body: { name: '2027/2028', startDate: '2027-09-06', endDate: '2028-07-21' },
  });
  assert.equal(nextYear.status, 201);
  const nextYearId = nextYear.json.year?.id || nextYear.json.academicYear?.id || nextYear.json.id;
  assert.ok(Number(nextYearId) > 0, 'the created academic year must expose an id');

  const nextTerm = await admin.request('/api/superadmin/academic/terms', {
    method: 'POST',
    body: {
      name: 'Term 1',
      academicYearId: nextYearId,
      startDate: '2027-09-06',
      endDate: '2027-12-17',
    },
  });
  assert.equal(nextTerm.status, 201);
  const nextTermId = nextTerm.json.term?.id || nextTerm.json.id;
  assert.ok(Number(nextTermId) > 0, 'the created term must expose an id');

  // Roll the whole class into the new year/term, same class level
  const rollover = await admin.request('/api/superadmin/reports/promote-class', {
    method: 'POST',
    body: {
      classId: targetClass.id,
      fromAcademicYearId: activeYear.id,
      fromTermId: activeTerm.id,
      toAcademicYearId: nextYearId,
      toTermId: nextTermId,
      promoteToNextClass: false,
    },
  });
  assert.equal(rollover.status, 200);
  assert.ok(rollover.json.moved >= 2, 'every enrolled student is rolled over');
  assert.equal(rollover.json.toClassId, targetClass.id);

  const rolledStudents = (await admin.request(`/api/superadmin/students?classId=${targetClass.id}`)).json;
  const rolledIds = new Set(
    (rolledStudents.items || []).map((s) => Number(s.academic_year_id)).filter((v) => Number.isInteger(v))
  );
  assert.ok(rolledIds.has(Number(nextYearId)), 'students are now enrolled in the target academic year');

  const promoteMissing = await admin.request('/api/superadmin/reports/promote-class', {
    method: 'POST',
    body: {
      classId: 987654321,
      toAcademicYearId: nextYearId,
      toTermId: nextTermId,
      fromAcademicYearId: activeYear.id,
      fromTermId: activeTerm.id,
    },
  });
  assert.equal(promoteMissing.status, 404);

  const promoteNoCsrf = await admin.request('/api/superadmin/reports/promote-class', {
    method: 'POST',
    body: {
      classId: targetClass.id,
      toAcademicYearId: nextYearId,
      toTermId: nextTermId,
      fromAcademicYearId: activeYear.id,
      fromTermId: activeTerm.id,
    },
    sendCsrf: false,
  });
  assert.equal(promoteNoCsrf.status, 403);

  // Promote to the next class level (Grade 10 -> Grade 11)
  const nextLevel = await admin.request('/api/superadmin/reports/promote-class', {
    method: 'POST',
    body: {
      classId: targetClass.id,
      fromAcademicYearId: activeYear.id,
      fromTermId: activeTerm.id,
      toAcademicYearId: nextYearId,
      toTermId: nextTermId,
      promoteToNextClass: true,
    },
  });
  assert.equal(nextLevel.status, 200);
  assert.notEqual(nextLevel.json.toClassId, targetClass.id, 'students move up a class level');
  assert.ok(/promoted/i.test(nextLevel.json.message));

  // ---------- UI WIRING ----------
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'superadmin.html'), 'utf8');
  for (const id of [
    'sec-report-cards',
    'rc-generate-form',
    'rc-gen-class',
    'rc-gen-year',
    'rc-gen-term',
    'rc-list-class',
    'rc-list-year',
    'rc-list-term',
    'rc-list-tbody',
    'rc-promote-form',
    'rc-promote-class',
    'rc-promote-to-year',
    'rc-promote-to-term',
    'rc-promote-next-class',
  ]) {
    assert.match(adminHtml, new RegExp(`id="${id}"`), `superadmin.html must contain #${id}`);
  }
  assert.match(adminHtml, /data-section="report-cards"/);

  const teacherHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'teacher.html'), 'utf8');
  for (const id of ['sec-report-cards', 'trc-class', 'trc-year', 'trc-term', 'trc-tbody']) {
    assert.match(teacherHtml, new RegExp(`id="${id}"`), `teacher.html must contain #${id}`);
  }
  assert.match(teacherHtml, /data-section="report-cards"/);

  const studentHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'student.html'), 'utf8');
  for (const id of ['sec-report-cards', 'src-tbody', 'src-refresh-btn']) {
    assert.match(studentHtml, new RegExp(`id="${id}"`), `student.html must contain #${id}`);
  }
  assert.match(studentHtml, /data-section="report-cards"/);

  const common = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'js', 'common.js'), 'utf8');
  assert.match(common, /buildReportCardHtml/);
  assert.match(common, /printReportCardHtml/);
  assert.match(common, /rc-sheet/);

  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'public', 'css', 'styles.css'), 'utf8');
  assert.match(css, /\.rc-sheet \{/);
  assert.match(css, /\.rc-table \{/);

  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '017_report_cards_and_rollover.sql'),
    'utf8'
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS report_cards/);
});

test('Test 30: hosted database config uses TLS for remote hosts and never silently degrades', () => {
  const envPath = require.resolve('../src/config/environment');
  const originalModule = require.cache[envPath];
  const saved = {
    DB_DRIVER: process.env.DB_DRIVER,
    DB_HOST: process.env.DB_HOST,
    DB_SSL: process.env.DB_SSL,
    DB_SSL_REJECT_UNAUTHORIZED: process.env.DB_SSL_REJECT_UNAUTHORIZED,
    DB_AUTO_FALLBACK: process.env.DB_AUTO_FALLBACK,
  };

  // Blank every key first: an unset variable would otherwise be refilled by dotenv from .env
  const loadEnv = (vars) => {
    for (const key of Object.keys(saved)) process.env[key] = '';
    Object.assign(process.env, vars);
    delete require.cache[envPath];
    return require('../src/config/environment');
  };

  try {
    // Hosted endpoints (TiDB Cloud, Aiven, Railway, PlanetScale, Cloud SQL) are TLS-only
    assert.deepEqual(
      loadEnv({ DB_HOST: 'gateway01.eu-central-1.prod.aws.tidbcloud.com' }).db.ssl,
      { rejectUnauthorized: true },
      'remote database hosts must negotiate TLS by default'
    );

    // Loopback and private-network hosts stay plain text
    assert.equal(loadEnv({ DB_HOST: '127.0.0.1' }).db.ssl, null);
    assert.equal(loadEnv({ DB_HOST: '10.0.0.5' }).db.ssl, null);

    // Explicit overrides win in both directions
    assert.equal(loadEnv({ DB_HOST: 'db.school.example', DB_SSL: 'false' }).db.ssl, null);
    assert.deepEqual(
      loadEnv({
        DB_HOST: 'db.school.example',
        DB_SSL: 'true',
        DB_SSL_REJECT_UNAUTHORIZED: 'false',
      }).db.ssl,
      { rejectUnauthorized: false }
    );

    // A production deployment pinned to MySQL must fail loudly rather than fall back to an
    // ephemeral SQLite file, otherwise sessions and records vanish between instances.
    assert.equal(loadEnv({ DB_DRIVER: 'mysql' }).db.autoFallback, false);
    assert.equal(loadEnv({ DB_DRIVER: 'mysql', DB_AUTO_FALLBACK: 'false' }).db.autoFallback, false);
    assert.equal(loadEnv({ DB_DRIVER: 'mysql', DB_AUTO_FALLBACK: 'true' }).db.autoFallback, true);
    assert.equal(loadEnv({ DB_DRIVER: 'sqlite' }).db.autoFallback, true);
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    require.cache[envPath] = originalModule;
    delete require.cache[envPath];
    require('../src/config/environment');
    require.cache[envPath] = originalModule;
  }

  const dbSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'database.js'), 'utf8');
  assert.match(dbSource, /ssl: env\.db\.ssl/, 'the MySQL pool must forward the resolved TLS config');
  assert.match(dbSource, /connectTimeout/, 'the MySQL pool must fail fast with a connect timeout');

  const envSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'config', 'environment.js'), 'utf8');
  assert.match(envSource, /resolveMysqlSsl/);
});
