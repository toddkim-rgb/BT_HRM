import { z } from 'zod';
import { HttpError } from '../db.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || '입력값'}: ${i.message}`).join(', ');
    throw new HttpError(400, `입력값 오류 - ${msg}`, r.error.issues);
  }
  return r.data;
}

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식');
export const ymStr = z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM 형식');
export const optDate = dateStr.nullish().or(z.literal('').transform(() => null));
export const optStr = z.string().nullish().transform((v) => (v === '' ? null : v ?? null));
