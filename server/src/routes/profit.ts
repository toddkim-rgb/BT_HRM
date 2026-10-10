import { Router } from 'express';
import { z } from 'zod';
import { me } from '../auth.js';
import { HttpError, prisma } from '../db.js';
import { addDays, addMonths, today } from '../lib/dates.js';
import { requireMenu } from '../lib/permissions.js';
import { calculate, loadBasis, standardCost, type Basis, type SimInput, type SimResult } from '../lib/simCalc.js';
import { dateStr, parse } from '../lib/validate.js';

/**
 * 수익성 분석 — 사업비 시뮬레이션 · 실행예산 기준선(VRB) (메뉴 'profit')
 * - 조회·작성·확정: 사업관리자·시스템관리자 (메뉴 권한)
 * - 기준선으로 확정하면 잠기고, 확정 당시 기준값·결과를 그대로 보관 (원가 기준이 바뀌어도 금액 유지)
 */
export const profitRouter = Router();
profitRouter.use(requireMenu('profit'));
const edit = requireMenu('profit', 'EDIT');

const PARTNER_GRADES = ['초급', '중급', '고급', '특급'];
const won = z.number().int().min(0).max(100_000_000_000);
const rowSchema = z.object({
  type: z.enum(['OWN', 'PARTNER']),
  grade: z.string().trim().min(1).max(20),
  roleCd: z.string().min(1).max(20),
  jobNm: z.string().trim().max(40).nullish(),
  headcount: z.number().positive().max(100),
  startDt: dateStr,
  endDt: dateStr,
  allocRate: z.number().positive().max(100),
  monthlyRate: won.nullish(),
  note: z.string().max(100).nullish(),
});
const expenseSchema = z.object({ category: z.enum(['TRAVEL', 'EQUIP', 'LICENSE', 'OUTSOURCE', 'ETC']), amount: won, memo: z.string().max(100).nullish() });
const inputSchema = z
  .object({
    startDt: dateStr,
    endDt: dateStr,
    reserveRate: z.number().min(0).max(100),
    targetRate: z.number().min(-100).max(99),
    minRate: z.number().min(-100).max(99),
    proposedAmt: won.nullish(),
    rows: z.array(rowSchema).max(200),
    expenses: z.array(expenseSchema).max(50),
  })
  .refine((v) => v.startDt <= v.endDt, { message: '사업 종료일이 시작일보다 빠릅니다.', path: ['endDt'] })
  .refine((v) => v.minRate <= v.targetRate, { message: '최소 이익률이 목표 이익률보다 클 수 없습니다.', path: ['minRate'] });

type SimRec = NonNullable<Awaited<ReturnType<typeof prisma.simulation.findUnique>>>;
const inputOf = (s: SimRec): SimInput => ({
  startDt: s.startDt,
  endDt: s.endDt,
  reserveRate: s.reserveRate,
  targetRate: s.targetRate,
  minRate: s.minRate,
  proposedAmt: s.proposedAmt,
  rows: JSON.parse(s.rows),
  expenses: JSON.parse(s.expenses),
});
/** 기준선은 확정 당시 결과, 작성 중이면 지금 기준값으로 계산 */
const resultOf = (s: SimRec, basis: Basis): SimResult => (s.statusCd === 'BASELINE' && s.snapshot ? JSON.parse(s.snapshot).result : calculate(inputOf(s), basis));

async function getSim(id: unknown) {
  const s = await prisma.simulation.findUnique({ where: { simId: Number(id) || 0 } });
  if (!s) throw new HttpError(404, '시뮬레이션을 찾을 수 없습니다.');
  return s;
}
const assertDraft = (s: SimRec) => {
  if (s.statusCd !== 'DRAFT') throw new HttpError(400, '기준선으로 확정된 시뮬레이션은 바꿀 수 없습니다. 복사해서 새 안으로 수정하세요.');
};
const names = async (ids: (string | null)[]) => {
  const list = await prisma.employee.findMany({ where: { empId: { in: ids.filter((x): x is string => !!x) } }, select: { empId: true, name: true } });
  return new Map(list.map((e) => [e.empId, e.name]));
};

/** 입력 화면 선택지: 직급(현재 표준원가)·협력사 등급 단가·역할→직무·KOSA 직무·판정 기준 기본값 */
profitRouter.get('/options', async (_req, res) => {
  const [basis, roleJobs, margins, reserve] = await Promise.all([loadBasis(), prisma.roleJobMap.findMany(), prisma.marginRule.findMany(), prisma.costConfig.findUnique({ where: { key: 'RESERVE_RATE' } })]);
  const t = today();
  res.json({
    mdPerMm: basis.mdPerMm,
    ownGrades: Object.keys(basis.gradeSalaries).map((g) => ({ grade: g, monthlyCost: Math.round(standardCost(basis, g, t) ?? 0) })),
    partnerGrades: PARTNER_GRADES.map((g) => ({ grade: g, monthlyCost: basis.partnerRates[g] ?? null })),
    roleJobs: Object.fromEntries(roleJobs.map((r) => [r.roleCd, r.jobNm])),
    kosaYear: basis.kosaYear,
    kosaJobs: Object.keys(basis.kosaWages),
    margins,
    reserveRate: reserve?.value ?? 0,
  });
});

