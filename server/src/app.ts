// API 앱 (로컬: src/index.ts가 실행, Vercel: api/index.js가 서버리스 함수로 사용)
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { blockUntilPasswordChanged, requireAuth } from './auth.js';
import { HttpError } from './db.js';
import { ensureDefaultSettings } from './lib/settings.js';
import { can, ensureDefaultPermissions, migratePmRole } from './lib/permissions.js';
import { accountRequestsRouter } from './routes/accountRequests.js';
import { adminRouter } from './routes/admin.js';
import { assignmentsRouter } from './routes/assignments.js';
import { authRouter } from './routes/auth.js';
import { employeesRouter } from './routes/employees.js';
import { partnersRouter } from './routes/partners.js';
import { projectsRouter } from './routes/projects.js';
import { projectWeeklyRouter, reportsRouter } from './routes/reports.js';
import { statsRouter } from './routes/stats.js';
import { greetingRouter } from './routes/greeting.js';
import { weeklyWorksRouter } from './routes/weeklyWorks.js';

export const app = express();

// 서버 시작(또는 서버리스 첫 요청) 시 기준값·메뉴 권한 기본값을 DB에 한 번 저장
let initPromise: Promise<void> | null = null;
export function init() {
  initPromise ??= (async () => {
    const n = await ensureDefaultSettings();
    if (n) console.log(`기준값 기본값 ${n}건을 DB에 저장했습니다.`);
    await ensureDefaultPermissions();
    await migratePmRole();
  })().catch((e) => {
    initPromise = null;
    console.error('기본값 초기화 실패', e);
  });
  return initPromise;
}

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(async (_req, _res, next) => {
  await init();
  next();
});

const api = express.Router();
api.use('/auth', authRouter);
api.use(requireAuth, blockUntilPasswordChanged);
// 수행인력에게는 기술등급·고용형태를 내려보내지 않음 (인력 편집 권한을 받은 경우는 예외 — 편집 화면에 필요)
const HR_KEYS = new Set(['skillLevel', 'employType']);
const stripHr = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stripHr) : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.entries(v).filter(([k]) => !HR_KEYS.has(k)).map(([k, x]) => [k, stripHr(x)])) : v;
api.use(async (req, res, next) => {
  const u = req.user;
  if (u?.role === 'EMP' && !(await can(u, 'employees', 'EDIT'))) {
    const json = res.json.bind(res);
    res.json = (body: unknown) => json(stripHr(body));
  }
  next();
});
api.use('/employees', employeesRouter);
api.use('/admin/partners', partnersRouter);
api.use('/admin/account-requests', accountRequestsRouter);
api.use('/projects', projectWeeklyRouter); // 프로젝트 주간보고·마일스톤
api.use('/projects', projectsRouter);
api.use('/reports', reportsRouter);
api.use('/assignments', assignmentsRouter);
api.use('/weekly-works', weeklyWorksRouter);
api.use('/stats', statsRouter);
api.use('/greeting', greetingRouter); // 대시보드 인사말 (날씨·내 업무 현황)
api.use('/admin', adminRouter);
app.use('/api/v1', api);

/** 오류 응답 (정적 파일·개발 안내 라우트를 붙인 뒤 마지막에 등록) */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, details: err.details });
    return;
  }
  console.error(err);
  res.status(500).json({ message: '서버 오류가 발생했습니다.' });
}
