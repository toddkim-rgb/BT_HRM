import { PrismaLibSQL } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';

// 운영(Vercel): Turso(SQLite 호환 원격 DB) — TURSO_DATABASE_URL·TURSO_AUTH_TOKEN 환경변수
// 개발: 로컬 SQLite 파일 (DATABASE_URL)
const turso = process.env.TURSO_DATABASE_URL;
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
