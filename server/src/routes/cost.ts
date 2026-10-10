import { Router } from 'express';
import { z } from 'zod';
import { HttpError, prisma } from '../db.js';
import { requireMenu } from '../lib/permissions.js';
import { getSettings } from '../lib/settings.js';
import { dateStr, parse } from '../lib/validate.js';

/**
 * 원가 기준 (수익성 분석의 기준값) — 메뉴 'costBasis'
 * - 조회: 사업관리자·시스템관리자 (메뉴 권한 VIEW), 변경: 시스템관리자 (EDIT)
 * - 원가 값은 이 API로만 내려줌 (다른 화면 응답에 섞지 않음)
 */
export const costRouter = Router();
costRouter.use(requireMenu('costBasis'));
const edit = requireMenu('costBasis', 'EDIT');

/** 원가 비율 키 (값은 %, 연도는 숫자) */
export const COST_CONFIG_KEYS = ['LEGAL_RATE', 'OVERHEAD_RATE', 'RESERVE_RATE', 'KOSA_OVERHEAD_RATE', 'KOSA_TECH_FEE_RATE', 'KOSA_YEAR'] as const;
/** 이익률 판정을 쓰는 사업구분 (내부·제안·기타는 원가만 집계) */
export const MARGIN_TYPES = ['SM', 'SI'] as const;

const pct = z.number().min(0).max(1000);
const won = z.number().int().min(0).max(10_000_000_000);

costRouter.get('/basis', async (_req, res) => {
  const [settings, configRows, grades, margins, partnerRates, kosa, roleJobs, empGrades] = await Promise.all([
    getSettings(),
    prisma.costConfig.findMany(),
    prisma.costGrade.findMany({ orderBy: [{ gradeCd: 'asc' }, { applyStartDt: 'desc' }] }),
    prisma.marginRule.findMany(),
    prisma.partnerGradeRate.findMany(),
    prisma.kosaWage.findMany({ orderBy: [{ year: 'desc' }, { seq: 'asc' }, { jobNm: 'asc' }] }),
    prisma.roleJobMap.findMany(),
    prisma.employee.groupBy({ by: ['gradeCd'], where: { deletedAt: null, employType: { not: 'PARTNER' } }, _count: true }),
  ]);
  res.json({
    mdPerMm: Number(settings.MD_PER_MM) || 22,
    config: Object.fromEntries(COST_CONFIG_KEYS.map((k) => [k, configRows.find((r) => r.key === k)?.value ?? null])),
    grades,
    // 자사 인력에 실제 쓰이는 직급 (원가 미등록 직급 안내용)
    gradesInUse: empGrades.filter((g) => g.gradeCd && g.gradeCd !== '-').map((g) => ({ gradeCd: g.gradeCd, count: g._count })),
    margins: MARGIN_TYPES.map((t) => margins.find((m) => m.prjType === t) ?? { prjType: t, targetRate: null, minRate: null }),
    partnerRates,
    kosa,
    roleJobs,
  });
});

// 원가 비율
costRouter.put('/config', edit, async (req, res) => {
  const body = parse(z.partialRecord(z.enum(COST_CONFIG_KEYS), pct.or(z.number().int().min(2000).max(2100)).nullable()), req.body);
  for (const [key, value] of Object.entries(body)) {
    if (value == null) await prisma.costConfig.deleteMany({ where: { key } });
    else await prisma.costConfig.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
  res.json({ ok: true });
});

// 직급 인건비: 같은 직급·적용일이면 수정, 아니면 새 이력
costRouter.put('/grades', edit, async (req, res) => {
  const body = parse(z.object({ rows: z.array(z.object({ gradeCd: z.string().trim().min(1).max(20), monthlySalary: won, applyStartDt: dateStr })).max(100) }), req.body);
  for (const r of body.rows)
    await prisma.costGrade.upsert({
      where: { gradeCd_applyStartDt: { gradeCd: r.gradeCd, applyStartDt: r.applyStartDt } },
      create: r,
      update: { monthlySalary: r.monthlySalary },
    });
  res.json({ ok: true });
});
costRouter.delete('/grades/:id', edit, async (req, res) => {
  await prisma.costGrade.deleteMany({ where: { id: Number(req.params.id) } });
  res.json({ ok: true });
});

// 이익률 판정 기준
costRouter.put('/margins', edit, async (req, res) => {
  const body = parse(z.object({ rows: z.array(z.object({ prjType: z.enum(MARGIN_TYPES), targetRate: pct.max(100), minRate: pct.max(100) })) }), req.body);
  for (const r of body.rows) {
    if (r.minRate > r.targetRate) throw new HttpError(400, `${r.prjType}: 최소 이익률이 목표 이익률보다 클 수 없습니다.`);
    await prisma.marginRule.upsert({ where: { prjType: r.prjType }, create: r, update: r });
  }
  res.json({ ok: true });
});

// 협력사 등급별 기본 월단가 (0 또는 빈 값은 삭제)
costRouter.put('/partner-rates', edit, async (req, res) => {
  const body = parse(z.object({ rows: z.array(z.object({ gradeCd: z.string().trim().min(1).max(20), monthlyRate: won.nullable() })).max(20) }), req.body);
  for (const r of body.rows) {
    if (!r.monthlyRate) await prisma.partnerGradeRate.deleteMany({ where: { gradeCd: r.gradeCd } });
    else await prisma.partnerGradeRate.upsert({ where: { gradeCd: r.gradeCd }, create: { gradeCd: r.gradeCd, monthlyRate: r.monthlyRate }, update: { monthlyRate: r.monthlyRate } });
  }
  res.json({ ok: true });
});

// KOSA 평균임금: 연도 단위로 통째로 저장 (목록 순서 유지)
costRouter.put('/kosa/:year', edit, async (req, res) => {
  const year = parse(z.coerce.number().int().min(2000).max(2100), req.params.year);
  const body = parse(
    z.object({ rows: z.array(z.object({ jobNm: z.string().trim().min(1).max(40), dailyWage: won, monthlyWage: won.nullable().optional() })).max(100) }),
    req.body,
  );
  const names = body.rows.map((r) => r.jobNm);
  if (new Set(names).size !== names.length) throw new HttpError(400, '같은 직무가 두 번 들어 있습니다.');
  await prisma.$transaction([
    prisma.kosaWage.deleteMany({ where: { year } }),
    ...body.rows.map((r, i) => prisma.kosaWage.create({ data: { year, jobNm: r.jobNm, dailyWage: r.dailyWage, monthlyWage: r.monthlyWage ?? null, seq: i } })),
  ]);
  res.json({ ok: true });
});

// 역할 → KOSA 직무 매핑 (빈 값은 삭제)
costRouter.put('/role-jobs', edit, async (req, res) => {
  const body = parse(z.object({ rows: z.array(z.object({ roleCd: z.string().min(1).max(20), jobNm: z.string().trim().max(40) })).max(30) }), req.body);
  for (const r of body.rows) {
    if (!r.jobNm) await prisma.roleJobMap.deleteMany({ where: { roleCd: r.roleCd } });
    else await prisma.roleJobMap.upsert({ where: { roleCd: r.roleCd }, create: r, update: { jobNm: r.jobNm } });
  }
  res.json({ ok: true });
});
