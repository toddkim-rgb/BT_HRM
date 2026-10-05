import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { app, errorHandler, init } from './app.js';

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

app.use(errorHandler);

const port = Number(process.env.PORT) || 4000;
init();
app.listen(port, () => console.log(`BT-HRM API listening on http://localhost:${port}`));
