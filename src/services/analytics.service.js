const db = require('../config/database');

function todayUtcKey() {
  return new Date().toISOString().slice(0, 10);
}

function toUtcDateKey(raw) {
  if (!raw) return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function buildDateWindow(daysInput = 14) {
  const days = Math.min(90, Math.max(7, parseInt(daysInput, 10) || 14));
  const now = new Date();
  const anchorUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const list = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const dt = new Date(anchorUtc - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    const label = `${dt.getUTCDate()} ${shortMonths[dt.getUTCMonth()]}`;
    list.push({ date: key, label });
  }
  return { days, startDate: list[0].date, endDate: list[list.length - 1].date, list };
}

async function recordSiteHit(routeKey, user = null) {
  try {
    if (!db.getActiveDriver()) return;
    const hitDate = todayUtcKey();
    const roleSlug = user?.role ? String(user.role).slice(0, 32) : null;
    const userId = user?.id ? Number(user.id) : null;
    await db.run(
      `INSERT INTO site_page_hits (route_key, role_slug, user_id, hit_date)
       VALUES (?, ?, ?, ?)`,
      [String(routeKey || 'portal').slice(0, 80), roleSlug, userId, hitDate]
    );
  } catch (_) {
    // Non-critical telemetry: never interrupt user requests
  }
}

const ACTION_LABELS = {
  LOGIN_SUCCESS: 'Signed in to the portal',
  GOOGLE_LOGIN_SUCCESS: 'Signed in with Google',
  GOOGLE_AUTO_LINKED_VERIFIED_ACCOUNT: 'Linked verified Google account',
  GOOGLE_ACCOUNT_LINKED: 'Connected Google Sign-In',
  GOOGLE_ACCOUNT_UNLINKED: 'Disconnected Google Sign-In',
  LOGOUT: 'Signed out of session',
  LOGIN_FAILED: 'Failed sign-in attempt (unknown account)',
  LOGIN_FAILED_WRONG_PASSWORD: 'Failed sign-in attempt (wrong password)',
  LOGIN_BLOCKED_ACCOUNT_LOCKED: 'Blocked sign-in on locked account',
  ACCOUNT_LOCKED_BRUTE_FORCE: 'Account temporarily locked after failed tries',
  CLASS_CREATED: 'Created a school class',
  SUBJECT_CREATED: 'Added a school subject',
  TEACHER_CREATED: 'Registered a teacher account',
  TEACHER_SUBJECTS_UPDATED: 'Updated teacher subjects',
  TEACHER_ASSIGNED: 'Assigned teacher to class & subject',
  TIMETABLE_SLOT_CREATED: 'Scheduled a timetable lesson',
  COURSEWORK_CREATED: 'Published classwork, test, or exam',
  COURSEWORK_DELETED: 'Removed published coursework item',
  COURSEWORK_SUBMISSION_SAVED: 'Submitted student coursework answer',
  COURSEWORK_SUBMISSION_GRADED: 'Graded student submission',
  ANNOUNCEMENT_PUBLISHED: 'Published an announcement',
  CLASS_ANNOUNCEMENT_PUBLISHED: 'Sent a class announcement',
  ANNOUNCEMENT_DELETED: 'Deleted an announcement',
  STUDENT_ENROLLED: 'Enrolled a student',
  STUDENT_JOIN_REQUEST_SUBMITTED: 'Submitted student join proposal',
  STUDENT_GOOGLE_JOIN_REQUEST_SUBMITTED: 'Submitted Google student join proposal',
  STUDENT_JOIN_REQUEST_APPROVED: 'Approved student join proposal',
  STUDENT_JOIN_REQUEST_REJECTED: 'Declined student join proposal',
  FEE_CATEGORY_CREATED: 'Created a fee item',
  FEE_ASSIGNED: 'Assigned fees to student(s)',
  PAYMENT_RECORDED: 'Recorded student fee payment',
  PAYSTACK_TX_INITIALIZED: 'Started Paystack checkout',
  PAYSTACK_TX_VERIFIED: 'Completed Paystack fee payment',
  PAYSTACK_TRANSFER_SENT: 'Sent outbound Paystack transfer',
  PAYMENT_REVERSED: 'Reversed a fee payment',
  CURRENCY_CHANGED: 'Switched active school currency',
  SCHOOL_SETTINGS_UPDATED: 'Updated school settings',
  USER_CREATED: 'Created a staff portal account',
  USER_UPDATED: 'Updated a portal account',
};

function humanizeAction(action) {
  const code = String(action || '').trim().toUpperCase();
  if (ACTION_LABELS[code]) return ACTION_LABELS[code];
  if (!code) return 'Portal activity';
  const cleaned = code
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
  return cleaned;
}

function classifyModule(action) {
  const a = String(action || '').toUpperCase();
  if (
    a.includes('LOGIN') ||
    a.includes('LOGOUT') ||
    a.includes('GOOGLE') ||
    a.includes('PASSWORD') ||
    a.includes('SESSION') ||
    a.includes('LOCKED')
  ) {
    return 'auth';
  }
  if (
    a.includes('COURSEWORK') ||
    a.includes('ASSESSMENT') ||
    a.includes('MARK') ||
    a.includes('GRADING')
  ) {
    return 'coursework';
  }
  if (
    a.includes('FEE') ||
    a.includes('PAYMENT') ||
    a.includes('PAYSTACK') ||
    a.includes('RECONCILIATION') ||
    a.includes('CURRENCY') ||
    a.includes('FINANCIAL')
  ) {
    return 'finance';
  }
  if (
    a.includes('CLASS') ||
    a.includes('SUBJECT') ||
    a.includes('TIMETABLE') ||
    a.includes('TEACHER') ||
    a.includes('ACADEMIC') ||
    a.includes('TERM')
  ) {
    return 'academics';
  }
  return 'community';
}

async function safeCount(sql, params = []) {
  try {
    const row = await db.get(sql, params);
    return Number(row?.cnt || 0);
  } catch (_) {
    return 0;
  }
}

async function safeQuery(sql, params = []) {
  try {
    return await db.query(sql, params);
  } catch (_) {
    return [];
  }
}

async function getSiteAnalytics(options = {}) {
  const win = buildDateWindow(options.days || 14);
  const nowMs = Date.now();
  const today = win.endDate;
  const startTimestamp = `${win.startDate} 00:00:00`;

  const [
    activeSessionRows,
    roleUserCounts,
    hitRows,
    auditRows,
    recentAudits,
    classesCount,
    subjectsCount,
    timetablesCount,
    courseworkCount,
    submissionsCount,
    mediaCount,
    paymentsCount,
    proposalsCount,
    announcementsCount,
    classBreakdownRows,
  ] = await Promise.all([
    safeQuery(
      `SELECT us.sid, us.user_id, r.slug AS role_slug
       FROM user_sessions us
       LEFT JOIN user_roles ur ON ur.user_id = us.user_id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE us.expires_at > ?`,
      [nowMs]
    ),
    safeQuery(
      `SELECT r.slug AS role_slug, COUNT(u.id) AS cnt
       FROM roles r
       LEFT JOIN user_roles ur ON ur.role_id = r.id
       LEFT JOIN users u ON u.id = ur.user_id AND u.status = 'active'
       GROUP BY r.slug`
    ),
    safeQuery(
      `SELECT route_key, role_slug, hit_date
       FROM site_page_hits
       WHERE hit_date >= ?`,
      [win.startDate]
    ),
    safeQuery(
      `SELECT action, actor_role, created_at
       FROM audit_logs
       WHERE created_at >= ?`,
      [startTimestamp]
    ),
    safeQuery(
      `SELECT al.id, al.action, al.actor_role, al.created_at, u.full_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       ORDER BY al.id DESC
       LIMIT 10`
    ),
    safeCount("SELECT COUNT(*) AS cnt FROM classes WHERE status = 'active'"),
    safeCount('SELECT COUNT(*) AS cnt FROM subjects'),
    safeCount('SELECT COUNT(*) AS cnt FROM timetables'),
    safeCount('SELECT COUNT(*) AS cnt FROM coursework_items'),
    safeCount('SELECT COUNT(*) AS cnt FROM coursework_submissions'),
    safeCount('SELECT COUNT(*) AS cnt FROM media_attachments'),
    safeCount("SELECT COUNT(*) AS cnt FROM payments WHERE status = 'completed'"),
    safeCount('SELECT COUNT(*) AS cnt FROM student_registration_requests'),
    safeCount('SELECT COUNT(*) AS cnt FROM announcements'),
    safeQuery(
      `SELECT
         c.id,
         c.name,
         (SELECT COUNT(*) FROM student_enrolments se
          JOIN students st ON st.id = se.student_id
          WHERE se.class_id = c.id AND se.status = 'enrolled' AND st.status = 'active') AS student_count,
         (SELECT COUNT(*) FROM coursework_classes cc WHERE cc.class_id = c.id) AS coursework_count
       FROM classes c
       WHERE c.status = 'active'
       ORDER BY c.level_order ASC, c.name ASC
       LIMIT 8`
    ),
  ]);

  // 1. Daily trend map across the exact N-day window
  const dayBuckets = new Map();
  for (const d of win.list) {
    dayBuckets.set(d.date, {
      date: d.date,
      label: d.label,
      views: 0,
      actions: 0,
      signIns: 0,
    });
  }

  const roleDefs = [
    { role: 'superadmin', label: 'Superadmin' },
    { role: 'teacher', label: 'Teachers' },
    { role: 'student', label: 'Students' },
    { role: 'financial', label: 'Financial' },
  ];
  const roleMap = new Map(
    roleDefs.map((r) => [
      r.role,
      {
        role: r.role,
        label: r.label,
        accounts: 0,
        activeSessions: 0,
        visits: 0,
        actions: 0,
      },
    ])
  );

  for (const row of roleUserCounts) {
    const entry = roleMap.get(String(row.role_slug || ''));
    if (entry) entry.accounts = Number(row.cnt || 0);
  }

  const onlineUserIds = new Set();
  for (const sess of activeSessionRows) {
    if (sess.user_id) onlineUserIds.add(Number(sess.user_id));
    const entry = roleMap.get(String(sess.role_slug || ''));
    if (entry) entry.activeSessions += 1;
  }

  let pageViewsPeriod = 0;
  let pageViewsToday = 0;
  let loginPageViews = 0;

  for (const hit of hitRows) {
    const dKey = toUtcDateKey(hit.hit_date);
    if (!dayBuckets.has(dKey)) continue;
    pageViewsPeriod += 1;
    if (dKey === today) pageViewsToday += 1;
    dayBuckets.get(dKey).views += 1;

    if (hit.route_key === 'login') {
      loginPageViews += 1;
    }
    const rSlug =
      hit.role_slug ||
      (String(hit.route_key || '').startsWith('dashboard:')
        ? String(hit.route_key).split(':')[1]
        : '');
    if (roleMap.has(rSlug)) {
      roleMap.get(rSlug).visits += 1;
    }
  }

  const moduleEvents = {
    auth: 0,
    academics: 0,
    coursework: 0,
    finance: 0,
    community: 0,
  };

  let signInsPeriod = 0;
  let signInsToday = 0;
  let failedLoginsPeriod = 0;
  let actionsPeriod = 0;
  let actionsToday = 0;

  for (const row of auditRows) {
    const dKey = toUtcDateKey(row.created_at);
    const act = String(row.action || '').toUpperCase();
    const bucket = dayBuckets.get(dKey);

    actionsPeriod += 1;
    if (dKey === today) actionsToday += 1;
    if (bucket) bucket.actions += 1;

    if (act === 'LOGIN_SUCCESS' || act === 'GOOGLE_LOGIN_SUCCESS') {
      signInsPeriod += 1;
      if (dKey === today) signInsToday += 1;
      if (bucket) bucket.signIns += 1;
    } else if (
      act.startsWith('LOGIN_FAILED') ||
      act.startsWith('LOGIN_BLOCKED') ||
      act.includes('BRUTE_FORCE')
    ) {
      failedLoginsPeriod += 1;
    }

    const modKey = classifyModule(act);
    moduleEvents[modKey] = (moduleEvents[modKey] || 0) + 1;

    const rEntry = roleMap.get(String(row.actor_role || ''));
    if (rEntry) rEntry.actions += 1;
  }

  // Ensure views on each day is at least signIns if actions happened purely via API before a HTML reload
  for (const b of dayBuckets.values()) {
    if (b.views === 0 && b.signIns > 0) {
      b.views = b.signIns;
      pageViewsPeriod += b.signIns;
      if (b.date === today) pageViewsToday += b.signIns;
    }
  }

  const moduleActivity = [
    {
      key: 'auth',
      label: 'Sign-Ins & Sessions',
      events: moduleEvents.auth + loginPageViews,
      records: activeSessionRows.length,
      recordLabel: `${activeSessionRows.length} live session(s)`,
    },
    {
      key: 'academics',
      label: 'Classes, Subjects & Timetable',
      events: moduleEvents.academics,
      records: classesCount + subjectsCount + timetablesCount,
      recordLabel: `${classesCount} classes, ${subjectsCount} subjects`,
    },
    {
      key: 'coursework',
      label: 'Classwork, Exams & Uploads',
      events: moduleEvents.coursework,
      records: courseworkCount + submissionsCount,
      recordLabel: `${courseworkCount} works, ${submissionsCount} submissions`,
    },
    {
      key: 'finance',
      label: 'Fees & Paystack Payments',
      events: moduleEvents.finance,
      records: paymentsCount,
      recordLabel: `${paymentsCount} completed payment(s)`,
    },
    {
      key: 'community',
      label: 'Join Proposals & Notices',
      events: moduleEvents.community,
      records: proposalsCount + announcementsCount,
      recordLabel: `${proposalsCount} proposals, ${announcementsCount} notices`,
    },
  ];

  const liveFeed = recentAudits.map((row) => ({
    id: row.id,
    actorName: row.actor_name || (row.actor_role ? row.actor_role : 'Visitor'),
    actorRole: row.actor_role || 'public',
    actionCode: row.action,
    label: humanizeAction(row.action),
    category: classifyModule(row.action),
    createdAt: row.created_at,
  }));

  return {
    windowDays: win.days,
    startDate: win.startDate,
    endDate: win.endDate,
    summary: {
      activeSessions: activeSessionRows.length,
      onlineUsers: onlineUserIds.size,
      pageViewsPeriod,
      pageViewsToday,
      signInsPeriod,
      signInsToday,
      failedLoginsPeriod,
      actionsPeriod,
      actionsToday,
      courseworkCount,
      submissionsCount,
      mediaUploadsCount: mediaCount,
      paymentsCount,
    },
    dailyTrend: Array.from(dayBuckets.values()),
    portalUsageByRole: Array.from(roleMap.values()),
    moduleActivity,
    classSnapshot: classBreakdownRows.map((c) => ({
      id: c.id,
      name: c.name,
      students: Number(c.student_count || 0),
      coursework: Number(c.coursework_count || 0),
    })),
    liveFeed,
  };
}

module.exports = {
  recordSiteHit,
  getSiteAnalytics,
};
