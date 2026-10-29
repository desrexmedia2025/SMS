const bcrypt = require('bcryptjs');
const db = require('../config/database');
const systemModel = require('../models/system.model');
const academicModel = require('../models/academic.model');
const financialService = require('./financial.service');
const analyticsService = require('./analytics.service');
const { isCurrentlyLocked } = require('./auth.service');
const { recordAudit } = require('./audit.service');
const { AppError } = require('../middleware/errorHandler');
const { resolveCurrency } = require('../utils/currency');
const { parsePagination, buildPaginatedResult } = require('../utils/pagination');

async function getOverview() {
  const context = await systemModel.getSchoolContext();
  const [
    studentsCnt,
    teachersCnt,
    classesCnt,
    usersCnt,
    pendingMarkCorr,
    pendingProfReq,
    pendingStuReq,
    attSummary,
    managedFinance,
    recentAudits,
    announcements,
    analytics,
  ] = await Promise.all([
    db.get("SELECT COUNT(*) AS cnt FROM students WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS cnt FROM teachers WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS cnt FROM classes WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS cnt FROM users WHERE status = 'active'"),
    db.get("SELECT COUNT(*) AS cnt FROM mark_correction_requests WHERE status = 'pending'"),
    db.get("SELECT COUNT(*) AS cnt FROM profile_change_requests WHERE status = 'pending'"),
    db.get("SELECT COUNT(*) AS cnt FROM student_registration_requests WHERE status = 'pending'"),
    db.get(
      `SELECT
         COUNT(*) AS total_records,
         SUM(CASE WHEN status IN ('present', 'late') THEN 1 ELSE 0 END) AS present_records
       FROM attendance_records`
    ),
    financialService.computeManagedFinancialMetrics(context.settings),
    db.query(
      `SELECT al.*, u.full_name AS actor_name
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.actor_user_id
       ORDER BY al.id DESC LIMIT 10`
    ),
    systemModel.listAnnouncementsForAudience(['all', 'superadmin', 'teachers', 'students', 'financial', 'class']),
    analyticsService.getSiteAnalytics({ days: 14 }),
  ]);

  const totalAtt = Number(attSummary?.total_records || 0);
  const presentAtt = Number(attSummary?.present_records || 0);
  const attendanceRate = totalAtt > 0 ? Math.round((presentAtt / totalAtt) * 1000) / 10 : 100;

  return {
    ...context,
    metrics: {
      activeStudents: Number(studentsCnt?.cnt || 0),
      activeTeachers: Number(teachersCnt?.cnt || 0),
      activeClasses: Number(classesCnt?.cnt || 0),
      activeUsers: Number(usersCnt?.cnt || 0),
      attendanceRate,
      pendingMarkCorrections: Number(pendingMarkCorr?.cnt || 0),
      pendingProfileRequests: Number(pendingProfReq?.cnt || 0),
      pendingStudentRequests: Number(pendingStuReq?.cnt || 0),
      finance: {
        netBilled: managedFinance.netBilled,
        collected: managedFinance.totalCollected,
        outstanding: managedFinance.totalOutstanding,
        collectionRate: managedFinance.collectionRate,
        paystackCollected: managedFinance.paystackCollected,
        termRevenueTarget: managedFinance.termRevenueTarget,
        targetAttainmentRate: managedFinance.targetAttainmentRate,
        treasuryPosition: managedFinance.treasuryPosition,
      },
    },
    recentAudits,
    announcements,
    analytics,
  };
}

// ---------------- USERS & ROLES ----------------
async function listUsers(query = {}) {
  const { page, limit, offset } = parsePagination(query, { page: 1, limit: 25, maxLimit: 100 });
  const params = [];
  let where = 'WHERE 1=1';

  if (query.role) {
    where += ' AND r.slug = ?';
    params.push(String(query.role).trim());
  }
  if (query.status) {
    where += ' AND u.status = ?';
    params.push(String(query.status).trim());
  }
  if (query.search) {
    const q = `%${String(query.search).trim().toLowerCase()}%`;
    where += ' AND (LOWER(u.full_name) LIKE ? OR LOWER(u.email) LIKE ? OR LOWER(u.username) LIKE ?)';
    params.push(q, q, q);
  }

  const countRow = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     ${where}`,
    params
  );

  const items = await db.query(
    `SELECT
       u.id, u.username, u.email, u.full_name, u.phone, u.status,
       u.email_verified, u.auth_provider, u.google_subject_id,
       u.failed_login_attempts, u.locked_until, u.last_login_at, u.created_at,
       r.slug AS role, r.name AS role_name
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     ${where}
     ORDER BY u.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const roles = await db.query('SELECT id, slug, name, description FROM roles ORDER BY id ASC');
  return {
    ...buildPaginatedResult(
      items.map((u) => ({
        ...u,
        google_linked: Boolean(u.google_subject_id),
        is_locked: isCurrentlyLocked(u.locked_until),
        google_subject_id: undefined,
        locked_until: undefined,
      })),
      countRow?.cnt || 0,
      { page, limit }
    ),
    roles,
  };
}