/** 시뮬레이션 대상 프로젝트 (제안 포함, 중단 제외) */
profitRouter.get('/projects', async (_req, res) => {
  res.json(
    await prisma.project.findMany({
      where: { statusCd: { not: 'STOP' } },
      select: { prjCd: true, prjNm: true, prjType: true, customerNm: true, statusCd: true, startDt: true, endDt: true, contractAmt: true },
      orderBy: [{ statusCd: 'asc' }, { prjNm: 'asc' }],
    }),
  );
});

/** 목록: 프로젝트별 시뮬레이션과 요약 */
profitRouter.get('/sims', async (_req, res) => {
  const [sims, basis] = await Promise.all([prisma.simulation.findMany({ orderBy: [{ prjCd: 'asc' }, { createdAt: 'asc' }] }), loadBasis()]);
  const prjs = await prisma.project.findMany({ where: { prjCd: { in: [...new Set(sims.map((s) => s.prjCd))] } }, select: { prjCd: true, prjNm: true, prjType: true, customerNm: true, statusCd: true, contractAmt: true } });
  const who = await names(sims.flatMap((s) => [s.createdBy, s.confirmedBy]));
  res.json(
    sims.map((s) => {
      const r = resultOf(s, basis);
      return {
        simId: s.simId,
        prjCd: s.prjCd,
        project: prjs.find((p) => p.prjCd === s.prjCd) ?? null,
        name: s.name,
        statusCd: s.statusCd,
        version: s.version,
        startDt: s.startDt,
        endDt: s.endDt,
        targetRate: s.targetRate,
        mm: r.totals.mm,
        totalCost: r.totals.totalCost,
        fairPrice: r.totals.fairPrice,
        kosaBudget: r.kosa?.budget ?? null,
        proposed: r.proposed,
        createdBy: who.get(s.createdBy) ?? s.createdBy,
        confirmedBy: s.confirmedBy ? who.get(s.confirmedBy) ?? s.confirmedBy : null,
        confirmedAt: s.confirmedAt,
        updatedAt: s.updatedAt,
      };
    }),
  );
});

/** 새 시뮬레이션: 프로젝트 기간·사업구분별 판정 기준·기본 예비비율로 시작 */
profitRouter.post('/sims', edit, async (req, res) => {
  const body = parse(z.object({ prjCd: z.string().min(1), name: z.string().trim().min(1).max(40) }), req.body);
  const p = await prisma.project.findUnique({ where: { prjCd: body.prjCd } });
  if (!p) throw new HttpError(404, '프로젝트를 찾을 수 없습니다.');
  const [margin, reserve] = await Promise.all([prisma.marginRule.findUnique({ where: { prjType: p.prjType } }), prisma.costConfig.findUnique({ where: { key: 'RESERVE_RATE' } })]);
  const startDt = p.startDt ?? today();
  const endDt = p.endDt && p.endDt >= startDt ? p.endDt : addDays(`${addMonths(startDt.slice(0, 7), 12)}-01`, -1);
  const s = await prisma.simulation.create({
    data: {
      prjCd: p.prjCd,
      name: body.name,
      startDt,
      endDt,
      reserveRate: reserve?.value ?? 0,
      targetRate: margin?.targetRate ?? 0,
      minRate: margin?.minRate ?? 0,
      proposedAmt: p.contractAmt ?? null,
      rows: '[]',
      expenses: '[]',
      createdBy: me(req).empId,
    },
  });
  res.status(201).json({ simId: s.simId });
});

profitRouter.get('/sims/:id', async (req, res) => {
  const s = await getSim(req.params.id);
  const [basis, project, versions] = await Promise.all([
    loadBasis(),
    prisma.project.findUnique({ where: { prjCd: s.prjCd }, select: { prjCd: true, prjNm: true, prjType: true, customerNm: true, statusCd: true, startDt: true, endDt: true, contractAmt: true } }),
    prisma.simulation.findMany({ where: { prjCd: s.prjCd, statusCd: 'BASELINE' }, select: { version: true }, orderBy: { version: 'desc' }, take: 1 }),
  ]);
  const who = await names([s.createdBy, s.confirmedBy]);
  const snap = s.snapshot ? JSON.parse(s.snapshot) : null;
  res.json({
    simId: s.simId,
    prjCd: s.prjCd,
    project,
    name: s.name,
    statusCd: s.statusCd,
    version: s.version,
    latestBaseline: versions[0]?.version ?? null,
    memo: s.memo,
    input: inputOf(s),
    result: resultOf(s, basis),
    basisAt: snap?.basis ? { kosaYear: snap.basis.kosaYear, legalRate: snap.basis.legalRate, overheadRate: snap.basis.overheadRate } : null,
    createdBy: who.get(s.createdBy) ?? s.createdBy,
    confirmedBy: s.confirmedBy ? who.get(s.confirmedBy) ?? s.confirmedBy : null,
    confirmedAt: s.confirmedAt,
    updatedAt: s.updatedAt,
  });
});

