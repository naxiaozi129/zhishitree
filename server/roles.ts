export const ROLES = {
  USER: 'user',
  QUESTION_ADMIN: 'question_admin',
  SUPER_ADMIN: 'super_admin',
} as const;

export type AppRole = (typeof ROLES)[keyof typeof ROLES];

const VALID_ROLES = new Set<string>([ROLES.USER, ROLES.QUESTION_ADMIN, ROLES.SUPER_ADMIN, 'admin']);

export function normalizeRole(role: string): AppRole {
  if (role === 'admin') return ROLES.SUPER_ADMIN;
  if (role === ROLES.QUESTION_ADMIN) return ROLES.QUESTION_ADMIN;
  if (role === ROLES.SUPER_ADMIN) return ROLES.SUPER_ADMIN;
  return ROLES.USER;
}

export function isValidRoleInput(role: string): role is AppRole | 'admin' {
  return VALID_ROLES.has(role);
}

export function isSuperAdminRole(role: string): boolean {
  return normalizeRole(role) === ROLES.SUPER_ADMIN;
}

export function isQuestionAdminRole(role: string): boolean {
  return normalizeRole(role) === ROLES.QUESTION_ADMIN;
}

export function isStaffRole(role: string): boolean {
  const r = normalizeRole(role);
  return r === ROLES.SUPER_ADMIN || r === ROLES.QUESTION_ADMIN;
}

export function userCanUseApp(user: { role: string; approved: boolean }): boolean {
  if (isSuperAdminRole(user.role)) return true;
  return Boolean(user.approved);
}

export function roleLabel(role: string): string {
  switch (normalizeRole(role)) {
    case ROLES.SUPER_ADMIN:
      return '超级管理员';
    case ROLES.QUESTION_ADMIN:
      return '题目管理员';
    default:
      return '普通用户';
  }
}