async function createUserAccount({
  username,
  email,
  fullName,
  phone,
  password,
  roleSlug,
  staffNumber,
  department,
  qualification,
  subjectIds,
  customSubjects,
  actor,
  ipAddress,
}) {
  const role = await db.get('SELECT id, slug FROM roles WHERE slug = ?', [roleSlug]);
  if (!role) throw new AppError(400, 'Invalid role selected.');

  const existing = await db.get(
    'SELECT id FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?',
    [email.toLowerCase(), username.toLowerCase()]
  );
  if (existing) throw new AppError(409, 'A user with that email or username already exists.');

  const hash = await bcrypt.hash(password, 10);
  const result = await db.withTransaction(async (tx) => {
    const ins = await tx.run(
      `INSERT INTO users (username, email, password_hash, full_name, phone, status, email_verified, auth_provider)
       VALUES (?, ?, ?, ?, ?, 'active', 1, 'local')`,
      [username.toLowerCase(), email.toLowerCase(), hash, fullName, phone || '']
    );
    await tx.run('INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)', [
      ins.insertId,
      role.id,
      actor.id,
    ]);

    let teacherId = null;
    let resolvedSubjects = [];
    if (roleSlug === 'teacher') {
      const nameParts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || 'Teacher';
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'Staff';
      let resolvedStaffNo = staffNumber && String(staffNumber).trim();
      if (!resolvedStaffNo) {
        resolvedStaffNo = `STF-${new Date().getFullYear()}-${String(ins.insertId).padStart(3, '0')}`;
        while (await tx.get('SELECT id FROM teachers WHERE staff_number = ?', [resolvedStaffNo])) {
          resolvedStaffNo = `STF-${new Date().getFullYear()}-${ins.insertId}${Math.floor(10 + Math.random() * 89)}`;
        }
      } else {
        const dupStaff = await tx.get('SELECT id FROM teachers WHERE staff_number = ?', [resolvedStaffNo]);
        if (dupStaff) throw new AppError(409, 'Staff number already exists.');
      }

      resolvedSubjects = await resolveOrCreateSubjects(tx, {
        subjectIds,
        customSubjects,
        department: department || '',
      });
      const specSummary = resolvedSubjects.map((s) => s.name).join(', ').slice(0, 255);

      const tIns = await tx.run(
        `INSERT INTO teachers (user_id, staff_number, first_name, last_name, qualification, specialization, department, hire_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        [
          ins.insertId,
          resolvedStaffNo,
          firstName,
          lastName,
          qualification || '',
          specSummary,
          department || '',
          new Date().toISOString().slice(0, 10),
        ]
      );
      teacherId = tIns.insertId;
      for (const sub of resolvedSubjects) {
        await tx.run('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [
          teacherId,
          sub.id,
        ]);
      }
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'USER_CREATED',
        targetType: 'user',
        targetId: String(ins.insertId),
        ipAddress,
        metadata: {
          email: email.toLowerCase(),
          role: roleSlug,
          ...(roleSlug === 'teacher' ? { teacherId, subjects: resolvedSubjects.map((s) => s.name) } : {}),
        },
      },
      tx
    );
    return { userId: ins.insertId, teacherId, subjects: resolvedSubjects };
  });

  return {
    id: result.userId,
    teacherId: result.teacherId || undefined,
    subjects: result.roleSlug === 'teacher' || result.subjects.length ? result.subjects : undefined,
    username: username.toLowerCase(),
    email: email.toLowerCase(),
    role: roleSlug,
  };
}

async function updateUserRoleOrStatus({ targetUserId, roleSlug, status, newPassword, actor, ipAddress }) {
  const target = await db.get('SELECT id, email FROM users WHERE id = ?', [targetUserId]);
  if (!target) throw new AppError(404, 'User not found.');
  if (target.id === actor.id && status && status !== 'active') {
    throw new AppError(400, 'You cannot deactivate your own active Superadmin session.');
  }

  await db.withTransaction(async (tx) => {
    if (status) {
      await tx.run('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        status,
        targetUserId,
      ]);
      if (status !== 'active') {
        await tx.run('DELETE FROM user_sessions WHERE user_id = ?', [targetUserId]);
      }
    }

    if (roleSlug) {
      const role = await tx.get('SELECT id FROM roles WHERE slug = ?', [roleSlug]);
      if (!role) throw new AppError(400, 'Invalid role.');
      if (target.id === actor.id && roleSlug !== 'superadmin') {
        throw new AppError(400, 'You cannot remove your own Superadmin role.');
      }
      await tx.run('DELETE FROM user_roles WHERE user_id = ?', [targetUserId]);
      await tx.run('INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)', [
        targetUserId,
        role.id,
        actor.id,
      ]);
    }

    if (newPassword && String(newPassword).trim().length >= 8) {
      const hash = await bcrypt.hash(String(newPassword).trim(), 10);
      await tx.run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
        hash,
        targetUserId,
      ]);
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'USER_ACCESS_UPDATED',
        targetType: 'user',
        targetId: String(targetUserId),
        ipAddress,
        metadata: { roleSlug, status, passwordReset: Boolean(newPassword) },
      },
      tx
    );
  });
}

// ---------------- ACADEMIC STRUCTURE ----------------
async function getAcademicSetup() {
  const [years, terms, classes, subjects, gradingScales] = await Promise.all([
    db.query('SELECT * FROM academic_years ORDER BY id DESC'),
    db.query(
      `SELECT tr.*, ay.name AS academic_year_name
       FROM terms tr
       INNER JOIN academic_years ay ON ay.id = tr.academic_year_id
       ORDER BY tr.id ASC`
    ),
    db.query('SELECT * FROM classes ORDER BY level_order ASC, name ASC'),
    db.query('SELECT * FROM subjects ORDER BY code ASC'),
    db.query('SELECT * FROM grading_scales ORDER BY min_score DESC'),
  ]);
  return { years, terms, classes, subjects, gradingScales };
}

async function createAcademicYear({ name, startDate, endDate, isActive, actor, ipAddress }) {
  return db.withTransaction(async (tx) => {
    const existingActive = await tx.get('SELECT id FROM academic_years WHERE is_active = 1 LIMIT 1');
    const shouldActivate = Boolean(isActive || !existingActive);
    if (shouldActivate) {
      await tx.run('UPDATE academic_years SET is_active = 0');
    }
    const ins = await tx.run(
      'INSERT INTO academic_years (name, start_date, end_date, is_active, status) VALUES (?, ?, ?, ?, ?)',
      [name, startDate, endDate, shouldActivate ? 1 : 0, 'active']
    );
    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'ACADEMIC_YEAR_CREATED',
        targetType: 'academic_year',
        targetId: String(ins.insertId),
        ipAddress,
        metadata: { name, isActive: shouldActivate },
      },
      tx
    );
    return { id: ins.insertId, isActive: shouldActivate };
  });
}

async function createTerm({ academicYearId, name, startDate, endDate, isActive, actor, ipAddress }) {
  return db.withTransaction(async (tx) => {
    const existingActiveTerm = await tx.get('SELECT id FROM terms WHERE is_active = 1 LIMIT 1');
    const shouldActivate = Boolean(isActive || !existingActiveTerm);
    if (shouldActivate) {
      await tx.run('UPDATE terms SET is_active = 0');
    }
    const ins = await tx.run(
      'INSERT INTO terms (academic_year_id, name, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?)',
      [academicYearId, name, startDate, endDate, shouldActivate ? 1 : 0]
    );
    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'TERM_CREATED',
        targetType: 'term',
        targetId: String(ins.insertId),
        ipAddress,
        metadata: { academicYearId, name, isActive: shouldActivate },
      },
      tx
    );
    return { id: ins.insertId, isActive: shouldActivate };
  });
}

async function activatePeriod({ academicYearId, termId, actor, ipAddress }) {
  await db.withTransaction(async (tx) => {
    if (academicYearId) {
      await tx.run('UPDATE academic_years SET is_active = 0');
      await tx.run('UPDATE academic_years SET is_active = 1 WHERE id = ?', [academicYearId]);
    }
    if (termId) {
      await tx.run('UPDATE terms SET is_active = 0');
      await tx.run('UPDATE terms SET is_active = 1 WHERE id = ?', [termId]);
    }
    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'ACTIVE_ACADEMIC_PERIOD_CHANGED',
        targetType: 'academic_period',
        targetId: `${academicYearId || ''}:${termId || ''}`,
        ipAddress,
      },
      tx
    );
  });
}

async function createClass({ name, levelOrder, capacity, actor, ipAddress }) {
  const ins = await db.run(
    'INSERT INTO classes (name, level_order, capacity, status) VALUES (?, ?, ?, ?)',
    [name, levelOrder, capacity, 'active']
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'CLASS_CREATED',
    targetType: 'class',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { name },
  });
  return { id: ins.insertId };
}

async function createSubject({ code, name, department, isElective, passMark, maxMark, actor, ipAddress }) {
  const finalCode =
    code && String(code).trim()
      ? String(code).trim().toUpperCase()
      : await generateUniqueSubjectCode(db, name);
  const ins = await db.run(
    `INSERT INTO subjects (code, name, department, is_elective, pass_mark, max_mark, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [finalCode, name, department || '', isElective ? 1 : 0, passMark ?? 50, maxMark ?? 100]
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'SUBJECT_CREATED',
    targetType: 'subject',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { code: finalCode, name },
  });
  return { id: ins.insertId, code: finalCode };
}

// ---------------- TEACHERS & ASSIGNMENTS ----------------
function parseSubjectIdList(raw) {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0)));
  }
  if (typeof raw === 'string' && raw.trim()) {
    return Array.from(
      new Set(
        raw
          .split(',')
          .map((v) => Number(v.trim()))
          .filter((n) => Number.isInteger(n) && n > 0)
      )
    );
  }
  if (Number.isInteger(Number(raw)) && Number(raw) > 0) {
    return [Number(raw)];
  }
  return [];
}

