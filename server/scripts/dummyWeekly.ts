/**
 * 주간 업무보고 더미 데이터 생성 / 삭제 (개발·시연용)
 *   생성(미리보기): npx tsx --env-file=.env.turso scripts/dummyWeekly.ts
 *   생성(실행):     npx tsx --env-file=.env.turso scripts/dummyWeekly.ts --apply
 *   삭제:           npx tsx --env-file=.env.turso scripts/dummyWeekly.ts --delete --apply
 *   (로컬은 --env-file 대신 DATABASE_URL 사용)
 *
 * - 배정 시작 ~ 오늘(이번 주 지난 평일 포함), 배정된 평일(공휴일 제외)마다 1MD (같은 날 배정이 여러 개면 0.5MD씩, 하루 합계 1MD)
 * - 금주 실적·차주 계획·간간이 이슈/리스크/요청(건의) — 제출 상태
 * - 이미 보고서가 있는 주는 건너뜀, 비고(remark)가 '[더미]'로 시작 → 삭제 시 이것만 지움
 */
import { prisma } from '../src/db.js';
import { addDays, isoWeek, shiftWeek, today, weekDays } from '../src/lib/dates.js';

const APPLY = process.argv.includes('--apply');
const DELETE = process.argv.includes('--delete');
const MARK = '[더미]';

// 결정적 난수 (같은 사람·주차는 늘 같은 내용)
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
const between = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

const SI_TASKS: Record<string, string[]> = {
  PM: ['프로젝트 일정·범위 관리', '고객 협의 및 주간 보고', '리스크·이슈 관리', '산출물 검토', '단계 종료 점검'],
  PL: ['업무 분석 및 설계 검토', '개발 표준·진척 관리', '통합 테스트 계획', '결함 조치 관리'],
  DESIGN: ['요구사항 정의', '화면 설계', 'DB 설계', '인터페이스 설계', '설계 산출물 정리'],
  DEV: ['요구사항 분석', '화면 개발', 'API 개발', '배치 개발', '단위 테스트', '통합 테스트 결함 조치'],
  QA: ['테스트 시나리오 작성', '통합 테스트 수행', '결함 관리', '인수 테스트 지원'],
  OPS: ['운영 환경 점검', '배포 지원', '모니터링 체계 구성'],
  ETC: ['업무 지원', '문서 정리', '회의 지원'],
};
const SI_CONTENT = ['주요 기능 구현 및 검토 진행', '고객 피드백 반영', '세부 항목 정리 및 보완', '관련 부서 협의 완료', '산출물 작성 및 내부 검토', '테스트 데이터 준비 및 확인'];
const DELAY_REASON = ['고객 요구사항 변경으로 일정 조정', '외부 연계 시스템 일정 지연', '테스트 환경 준비 지연', '추가 분석 필요 항목 발생'];
const SM_ITEMS: { type: string; name: string; contents: string[]; min: number; max: number; prob: number }[] = [
  { type: 'PERIODIC', name: '정기 점검', contents: ['서버·DB 상태 점검', '백업 정상 여부 확인', '보안 패치 적용 여부 점검'], min: 1, max: 2, prob: 1 },
  { type: 'REQUEST', name: '사용자 요청 처리', contents: ['데이터 정정 요청 처리', '권한·계정 요청 처리', '화면 문구 수정 요청 반영', '통계 자료 추출 요청 처리'], min: 2, max: 7, prob: 0.95 },
  { type: 'INCIDENT', name: '장애 대응', contents: ['일시적 접속 지연 원인 분석 및 조치', '배치 실패 재처리', '외부 연계 오류 조치'], min: 1, max: 2, prob: 0.25 },
  { type: 'IMPROVE', name: '개선 개발', contents: ['조회 화면 성능 개선', '엑셀 다운로드 기능 개선', '관리자 화면 기능 추가'], min: 1, max: 1, prob: 0.4 },
];
const ISSUES: { type: string; sev: string; content: string; action: string; support?: boolean }[] = [
  { type: 'ISSUE', sev: 'M', content: '고객 요구사항 추가 요청 접수 (범위 협의 필요)', action: 'PM 주관 고객 협의 후 변경 요청서 작성' },
  { type: 'ISSUE', sev: 'L', content: '테스트 데이터 일부 누락 확인', action: '고객 담당자에게 데이터 추가 요청' },
  { type: 'RISK', sev: 'M', content: '외부 연계 시스템 일정 지연 시 통합 테스트 지연 우려', action: '연계 일정 주간 점검, 모의 데이터로 선행 테스트' },
  { type: 'RISK', sev: 'H', content: '핵심 인력 휴가 일정으로 다음 주 개발 공백 우려', action: '업무 인수인계 및 일정 조정' },
  { type: 'REQUEST', sev: 'L', content: '개발 서버 메모리 증설 요청', action: '인프라 담당자 협조 요청', support: true },
  { type: 'REQUEST', sev: 'M', content: '추가 인력(개발 1명) 지원 건의', action: '사업관리자 검토 요청', support: true },
  { type: 'REQUEST', sev: 'L', content: '고객사 출입·보안 교육 일정 조율 요청', action: '고객사 담당자와 일정 확정 예정' },
];
const REMARKS = ['', '', '', '', '다음 주 고객 보고 일정 있음', '주간 회의 일정 변경 건의 (수 → 목)', '협업 도구 계정 추가 발급 건의', '반복 요청 건 자동화 검토 건의'];

