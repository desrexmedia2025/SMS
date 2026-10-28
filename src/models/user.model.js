const db = require('../config/database');

const USER_WITH_ROLE_SQL = `
  SELECT
    u.id,
    u.username,
    u.email,
    u.password_hash,
    u.full_name,
    u.phone,
    u.avatar_url,
    u.status,
    u.google_subject_id,
    u.email_verified,
    u.auth_provider,
    u.password_reset_token_hash,
    u.password_reset_expires_at,
    u.failed_login_attempts,
    u.locked_until,
    u.password_changed_at,
    u.last_login_at,
    u.created_at,
    r.slug AS role,
    r.name AS role_name,
    t.id AS teacher_id,
    t.staff_number,
    s.id AS student_id,
    s.admission_number
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
  LEFT JOIN teachers t ON t.user_id = u.id
  LEFT JOIN students s ON s.user_id = u.id
`;

async function findById(id, runner = db) {
  return runner.get(`${USER_WITH_ROLE_SQL} WHERE u.id = ? LIMIT 1`, [id]);
}

async function findByEmailOrUsername(identifier, runner = db) {
  const norm = String(identifier || '').trim().toLowerCase();
  return runner.get(
    `${USER_WITH_ROLE_SQL} WHERE LOWER(u.email) = ? OR LOWER(u.username) = ? LIMIT 1`,
    [norm, norm]
  );
}

async function findByEmail(email, runner = db) {
  const norm = String(email || '').trim().toLowerCase();
  return runner.get(`${USER_WITH_ROLE_SQL} WHERE LOWER(u.email) = ? LIMIT 1`, [norm]);
}

async function findByGoogleSubjectId(googleSubjectId, runner = db) {
  return runner.get(`${USER_WITH_ROLE_SQL} WHERE u.google_subject_id = ? LIMIT 1`, [googleSubjectId]);
}

async function getPermissionsForRole(roleSlug, runner = db) {
  if (!roleSlug) return [];
  const rows = await runner.query(
    `SELECT p.code
     FROM permissions p
     INNER JOIN role_permissions rp ON rp.permission_id = p.id
     INNER JOIN roles r ON r.id = rp.role_id
     WHERE r.slug = ?`,
    [roleSlug]
  );
  return rows.map((r) => r.code);
}

function toSafeSessionUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone || '',
    status: row.status,
    role: row.role || null,
    roleName: row.role_name || '',
    teacherId: row.teacher_id || null,
    staffNumber: row.staff_number || null,
    studentId: row.student_id || null,
    admissionNumber: row.admission_number || null,
    googleLinked: Boolean(row.google_subject_id),
    authProvider: row.auth_provider || 'local',
  };
}

function dashboardPathForRole(role) {
  switch (role) {
    case 'superadmin':
      return '/dashboard/superadmin';
    case 'teacher':
      return '/dashboard/teacher';
    case 'student':
      return '/dashboard/student';
    case 'financial':
      return '/dashboard/financial';
    default:
      return '/login';
  }
}

module.exports = {
  findById,
  findByEmail,
  findByEmailOrUsername,
  findByGoogleSubjectId,
  getPermissionsForRole,
  toSafeSessionUser,
  dashboardPathForRole,
};