function parseCustomSubjectNames(raw) {
  const items = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const cleaned = String(item || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

async function generateUniqueSubjectCode(tx, subjectName) {
  const words = String(subjectName || '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let prefix = 'SUB';
  if (words.length === 1) {
    prefix = words[0].slice(0, 4).padEnd(3, 'X');
  } else if (words.length >= 2) {
    prefix = words.map((w) => w[0]).join('').slice(0, 4);
    if (prefix.length < 3) {
      prefix = (words[0].slice(0, 2) + words[1].slice(0, 2)).slice(0, 4);
    }
  }
  let candidate = `${prefix}101`;
  let suffix = 101;
  while (await tx.get('SELECT id FROM subjects WHERE UPPER(code) = ?', [candidate])) {
    suffix += 1;
    candidate = `${prefix}${suffix}`;
  }
  return candidate;
}

async function resolveOrCreateSubjects(tx, { subjectIds = [], customSubjects = [], department = '' }) {
  const parsedIds = parseSubjectIdList(subjectIds);
  const parsedNames = parseCustomSubjectNames(customSubjects);
  const resolvedMap = new Map();

  for (const sid of parsedIds) {
    const row = await tx.get('SELECT id, code, name, department FROM subjects WHERE id = ?', [sid]);
    if (!row) throw new AppError(400, `Selected subject (#${sid}) was not found.`);
    resolvedMap.set(Number(row.id), row);
  }

  for (const customName of parsedNames) {
    const existing = await tx.get(
      'SELECT id, code, name, department FROM subjects WHERE LOWER(name) = ? OR LOWER(code) = ? LIMIT 1',
      [customName.toLowerCase(), customName.toLowerCase()]
    );
    if (existing) {
      resolvedMap.set(Number(existing.id), existing);
      continue;
    }
    const autoCode = await generateUniqueSubjectCode(tx, customName);
    const ins = await tx.run(
      `INSERT INTO subjects (code, name, department, is_elective, pass_mark, max_mark, status)
       VALUES (?, ?, ?, 0, 50, 100, 'active')`,
      [autoCode, customName, department || '']
    );
    resolvedMap.set(Number(ins.insertId), {
      id: Number(ins.insertId),
      code: autoCode,
      name: customName,
      department: department || '',
    });
  }

  return Array.from(resolvedMap.values());
}

async function listTeachers(query = {}) {
  const [teachers, teacherSubjectRows, assignments] = await Promise.all([
    db.query(
      `SELECT
         t.*,
         u.username, u.email, u.phone, u.status AS user_status
       FROM teachers t
       INNER JOIN users u ON u.id = t.user_id
       ORDER BY t.id DESC`
    ),
    db.query(
      `SELECT
         ts.teacher_id,
         s.id, s.code, s.name, s.department
       FROM teacher_subjects ts
       INNER JOIN subjects s ON s.id = ts.subject_id
       ORDER BY s.code ASC, s.name ASC`
    ),
    db.query(
      `SELECT
         ta.*,
         t.first_name, t.last_name, t.staff_number,
         c.name AS class_name,
         sub.code AS subject_code, sub.name AS subject_name,
         ay.name AS academic_year_name
       FROM teacher_assignments ta
       INNER JOIN teachers t ON t.id = ta.teacher_id
       INNER JOIN classes c ON c.id = ta.class_id
       INNER JOIN subjects sub ON sub.id = ta.subject_id
       INNER JOIN academic_years ay ON ay.id = ta.academic_year_id
       ORDER BY ta.id DESC`
    ),
  ]);

  const byTeacher = new Map();
  for (const row of teacherSubjectRows) {
    const tid = Number(row.teacher_id);
    if (!byTeacher.has(tid)) byTeacher.set(tid, new Map());
    byTeacher.get(tid).set(Number(row.id), {
      id: Number(row.id),
      code: row.code,
      name: row.name,
      department: row.department || '',
    });
  }
  for (const asg of assignments) {
    const tid = Number(asg.teacher_id);
    if (!byTeacher.has(tid)) byTeacher.set(tid, new Map());
    const sid = Number(asg.subject_id);
    if (!byTeacher.get(tid).has(sid)) {
      byTeacher.get(tid).set(sid, {
        id: sid,
        code: asg.subject_code,
        name: asg.subject_name,
        department: '',
      });
    }
  }

  let enrichedTeachers = teachers.map((t) => {
    const subMap = byTeacher.get(Number(t.id));
    const subjects = subMap ? Array.from(subMap.values()) : [];
    return {
      ...t,
      subjects,
      subjectIds: subjects.map((s) => s.id),
    };
  });

  if (query.search) {
    const q = String(query.search).trim().toLowerCase();
    if (q) {
      enrichedTeachers = enrichedTeachers.filter((t) => {
        const subNames = (t.subjects || []).map((s) => `${s.code || ''} ${s.name || ''}`).join(' ');
        const haystack = [
          t.staff_number,
          t.first_name,
          t.last_name,
          `${t.first_name || ''} ${t.last_name || ''}`,
          t.email,
          t.username,
          t.department,
          t.specialization,
          subNames,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      });
    }
  }

  return { teachers: enrichedTeachers, assignments };
}

async function createTeacher({
  staffNumber,
  firstName,
  lastName,
  email,
  phone,
  password,
  qualification,
  specialization,
  department,
  hireDate,
  subjectIds,
  customSubjects,
  classIds,
  actor,
  ipAddress,
}) {
  let resolvedStaffNo = staffNumber ? String(staffNumber).trim() : '';
  if (resolvedStaffNo) {
    const existingStaff = await db.get('SELECT id FROM teachers WHERE staff_number = ?', [resolvedStaffNo]);
    if (existingStaff) throw new AppError(409, 'Staff number already exists.');
  } else {
    const yr = new Date().getFullYear();
    const countRow = await db.get('SELECT COUNT(*) AS cnt FROM teachers');
    let seq = Number(countRow?.cnt || 0) + 1;
    resolvedStaffNo = `STF-${yr}-${String(seq).padStart(3, '0')}`;
    while (await db.get('SELECT id FROM teachers WHERE staff_number = ?', [resolvedStaffNo])) {
      seq += 1;
      resolvedStaffNo = `STF-${yr}-${String(seq).padStart(3, '0')}`;
    }
  }
  const existingEmail = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
  if (existingEmail) throw new AppError(409, 'Email address is already in use.');

  const role = await db.get("SELECT id FROM roles WHERE slug = 'teacher'");
  const hash = await bcrypt.hash(password || 'Teacher@2026!', 10);
  const baseUsername = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9.]/g, '') + '.' + Date.now().toString().slice(-4);

  return db.withTransaction(async (tx) => {
    const resolvedSubjects = await resolveOrCreateSubjects(tx, {
      subjectIds,
      customSubjects,
      department,
    });
    const subjectNamesSummary = resolvedSubjects.map((s) => s.name).join(', ');
    const effectiveSpecialization =
      (specialization && String(specialization).trim()) || subjectNamesSummary || '';

    const uRes = await tx.run(
      `INSERT INTO users (username, email, password_hash, full_name, phone, status, email_verified, auth_provider)
       VALUES (?, ?, ?, ?, ?, 'active', 1, 'local')`,
      [baseUsername, email.toLowerCase(), hash, `${firstName} ${lastName}`, phone || '']
    );
    await tx.run('INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)', [
      uRes.insertId,
      role.id,
      actor.id,
    ]);
    const tRes = await tx.run(
      `INSERT INTO teachers (user_id, staff_number, first_name, last_name, qualification, specialization, department, hire_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        uRes.insertId,
        resolvedStaffNo,
        firstName,
        lastName,
        qualification || '',
        effectiveSpecialization.slice(0, 255),
        department || '',
        hireDate || new Date().toISOString().slice(0, 10),
      ]
    );

    for (const sub of resolvedSubjects) {
      await tx.run('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [
        tRes.insertId,
        sub.id,
      ]);
    }

    // Optional class auto-assignment during registration if classes were selected and an active year exists
    const parsedClassIds = parseSubjectIdList(classIds);
    if (parsedClassIds.length > 0 && resolvedSubjects.length > 0) {
      const ensured = await systemModel.ensureActiveAcademicPeriod(tx);
      for (const cid of parsedClassIds) {
        const clsRow = await tx.get('SELECT id FROM classes WHERE id = ?', [cid]);
        if (!clsRow) continue;
        for (const sub of resolvedSubjects) {
          const key = `${tRes.insertId}:${cid}:0:${sub.id}:${ensured.yearId}`;
          const exists = await tx.get('SELECT id FROM teacher_assignments WHERE assignment_key = ?', [key]);
          if (!exists) {
            await tx.run(
              `INSERT INTO teacher_assignments (teacher_id, class_id, subject_id, academic_year_id, term_id, assignment_key)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [tRes.insertId, cid, sub.id, ensured.yearId, ensured.termId || null, key]
            );
          }
        }
      }
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'TEACHER_ENROLLED',
        targetType: 'teacher',
        targetId: String(tRes.insertId),
        ipAddress,
        metadata: {
          staffNumber: resolvedStaffNo,
          email: email.toLowerCase(),
          subjects: resolvedSubjects.map((s) => s.name),
        },
      },
      tx
    );
    return {
      teacherId: tRes.insertId,
      userId: uRes.insertId,
      username: baseUsername,
      email: email.toLowerCase(),
      role: 'teacher',
      subjects: resolvedSubjects,
    };
  });
}

async function updateTeacherSubjects({ teacherId, subjectIds, customSubjects, specialization, actor, ipAddress }) {
  const teacher = await db.get('SELECT * FROM teachers WHERE id = ?', [teacherId]);
  if (!teacher) throw new AppError(404, 'Teacher record not found.');

  return db.withTransaction(async (tx) => {
    const resolvedSubjects = await resolveOrCreateSubjects(tx, {
      subjectIds,
      customSubjects,
      department: teacher.department || '',
    });

    await tx.run('DELETE FROM teacher_subjects WHERE teacher_id = ?', [teacherId]);
    for (const sub of resolvedSubjects) {
      await tx.run('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [
        teacherId,
        sub.id,
      ]);
    }

    const summary = resolvedSubjects.map((s) => s.name).join(', ');
    const nextSpecialization =
      specialization !== undefined && String(specialization).trim()
        ? String(specialization).trim().slice(0, 255)
        : summary.slice(0, 255);

    await tx.run('UPDATE teachers SET specialization = ? WHERE id = ?', [nextSpecialization, teacherId]);

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'TEACHER_SUBJECTS_UPDATED',
        targetType: 'teacher',
        targetId: String(teacherId),
        ipAddress,
        metadata: {
          staffNumber: teacher.staff_number,
          subjects: resolvedSubjects.map((s) => s.name),
        },
      },
      tx
    );

    return {
      teacherId: Number(teacherId),
      subjects: resolvedSubjects,
      specialization: nextSpecialization,
    };
  });
}

