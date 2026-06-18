export const ROLES = {
  USER: 'user',
  QUESTION_ADMIN: 'question_admin',
  SUPER_ADMIN: 'super_admin',
} as const;

export type AppRole = (typeof ROLES)[keyof typeof ROLES];

export function normalizeRole(role: string): AppRole {
  if (role === 'admin') return ROLES.SUPER_ADMIN;
  if (role === ROLES.QUESTION_ADMIN) return ROLES.QUESTION_ADMIN;
  if (role === ROLES.SUPER_ADMIN) return ROLES.SUPER_ADMIN;
  return ROLES.USER;
}

export function isSuperAdmin(role: string): boolean {
  return normalizeRole(role) === ROLES.SUPER_ADMIN;
}

export function isQuestionAdmin(role: string): boolean {
  return normalizeRole(role) === ROLES.QUESTION_ADMIN;
}

export function isStaff(role: string): boolean {
  const r = normalizeRole(role);
  return r === ROLES.SUPER_ADMIN || r === ROLES.QUESTION_ADMIN;
}

export function canUseApp(user: { role: string; approved: boolean }): boolean {
  if (isSuperAdmin(user.role)) return true;
  return Boolean(user.approved);
}

export function canAccessAdminPanel(role: string): boolean {
  return isStaff(role);
}

export function canManageUsers(role: string): boolean {
  return isSuperAdmin(role);
}

export function canManageSystemSettings(role: string): boolean {
  return isSuperAdmin(role);
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

export function roleBadgeClass(role: string): string {
  switch (normalizeRole(role)) {
    case ROLES.SUPER_ADMIN:
      return 'bg-amber-100 text-amber-900';
    case ROLES.QUESTION_ADMIN:
      return 'bg-indigo-100 text-indigo-900';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}
