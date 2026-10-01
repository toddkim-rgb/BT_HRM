import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError, forbidden, prisma } from './db.js';

export type Role = 'EMP' | 'PM' | 'EXEC' | 'ADMIN' | 'SALES';

export interface AuthUser {
  empId: string;
  name: string;
  role: Role;
  mustChangePw?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const secret = () => process.env.JWT_SECRET || 'dev-secret';

export function signToken(user: AuthUser): string {
  return jwt.sign(user, secret(), { expiresIn: '12h' });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, '로그인이 필요합니다.');
  try {
    const payload = jwt.verify(header.slice(7), secret()) as AuthUser;
    req.user = { empId: payload.empId, name: payload.name, role: payload.role, mustChangePw: !!payload.mustChangePw };
  } catch {
    throw new HttpError(401, '세션이 만료되었습니다. 다시 로그인해 주세요.');
  }
  next();
}

/** 초기·임시 비밀번호 사용자는 비밀번호 변경 전까지 다른 API 사용 불가 */
export function blockUntilPasswordChanged(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.mustChangePw) throw new HttpError(403, '비밀번호를 변경한 뒤 이용할 수 있습니다.', { code: 'PW_CHANGE_REQUIRED' });
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

export function me(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, '로그인이 필요합니다.');
  return req.user;
}

/** 전사 조회 권한 (경영진·관리자) */
export const isManager = (u: AuthUser) => u.role === 'EXEC' || u.role === 'ADMIN';

/** PM이 담당하는 프로젝트 코드 목록 */
export async function pmProjectCodes(empId: string): Promise<string[]> {
  const rows = await prisma.project.findMany({ where: { pmEmpId: empId }, select: { prjCd: true } });
  return rows.map((r) => r.prjCd);
}

/** 프로젝트 관리 권한: 관리자 또는 해당 프로젝트 PM */
export async function assertProjectManager(u: AuthUser, prjCd: string) {
  if (u.role === 'ADMIN') return;
  const p = await prisma.project.findUnique({ where: { prjCd }, select: { pmEmpId: true } });
  if (!p) throw new HttpError(404, '프로젝트를 찾을 수 없습니다.');
  if (u.role !== 'PM' || p.pmEmpId !== u.empId) throw forbidden();
}