async function assignTeacher({
  teacherId,
  classId,
  classIds,
  applyToAllClasses,
  subjectId,
  subjectIds,
  academicYearId,
  termId,
  actor,
  ipAddress,
}) {
  let resolvedYearId = academicYearId;
  let resolvedTermId = termId;
  if (!resolvedYearId || !resolvedTermId) {
    const ensured = await systemModel.ensureActiveAcademicPeriod();
    resolvedYearId = resolvedYearId || ensured.yearId;
    resolvedTermId = resolvedTermId || ensured.termId;
  }

  let targetClassIds = [];
  if (applyToAllClasses === true || applyToAllClasses === 'true' || applyToAllClasses === '1' || applyToAllClasses === 1) {
    const allCls = await db.query("SELECT id FROM classes WHERE status = 'active' ORDER BY level_order ASC, id ASC");
    targetClassIds = allCls.map((c) => Number(c.id));
  } else {
    targetClassIds = parseSubjectIdList(
      Array.isArray(classIds) && classIds.length > 0 ? classIds : classId
    );
  }
  if (!targetClassIds.length) {
    throw new AppError(400, 'Please select at least one class to assign.');
  }

  const targetSubjectIds = parseSubjectIdList(
    Array.isArray(subjectIds) && subjectIds.length > 0 ? subjectIds : subjectId
  );
  if (!targetSubjectIds.length) {
    throw new AppError(400, 'Please select at least one subject to assign.');
  }

  return db.withTransaction(async (tx) => {
    const createdIds = [];
    let skippedCount = 0;

    for (const cid of targetClassIds) {
      const clsRow = await tx.get('SELECT id FROM classes WHERE id = ?', [cid]);
      if (!clsRow) throw new AppError(400, `Class #${cid} not found.`);

      for (const sid of targetSubjectIds) {
        const subRow = await tx.get('SELECT id FROM subjects WHERE id = ?', [sid]);
        if (!subRow) throw new AppError(400, `Subject #${sid} not found.`);

        const linked = await tx.get(
          'SELECT id FROM teacher_subjects WHERE teacher_id = ? AND subject_id = ?',
          [teacherId, sid]
        );
        if (!linked) {
          await tx.run('INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)', [
            teacherId,
            sid,
          ]);
        }

        const key = `${teacherId}:${cid}:0:${sid}:${resolvedYearId}`;
        const existing = await tx.get('SELECT id FROM teacher_assignments WHERE assignment_key = ?', [key]);
        if (existing) {
          skippedCount += 1;
          continue;
        }

        const ins = await tx.run(
          `INSERT INTO teacher_assignments (teacher_id, class_id, subject_id, academic_year_id, term_id, assignment_key)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [teacherId, cid, sid, resolvedYearId, resolvedTermId || null, key]
        );
        createdIds.push(ins.insertId);
      }
    }

    if (createdIds.length === 0) {
      throw new AppError(
        409,
        targetSubjectIds.length === 1 && targetClassIds.length === 1
          ? 'This teacher is already assigned to that class and subject.'
          : 'This teacher is already assigned to all selected classes and subjects.'
      );
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'TEACHER_ASSIGNED',
        targetType: 'teacher_assignment',
        targetId: String(createdIds[0]),
        ipAddress,
        metadata: { teacherId, classIds: targetClassIds, subjectIds: targetSubjectIds, createdIds },
      },
      tx
    );

    return {
      id: createdIds[0],
      ids: createdIds,
      assignedCount: createdIds.length,
      classIds: targetClassIds,
      skippedCount,
    };
  });
}

// ---------------- STUDENTS & ENROLMENTS ----------------
async function listStudents(query = {}) {
  const { page, limit, offset } = parsePagination(query, { page: 1, limit: 25, maxLimit: 100 });
  const params = [];
  let where = 'WHERE 1=1';

  if (query.classId) {
    where += ' AND se.class_id = ?';
    params.push(Number(query.classId));
  }
  if (query.status) {
    where += ' AND s.status = ?';
    params.push(String(query.status));
  }
  if (query.search) {
    const q = `%${String(query.search).trim().toLowerCase()}%`;
    where +=
      ' AND (LOWER(s.first_name) LIKE ? OR LOWER(s.last_name) LIKE ? OR LOWER(s.admission_number) LIKE ? OR LOWER(u.email) LIKE ?)';
    params.push(q, q, q, q);
  }

  const countRow = await db.get(
    `SELECT COUNT(*) AS cnt
     FROM students s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN student_enrolments se ON se.student_id = s.id
     ${where}`,
    params
  );

  const items = await db.query(
    `SELECT
       s.*,
       u.email, u.username, u.phone, u.status AS user_status,
       se.class_id, se.roll_number, se.academic_year_id,
       c.name AS class_name
     FROM students s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN student_enrolments se ON se.student_id = s.id
     LEFT JOIN classes c ON c.id = se.class_id
     ${where}
     ORDER BY s.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return buildPaginatedResult(items, countRow?.cnt || 0, { page, limit });
}

async function enrolStudent({
  admissionNumber,
  firstName,
  lastName,
  email,
  password,
  gender,
  dateOfBirth,
  guardianName,
  guardianPhone,
  guardianEmail,
  address,
  classId,
  academicYearId,
  termId,
  rollNumber,
  actor,
  ipAddress,
}) {
  let resolvedAdmNo = admissionNumber ? String(admissionNumber).trim() : '';
  if (resolvedAdmNo) {
    const existingAdm = await db.get('SELECT id FROM students WHERE admission_number = ?', [resolvedAdmNo]);
    if (existingAdm) throw new AppError(409, 'Admission number is already assigned to another student.');
  } else {
    const yr = new Date().getFullYear();
    const countRow = await db.get('SELECT COUNT(*) AS cnt FROM students');
    let seq = Number(countRow?.cnt || 0) + 1;
    resolvedAdmNo = `ADM-${yr}-${String(seq).padStart(3, '0')}`;
    while (await db.get('SELECT id FROM students WHERE admission_number = ?', [resolvedAdmNo])) {
      seq += 1;
      resolvedAdmNo = `ADM-${yr}-${String(seq).padStart(3, '0')}`;
    }
  }
  const existingEmail = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', [email.toLowerCase()]);
  if (existingEmail) throw new AppError(409, 'Email address is already in use.');

  const role = await db.get("SELECT id FROM roles WHERE slug = 'student'");
  const hash = await bcrypt.hash(password || 'Student@2026!', 10);
  const username = resolvedAdmNo.toLowerCase().replace(/[^a-z0-9.-]/g, '');

  return db.withTransaction(async (tx) => {
    const uRes = await tx.run(
      `INSERT INTO users (username, email, password_hash, full_name, phone, status, email_verified, auth_provider)
       VALUES (?, ?, ?, ?, ?, 'active', 1, 'local')`,
      [username, email.toLowerCase(), hash, `${firstName} ${lastName}`, guardianPhone || '']
    );
    await tx.run('INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)', [
      uRes.insertId,
      role.id,
      actor.id,
    ]);
    const sRes = await tx.run(
      `INSERT INTO students (user_id, admission_number, first_name, last_name, gender, date_of_birth, guardian_name, guardian_phone, guardian_email, address, enrollment_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        uRes.insertId,
        resolvedAdmNo,
        firstName,
        lastName,
        gender || '',
        dateOfBirth || '',
        guardianName || '',
        guardianPhone || '',
        guardianEmail || '',
        address || '',
        new Date().toISOString().slice(0, 10),
      ]
    );

    let resolvedYearId = academicYearId;
    let resolvedTermId = termId;
    if (classId && (!resolvedYearId || !resolvedTermId)) {
      const ensured = await systemModel.ensureActiveAcademicPeriod(tx);
      resolvedYearId = resolvedYearId || ensured.yearId;
      resolvedTermId = resolvedTermId || ensured.termId;
    }

    if (classId && resolvedYearId) {
      await tx.run(
        `INSERT INTO student_enrolments (student_id, class_id, academic_year_id, term_id, roll_number, status)
         VALUES (?, ?, ?, ?, ?, 'enrolled')`,
        [sRes.insertId, classId, resolvedYearId, resolvedTermId || null, rollNumber || '']
      );
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'STUDENT_ENROLLED',
        targetType: 'student',
        targetId: String(sRes.insertId),
        ipAddress,
        metadata: { admissionNumber: resolvedAdmNo, classId },
      },
      tx
    );
    return {
      studentId: sRes.insertId,
      userId: uRes.insertId,
      username,
      email: email.toLowerCase(),
    };
  });
}

// ---------------- TIMETABLES ----------------
async function listTimetables(query = {}) {
  const params = [];
  let where = 'WHERE 1=1';
  if (query.classId) {
    where += ' AND tt.class_id = ?';
    params.push(Number(query.classId));
  }
  return db.query(
    `SELECT
       tt.*,
       c.name AS class_name,
       sub.code AS subject_code, sub.name AS subject_name,
       u.full_name AS teacher_name
     FROM timetables tt
     INNER JOIN classes c ON c.id = tt.class_id
     INNER JOIN subjects sub ON sub.id = tt.subject_id
     INNER JOIN teachers t ON t.id = tt.teacher_id
     INNER JOIN users u ON u.id = t.user_id
     ${where}
     ORDER BY tt.day_of_week ASC, tt.start_time ASC`,
    params
  );
}

async function createTimetableSlot({
  academicYearId,
  termId,
  classId,
  subjectId,
  teacherId,
  dayOfWeek,
  startTime,
  endTime,
  room,
  actor,
  ipAddress,
}) {
  let resolvedYearId = academicYearId;
  let resolvedTermId = termId;
  if (!resolvedYearId || !resolvedTermId) {
    const ensured = await systemModel.ensureActiveAcademicPeriod();
    resolvedYearId = resolvedYearId || ensured.yearId;
    resolvedTermId = resolvedTermId || ensured.termId;
  }

  if (startTime >= endTime) {
    throw new AppError(400, 'Start time must be earlier than end time.');
  }

  // Conflict check: teacher cannot be double-booked on same day & overlapping time
  const teacherConflict = await db.get(
    `SELECT id FROM timetables
     WHERE academic_year_id = ? AND day_of_week = ? AND teacher_id = ?
       AND start_time < ? AND end_time > ?
     LIMIT 1`,
    [resolvedYearId, dayOfWeek, teacherId, endTime, startTime]
  );
  if (teacherConflict) {
    throw new AppError(409, 'Schedule conflict: that teacher already has an overlapping class on that day.');
  }

  // Conflict check: class cannot have overlapping lessons
  const classConflict = await db.get(
    `SELECT id FROM timetables
     WHERE academic_year_id = ? AND day_of_week = ? AND class_id = ?
       AND start_time < ? AND end_time > ?
     LIMIT 1`,
    [resolvedYearId, dayOfWeek, classId, endTime, startTime]
  );
  if (classConflict) {
    throw new AppError(409, 'Schedule conflict: that class already has an overlapping timetable entry.');
  }

  const ins = await db.run(
    `INSERT INTO timetables (academic_year_id, term_id, class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [resolvedYearId, resolvedTermId || null, classId, subjectId, teacherId, dayOfWeek, startTime, endTime, room || '']
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'TIMETABLE_SLOT_CREATED',
    targetType: 'timetable',
    targetId: String(ins.insertId),
    ipAddress,
  });
  return { id: ins.insertId };
}

// ---------------- ATTENDANCE & EXAMS OVERSIGHT ----------------
async function getAttendanceOverview() {
  const sessions = await db.query(
    `SELECT
       s.*,
       c.name AS class_name,
       sub.name AS subject_name,
       u.full_name AS taken_by_name,
       COUNT(ar.id) AS total_marked,
       SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END) AS present_count,
       SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END) AS absent_count,
       SUM(CASE WHEN ar.status = 'late' THEN 1 ELSE 0 END) AS late_count
     FROM attendance_sessions s
     INNER JOIN classes c ON c.id = s.class_id
     LEFT JOIN subjects sub ON sub.id = s.subject_id
     LEFT JOIN users u ON u.id = s.taken_by_user_id
     LEFT JOIN attendance_records ar ON ar.session_id = s.id
     GROUP BY s.id
     ORDER BY s.session_date DESC, s.id DESC
     LIMIT 50`
  );
  return { sessions };
}

async function getExamsGovernance() {
  const [assessments, gradingScales, correctionRequests, profileRequests] = await Promise.all([
    db.query(
      `SELECT
         a.*,
         c.name AS class_name,
         sub.name AS subject_name,
         tr.name AS term_name,
         u.full_name AS creator_name,
         (SELECT COUNT(*) FROM marks m WHERE m.assessment_id = a.id) AS marks_count
       FROM assessments a
       INNER JOIN classes c ON c.id = a.class_id
       INNER JOIN subjects sub ON sub.id = a.subject_id
       INNER JOIN terms tr ON tr.id = a.term_id
       LEFT JOIN users u ON u.id = a.created_by_user_id
       ORDER BY a.id DESC`
    ),
    db.query('SELECT * FROM grading_scales ORDER BY min_score DESC'),
    db.query(
      `SELECT
         mcr.*,
         a.title AS assessment_title, a.max_score,
         sub.name AS subject_name,
         s.admission_number, s.first_name, s.last_name,
         u.full_name AS requested_by_name
       FROM mark_correction_requests mcr
       INNER JOIN assessments a ON a.id = mcr.assessment_id
       INNER JOIN subjects sub ON sub.id = a.subject_id
       INNER JOIN students s ON s.id = mcr.student_id
       INNER JOIN users u ON u.id = mcr.requested_by_user_id
       ORDER BY mcr.id DESC`
    ),
    db.query(
      `SELECT
         pcr.*,
         u.full_name AS requester_name, u.email AS requester_email
       FROM profile_change_requests pcr
       INNER JOIN users u ON u.id = pcr.user_id
       ORDER BY pcr.id DESC`
    ),
  ]);
  return { assessments, gradingScales, correctionRequests, profileRequests };
}

async function createGradingScale({ grade, minScore, maxScore, gradePoint, remark, actor, ipAddress }) {
  if (Number(minScore) < 0 || Number(maxScore) > 100 || Number(minScore) > Number(maxScore)) {
    throw new AppError(400, 'Score range must be between 0 and 100 with Min Score <= Max Score.');
  }
  const existing = await db.get('SELECT id FROM grading_scales WHERE UPPER(grade) = ?', [
    grade.toUpperCase(),
  ]);
  if (existing) {
    throw new AppError(409, `Grade "${grade.toUpperCase()}" already exists in the grading scale.`);
  }
  const ins = await db.run(
    'INSERT INTO grading_scales (grade, min_score, max_score, grade_point, remark) VALUES (?, ?, ?, ?, ?)',
    [grade.toUpperCase(), Number(minScore), Number(maxScore), Number(gradePoint || 0), remark || '']
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'GRADING_SCALE_CREATED',
    targetType: 'grading_scale',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { grade: grade.toUpperCase(), minScore, maxScore },
  });
  return { id: ins.insertId };
}

async function deleteGradingScale({ scaleId, actor, ipAddress }) {
  const existing = await db.get('SELECT id, grade FROM grading_scales WHERE id = ?', [scaleId]);
  if (!existing) throw new AppError(404, 'Grading band not found.');
  await db.run('DELETE FROM grading_scales WHERE id = ?', [scaleId]);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'GRADING_SCALE_DELETED',
    targetType: 'grading_scale',
    targetId: String(scaleId),
    ipAddress,
    metadata: { grade: existing.grade },
  });
}

async function toggleAssessmentPublication({ assessmentId, isPublished, actor, ipAddress }) {
  const assess = await db.get('SELECT id, title FROM assessments WHERE id = ?', [assessmentId]);
  if (!assess) throw new AppError(404, 'Assessment not found.');

  await db.run('UPDATE assessments SET is_published = ? WHERE id = ?', [isPublished ? 1 : 0, assessmentId]);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: isPublished ? 'ASSESSMENT_PUBLISHED' : 'ASSESSMENT_UNPUBLISHED',
    targetType: 'assessment',
    targetId: String(assessmentId),
    ipAddress,
    metadata: { title: assess.title },
  });
}

async function reviewMarkCorrection({ requestId, decision, reviewNote, actor, ipAddress }) {
  const reqRow = await db.get(
    `SELECT mcr.*, a.max_score
     FROM mark_correction_requests mcr
     INNER JOIN assessments a ON a.id = mcr.assessment_id
     WHERE mcr.id = ?`,
    [requestId]
  );
  if (!reqRow) throw new AppError(404, 'Mark correction request not found.');
  if (reqRow.status !== 'pending') throw new AppError(400, 'This request has already been reviewed.');

  await db.withTransaction(async (tx) => {
    if (decision === 'approved') {
      const pct = Math.round((Number(reqRow.proposed_score) / Number(reqRow.max_score)) * 10000) / 100;
      const gradeInfo = await academicModel.resolveGradeForPercentage(pct, tx);
      await tx.run(
        `UPDATE marks
         SET score = ?, percentage = ?, grade = ?, remark = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [reqRow.proposed_score, pct, gradeInfo.grade, gradeInfo.remark, reqRow.mark_id]
      );
    }

    await tx.run(
      `UPDATE mark_correction_requests
       SET status = ?, reviewed_by_user_id = ?, review_note = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [decision, actor.id, reviewNote || '', requestId]
    );

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: `MARK_CORRECTION_${decision.toUpperCase()}`,
        targetType: 'mark_correction_request',
        targetId: String(requestId),
        ipAddress,
        metadata: {
          markId: reqRow.mark_id,
          previousScore: reqRow.previous_score,
          proposedScore: reqRow.proposed_score,
        },
      },
      tx
    );
  });
}

async function reviewProfileChangeRequest({ requestId, decision, actor, ipAddress }) {
  const reqRow = await db.get('SELECT * FROM profile_change_requests WHERE id = ?', [requestId]);
  if (!reqRow) throw new AppError(404, 'Profile change request not found.');
  if (reqRow.status !== 'pending') throw new AppError(400, 'Already processed.');

  const allowedStudentFields = new Set(['first_name', 'last_name', 'date_of_birth', 'guardian_name', 'guardian_phone', 'address']);
  await db.withTransaction(async (tx) => {
    if (decision === 'approved' && reqRow.student_id && allowedStudentFields.has(reqRow.field_name)) {
      await tx.run(`UPDATE students SET ${reqRow.field_name} = ? WHERE id = ?`, [
        reqRow.requested_value,
        reqRow.student_id,
      ]);
      if (reqRow.field_name === 'first_name' || reqRow.field_name === 'last_name') {
        const s = await tx.get('SELECT first_name, last_name, user_id FROM students WHERE id = ?', [
          reqRow.student_id,
        ]);
        if (s) {
          await tx.run('UPDATE users SET full_name = ? WHERE id = ?', [
            `${s.first_name} ${s.last_name}`,
            s.user_id,
          ]);
        }
      }
    }

    await tx.run(
      `UPDATE profile_change_requests
       SET status = ?, reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [decision, actor.id, requestId]
    );

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: `PROFILE_CHANGE_${decision.toUpperCase()}`,
        targetType: 'profile_change_request',
        targetId: String(requestId),
        ipAddress,
        metadata: { field: reqRow.field_name },
      },
      tx
    );
  });
}

// ---------------- ANNOUNCEMENTS, SETTINGS, REPORTS, AUDIT, BACKUP ----------------
async function createAnnouncement({ title, body, audience, priority, actor, ipAddress }) {
  const ins = await db.run(
    `INSERT INTO announcements (title, body, audience, priority, author_user_id, status)
     VALUES (?, ?, ?, ?, ?, 'published')`,
    [title, body, audience || 'all', priority || 'normal', actor.id]
  );
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'ANNOUNCEMENT_PUBLISHED',
    targetType: 'announcement',
    targetId: String(ins.insertId),
    ipAddress,
    metadata: { title, audience },
  });
  return { id: ins.insertId };
}

async function updateSchoolSettings(payload, actor, ipAddress) {
  const resolvedCurr = resolveCurrency(payload.currencyCode, payload.currencySymbol);
  const current = await db.get(
    `SELECT google_oauth_enabled, google_client_id, google_client_secret,
            paystack_enabled, paystack_transfers_enabled, paystack_refunds_enabled,
            paystack_public_key, paystack_secret_key, paystack_webhook_secret
     FROM school_settings WHERE id = 1`
  );
  const googleOauthEnabled =
    payload.googleOauthEnabled === undefined
      ? Boolean(current ? current.google_oauth_enabled !== 0 : true)
      : Boolean(payload.googleOauthEnabled);
  const googleClientId =
    payload.googleClientId === undefined
      ? String(current?.google_client_id || '')
      : String(payload.googleClientId || '').trim();
  const googleClientSecret = payload.clearGoogleSecret
    ? ''
    : payload.googleClientSecret && String(payload.googleClientSecret).trim()
      ? String(payload.googleClientSecret).trim()
      : String(current?.google_client_secret || '');

  const paystackEnabled =
    payload.paystackEnabled === undefined
      ? Boolean(current ? current.paystack_enabled !== 0 : true)
      : Boolean(payload.paystackEnabled);
  const paystackTransfersEnabled =
    payload.paystackTransfersEnabled === undefined
      ? Boolean(current ? current.paystack_transfers_enabled !== 0 : true)
      : Boolean(payload.paystackTransfersEnabled);
  const paystackRefundsEnabled =
    payload.paystackRefundsEnabled === undefined
      ? Boolean(current ? current.paystack_refunds_enabled !== 0 : true)
      : Boolean(payload.paystackRefundsEnabled);
  const paystackPublicKey =
    payload.paystackPublicKey === undefined
      ? String(current?.paystack_public_key || '')
      : String(payload.paystackPublicKey || '').trim();
  const paystackSecretKey = payload.clearPaystackSecret
    ? ''
    : payload.paystackSecretKey && String(payload.paystackSecretKey).trim()
      ? String(payload.paystackSecretKey).trim()
      : String(current?.paystack_secret_key || '');
  const paystackWebhookSecret = payload.clearPaystackSecret
    ? ''
    : payload.paystackWebhookSecret && String(payload.paystackWebhookSecret).trim()
      ? String(payload.paystackWebhookSecret).trim()
      : String(current?.paystack_webhook_secret || '');

  await db.run(
    `UPDATE school_settings
     SET school_name = ?,
         school_code = ?,
         motto = ?,
         email = ?,
         phone = ?,
         address = ?,
         timezone = ?,
         currency_code = ?,
         currency_symbol = ?,
         student_fee_portal_enabled = ?,
         attendance_cutoff_time = ?,
         allow_teacher_mark_edit_after_publish = ?,
         google_oauth_enabled = ?,
         google_client_id = ?,
         google_client_secret = ?,
         paystack_enabled = ?,
         paystack_transfers_enabled = ?,
         paystack_refunds_enabled = ?,
         paystack_public_key = ?,
         paystack_secret_key = ?,
         paystack_webhook_secret = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [
      payload.schoolName,
      payload.schoolCode,
      payload.motto || '',
      payload.email || '',
      payload.phone || '',
      payload.address || '',
      payload.timezone || 'Africa/Accra',
      resolvedCurr.code,
      resolvedCurr.symbol,
      payload.studentFeePortalEnabled ? 1 : 0,
      payload.attendanceCutoffTime || '08:30',
      payload.allowTeacherMarkEditAfterPublish ? 1 : 0,
      googleOauthEnabled ? 1 : 0,
      googleClientId,
      googleClientSecret,
      paystackEnabled ? 1 : 0,
      paystackTransfersEnabled ? 1 : 0,
      paystackRefundsEnabled ? 1 : 0,
      paystackPublicKey,
      paystackSecretKey,
      paystackWebhookSecret,
    ]
  );

  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'SCHOOL_SETTINGS_UPDATED',
    targetType: 'school_settings',
    targetId: '1',
    ipAddress,
    metadata: {
      currencyCode: resolvedCurr.code,
      currencySymbol: resolvedCurr.symbol,
      studentFeePortalEnabled: Boolean(payload.studentFeePortalEnabled),
      googleOauthEnabled,
      googleLiveKeysConfigured: Boolean(googleClientId && googleClientSecret),
      paystackEnabled,
      paystackTransfersEnabled,
      paystackRefundsEnabled,
      paystackSecretConfigured: Boolean(paystackSecretKey),
    },
  });

  return systemModel.getSchoolContext();
}

async function getSchoolWideReports() {
  const context = await systemModel.getSchoolContext();
  const [classPerformance, classAttendance, feeByClass] = await Promise.all([
    db.query(
      `SELECT
         c.name AS class_name,
         COUNT(DISTINCT m.student_id) AS students_assessed,
         ROUND(AVG(m.percentage), 2) AS avg_percentage
       FROM classes c
       LEFT JOIN assessments a ON a.class_id = c.id AND a.is_published = 1
       LEFT JOIN marks m ON m.assessment_id = a.id
       GROUP BY c.id, c.name
       ORDER BY c.level_order ASC`
    ),
    db.query(
      `SELECT
         c.name AS class_name,
         COUNT(ar.id) AS total_entries,
         SUM(CASE WHEN ar.status IN ('present', 'late') THEN 1 ELSE 0 END) AS attended_entries
       FROM classes c
       LEFT JOIN attendance_sessions s ON s.class_id = c.id
       LEFT JOIN attendance_records ar ON ar.session_id = s.id
       GROUP BY c.id, c.name
       ORDER BY c.level_order ASC`
    ),
    db.query(
      `SELECT
         c.name AS class_name,
         COALESCE(SUM(fa.amount_due - fa.discount_amount), 0) AS net_billed,
         COALESCE(SUM(fa.amount_paid), 0) AS collected
       FROM classes c
       LEFT JOIN student_enrolments se ON se.class_id = c.id
       LEFT JOIN fee_assignments fa ON fa.student_id = se.student_id
       GROUP BY c.id, c.name
       ORDER BY c.level_order ASC`
    ),
  ]);

  return {
    ...context,
    classPerformance,
    classAttendance,
    feeByClass,
  };
}

async function listAuditLogs(query = {}) {
  const { page, limit, offset } = parsePagination(query, { page: 1, limit: 30, maxLimit: 100 });
  const params = [];
  let where = 'WHERE 1=1';

  if (query.role) {
    where += ' AND al.actor_role = ?';
    params.push(String(query.role));
  }
  if (query.search) {
    const q = `%${String(query.search).trim().toLowerCase()}%`;
    where += ' AND (LOWER(al.action) LIKE ? OR LOWER(al.target_type) LIKE ? OR LOWER(COALESCE(u.full_name, \'\')) LIKE ?)';
    params.push(q, q, q);
  }

  const countRow = await db.get(
    `SELECT COUNT(*) AS cnt FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_user_id ${where}`,
    params
  );
  const items = await db.query(
    `SELECT al.*, u.full_name AS actor_name, u.email AS actor_email
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id
     ${where}
     ORDER BY al.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return buildPaginatedResult(items, countRow?.cnt || 0, { page, limit });
}

async function getBackupStatus() {
  const backups = await db.query(
    `SELECT bl.*, u.full_name AS created_by_name
     FROM backup_logs bl
     LEFT JOIN users u ON u.id = bl.created_by_user_id
     ORDER BY bl.id DESC
     LIMIT 20`
  );
  const health = await db.healthCheck();
  return { health, backups };
}

async function triggerBackup(actor, ipAddress) {
  const backup = await systemModel.createVerifiedBackup(actor.id);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: actor.role,
    action: 'DATABASE_BACKUP_VERIFIED',
    targetType: 'backup',
    targetId: backup.filename,
    ipAddress,
    metadata: { sizeBytes: backup.sizeBytes, totalRows: backup.totalRows },
  });
  return backup;
}

async function unlockUserAndRevokeSessions({ targetUserId, actor, ipAddress }) {
  const target = await db.get('SELECT id, email FROM users WHERE id = ?', [targetUserId]);
  if (!target) throw new AppError(404, 'User not found.');

  await db.withTransaction(async (tx) => {
    await tx.run(
      `UPDATE users
       SET failed_login_attempts = 0,
           locked_until = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [targetUserId]
    );
    if (Number(targetUserId) !== Number(actor.id)) {
      await tx.run('DELETE FROM user_sessions WHERE user_id = ?', [targetUserId]);
    }
    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'USER_UNLOCKED_SESSIONS_REVOKED',
        targetType: 'user',
        targetId: String(targetUserId),
        ipAddress,
      },
      tx
    );
  });
}

