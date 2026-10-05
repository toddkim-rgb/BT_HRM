import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';

// 운영(Vercel): Turso(SQLite 호환 원격 DB) — TURSO_DATABASE_URL·TURSO_AUTH_TOKEN 환경변수
// 개발: 로컬 SQLite 파일 (DATABASE_URL)
const turso = process.env.TURSO_DATABASE_URL;
if (!turso && process.env.VERCEL) {
  // 배포 환경에 DB 연결 정보가 없으면 원인을 로그에 분명히 남김 (Vercel 프로젝트 Storage에서 Turso DB 연결 필요)
  console.error('TURSO_DATABASE_URL 환경변수가 없습니다. Vercel 프로젝트의 Storage에서 Turso DB를 연결한 뒤 다시 배포하세요.');
}
export const prisma = turso
  ? new PrismaClient({ adapter: new PrismaLibSQL({ url: turso, authToken: process.env.TURSO_AUTH_TOKEN }) })
  : new PrismaClient();

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = '대상') => new HttpError(404, `${what}을(를) 찾을 수 없습니다.`);
export const forbidden = () => new HttpError(403, '권한이 없습니다.');
