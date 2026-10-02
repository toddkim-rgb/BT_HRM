import bcrypt from 'bcryptjs';
import { HttpError } from '../db.js';

/** 새 비밀번호 규칙: 8자 이상, 영문·숫자 포함 */
export function assertPasswordPolicy(pw: string) {
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new HttpError(400, '비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.');
  }
}

/** 초기 비밀번호 = 본인 이메일 주소(소문자). 첫 로그인 시 변경 강제(mustChangePw)와 함께 쓴다 */
export function initialPasswordHash(email: string): Promise<string> {
  return bcrypt.hash(email.trim().toLowerCase(), 10);
}

/** 이메일 일부 가리기: gildong.hong@example.com → gi****@example.com */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}****@${domain}`;
}

/** 로그인 화면 공개 API 남용 방지 (IP별 간단한 횟수 제한, 메모리) */
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, '요청이 너무 많습니다. 잠시 후 다시 시도하세요.');
  list.push(now);
  hits.set(key, list);
}
