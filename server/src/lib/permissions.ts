import type { NextFunction, Request, Response } from 'express';
import type { AuthUser, Role } from '../auth.js';
import { HttpError, forbidden, prisma } from '../db.js';

/**
 * 메뉴별 접근 권한 (역할 × 메뉴 → 없음/조회/편집, DB 저장)
 * - 관리자 화면 '메뉴 권한'에서 변경. 메뉴 표시·화면 접근·API가 모두 이 설정을 따름
 * - 데이터 범위 규칙은 별도로 유지: 수행인력은 본인 데이터, PM은 담당 프로젝트만
 * - '메뉴 권한' 화면 자체는 시스템관리자 전용(고정) — 관리자가 스스로 잠기지 않도록
 */
export type Level = 'NONE' | 'VIEW' | 'EDIT';
/** 메뉴 권한 표의 열: 역할 3개 + '프로젝트 PM'(투입 배정에서 PM으로 지정된 사람에게 추가로 적용) */
export type PermRole = Role | 'PM';
export const ROLES: PermRole[] = ['EMP', 'PM', 'EXEC', 'ADMIN'];
const RANK: Record<Level, number> = { NONE: 0, VIEW: 1, EDIT: 2 };

export interface MenuDef {
  key: string;
  label: string;
  group: string;
  editable: boolean; // false = 조회 전용 화면 (편집 단계 없음)
  editDesc?: string; // '편집'으로 할 수 있는 일
}

export const MENUS: MenuDef[] = [
  { key: 'dashboard', label: '대시보드', group: '업무', editable: false },
  { key: 'weekly', label: '주간 업무보고', group: '업무', editable: true, editDesc: '본인 보고서 작성·제출' },
  { key: 'assignments', label: '투입 배정', group: '업무', editable: true, editDesc: '배정 등록·수정·취소 (PM은 담당 프로젝트만)' },
  { key: 'submissions', label: '제출 현황', group: '주간보고', editable: false },
  { key: 'projectWeekly', label: '프로젝트 주간보고', group: '주간보고', editable: true, editDesc: 'PM 의견·확정, 마일스톤, One-Page 반영 이슈 선택 (PM은 담당 프로젝트만)' },
  { key: 'onepage', label: '전사 One-Page', group: '주간보고', editable: true, editDesc: '종합 의견·차주 계획 입력, 확정·확정 취소' },
  { key: 'staffing', label: '프로젝트별 투입현황', group: '현황', editable: false },
  { key: 'utilization', label: '가동률', group: '현황', editable: false },
  { key: 'projectMm', label: '프로젝트 투입률', group: '현황', editable: false },
  { key: 'employees', label: '인력', group: '기준정보', editable: true, editDesc: '등록·수정·삭제·일괄 등록·비밀번호 초기화 (관리자 계정·권한은 시스템관리자만)' },
  { key: 'projects', label: '프로젝트', group: '기준정보', editable: true, editDesc: '등록·수정·삭제' },
  { key: 'partners', label: '협력사', group: '기준정보', editable: true, editDesc: '등록·수정·삭제' },
  { key: 'costBasis', label: '원가 기준', group: '기준정보', editable: true, editDesc: '직급 인건비·원가 비율·이익률 기준·협력사 단가·KOSA 단가 변경' },
  { key: 'settings', label: '기준값 설정', group: '기준정보', editable: true, editDesc: '기준값·공휴일 변경' },
  { key: 'accountRequests', label: '계정 요청', group: '기준정보', editable: true, editDesc: '비밀번호 초기화·요청 처리' },
];
export type MenuKey = (typeof MENUS)[number]['key'];

const V: Level = 'VIEW';
const E: Level = 'EDIT';
// 기본값 = v1.8까지 코드에 고정돼 있던 권한 (없는 값은 NONE)
export const DEFAULT_PERMISSIONS: Record<PermRole, Partial<Record<string, Level>>> = {
  EMP: { dashboard: V, weekly: E, utilization: V },
  PM: { dashboard: V, weekly: E, assignments: E, submissions: V, projectWeekly: E, onepage: V, staffing: V, utilization: V, projectMm: V, employees: V, projects: V },
  EXEC: { dashboard: V, weekly: E, assignments: V, submissions: V, projectWeekly: V, onepage: E, staffing: V, utilization: V, projectMm: V, employees: V, projects: V, partners: V, costBasis: V },
  ADMIN: Object.fromEntries(MENUS.map((m) => [m.key, m.editable ? E : V])),
};

export type PermissionMap = Record<PermRole, Record<string, Level>>;
let cache: PermissionMap | null = null;

