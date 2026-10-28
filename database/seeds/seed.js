const bcrypt = require('bcryptjs');
const db = require('../../src/config/database');
const env = require('../../src/config/environment');
const logger = require('../../src/utils/logger');
const { runMigrations } = require('../migrate');

const CORE_ROLES = [
  {
    slug: 'superadmin',
    name: 'Superadmin',
    description: 'Full school governance, users/roles, academic setup, oversight and system configuration.',
  },
  {
    slug: 'teacher',
    name: 'Teacher',
    description: 'Assigned classes, subjects, timetables, attendance, assessments and marks.',
  },
  {
    slug: 'student',
    name: 'Student',
    description: 'Own profile, timetable, attendance, published results, report cards and fee statement.',
  },
  {
    slug: 'financial',
    name: 'Financial Officer',
    description: 'Fee categories, student billing, payments, receipts, concessions, reconciliation and financial reports.',
  },
];

const CORE_PERMISSIONS = [
  ['users.manage', 'Create, update, activate/deactivate users and assign roles', ['superadmin']],
  ['school.configure', 'Manage school settings, academic years, terms, classes, subjects and grading', ['superadmin']],
  ['attendance.oversight', 'View school-wide attendance sessions and summaries', ['superadmin']],
  ['attendance.record', 'Record attendance for assigned classes and subjects', ['teacher', 'superadmin']],
  ['attendance.view_own', 'View personal student attendance record', ['student']],
  ['marks.enter', 'Create assessments and submit marks for assigned classes/subjects', ['teacher', 'superadmin']],
  ['marks.publish', 'Publish/unpublish assessments and approve mark corrections', ['superadmin']],
  ['results.view_own', 'View own published examination results and report cards', ['student']],
  ['fees.configure', 'Configure fee categories and assign student charges', ['financial', 'superadmin']],
  ['payments.record', 'Record student payments, allocate balances and issue receipts', ['financial', 'superadmin']],
  ['fees.view_own', 'View personal fee statement and receipts when enabled', ['student']],
  ['audit.view_all', 'Inspect system-wide audit logs and backups', ['superadmin']],
  ['audit.view_financial', 'Inspect financial audit logs and reconciliations', ['financial', 'superadmin']],
];

const DEFAULT_GRADING_SCALES = [
  { grade: 'A1', min_score: 80, max_score: 100, grade_point: 4.0, remark: 'Excellent' },
  { grade: 'B2', min_score: 70, max_score: 79.99, grade_point: 3.5, remark: 'Very Good' },
  { grade: 'B3', min_score: 65, max_score: 69.99, grade_point: 3.0, remark: 'Good' },
  { grade: 'C4', min_score: 60, max_score: 64.99, grade_point: 2.5, remark: 'Credit' },
  { grade: 'C5', min_score: 55, max_score: 59.99, grade_point: 2.25, remark: 'Credit' },
  { grade: 'C6', min_score: 50, max_score: 54.99, grade_point: 2.0, remark: 'Credit Pass' },
  { grade: 'D7', min_score: 45, max_score: 49.99, grade_point: 1.5, remark: 'Pass' },
  { grade: 'E8', min_score: 40, max_score: 44.99, grade_point: 1.0, remark: 'Weak Pass' },
  { grade: 'F9', min_score: 0, max_score: 39.99, grade_point: 0.0, remark: 'Fail' },
];

