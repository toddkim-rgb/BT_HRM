import crypto from 'node:crypto';
import { HttpError } from '../db.js';

/** 새 비밀번호 규칙: 8자 이상, 영문·숫자 포함 */
export function assertPasswordPolicy(pw: string) {
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new HttpError(400, '비밀번호는 8자 이상이며 영문과 숫자를 모두 포함해야 합니다.');
  }
}

/** 임시 비밀번호 (헷갈리는 문자 제외, 영문·숫자 포함 10자) */
export function tempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const chars = [pick(letters), pick(digits), ...Array.from({ length: 8 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
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
