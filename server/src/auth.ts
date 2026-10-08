import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { HttpError, forbidden, prisma } from './db.js';
import { assertMenu } from './lib/permissions.js';

export type Role = 'EMP' | 'EXEC' | 'ADMIN'; // 수행인력 / 사업관리자 / 시스템관리자 (PM은 역할이 아니라 투입 배정에서 프로젝트별 지정)

export interface AuthUser {
  empId: string;
  name: string;
  role: Role;
  mustChangePw?: boolean;
  pm?: boolean; // 투입 배정에서 PM으로 지정된 프로젝트가 있음
  pmPrjCds?: string[]; // PM으로 지정된 프로젝트 코드 (테스트 계정의 'PM 역할' 시험 중이면 고른 프로젝트)
  tester?: boolean; // 테스트 계정 (@bt-hrm.test)으로 로그인했거나, 테스트 계정이 다른 인력으로 전환한 상태
  impersonator?: string; // (토큰) 테스트 계정이 다른 인력으로 전환했을 때 테스트 계정의 empId
  roleOverride?: Role; // (토큰) 전환한 인력의 권한을 바꿔 시험 (예: 시스템관리자 → 사업관리자)
  testAs?: string; // (토큰) 전환한 역할 키 (ADMIN/EXEC/PM/EMP)
}

/**
 * 테스트 계정의 역할 전환 대상 (실제 인력으로 로그인한 것처럼 화면·권한을 시험)
 * - 사업관리자는 김석현 계정을 사업관리자 권한으로만 좁혀서 보여 줌 (실제 역할은 바꾸지 않음)
 */
export const TEST_PERSONAS: Record<string, { name: string; label: string; roleOverride?: Role }> = {
  ADMIN: { name: '김석현', label: '시스템관리자' },
  EXEC: { name: '김석현', label: '사업관리자', roleOverride: 'EXEC' },
  PM: { name: '정창원', label: '프로젝트 PM' },
  EMP: { name: '신현석', label: '수행인력' },
};

/** 테스트 계정: 이 도메인의 계정만 '테스트 역할' 전환 가능 (개발 완료 후 계정 삭제) */
export const TEST_DOMAIN = '@bt-hrm.test';
export const isTesterEmail = (email: string) => email.toLowerCase().endsWith(TEST_DOMAIN);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// 서명 키: JWT_SECRET → (없으면) 운영 DB 토큰에서 파생(서버에만 존재, 사람이 다룰 비밀값 없음) → 개발용
const derived = process.env.TURSO_AUTH_TOKEN ? createHash('sha256').update(`bt-hrm-jwt:${process.env.TURSO_AUTH_TOKEN}`).digest('hex') : null;
const secret = () => process.env.JWT_SECRET || derived || 'dev-secret';

export function signToken(user: AuthUser): string {
  return jwt.sign(user, secret(), { expiresIn: '12h' });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, '로그인이 필요합니다.');
  let payload: AuthUser;
  try {
    payload = jwt.verify(header.slice(7), secret()) as AuthUser;
  } catch {
    throw new HttpError(401, '세션이 만료되었습니다. 다시 로그인해 주세요.');
  }
  // 테스트 계정이 다른 인력으로 전환한 토큰: 테스트 계정이 아직 유효해야 함
  let impersonated = false;
  if (payload.impersonator) {
    const imp = await prisma.employee.findUnique({ where: { empId: payload.impersonator }, select: { email: true, deletedAt: true, statusCd: true } });
    if (!imp || imp.deletedAt || imp.statusCd === 'RETIRED' || !isTesterEmail(imp.email)) throw new HttpError(401, '테스트 계정을 사용할 수 없습니다. 다시 로그인해 주세요.');
    impersonated = true;
  }
  // 삭제 처리·퇴사된 인력은 발급된 토큰도 사용 불가
  const emp = await prisma.employee.findUnique({ where: { empId: payload.empId }, select: { deletedAt: true, statusCd: true, role: true, email: true } });
  if (!emp || emp.deletedAt || emp.statusCd === 'RETIRED') throw new HttpError(401, '사용할 수 없는 계정입니다. 다시 로그인해 주세요.');
  const tester = impersonated || isTesterEmail(emp.email);
  const pmPrjCds = (await prisma.project.findMany({ where: { pmEmpId: payload.empId }, select: { prjCd: true } })).map((p) => p.prjCd);
  const role = (impersonated && payload.roleOverride) || (emp.role as Role);
  req.user = {
    empId: payload.empId,
    name: payload.name,
    role,
    mustChangePw: !!payload.mustChangePw,
    pm: pmPrjCds.length > 0,
    pmPrjCds,
    tester,
    ...(impersonated ? { impersonator: payload.impersonator, roleOverride: payload.roleOverride, testAs: payload.testAs } : {}),
  };
  next();
}

/** 초기 비밀번호(이메일 주소) 사용자는 비밀번호 변경 전까지 다른 API 사용 불가 */
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

/** 프로젝트 PM(수행인력): 데이터 범위가 담당 프로젝트로 제한됨 */
export const pmScoped = (u: AuthUser) => u.role === 'EMP' && !!u.pm;
/** PM 지정이 없는 수행인력: 본인 데이터만 */
export const staffOnly = (u: AuthUser) => u.role === 'EMP' && !u.pm;

/** 전사 조회 권한 (사업관리자·시스템관리자) */
export const isManager = (u: AuthUser) => u.role === 'EXEC' || u.role === 'ADMIN';

/** 로그인 사용자가 PM으로 지정된 프로젝트 코드 */
export const pmProjectCodes = (u: AuthUser): string[] => u.pmPrjCds ?? [];
/** 로그인 사용자가 이 프로젝트의 PM인가 */
export const isPmOf = (u: AuthUser, prjCd: string) => (u.pmPrjCds ?? []).includes(prjCd);

/**
 * 프로젝트 단위 편집 권한: 해당 메뉴 '편집' 권한(메뉴 권한 설정) + 프로젝트 PM(수행인력)은 담당 프로젝트만
 * (투입 배정·프로젝트 주간보고·마일스톤)
 */
export async function assertProjectManager(u: AuthUser, prjCd: string, menu: 'assignments' | 'projectWeekly') {
  await assertMenu(u, menu, 'EDIT');
  const p = await prisma.project.findUnique({ where: { prjCd }, select: { pmEmpId: true } });
  if (!p) throw new HttpError(404, '프로젝트를 찾을 수 없습니다.');
  if (pmScoped(u) && !isPmOf(u, prjCd)) throw forbidden();
}
