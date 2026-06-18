import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getUserById, type PublicUserRow } from './db.js';
import { isStaffRole, isSuperAdminRole, userCanUseApp } from './roles.js';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-JWT_SECRET';

export type AuthedUser = PublicUserRow;

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser | null;
    }
  }
}

export function signToken(userId: number, role: string): string {
  return jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: '14d' });
}

const cookieOpts = (): import('express').CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 14 * 24 * 60 * 60 * 1000,
  path: '/',
  secure:
    process.env.COOKIE_SECURE === '1'
      ? true
      : process.env.COOKIE_SECURE === '0'
        ? false
        : process.env.NODE_ENV === 'production',
});

export function setAuthCookie(res: Response, token: string) {
  res.cookie('token', token, cookieOpts());
}

export function clearAuthCookie(res: Response) {
  res.clearCookie('token', { path: '/', sameSite: 'lax' });
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.token || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const payload = decoded as unknown as { sub: number; role: string };
    const row = getUserById(Number(payload.sub));
    req.user = row ?? null;
  } catch {
    req.user = null;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: '请先登录' });
    return;
  }
  if (!userCanUseApp(req.user)) {
    res.status(403).json({ error: '账号尚未通过超级管理员审核，请等待审核通过后再使用' });
    return;
  }
  next();
}

/** 仅校验登录，不校验审核（用于 /api/auth/me） */
export function requireLoggedIn(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: '请先登录' });
    return;
  }
  next();
}

export function requireQuestionAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !isStaffRole(req.user.role)) {
    res.status(403).json({ error: '需要题目管理员或超级管理员权限' });
    return;
  }
  if (!userCanUseApp(req.user)) {
    res.status(403).json({ error: '账号尚未通过超级管理员审核' });
    return;
  }
  next();
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !isSuperAdminRole(req.user.role)) {
    res.status(403).json({ error: '需要超级管理员权限' });
    return;
  }
  next();
}

/** @deprecated 使用 requireQuestionAdmin 或 requireSuperAdmin */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  return requireQuestionAdmin(req, res, next);
}

export function publicUserPayload(user: PublicUserRow) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    approved: user.approved,
  };
}