profitRouter.put('/sims/:id', edit, async (req, res) => {
  const s = await getSim(req.params.id);
  assertDraft(s);
  const body = parse(inputSchema.and(z.object({ name: z.string().trim().min(1).max(40), memo: z.string().max(500).nullish() })), req.body);
  await prisma.simulation.update({
    where: { simId: s.simId },
    data: {
      name: body.name,
      memo: body.memo ?? null,
      startDt: body.startDt,
      endDt: body.endDt,
      reserveRate: body.reserveRate,
      targetRate: body.targetRate,
      minRate: body.minRate,
      proposedAmt: body.proposedAmt ?? null,
      rows: JSON.stringify(body.rows),
      expenses: JSON.stringify(body.expenses),
    },
  });
  res.json({ ok: true });
});

profitRouter.delete('/sims/:id', edit, async (req, res) => {
  const s = await getSim(req.params.id);
  assertDraft(s);
  await prisma.simulation.delete({ where: { simId: s.simId } });
  res.json({ ok: true });
});

/** 입력 중 미리보기 계산 (저장하지 않음) */
profitRouter.post('/calc', async (req, res) => {
  const input = parse(inputSchema, req.body);
  res.json(calculate(input, await loadBasis()));
});

/** 복사 → 새 작성 중 안 (기준선 변경 시 v2를 만들 때도 사용) */
profitRouter.post('/sims/:id/copy', edit, async (req, res) => {
  const s = await getSim(req.params.id);
  const body = parse(z.object({ name: z.string().trim().min(1).max(40) }), req.body);
  const c = await prisma.simulation.create({
    data: {
      prjCd: s.prjCd,
      name: body.name,
      startDt: s.startDt,
      endDt: s.endDt,
      reserveRate: s.reserveRate,
      targetRate: s.targetRate,
      minRate: s.minRate,
      proposedAmt: s.proposedAmt,
      memo: s.memo,
      rows: s.rows,
      expenses: s.expenses,
      createdBy: me(req).empId,
    },
  });
  res.status(201).json({ simId: c.simId });
});

/** 기준선(실행예산) 확정: 잠금 + 버전 + 확정 당시 기준값·결과 보관 */
profitRouter.post('/sims/:id/confirm', edit, async (req, res) => {
  const s = await getSim(req.params.id);
  assertDraft(s);
  const input = parse(inputSchema, inputOf(s));
  if (!input.rows.length) throw new HttpError(400, '인력 투입 행이 없습니다.');
  const basis = await loadBasis();
  const result = calculate(input, basis);
  const last = await prisma.simulation.aggregate({ where: { prjCd: s.prjCd, statusCd: 'BASELINE' }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  await prisma.simulation.update({
    where: { simId: s.simId },
    data: { statusCd: 'BASELINE', version, snapshot: JSON.stringify({ basis, result }), confirmedBy: me(req).empId, confirmedAt: new Date() },
  });
  res.json({ version });
});

/** 현재 배정 불러오기: 프로젝트에 배정된 인력을 투입 행으로 (자사=직급, 협력사=기술등급) */
profitRouter.get('/assignments/:prjCd', async (req, res) => {
  const [list, roleJobs] = await Promise.all([
    prisma.assignment.findMany({
      where: { prjCd: String(req.params.prjCd), canceled: false },
      include: { employee: { select: { name: true, gradeCd: true, employType: true, skillLevel: true } } },
      orderBy: [{ startDt: 'asc' }],
    }),
    prisma.roleJobMap.findMany(),
  ]);
  const job = Object.fromEntries(roleJobs.map((r) => [r.roleCd, r.jobNm]));
  res.json(
    list.map((a) => {
      const partner = a.employee.employType === 'PARTNER';
      return {
        type: partner ? 'PARTNER' : 'OWN',
        grade: partner ? a.employee.skillLevel || '중급' : a.employee.gradeCd,
        roleCd: a.roleCd,
        jobNm: job[a.roleCd] ?? null,
        headcount: 1,
        startDt: a.startDt,
        endDt: a.endDt,
        allocRate: a.allocRate,
        monthlyRate: null,
        note: a.employee.name,
      };
    }),
  );
});
