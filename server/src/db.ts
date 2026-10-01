import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

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
