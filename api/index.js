// Vercel 서버리스 함수: /api/* 요청을 Express 앱으로 처리 (빌드된 server/dist 사용)
import { app, errorHandler } from '../server/dist/app.js';

app.use(errorHandler);
export default app;