async function listStudentRegistrationRequests(query = {}) {
  const params = [];
  let where = 'WHERE 1=1';

  if (query.status) {
    where += ' AND srr.status = ?';
    params.push(String(query.status).trim().toLowerCase());
  }

  const items = await db.query(
    `SELECT
       srr.id, srr.first_name, srr.last_name, srr.email, srr.phone,
       srr.gender, srr.date_of_birth, srr.requested_class_id,
       srr.guardian_name, srr.guardian_phone, srr.auth_provider, srr.status,
       srr.admission_number, srr.approved_user_id, srr.approved_student_id,
       srr.review_note, srr.reviewed_at, srr.created_at,
       c.name AS requested_class_name,
       u.full_name AS reviewer_name
     FROM student_registration_requests srr
     LEFT JOIN classes c ON c.id = srr.requested_class_id
     LEFT JOIN users u ON u.id = srr.reviewed_by_user_id
     ${where}
     ORDER BY CASE WHEN srr.status = 'pending' THEN 0 ELSE 1 END ASC, srr.id DESC
     LIMIT 100`,
    params
  );

  return { items };
}

async function reviewStudentRegistrationRequest({
  requestId,
  decision,
  admissionNumber,
  classId,
  reviewNote,
  actor,
  ipAddress,
}) {
  const reqRow = await db.get('SELECT * FROM student_registration_requests WHERE id = ?', [requestId]);
  if (!reqRow) throw new AppError(404, 'Student join proposal not found.');
  if (reqRow.status !== 'pending') {
    throw new AppError(409, 'This student join proposal has already been reviewed.');
  }

  if (decision === 'rejected') {
    await db.run(
      `UPDATE student_registration_requests
       SET status = 'rejected',
           reviewed_by_user_id = ?,
           review_note = ?,
           reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [actor.id, reviewNote || '', requestId]
    );
    await recordAudit({
      actorUserId: actor.id,
      actorRole: actor.role,
      action: 'STUDENT_JOIN_REQUEST_REJECTED',
      targetType: 'student_registration_request',
      targetId: String(requestId),
      ipAddress,
      metadata: { email: reqRow.email, reviewNote: reviewNote || '' },
    });
    return { status: 'rejected' };
  }

  // decision === 'approved'
  const role = await db.get("SELECT id FROM roles WHERE slug = 'student'");
  if (!role) throw new AppError(500, 'Student role missing in system roles.');

  return db.withTransaction(async (tx) => {
    const existingEmail = await tx.get('SELECT id FROM users WHERE LOWER(email) = ?', [
      reqRow.email.toLowerCase(),
    ]);
    if (existingEmail) {
      throw new AppError(409, 'A user account with this email address already exists.');
    }

    if (reqRow.google_subject_id) {
      const existingGoogleSub = await tx.get(
        'SELECT id FROM users WHERE google_subject_id = ?',
        [reqRow.google_subject_id]
      );
      if (existingGoogleSub) {
        throw new AppError(409, 'That Google account is already linked to another user.');
      }
    }

    let finalAdm = String(admissionNumber || '').trim();
    if (finalAdm) {
      const existingAdm = await tx.get('SELECT id FROM students WHERE admission_number = ?', [finalAdm]);
      if (existingAdm) {
        throw new AppError(409, 'Admission number is already assigned to another student.');
      }
    } else {
      const yr = new Date().getFullYear();
      const countRow = await tx.get('SELECT COUNT(*) AS cnt FROM students');
      let seq = Number(countRow?.cnt || 0) + 1;
      let candidate = `ADM-${yr}-${String(seq).padStart(3, '0')}`;
      while (await tx.get('SELECT id FROM students WHERE admission_number = ?', [candidate])) {
        seq += 1;
        candidate = `ADM-${yr}-${String(seq).padStart(3, '0')}`;
      }
      finalAdm = candidate;
    }

    const baseUsername = finalAdm.toLowerCase().replace(/[^a-z0-9.-]/g, '') || `student.${requestId}`;
    let finalUsername = baseUsername;
    let uSeq = 1;
    while (await tx.get('SELECT id FROM users WHERE LOWER(username) = ?', [finalUsername])) {
      uSeq += 1;
      finalUsername = `${baseUsername}.${uSeq}`;
    }

    const hasLocalPw = Boolean(reqRow.password_hash && String(reqRow.password_hash).trim());
    const googleSubId = reqRow.google_subject_id || null;
    const provider = googleSubId ? (hasLocalPw ? 'both' : 'google') : 'local';

    const uRes = await tx.run(
      `INSERT INTO users (username, email, password_hash, full_name, phone, status, email_verified, google_subject_id, auth_provider)
       VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
      [
        finalUsername,
        reqRow.email.toLowerCase(),
        hasLocalPw ? reqRow.password_hash : null,
        `${reqRow.first_name} ${reqRow.last_name}`,
        reqRow.phone || reqRow.guardian_phone || '',
        googleSubId,
        provider,
      ]
    );

    await tx.run('INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)', [
      uRes.insertId,
      role.id,
      actor.id,
    ]);

    const sRes = await tx.run(
      `INSERT INTO students (user_id, admission_number, first_name, last_name, gender, date_of_birth, guardian_name, guardian_phone, enrollment_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        uRes.insertId,
        finalAdm,
        reqRow.first_name,
        reqRow.last_name,
        reqRow.gender || '',
        reqRow.date_of_birth || '',
        reqRow.guardian_name || '',
        reqRow.guardian_phone || '',
        new Date().toISOString().slice(0, 10),
      ]
    );

    const targetClassId = classId || reqRow.requested_class_id || null;
    if (targetClassId) {
      const ensured = await systemModel.ensureActiveAcademicPeriod(tx);
      await tx.run(
        `INSERT INTO student_enrolments (student_id, class_id, academic_year_id, term_id, status)
         VALUES (?, ?, ?, ?, 'enrolled')`,
        [sRes.insertId, targetClassId, ensured.yearId, ensured.termId || null]
      );
    }

    await tx.run(
      `UPDATE student_registration_requests
       SET status = 'approved',
           admission_number = ?,
           approved_user_id = ?,
           approved_student_id = ?,
           reviewed_by_user_id = ?,
           review_note = ?,
           reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [finalAdm, uRes.insertId, sRes.insertId, actor.id, reviewNote || '', requestId]
    );

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'STUDENT_JOIN_REQUEST_APPROVED',
        targetType: 'student_registration_request',
        targetId: String(requestId),
        ipAddress,
        metadata: {
          studentId: sRes.insertId,
          userId: uRes.insertId,
          admissionNumber: finalAdm,
          email: reqRow.email.toLowerCase(),
        },
      },
      tx
    );

    return {
      status: 'approved',
      studentId: sRes.insertId,
      userId: uRes.insertId,
      admissionNumber: finalAdm,
      username: finalUsername,
      email: reqRow.email.toLowerCase(),
    };
  });
}