async function ensureCoreFoundation() {
  await runMigrations();

  // 1. School settings (clean defaults — no sample contact details)
  const existingSettings = await db.get('SELECT id FROM school_settings WHERE id = 1');
  if (!existingSettings) {
    await db.run(
      `INSERT INTO school_settings
       (id, school_name, school_code, motto, email, phone, address, timezone, currency_code, currency_symbol, student_fee_portal_enabled, attendance_cutoff_time, allow_teacher_mark_edit_after_publish)
       VALUES (1, ?, ?, '', '', '', '', ?, ?, ?, 1, '08:30', 0)`,
      [
        'School Management System',
        'SMS',
        env.defaults.timezone,
        env.defaults.currencyCode,
        env.defaults.currencySymbol,
      ]
    );
  }

  // 2. Roles & Permissions
  const roleMap = {};
  for (const r of CORE_ROLES) {
    let row = await db.get('SELECT id, slug FROM roles WHERE slug = ?', [r.slug]);
    if (!row) {
      const ins = await db.run('INSERT INTO roles (slug, name, description) VALUES (?, ?, ?)', [
        r.slug,
        r.name,
        r.description,
      ]);
      row = { id: ins.insertId, slug: r.slug };
    }
    roleMap[r.slug] = row.id;
  }

  for (const [code, desc, roleSlugs] of CORE_PERMISSIONS) {
    let perm = await db.get('SELECT id FROM permissions WHERE code = ?', [code]);
    if (!perm) {
      const ins = await db.run('INSERT INTO permissions (code, description) VALUES (?, ?)', [code, desc]);
      perm = { id: ins.insertId };
    }
    for (const slug of roleSlugs) {
      const existingMap = await db.get(
        'SELECT role_id FROM role_permissions WHERE role_id = ? AND permission_id = ?',
        [roleMap[slug], perm.id]
      );
      if (!existingMap) {
        await db.run('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [
          roleMap[slug],
          perm.id,
        ]);
      }
    }
  }

  // 3. Initial Superadmin account (sole bootstrap login so admin can sign in and add data)
  let adminUser = await db.get('SELECT id FROM users WHERE email = ?', [env.defaults.superadminEmail]);
  if (!adminUser) {
    const hash = await bcrypt.hash(env.defaults.superadminPassword, 10);
    const ins = await db.run(
      `INSERT INTO users (username, email, password_hash, full_name, phone, status, email_verified, auth_provider)
       VALUES (?, ?, ?, ?, '', 'active', 1, 'local')`,
      ['superadmin', env.defaults.superadminEmail, hash, 'Superadmin']
    );
    adminUser = { id: ins.insertId };
    await db.run('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [
      adminUser.id,
      roleMap.superadmin,
    ]);
  }

  return { roleMap, adminUserId: adminUser.id };
}

