import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { blockUntilPasswordChanged, requireAuth } from './auth.js';
import { HttpError } from './db.js';
import { ensureDefaultSettings } from './lib/settings.js';
import { accountRequestsRouter } from './routes/accountRequests.js';
import { adminRouter } from './routes/admin.js';
import { assignmentsRouter } from './routes/assignments.js';
import { authRouter } from './routes/auth.js';
import { employeesRouter } from './routes/employees.js';
import { partnersRouter } from './routes/partners.js';
import { projectsRouter } from './routes/projects.js';
import { projectWeeklyRouter, reportsRouter } from './routes/reports.js';
import { statsRouter } from './routes/stats.js';
import { weeklyWorksRouter } from './routes/weeklyWorks.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const api = express.Router();
api.use('/auth', authRouter);
api.use(requireAuth, blockUntilPasswordChanged);
api.use('/employees', employeesRouter);
api.use('/admin/partners', partnersRouter);
api.use('/admin/account-requests', accountRequestsRouter);
api.use('/projects', projectWeeklyRouter); // 프로젝트 주간보고·마일스톤
api.use('/projects', projectsRouter);
api.use('/reports', reportsRouter);
api.use('/assignments', assignmentsRouter);
api.use('/weekly-works', weeklyWorksRouter);
api.use('/stats', statsRouter);
api.use('/admin', adminRouter);
app.use('/api/v1', api);

// 운영(npm start = 빌드된 dist/index.js 실행): 빌드된 프론트엔드 정적 서빙
// 개발(npm run dev = tsx로 src/index.ts 실행): 예전 빌드가 열리지 않도록 화면은 Vite(5173)로 안내
const isProduction = import.meta.url.endsWith('.js');
const clientDist = path.resolve(import.meta.dirname, '../../client/dist');
if (isProduction && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
} else if (!isProduction) {
  app.get(/^\/(?!api\/).*/, (req, res) => res.redirect(`http://localhost:5173${req.originalUrl}`));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, details: err.details });
    return;
  }
  console.error(err);
  res.status(500).json({ message: '서버 오류가 발생했습니다.' });
});

const port = Number(process.env.PORT) || 4000;
ensureDefaultSettings()
  .then((n) => n && console.log(`기준값 기본값 ${n}건을 DB에 저장했습니다.`))
  .catch((e) => console.error('기준값 초기화 실패', e));
app.listen(port, () => console.log(`BT-HRM API listening on http://localhost:${port}`));