async function getSiteAnalytics(query = {}) {
  return analyticsService.getSiteAnalytics({ days: query.days });
}

// ---------------- CENTRALISED RECORD EDITING (Students, Teachers & Staff) ----------------
async function assertUniqueEmail(email, excludeUserId) {
  const clash = await db.get(
    'SELECT id FROM users WHERE LOWER(email) = ? AND id <> ?',
    [String(email).toLowerCase(), excludeUserId]
  );
  if (clash) throw new AppError(409, 'That email address is already used by another account.');
}

async function assertUniqueUsername(username, excludeUserId) {
  const clash = await db.get(
    'SELECT id FROM users WHERE LOWER(username) = ? AND id <> ?',
    [String(username).toLowerCase(), excludeUserId]
  );
  if (clash) throw new AppError(409, 'That username is already taken by another account.');
}

async function updateStudentRecord({
  studentId,
  admissionNumber,
  firstName,
  lastName,
  email,
  phone,
  gender,
  dateOfBirth,
  guardianName,
  guardianPhone,
  guardianEmail,
  address,
  medicalNotes,
  status,
  classId,
  newPassword,
  actor,
  ipAddress,
}) {
  const student = await db.get(
    `SELECT s.*, u.id AS user_id, u.email AS user_email, u.full_name, u.phone AS user_phone
     FROM students s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
    [studentId]
  );
  if (!student) throw new AppError(404, 'Student record not found.');

  if (email && String(email).toLowerCase() !== String(student.user_email).toLowerCase()) {
    await assertUniqueEmail(email, student.user_id);
  }
  if (admissionNumber && admissionNumber !== student.admission_number) {
    const admClash = await db.get(
      'SELECT id FROM students WHERE admission_number = ? AND id <> ?',
      [admissionNumber, studentId]
    );
    if (admClash) throw new AppError(409, 'That admission number is already assigned to another student.');
  }

  const nextFirst = firstName || student.first_name;
  const nextLast = lastName || student.last_name;

  await db.withTransaction(async (tx) => {
    await tx.run(
      `UPDATE students
       SET admission_number = ?, first_name = ?, last_name = ?, gender = ?, date_of_birth = ?,
           guardian_name = ?, guardian_phone = ?, guardian_email = ?, address = ?, medical_notes = ?,
           status = ?
       WHERE id = ?`,
      [
        admissionNumber || student.admission_number,
        nextFirst,
        nextLast,
        gender === undefined ? student.gender : gender,
        dateOfBirth === undefined ? student.date_of_birth : dateOfBirth,
        guardianName === undefined ? student.guardian_name : guardianName,
        guardianPhone === undefined ? student.guardian_phone : guardianPhone,
        guardianEmail === undefined ? student.guardian_email : guardianEmail,
        address === undefined ? student.address : address,
        medicalNotes === undefined ? student.medical_notes : medicalNotes,
        status || student.status,
        studentId,
      ]
    );

    await tx.run(
      `UPDATE users
       SET email = COALESCE(?, email),
           phone = ?,
           full_name = ?,
           status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        email ? String(email).toLowerCase() : null,
        phone === undefined ? student.user_phone : phone,
        `${nextFirst} ${nextLast}`,
        status || student.status,
        student.user_id,
      ]
    );

    if (newPassword && String(newPassword).trim().length >= 8) {
      const hash = await bcrypt.hash(String(newPassword).trim(), 10);
      await tx.run(
        `UPDATE users
         SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL,
             password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [hash, student.user_id]
      );
    }

    if (classId !== undefined) {
      const existing = await tx.get(
        'SELECT id, class_id FROM student_enrolments WHERE student_id = ? ORDER BY id DESC LIMIT 1',
        [studentId]
      );
      if (existing) {
        await tx.run(
          'UPDATE student_enrolments SET class_id = ?, status = ? WHERE id = ?',
          [classId || existing.class_id, status && status !== 'active' ? 'inactive' : 'enrolled', existing.id]
        );
      } else if (classId) {
        const period = await systemModel.ensureActiveAcademicPeriod(tx);
        await tx.run(
          `INSERT INTO student_enrolments (student_id, class_id, academic_year_id, term_id, status)
           VALUES (?, ?, ?, ?, 'enrolled')`,
          [studentId, classId, period.yearId, period.termId || null]
        );
      }
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'STUDENT_RECORD_UPDATED',
        targetType: 'student',
        targetId: String(studentId),
        ipAddress,
        metadata: { admissionNumber: admissionNumber || student.admission_number, classId: classId ?? null },
      },
      tx
    );
  });

  const fresh = await db.get(
    `SELECT s.*, u.email, u.username, u.phone, u.status AS user_status,
            se.class_id, se.roll_number, c.name AS class_name
     FROM students s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN student_enrolments se ON se.student_id = s.id
     LEFT JOIN classes c ON c.id = se.class_id
     WHERE s.id = ?`,
    [studentId]
  );
  return { student: fresh, message: 'Student record updated.' };
}

async function updateTeacherRecord({
  teacherId,
  staffNumber,
  firstName,
  lastName,
  email,
  phone,
  qualification,
  specialization,
  department,
  hireDate,
  status,
  newPassword,
  actor,
  ipAddress,
}) {
  const teacher = await db.get(
    `SELECT t.*, u.id AS user_id, u.email AS user_email, u.phone AS user_phone
     FROM teachers t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.id = ?`,
    [teacherId]
  );
  if (!teacher) throw new AppError(404, 'Teacher record not found.');

  if (email && String(email).toLowerCase() !== String(teacher.user_email).toLowerCase()) {
    await assertUniqueEmail(email, teacher.user_id);
  }
  if (staffNumber && staffNumber !== teacher.staff_number) {
    const staffClash = await db.get(
      'SELECT id FROM teachers WHERE staff_number = ? AND id <> ?',
      [staffNumber, teacherId]
    );
    if (staffClash) throw new AppError(409, 'That staff number is already assigned to another teacher.');
  }

  const nextFirst = firstName || teacher.first_name;
  const nextLast = lastName || teacher.last_name;

  await db.withTransaction(async (tx) => {
    await tx.run(
      `UPDATE teachers
       SET staff_number = ?, first_name = ?, last_name = ?, qualification = ?, specialization = ?,
           department = ?, hire_date = ?, status = ?
       WHERE id = ?`,
      [
        staffNumber || teacher.staff_number,
        nextFirst,
        nextLast,
        qualification === undefined ? teacher.qualification : qualification,
        specialization === undefined ? teacher.specialization : specialization,
        department === undefined ? teacher.department : department,
        hireDate === undefined ? teacher.hire_date : hireDate,
        status || teacher.status,
        teacherId,
      ]
    );

    await tx.run(
      `UPDATE users
       SET email = COALESCE(?, email), phone = ?, full_name = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        email ? String(email).toLowerCase() : null,
        phone === undefined ? teacher.user_phone : phone,
        `${nextFirst} ${nextLast}`,
        status || teacher.status,
        teacher.user_id,
      ]
    );

    if (newPassword && String(newPassword).trim().length >= 8) {
      const hash = await bcrypt.hash(String(newPassword).trim(), 10);
      await tx.run(
        `UPDATE users
         SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL,
             password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [hash, teacher.user_id]
      );
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'TEACHER_RECORD_UPDATED',
        targetType: 'teacher',
        targetId: String(teacherId),
        ipAddress,
        metadata: { staffNumber: staffNumber || teacher.staff_number },
      },
      tx
    );
  });

  const fresh = await db.get(
    `SELECT t.*, u.username, u.email, u.phone, u.status AS user_status
     FROM teachers t
     INNER JOIN users u ON u.id = t.user_id
     WHERE t.id = ?`,
    [teacherId]
  );
  return { teacher: fresh, message: 'Teacher record updated.' };
}

async function updateStaffAccount({
  targetUserId,
  fullName,
  email,
  username,
  phone,
  roleSlug,
  status,
  newPassword,
  actor,
  ipAddress,
}) {
  const target = await db.get('SELECT * FROM users WHERE id = ?', [targetUserId]);
  if (!target) throw new AppError(404, 'User account not found.');

  if (email && String(email).toLowerCase() !== String(target.email).toLowerCase()) {
    await assertUniqueEmail(email, targetUserId);
  }
  if (username && String(username).toLowerCase() !== String(target.username).toLowerCase()) {
    await assertUniqueUsername(username, targetUserId);
  }

  await db.withTransaction(async (tx) => {
    await tx.run(
      `UPDATE users
       SET full_name = COALESCE(?, full_name),
           email = COALESCE(?, email),
           username = COALESCE(?, username),
           phone = ?,
           status = COALESCE(?, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        fullName ? String(fullName).trim() : null,
        email ? String(email).toLowerCase() : null,
        username ? String(username).trim() : null,
        phone === undefined ? target.phone : phone,
        status || null,
        targetUserId,
      ]
    );

    if (roleSlug) {
      const role = await tx.get('SELECT id FROM roles WHERE slug = ?', [roleSlug]);
      if (!role) throw new AppError(400, 'Invalid role.');
      if (target.id === actor.id && roleSlug !== 'superadmin') {
        throw new AppError(400, 'You cannot remove your own Superadmin role.');
      }
      await tx.run('DELETE FROM user_roles WHERE user_id = ?', [targetUserId]);
      await tx.run(
        'INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)',
        [targetUserId, role.id, actor.id]
      );
    }

    if (status && status !== 'active') {
      await tx.run('DELETE FROM user_sessions WHERE user_id = ?', [targetUserId]);
    }

    if (newPassword && String(newPassword).trim().length >= 8) {
      const hash = await bcrypt.hash(String(newPassword).trim(), 10);
      await tx.run(
        `UPDATE users
         SET password_hash = ?, failed_login_attempts = 0, locked_until = NULL,
             password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [hash, targetUserId]
      );
    }

    await recordAudit(
      {
        actorUserId: actor.id,
        actorRole: actor.role,
        action: 'STAFF_ACCOUNT_UPDATED',
        targetType: 'user',
        targetId: String(targetUserId),
        ipAddress,
        metadata: { roleSlug: roleSlug || null, status: status || null, passwordReset: Boolean(newPassword) },
      },
      tx
    );
  });

  const fresh = await db.get(
    `SELECT u.id, u.full_name, u.email, u.username, u.phone, u.status,
            (SELECT r.slug FROM user_roles ur INNER JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id LIMIT 1) AS role
     FROM users u
     WHERE u.id = ?`,
    [targetUserId]
  );
  return { user: fresh, message: 'Staff account updated.' };
}

module.exports = {
  getOverview,
  getSiteAnalytics,
  listUsers,
  createUserAccount,
  updateUserRoleOrStatus,
  unlockUserAndRevokeSessions,
  getAcademicSetup,
  createAcademicYear,
  createTerm,
  activatePeriod,
  createClass,
  createSubject,
  listTeachers,
  createTeacher,
  updateTeacherSubjects,
  assignTeacher,
  listStudents,
  enrolStudent,
  updateStudentRecord,
  updateTeacherRecord,
  updateStaffAccount,
  listStudentRegistrationRequests,
  reviewStudentRegistrationRequest,
  listTimetables,
  createTimetableSlot,
  getAttendanceOverview,
  getExamsGovernance,
  createGradingScale,
  deleteGradingScale,
  toggleAssessmentPublication,
  reviewMarkCorrection,
  reviewProfileChangeRequest,
  createAnnouncement,
  updateSchoolSettings,
  getSchoolWideReports,
  listAuditLogs,
  getBackupStatus,
  triggerBackup,
};