async function seedDemoData() {
  const { roleMap, adminUserId } = await ensureCoreFoundation();

  // Seed default grading scales for demo/test runs when empty
  const gradeCountRow = await db.get('SELECT COUNT(*) AS cnt FROM grading_scales');
  if (Number(gradeCountRow.cnt) === 0) {
    for (const g of DEFAULT_GRADING_SCALES) {
      await db.run(
        'INSERT INTO grading_scales (grade, min_score, max_score, grade_point, remark) VALUES (?, ?, ?, ?, ?)',
        [g.grade, g.min_score, g.max_score, g.grade_point, g.remark]
      );
    }
  }

  // Only seed demo records if no teachers exist yet (idempotent, never wipes existing DB!)
  const existingTeachers = await db.get('SELECT COUNT(*) AS cnt FROM teachers');
  if (Number(existingTeachers.cnt) > 0) {
    // Backfill sample Paystack gateway records for existing seeded payments if table is empty
    const pskCnt = await db.get('SELECT COUNT(*) AS cnt FROM paystack_transactions');
    if (Number(pskCnt?.cnt || 0) === 0) {
      const existingPays = await db.query(
        `SELECT p.*, r.receipt_number, s.guardian_email
         FROM payments p
         LEFT JOIN receipts r ON r.payment_id = p.id
         INNER JOIN students s ON s.id = p.student_id
         ORDER BY p.id ASC LIMIT 2`
      );
      for (const [idx, p] of existingPays.entries()) {
        const ref = `PSK-2026-0000${idx + 1}`;
        await db.run('UPDATE payments SET payment_method = ?, reference_number = ? WHERE id = ?', [
          'paystack',
          ref,
          p.id,
        ]);
        await db.run(
          `INSERT INTO paystack_transactions
           (reference, access_code, student_id, academic_year_id, term_id, payer_email, amount, amount_subunits, currency_code, channel, gateway_mode, status, gateway_response, payment_id, receipt_number, initiated_by_user_id, verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sandbox', 'success', 'Approved (Paystack)', ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            ref,
            `acc_seed_00${idx + 1}`,
            p.student_id,
            p.academic_year_id,
            p.term_id,
            p.guardian_email || 'parent@example.com',
            p.amount,
            Math.round(Number(p.amount) * 100),
            env.defaults.currencyCode,
            idx === 0 ? 'mobile_money' : 'card',
            p.id,
            p.receipt_number || null,
            p.received_by_user_id,
          ]
        );
      }
    }
    return { seededDemo: false };
  }

  const teacherHash = await bcrypt.hash('Teacher@2026!', 10);
  const studentHash = await bcrypt.hash('Student@2026!', 10);
  const financeHash = await bcrypt.hash('Finance@2026!', 10);

  await db.withTransaction(async (tx) => {
    // Academic Year & Terms
    const yrRes = await tx.run(
      `INSERT INTO academic_years (name, start_date, end_date, is_active, status)
       VALUES ('2026/2027', '2026-09-07', '2027-07-23', 1, 'active')`
    );
    const yearId = yrRes.insertId;

    const t1Res = await tx.run(
      `INSERT INTO terms (academic_year_id, name, start_date, end_date, is_active)
       VALUES (?, 'Term 1', '2026-09-07', '2026-12-18', 1)`,
      [yearId]
    );
    const term1Id = t1Res.insertId;

    await tx.run(
      `INSERT INTO terms (academic_year_id, name, start_date, end_date, is_active)
       VALUES (?, 'Term 2', '2027-01-11', '2027-04-09', 0)`,
      [yearId]
    );
    await tx.run(
      `INSERT INTO terms (academic_year_id, name, start_date, end_date, is_active)
       VALUES (?, 'Term 3', '2027-04-26', '2027-07-23', 0)`,
      [yearId]
    );

    // Financial User
    const finUser = await tx.run(
      `INSERT INTO users (username, email, password_hash, full_name, phone, status, email_verified, auth_provider)
       VALUES ('bursar', 'finance@school.edu.gh', ?, ' Efua Nyarko (Senior Bursar)', '+233 24 410 0040', 'active', 1, 'local')`,
      [financeHash]
    );
    await tx.run('INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)', [
      finUser.insertId,
      roleMap.financial,
      adminUserId,
    ]);

    // Teachers
    const tUser1 = await tx.run(
      `INSERT INTO users (username, email, password_hash, full_name, phone, status, email_verified, auth_provider)
       VALUES ('kofi.mensah', 'kofi.mensah@school.edu.gh', ?, 'Mr. Kofi Mensah', '+233 24 555 0101', 'active', 1, 'local')`,
      [teacherHash]
    );
    await tx.run('INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)', [
      tUser1.insertId,
      roleMap.teacher,
      adminUserId,
    ]);
    const t1 = await tx.run(
      `INSERT INTO teachers (user_id, staff_number, first_name, last_name, qualification, specialization, department, hire_date, status)
       VALUES (?, 'STF-2024-001', 'Kofi', 'Mensah', 'B.Ed Mathematics & M.Sc Physics', 'Mathematics & Physics', 'Sciences', '2024-01-15', 'active')`,
      [tUser1.insertId]
    );

    const tUser2 = await tx.run(
      `INSERT INTO users (username, email, password_hash, full_name, phone, status, email_verified, auth_provider)
       VALUES ('ama.owusu', 'ama.owusu@school.edu.gh', ?, 'Mrs. Ama Owusu', '+233 24 555 0102', 'active', 1, 'local')`,
      [teacherHash]
    );
    await tx.run('INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)', [
      tUser2.insertId,
      roleMap.teacher,
      adminUserId,
    ]);
    const t2 = await tx.run(
      `INSERT INTO teachers (user_id, staff_number, first_name, last_name, qualification, specialization, department, hire_date, status)
       VALUES (?, 'STF-2024-002', 'Ama', 'Owusu', 'B.A. English & PGDE', 'English & Literature', 'Languages & Humanities', '2024-02-01', 'active')`,
      [tUser2.insertId]
    );

    // Classes (no class streams)
    const cls10 = await tx.run(
      `INSERT INTO classes (name, level_order, capacity, status) VALUES ('Grade 10', 10, 40, 'active')`
    );
    const cls11 = await tx.run(
      `INSERT INTO classes (name, level_order, capacity, status) VALUES ('Grade 11', 11, 40, 'active')`
    );
    await tx.run(
      `INSERT INTO classes (name, level_order, capacity, status) VALUES ('Grade 12', 12, 35, 'active')`
    );

    // Subjects
    const subMath = await tx.run(
      `INSERT INTO subjects (code, name, department, is_elective, pass_mark, max_mark) VALUES ('MTH101', 'Core Mathematics', 'Sciences', 0, 50, 100)`
    );
    const subPhys = await tx.run(
      `INSERT INTO subjects (code, name, department, is_elective, pass_mark, max_mark) VALUES ('PHY102', 'Elective Physics', 'Sciences', 1, 50, 100)`
    );
    const subEng = await tx.run(
      `INSERT INTO subjects (code, name, department, is_elective, pass_mark, max_mark) VALUES ('ENG101', 'English Language', 'Languages & Humanities', 0, 50, 100)`
    );
    const subIct = await tx.run(
      `INSERT INTO subjects (code, name, department, is_elective, pass_mark, max_mark) VALUES ('ICT103', 'Computing & ICT', 'Sciences', 0, 50, 100)`
    );

    // Teacher Subject Specializations
    for (const [tid, subid] of [
      [t1.insertId, subMath.insertId],
      [t1.insertId, subPhys.insertId],
      [t1.insertId, subIct.insertId],
      [t2.insertId, subEng.insertId],
    ]) {
      await tx.run(
        `INSERT INTO teacher_subjects (teacher_id, subject_id) VALUES (?, ?)`,
        [tid, subid]
      );
    }

    // Teacher Assignments
    const assignments = [
      [t1.insertId, cls10.insertId, subMath.insertId, yearId, term1Id],
      [t1.insertId, cls10.insertId, subPhys.insertId, yearId, term1Id],
      [t1.insertId, cls11.insertId, subMath.insertId, yearId, term1Id],
      [t1.insertId, cls10.insertId, subIct.insertId, yearId, term1Id],
      [t2.insertId, cls10.insertId, subEng.insertId, yearId, term1Id],
      [t2.insertId, cls11.insertId, subEng.insertId, yearId, term1Id],
    ];
    for (const [tid, cid, subid, yid, trmid] of assignments) {
      const key = `${yid}-${trmid}-${cid}-0-${subid}`;
      await tx.run(
        `INSERT INTO teacher_assignments (teacher_id, class_id, stream_id, subject_id, academic_year_id, term_id, assignment_key)
         VALUES (?, ?, NULL, ?, ?, ?, ?)`,
        [tid, cid, subid, yid, trmid, key]
      );
    }

    // Timetable entries
    const ttEntries = [
      [yearId, term1Id, cls10.insertId, null, subMath.insertId, t1.insertId, 'Monday', '08:00', '09:30', 'Block A-101'],
      [yearId, term1Id, cls10.insertId, null, subEng.insertId, t2.insertId, 'Monday', '09:45', '11:15', 'Block A-101'],
      [yearId, term1Id, cls10.insertId, null, subPhys.insertId, t1.insertId, 'Tuesday', '08:00', '09:30', 'Science Lab 1'],
      [yearId, term1Id, cls10.insertId, null, subIct.insertId, t1.insertId, 'Wednesday', '10:00', '11:30', 'ICT Lab'],
      [yearId, term1Id, cls11.insertId, null, subMath.insertId, t1.insertId, 'Thursday', '08:00', '09:30', 'Block B-201'],
      [yearId, term1Id, cls11.insertId, null, subEng.insertId, t2.insertId, 'Friday', '08:00', '09:30', 'Block B-201'],
    ];
    for (const row of ttEntries) {
      await tx.run(
        `INSERT INTO timetables (academic_year_id, term_id, class_id, stream_id, subject_id, teacher_id, day_of_week, start_time, end_time, room)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row
      );
    }

    // Students
    const demoStudents = [
      {
        username: 'kwame.asante',
        email: 'kwame.asante@student.school.edu.gh',
        adm: 'ADM-2026-001',
        first: 'Kwame',
        last: 'Asante',
        gender: 'Male',
        dob: '2010-04-12',
        guardian: 'Mr. Samuel Asante',
        gPhone: '+233 24 700 1101',
        gEmail: 's.asante@example.com',
        classId: cls10.insertId,
        roll: 'G10-01',
      },
      {
        username: 'abena.boateng',
        email: 'abena.boateng@student.school.edu.gh',
        adm: 'ADM-2026-002',
        first: 'Abena',
        last: 'Boateng',
        gender: 'Female',
        dob: '2010-08-23',
        guardian: 'Mrs. Grace Boateng',
        gPhone: '+233 24 700 1102',
        gEmail: 'g.boateng@example.com',
        classId: cls10.insertId,
        roll: 'G10-02',
      },
      {
        username: 'yaw.osei',
        email: 'yaw.osei@student.school.edu.gh',
        adm: 'ADM-2026-003',
        first: 'Yaw',
        last: 'Osei',
        gender: 'Male',
        dob: '2010-01-19',
        guardian: 'Mr. Daniel Osei',
        gPhone: '+233 24 700 1103',
        gEmail: 'd.osei@example.com',
        classId: cls10.insertId,
        roll: 'G10-03',
      },
      {
        username: 'esi.darko',
        email: 'esi.darko@student.school.edu.gh',
        adm: 'ADM-2026-004',
        first: 'Esi',
        last: 'Darko',
        gender: 'Female',
        dob: '2009-11-05',
        guardian: 'Dr. Nana Darko',
        gPhone: '+233 24 700 1104',
        gEmail: 'n.darko@example.com',
        classId: cls11.insertId,
        roll: 'G11-01',
      },
    ];

    const studentIds = [];
    for (const st of demoStudents) {
      const su = await tx.run(
        `INSERT INTO users (username, email, password_hash, full_name, phone, status, email_verified, auth_provider)
         VALUES (?, ?, ?, ?, ?, 'active', 1, 'local')`,
        [st.username, st.email, studentHash, `${st.first} ${st.last}`, st.gPhone]
      );
      await tx.run('INSERT INTO user_roles (user_id, role_id, assigned_by_user_id) VALUES (?, ?, ?)', [
        su.insertId,
        roleMap.student,
        adminUserId,
      ]);
      const sr = await tx.run(
        `INSERT INTO students (user_id, admission_number, first_name, last_name, gender, date_of_birth, guardian_name, guardian_phone, guardian_email, address, enrollment_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'East Legon, Accra', '2026-09-07', 'active')`,
        [su.insertId, st.adm, st.first, st.last, st.gender, st.dob, st.guardian, st.gPhone, st.gEmail]
      );
      await tx.run(
        `INSERT INTO student_enrolments (student_id, class_id, stream_id, academic_year_id, term_id, roll_number, status)
         VALUES (?, ?, NULL, ?, ?, ?, 'enrolled')`,
        [sr.insertId, st.classId, yearId, term1Id, st.roll]
      );
      studentIds.push(sr.insertId);
    }

    // Attendance Sessions for Grade 10
    const dates = ['2026-10-23', '2026-10-26', '2026-10-27'];
    for (const dt of dates) {
      const sessKey = `${yearId}-${term1Id}-${cls10.insertId}-0-${subMath.insertId}-${dt}`;
      const sess = await tx.run(
        `INSERT INTO attendance_sessions (class_id, stream_id, subject_id, academic_year_id, term_id, session_date, session_key, taken_by_user_id, status, notes)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'submitted', 'Morning Mathematics Roll Call')`,
        [cls10.insertId, subMath.insertId, yearId, term1Id, dt, sessKey, tUser1.insertId]
      );
      await tx.run(
        `INSERT INTO attendance_records (session_id, student_id, status, remarks, updated_by_user_id)
         VALUES (?, ?, 'present', 'On time', ?)`,
        [sess.insertId, studentIds[0], tUser1.insertId]
      );
      await tx.run(
        `INSERT INTO attendance_records (session_id, student_id, status, remarks, updated_by_user_id)
         VALUES (?, ?, ?, ?, ?)`,
        [
          sess.insertId,
          studentIds[1],
          dt === '2026-10-26' ? 'late' : 'present',
          dt === '2026-10-26' ? 'Arrived 10 mins after bell' : 'On time',
          tUser1.insertId,
        ]
      );
    }

    // Assessments & Marks (Published + Unpublished Draft)
    const aMathTest = await tx.run(
      `INSERT INTO assessments (title, assessment_type, class_id, stream_id, subject_id, academic_year_id, term_id, max_score, weight_percent, scheduled_date, is_published, created_by_user_id)
       VALUES ('Term 1 Class Test 1 - Algebra', 'class_test', ?, NULL, ?, ?, ?, 100, 30, '2026-10-05', 1, ?)`,
      [cls10.insertId, subMath.insertId, yearId, term1Id, tUser1.insertId]
    );
    const aMathMid = await tx.run(
      `INSERT INTO assessments (title, assessment_type, class_id, stream_id, subject_id, academic_year_id, term_id, max_score, weight_percent, scheduled_date, is_published, created_by_user_id)
       VALUES ('Term 1 Midterm Exam - Core Math', 'midterm', ?, NULL, ?, ?, ?, 100, 70, '2026-10-20', 1, ?)`,
      [cls10.insertId, subMath.insertId, yearId, term1Id, tUser1.insertId]
    );
    const aPhysMid = await tx.run(
      `INSERT INTO assessments (title, assessment_type, class_id, stream_id, subject_id, academic_year_id, term_id, max_score, weight_percent, scheduled_date, is_published, created_by_user_id)
       VALUES ('Term 1 Midterm - Mechanics & Optics', 'midterm', ?, NULL, ?, ?, ?, 100, 100, '2026-10-21', 1, ?)`,
      [cls10.insertId, subPhys.insertId, yearId, term1Id, tUser1.insertId]
    );
    const aEngMid = await tx.run(
      `INSERT INTO assessments (title, assessment_type, class_id, stream_id, subject_id, academic_year_id, term_id, max_score, weight_percent, scheduled_date, is_published, created_by_user_id)
       VALUES ('Term 1 Comprehension & Essay Exam', 'midterm', ?, NULL, ?, ?, ?, 100, 100, '2026-10-22', 1, ?)`,
      [cls10.insertId, subEng.insertId, yearId, term1Id, tUser2.insertId]
    );
    // Draft (unpublished) ICT Practical so Student only sees published results while Teacher/Superadmin sees draft too!
    const aIctDraft = await tx.run(
      `INSERT INTO assessments (title, assessment_type, class_id, stream_id, subject_id, academic_year_id, term_id, max_score, weight_percent, scheduled_date, is_published, created_by_user_id)
       VALUES ('Term 1 Practical Lab Assessment (Draft)', 'project', ?, NULL, ?, ?, ?, 100, 100, '2026-10-27', 0, ?)`,
      [cls10.insertId, subIct.insertId, yearId, term1Id, tUser1.insertId]
    );

    const marksToSeed = [
      [aMathTest.insertId, studentIds[0], 84, 84, 'A1', 'Excellent', tUser1.insertId],
      [aMathTest.insertId, studentIds[1], 76, 76, 'B2', 'Very Good', tUser1.insertId],
      [aMathMid.insertId, studentIds[0], 88, 88, 'A1', 'Excellent', tUser1.insertId],
      [aMathMid.insertId, studentIds[1], 72, 72, 'B2', 'Very Good', tUser1.insertId],
      [aPhysMid.insertId, studentIds[0], 81, 81, 'A1', 'Excellent', tUser1.insertId],
      [aPhysMid.insertId, studentIds[1], 68, 68, 'B3', 'Good', tUser1.insertId],
      [aEngMid.insertId, studentIds[0], 79, 79, 'B2', 'Very Good', tUser2.insertId],
      [aEngMid.insertId, studentIds[1], 85, 85, 'A1', 'Excellent', tUser2.insertId],
      [aIctDraft.insertId, studentIds[0], 91, 91, 'A1', 'Excellent', tUser1.insertId],
    ];
    let samplePublishedMarkId = null;
    for (const m of marksToSeed) {
      const mr = await tx.run(
        `INSERT INTO marks (assessment_id, student_id, score, percentage, grade, remark, entered_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        m
      );
      if (m[0] === aPhysMid.insertId && m[1] === studentIds[1]) {
        samplePublishedMarkId = mr.insertId;
      }
    }

    if (samplePublishedMarkId) {
      await tx.run(
        `INSERT INTO mark_correction_requests (mark_id, assessment_id, student_id, requested_by_user_id, previous_score, proposed_score, reason, status)
         VALUES (?, ?, ?, ?, 68, 73, 'Question 4b lab graph bonus tally omitted during initial entry', 'pending')`,
        [samplePublishedMarkId, aPhysMid.insertId, studentIds[1], tUser1.insertId]
      );
    }

    // Fee Categories & Fee Assignments
    const fcTuition = await tx.run(
      `INSERT INTO fee_categories (code, name, description, default_amount, frequency, is_mandatory)
       VALUES ('FEE-TUITION', 'Termly Tuition Fee', 'Core academic instruction charge', 2400.00, 'termly', 1)`
    );
    const fcLab = await tx.run(
      `INSERT INTO fee_categories (code, name, description, default_amount, frequency, is_mandatory)
       VALUES ('FEE-ICTLAB', 'ICT & Science Lab Levy', 'Laboratory consumables and computing resources', 450.00, 'termly', 1)`
    );
    const fcLib = await tx.run(
      `INSERT INTO fee_categories (code, name, description, default_amount, frequency, is_mandatory)
       VALUES ('FEE-LIB', 'Library & Sports Levy', 'Library books, journals and athletics', 200.00, 'termly', 1)`
    );

    const faByStudent = {};
    for (const sid of studentIds) {
      faByStudent[sid] = [];
      for (const [catId, amt] of [
        [fcTuition.insertId, '2400.00'],
        [fcLab.insertId, '450.00'],
        [fcLib.insertId, '200.00'],
      ]) {
        const fa = await tx.run(
          `INSERT INTO fee_assignments (student_id, fee_category_id, academic_year_id, term_id, amount_due, discount_amount, amount_paid, due_date, status, created_by_user_id)
           VALUES (?, ?, ?, ?, ?, '0.00', '0.00', '2026-11-15', 'unpaid', ?)`,
          [sid, catId, yearId, term1Id, amt, finUser.insertId]
        );
        faByStudent[sid].push(fa.insertId);
      }
    }

    // Scholarship discount on Student 2 Tuition (300.00)
    await tx.run(
      `UPDATE fee_assignments SET discount_amount = '300.00' WHERE id = ?`,
      [faByStudent[studentIds[1]][0]]
    );
    await tx.run(
      `INSERT INTO fee_adjustments (student_id, fee_assignment_id, adjustment_type, amount, reason, approved_by_user_id)
       VALUES (?, ?, 'scholarship', '300.00', 'STEM Merit Partial Scholarship — Term 1', ?)`,
      [studentIds[1], faByStudent[studentIds[1]][0], finUser.insertId]
    );

    // Payment 1: Kwame Asante pays 2,600.00 via Paystack Mobile Money
    const pay1 = await tx.run(
      `INSERT INTO payments (student_id, academic_year_id, term_id, amount, payment_method, reference_number, idempotency_key, payment_date, received_by_user_id, status, notes)
       VALUES (?, ?, ?, '2600.00', 'paystack', 'PSK-2026-00001', 'psk:PSK-2026-00001', '2026-10-27', ?, 'completed', 'Paystack (mobile_money) - Approved')`,
      [studentIds[0], yearId, term1Id, finUser.insertId]
    );
    await tx.run(
      `INSERT INTO payment_allocations (payment_id, fee_assignment_id, allocated_amount) VALUES (?, ?, '2400.00')`,
      [pay1.insertId, faByStudent[studentIds[0]][0]]
    );
    await tx.run(
      `INSERT INTO payment_allocations (payment_id, fee_assignment_id, allocated_amount) VALUES (?, ?, '200.00')`,
      [pay1.insertId, faByStudent[studentIds[0]][1]]
    );
    await tx.run(
      `UPDATE fee_assignments SET amount_paid = '2400.00', status = 'paid' WHERE id = ?`,
      [faByStudent[studentIds[0]][0]]
    );
    await tx.run(
      `UPDATE fee_assignments SET amount_paid = '200.00', status = 'partial' WHERE id = ?`,
      [faByStudent[studentIds[0]][1]]
    );
    await tx.run(
      `INSERT INTO receipts (receipt_number, payment_id, student_id, issued_amount, currency_code, currency_symbol, issued_by_user_id, snapshot_json)
       VALUES ('RCP-2026-00001', ?, ?, '2600.00', ?, ?, ?, ?)`,
      [
        pay1.insertId,
        studentIds[0],
        env.defaults.currencyCode,
        env.defaults.currencySymbol,
        finUser.insertId,
        JSON.stringify({
          studentName: 'Kwame Asante',
          admissionNumber: 'ADM-2026-001',
          className: 'Grade 10 - Science A',
          paymentMethod: 'paystack',
          referenceNumber: 'PSK-2026-00001',
          paymentDate: '2026-10-27',
          allocations: [
            { feeName: 'Termly Tuition Fee', allocated: '2400.00' },
            { feeName: 'ICT & Science Lab Levy', allocated: '200.00' },
          ],
          balanceAfter: '450.00',
        }),
      ]
    );
    await tx.run(
      `INSERT INTO paystack_transactions
       (reference, access_code, student_id, academic_year_id, term_id, payer_email, amount, amount_subunits, currency_code, channel, gateway_mode, status, gateway_response, payment_id, receipt_number, initiated_by_user_id, verified_at)
       VALUES ('PSK-2026-00001', 'acc_seed_001', ?, ?, ?, 's.asante@example.com', '2600.00', 260000, ?, 'mobile_money', 'sandbox', 'success', 'Approved (Paystack)', ?, 'RCP-2026-00001', ?, CURRENT_TIMESTAMP)`,
      [studentIds[0], yearId, term1Id, env.defaults.currencyCode, pay1.insertId, finUser.insertId]
    );

    // Payment 2: Abena Boateng pays full discounted total (2,750.00) via Paystack Card
    const pay2 = await tx.run(
      `INSERT INTO payments (student_id, academic_year_id, term_id, amount, payment_method, reference_number, idempotency_key, payment_date, received_by_user_id, status, notes)
       VALUES (?, ?, ?, '2750.00', 'paystack', 'PSK-2026-00002', 'psk:PSK-2026-00002', '2026-10-27', ?, 'completed', 'Paystack (card) - Approved')`,
      [studentIds[1], yearId, term1Id, finUser.insertId]
    );
    await tx.run(
      `INSERT INTO payment_allocations (payment_id, fee_assignment_id, allocated_amount) VALUES (?, ?, '2100.00')`,
      [pay2.insertId, faByStudent[studentIds[1]][0]]
    );
    await tx.run(
      `INSERT INTO payment_allocations (payment_id, fee_assignment_id, allocated_amount) VALUES (?, ?, '450.00')`,
      [pay2.insertId, faByStudent[studentIds[1]][1]]
    );
    await tx.run(
      `INSERT INTO payment_allocations (payment_id, fee_assignment_id, allocated_amount) VALUES (?, ?, '200.00')`,
      [pay2.insertId, faByStudent[studentIds[1]][2]]
    );
    await tx.run(`UPDATE fee_assignments SET amount_paid = '2100.00', status = 'paid' WHERE id = ?`, [
      faByStudent[studentIds[1]][0],
    ]);
    await tx.run(`UPDATE fee_assignments SET amount_paid = '450.00', status = 'paid' WHERE id = ?`, [
      faByStudent[studentIds[1]][1],
    ]);
    await tx.run(`UPDATE fee_assignments SET amount_paid = '200.00', status = 'paid' WHERE id = ?`, [
      faByStudent[studentIds[1]][2],
    ]);
    await tx.run(
      `INSERT INTO receipts (receipt_number, payment_id, student_id, issued_amount, currency_code, currency_symbol, issued_by_user_id, snapshot_json)
       VALUES ('RCP-2026-00002', ?, ?, '2750.00', ?, ?, ?, ?)`,
      [
        pay2.insertId,
        studentIds[1],
        env.defaults.currencyCode,
        env.defaults.currencySymbol,
        finUser.insertId,
        JSON.stringify({
          studentName: 'Abena Boateng',
          admissionNumber: 'ADM-2026-002',
          className: 'Grade 10 - Science A',
          paymentMethod: 'paystack',
          referenceNumber: 'PSK-2026-00002',
          paymentDate: '2026-10-27',
          allocations: [
            { feeName: 'Termly Tuition Fee', allocated: '2100.00' },
            { feeName: 'ICT & Science Lab Levy', allocated: '450.00' },
            { feeName: 'Library & Sports Levy', allocated: '200.00' },
          ],
          balanceAfter: '0.00',
        }),
      ]
    );
    await tx.run(
      `INSERT INTO paystack_transactions
       (reference, access_code, student_id, academic_year_id, term_id, payer_email, amount, amount_subunits, currency_code, channel, gateway_mode, status, gateway_response, payment_id, receipt_number, initiated_by_user_id, verified_at)
       VALUES ('PSK-2026-00002', 'acc_seed_002', ?, ?, ?, 'g.boateng@example.com', '2750.00', 275000, ?, 'card', 'sandbox', 'success', 'Approved (Paystack)', ?, 'RCP-2026-00002', ?, CURRENT_TIMESTAMP)`,
      [studentIds[1], yearId, term1Id, env.defaults.currencyCode, pay2.insertId, finUser.insertId]
    );

    // Sample Daily Reconciliation
    await tx.run(
      `INSERT INTO reconciliations (reconciliation_date, payment_method, system_total, counted_total, variance, notes, status, reconciled_by_user_id)
       VALUES ('2026-10-27', 'all', '5350.00', '5350.00', '0.00', 'MoMo & Bank settlement statements matched to ledger', 'balanced', ?)`,
      [finUser.insertId]
    );

    // Announcements
    await tx.run(
      `INSERT INTO announcements (title, body, audience, priority, author_user_id, status)
       VALUES ('Term 1 Midterm Report Cards Published', 'Midterm Continuous Assessment scores for Term 1 (2026/2027) are now live on the Students Dashboard.', 'all', 'important', ?, 'published')`,
      [adminUserId]
    );
    await tx.run(
      `INSERT INTO announcements (title, body, audience, priority, author_user_id, status)
       VALUES ('Mark Verification Deadline — Friday 4:00 PM', 'Subject teachers should verify all Term 1 Continuous Assessment scores before Friday.', 'teachers', 'normal', ?, 'published')`,
      [adminUserId]
    );
    await tx.run(
      `INSERT INTO announcements (title, body, audience, priority, author_user_id, status)
       VALUES ('Term 1 Fee Settlement Window', 'Parents and students are reminded that Term 1 fee balances fall due on 15 November 2026.', 'students', 'normal', ?, 'published')`,
      [finUser.insertId]
    );

    // Audit Logs
    await tx.run(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata_json)
       VALUES (?, 'financial', 'PAYMENT_RECORDED', 'receipt', 'RCP-2026-00001', ?)`,
      [finUser.insertId, JSON.stringify({ studentId: studentIds[0], amount: '2600.00', method: 'mobile_money' })]
    );
    await tx.run(
      `INSERT INTO audit_logs (actor_user_id, actor_role, action, target_type, target_id, metadata_json)
       VALUES (?, 'financial', 'PAYMENT_RECORDED', 'receipt', 'RCP-2026-00002', ?)`,
      [finUser.insertId, JSON.stringify({ studentId: studentIds[1], amount: '2750.00', method: 'bank_transfer' })]
    );
  });

  logger.info('Seeded demo academic & financial records across all 4 dashboards');
  return { seededDemo: true };
}

if (require.main === module) {
  const runDemo = env.defaults.autoSeedDemo || process.argv.includes('--demo');
  (runDemo ? seedDemoData() : ensureCoreFoundation())
    .then((res) => {
      logger.info('Database initialization complete', { mode: runDemo ? 'demo' : 'clean', ...res });
      return db.closeDatabase();
    })
    .catch((err) => {
      logger.error('Database initialization failed', { error: err.message });
      process.exit(1);
    });
}

module.exports = { ensureCoreFoundation, seedDemoData };