/** DB에 없는 (역할, 메뉴) 조합만 기본값으로 저장, 없어진 메뉴는 정리 */
export async function ensureDefaultPermissions() {
  const rows = await prisma.menuPermission.findMany();
  const have = new Set(rows.map((r) => `${r.role}:${r.menu}`));
  for (const role of ROLES)
    for (const m of MENUS)
      if (!have.has(`${role}:${m.key}`)) await prisma.menuPermission.create({ data: { role, menu: m.key, level: DEFAULT_PERMISSIONS[role][m.key] ?? 'NONE' } });
  await prisma.menuPermission.deleteMany({ where: { OR: [{ menu: { notIn: MENUS.map((m) => m.key) } }, { role: { notIn: ROLES } }] } }); // 없어진 메뉴·역할(영업담당 등) 정리
  cache = null;
}

/**
 * v1.11 PM 역할 폐지에 따른 데이터 정리 (멱등, 서버 시작 시 실행)
 * - 역할 PM(PM/PL) → 수행인력(EMP). 담당 프로젝트의 PM 지정(프로젝트 PM)은 그대로 유지
 * - 프로젝트 PM이 그 프로젝트에 배정돼 있는데 PM 역할 배정이 없으면 그 배정을 PM으로 표시
 */
export async function migratePmRole() {
  const n = await prisma.employee.updateMany({ where: { role: 'PM' }, data: { role: 'EMP' } });
  if (n.count) console.log(`PM 역할 계정 ${n.count}명을 수행인력으로 변경했습니다.`);
  const prjs = await prisma.project.findMany({ where: { pmEmpId: { not: null } }, select: { prjCd: true, pmEmpId: true } });
  for (const p of prjs) {
    const hasPm = await prisma.assignment.count({ where: { prjCd: p.prjCd, roleCd: 'PM', empId: p.pmEmpId!, canceled: false } });
    if (hasPm) continue;
    const a = await prisma.assignment.findFirst({ where: { prjCd: p.prjCd, empId: p.pmEmpId!, canceled: false }, orderBy: { endDt: 'desc' } });
    if (a) await prisma.assignment.update({ where: { asgId: a.asgId }, data: { roleCd: 'PM' } });
  }
}

export async function getPermissions(): Promise<PermissionMap> {
  if (cache) return cache;
  const rows = await prisma.menuPermission.findMany();
  const map = Object.fromEntries(ROLES.map((r) => [r, Object.fromEntries(MENUS.map((m) => [m.key, 'NONE' as Level]))])) as PermissionMap;
  for (const r of rows) if (map[r.role as PermRole] && r.menu in map[r.role as PermRole]) map[r.role as PermRole][r.menu] = r.level as Level;
  cache = map;
  return map;
}

export async function savePermissions(input: Record<string, Record<string, string>>) {
  const ops = [];
  for (const [role, menus] of Object.entries(input)) {
    if (!ROLES.includes(role as PermRole)) throw new HttpError(400, `알 수 없는 역할: ${role}`);
    for (const [menu, level] of Object.entries(menus)) {
      const def = MENUS.find((m) => m.key === menu);
      if (!def) throw new HttpError(400, `알 수 없는 메뉴: ${menu}`);
      if (!(level in RANK)) throw new HttpError(400, `알 수 없는 권한: ${level}`);
      if (level === 'EDIT' && !def.editable) throw new HttpError(400, `${def.label}은(는) 조회 전용 메뉴입니다.`);
      ops.push(prisma.menuPermission.upsert({ where: { role_menu: { role, menu } }, create: { role, menu, level }, update: { level } }));
    }
  }
  await prisma.$transaction(ops);
  cache = null;
}

export async function levelOf(u: AuthUser, menu: string): Promise<Level> {
  const p = await getPermissions();
  const own = p[u.role]?.[menu] ?? 'NONE';
  const asPm = u.pm ? (p.PM?.[menu] ?? 'NONE') : 'NONE'; // 프로젝트 PM으로 지정되면 PM 권한을 더함
  return RANK[asPm] > RANK[own] ? asPm : own;
}

/** 사용자의 실제 메뉴 권한 (역할 + 프로젝트 PM 지정) */
export async function effectivePermissions(u: AuthUser): Promise<Record<string, Level>> {
  const out: Record<string, Level> = {};
  for (const m of MENUS) out[m.key] = await levelOf(u, m.key);
  return out;
}

/** 메뉴 중 하나라도 해당 단계 이상이면 통과 */
export async function can(u: AuthUser, menus: string | string[], level: Level = 'VIEW') {
  for (const m of Array.isArray(menus) ? menus : [menus]) if (RANK[await levelOf(u, m)] >= RANK[level]) return true;
  return false;
}

export async function assertMenu(u: AuthUser, menus: string | string[], level: Level = 'VIEW') {
  if (!(await can(u, menus, level))) throw forbidden();
}

/** 라우트 미들웨어: requireMenu('employees', 'EDIT') / requireMenu(['staffing','dashboard']) */
export function requireMenu(menus: string | string[], level: Level = 'VIEW') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, '로그인이 필요합니다.');
    await assertMenu(req.user, menus, level);
    next();
  };
}