async function remove() {
  const ids = (await prisma.weeklyWork.findMany({ where: { remark: { startsWith: MARK } }, select: { wwId: true } })).map((w) => w.wwId);
  console.log(`더미 주간보고 ${ids.length}건`);
  if (!APPLY || !ids.length) return console.log(APPLY ? '' : '미리보기 — 지우려면 --apply');
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    await prisma.timesheet.deleteMany({ where: { wwId: { in: part } } });
    await prisma.workItem.deleteMany({ where: { wwId: { in: part } } });
    await prisma.weeklyIssue.deleteMany({ where: { wwId: { in: part } } });
    await prisma.weeklyWork.deleteMany({ where: { wwId: { in: part } } });
  }
  console.log('삭제 완료');
}

async function generate() {
  const cutoff = today(); // 오늘까지 (화면 기본 주차인 이번 주도 보이도록, 지난 평일만)
  const lastWeek = isoWeek(cutoff);
  const holidays = new Set((await prisma.holiday.findMany()).map((h) => h.dt));
  const asg = await prisma.assignment.findMany({
    where: { canceled: false, startDt: { lte: cutoff }, project: { prjType: { not: 'NP' } }, employee: { deletedAt: null } },
    include: { project: { select: { prjNm: true, prjType: true } } },
    orderBy: [{ empId: 'asc' }, { startDt: 'asc' }],
  });
  const existing = new Set((await prisma.weeklyWork.findMany({ select: { empId: true, reportWeek: true } })).map((w) => `${w.empId}|${w.reportWeek}`));
  const byEmp = new Map<string, typeof asg>();
  for (const a of asg) byEmp.set(a.empId, [...(byEmp.get(a.empId) ?? []), a]);

  let reports = 0;
  let skipped = 0;
  let md = 0;
  let issues = 0;
  for (const [empId, list] of byEmp) {
    // 사람·프로젝트별 진행 상태 (SI 작업 진척)
    const state = new Map<string, { taskIdx: number; progress: number; target: number | null; round: number }>();
    const firstWeek = isoWeek(list.reduce((m, a) => (a.startDt < m ? a.startDt : m), list[0].startDt));
    for (let week = firstWeek; week <= lastWeek; week = shiftWeek(week, 1)) {
      const days = weekDays(week).slice(0, 5).filter((d) => !holidays.has(d) && d <= cutoff);
      // 날짜별 배정 → MD (하루 1MD, 여러 배정이면 0.5씩 최대 2개)
      const ts: { prjCd: string; workDt: string; md: number }[] = [];
      for (const d of days) {
        const on = list.filter((a) => a.startDt <= d && a.endDt >= d).sort((x, y) => y.allocRate - x.allocRate);
        const uniq = [...new Map(on.map((a) => [a.prjCd, a])).values()].slice(0, 2);
        for (const a of uniq) ts.push({ prjCd: a.prjCd, workDt: d, md: uniq.length === 1 ? 1 : 0.5 });
      }
      if (!ts.length) continue;
      if (existing.has(`${empId}|${week}`)) {
        skipped++;
        continue;
      }
      const r = rng(`${empId}|${week}`);
      const prjs = [...new Set(ts.map((t) => t.prjCd))];
      const actualItems: object[] = [];
      const planItems: object[] = [];
      const fri = weekDays(shiftWeek(week, 1))[4];
      for (const prjCd of prjs) {
        const a = list.find((x) => x.prjCd === prjCd)!;
        if (a.project.prjType === 'SM') {
          for (const it of SM_ITEMS) {
            if (r() > it.prob) continue;
            actualItems.push({ prjCd, itemType: 'ACTUAL', seq: actualItems.length, workNm: it.name, content: pick(r, it.contents), smWorkType: it.type, smCount: between(r, it.min, it.max) });
          }
          planItems.push({ prjCd, itemType: 'PLAN', seq: planItems.length, workNm: '정기 점검', content: '주간 정기 점검 및 백업 확인', smWorkType: 'PERIODIC', dueDt: fri });
          planItems.push({ prjCd, itemType: 'PLAN', seq: planItems.length, workNm: '사용자 요청 처리', content: '접수 요청 순차 처리', smWorkType: 'REQUEST', dueDt: fri });
          continue;
        }
        // SI·기타: 역할별 작업을 차례로 진행, 매주 15~30%p 진척, 가끔 목표 미달(지연)
        const tasks = SI_TASKS[a.roleCd] ?? SI_TASKS.ETC;
        const st = state.get(prjCd) ?? { taskIdx: 0, progress: 0, target: null, round: 1 };
        const workNm = `${tasks[st.taskIdx % tasks.length]}${st.round > 1 ? ` (${st.round}차)` : ''}`;
        const before = st.progress;
        const delayed = r() < 0.15 && st.target != null;
        const after = Math.min(100, before + (delayed ? between(r, 3, 8) : between(r, 15, 30)));
        const status = after === 100 ? 'DONE' : st.target != null && after < st.target ? 'DELAY' : 'NORMAL';
        actualItems.push({
          prjCd,
          itemType: 'ACTUAL',
          seq: actualItems.length,
          workNm,
          content: pick(r, SI_CONTENT),
          progressBefore: before,
          progressAfter: after,
          targetProgress: st.target,
          statusCd: status,
          delayReason: status === 'DELAY' ? pick(r, DELAY_REASON) : null,
        });
        // 다음 작업으로 넘어가기 / 차주 계획
        let next = { ...st, progress: after };
        if (after === 100) {
          next = { taskIdx: st.taskIdx + 1, progress: 0, target: null, round: st.round + (st.taskIdx + 1 >= tasks.length * st.round ? 1 : 0) };
        }
        const nextName = `${tasks[next.taskIdx % tasks.length]}${next.round > 1 ? ` (${next.round}차)` : ''}`;
        const target = Math.min(100, next.progress + between(r, 20, 30));
        planItems.push({ prjCd, itemType: 'PLAN', seq: planItems.length, workNm: nextName, content: after === 100 ? '착수 및 세부 계획 수립' : '잔여 항목 진행', targetProgress: target, dueDt: fri });
        state.set(prjCd, { ...next, target });
      }
      const iss = r() < 0.12 ? [pick(r, ISSUES)] : [];
      const remark = `${MARK} ${pick(r, REMARKS)}`.trim();
      reports++;
      md += ts.reduce((s, t) => s + t.md, 0);
      issues += iss.length;
      if (!APPLY) continue;
      await prisma.weeklyWork.create({
        data: {
          empId,
          reportWeek: week,
          statusCd: 'SUBMITTED',
          remark,
          submittedAt: new Date(`${addDays(weekDays(week)[4], 0)}T09:00:00Z`),
          timesheets: { create: ts.map((t) => ({ empId, prjCd: t.prjCd, workDt: t.workDt, md: t.md })) },
          workItems: { create: [...actualItems, ...planItems] as never },
          issues: { create: iss.map((i) => ({ prjCd: prjs[0], issueType: i.type, severity: i.sev, content: i.content, actionPlan: i.action, supportReqYn: !!i.support })) },
        },
      });
    }
  }
  console.log(`기준: ${lastWeek} (~${cutoff})까지 · 배정 ${asg.length}건 · 인력 ${byEmp.size}명`);
  console.log(`생성 ${reports}건 (투입 ${md} MD, 이슈·건의 ${issues}건) · 기존 보고서가 있어 건너뜀 ${skipped}건`);
  if (!APPLY) console.log('미리보기 — 실제로 넣으려면 --apply');
}

(DELETE ? remove() : generate())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
