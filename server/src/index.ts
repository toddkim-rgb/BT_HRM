import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { requireAuth } from './auth.js';
import { HttpError } from './db.js';
import { adminRouter } from './routes/admin.js';
import { assignmentsRouter } from './routes/assignments.js';
import { authRouter } from './routes/auth.js';
import { employeesRouter } from './routes/employees.js';
import { partnersRouter } from './routes/partners.js';
import { projectsRouter } from './routes/projects.js';
import { statsRouter } from './routes/stats.js';
import { weeklyWorksRouter } from './routes/weeklyWorks.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const api = express.Router();
api.use('/auth', authRouter);
api.use(requireAuth);
api.use('/employees', employeesRouter);
api.use('/admin/partners', partnersRouter);
api.use('/projects', projectsRouter);
api.use('/assignments', assignmentsRouter);
api.use('/weekly-works', weeklyWorksRouter);
api.use('/stats', statsRouter);
api.use('/admin', adminRouter);
app.use('/api/v1', api);

// 운영: 빌드된 프론트엔드 정적 서빙
const clientDist = path.resolve(import.meta.dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
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
app.listen(port, () => console.log(`BT-HRM API listening on http://localhost:${port}`));
