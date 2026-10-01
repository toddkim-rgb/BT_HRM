// 초기 데이터: 공통코드·관리자·공휴일·마일스톤 템플릿 + 데모 데이터
// 실행: npm run db:seed  (데모 제외: SEED_DEMO=N npm run db:seed)
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { businessDays, isoWeek, weekDays } from '../src/lib/dates.js';

const prisma = new PrismaClient();

// 2026년 공휴일 (관리자 화면 > 기준값 설정에서 확인·수정)
const HOLIDAYS_2026: [string, string][] = [
  ['2026-01-01', '신정'],
  ['2026-02-16', '설날 연휴'],
  ['2026-02-17', '설날'],
  ['2026-02-18', '설날 연휴'],
  ['2026-03-02', '삼일절 대체공휴일'],
  ['2026-05-05', '어린이날'],
  ['2026-05-25', '부처님오신날 대체공휴일'],
  ['2026-06-03', '전국동시지방선거'],
  ['2026-08-17', '광복절 대체공휴일'],
  ['2026-09-24', '추석 연휴'],
  ['2026-09-25', '추석'],
  ['2026-10-05', '개천절 대체공휴일'],
  ['2026-10-09', '한글날'],
  ['2026-12-25', '성탄절'],
];

const NP_CODES: [string, string][] = [
  ['NP-EDU', '교육'],
  ['NP-LV', '휴가'],
  ['NP-BENCH', '대기'],
  ['NP-ADM', '일반관리 업무'],
];

async function base() {
  for (const [prjCd, prjNm] of NP_CODES) {
    await prisma.project.upsert({ where: { prjCd }, create: { prjCd, prjNm, prjType: 'NP', statusCd: 'ACTIVE' }, update: {} });
  }
  for (const [dt, name] of HOLIDAYS_2026) await prisma.holiday.upsert({ where: { dt }, create: { dt, name }, update: {} });
  await prisma.employee.upsert({
    where: { empId: 'admin' },
    create: { empId: 'admin', name: '시스템관리자', deptCd: '경영지원팀', gradeCd: '과장', skillLevel: '중급', email: 'admin@example.com', employType: 'REG', role: 'ADMIN', utilTarget: false, passwordHash: await bcrypt.hash('admin1234', 10) },
    update: {},
  });
  if (!(await prisma.msTemplate.count())) {
    await prisma.msTemplate.create({
      data: {
        tplNm: 'SI 표준',
        prjType: 'SI',
        items: {
          create: [
            { seq: 1, msNm: '요구분석 완료', durationRatio: 15, deliverable: '요구사항정의서' },
            { seq: 2, msNm: '설계 완료', durationRatio: 20, deliverable: '화면·DB·인터페이스 설계서' },
            { seq: 3, msNm: '개발 완료', durationRatio: 40, deliverable: '소스, 단위테스트 결과' },
            { seq: 4, msNm: '통합테스트 완료', durationRatio: 15, deliverable: '통합테스트 결과서' },
            { seq: 5, msNm: '이행·검수 완료', durationRatio: 10, deliverable: '이행계획서, 검수확인서' },
          ],
        },
      },
    });
  }
}

async function demo() {
  if (await prisma.employee.count({ where: { empId: 'E3001' } })) return;
  const pw = await bcrypt.hash('1234', 10);

  await prisma.partner.createMany({
    data: [
      { partnerId: 'PT-001', partnerNm: '(주)한빛소프트', bizRegNo: '123-45-67890', contactNm: '오담당', contactPhone: '02-111-2222', contractStartDt: '2026-01-01', contractEndDt: '2026-12-31' },
      { partnerId: 'PT-002', partnerNm: '프리랜서(개인)', contactNm: '-', contractStartDt: '2026-01-01', contractEndDt: '2026-12-31' },
    ],
  });

  const emps = [
    { empId: 'E1001', email: 'ceo.kim@example.com', name: '김대표', deptCd: '경영진', gradeCd: '이사', skillLevel: '특급', employType: 'REG', role: 'EXEC', careerStartDt: '2002-03-01', utilTarget: false },
    { empId: 'E2001', email: 'sujin.lee@example.com', name: '이수진', deptCd: 'SI사업팀', gradeCd: '부장', skillLevel: '특급', employType: 'REG', role: 'PM', careerStartDt: '2008-03-01' },
    { empId: 'E2002', email: 'junho.park@example.com', name: '박준호', deptCd: 'SM사업팀', gradeCd: '차장', skillLevel: '고급', employType: 'REG', role: 'PM', careerStartDt: '2011-07-01' },
    { empId: 'E3001', email: 'gildong.hong@example.com', name: '홍길동', deptCd: 'SI사업팀', gradeCd: '대리', skillLevel: '중급', employType: 'REG', role: 'EMP', jobCd: '개발', skillStack: 'React, Java, Oracle', careerStartDt: '2019-01-02' },
    { empId: 'E3002', email: 'chulsoo.kim@example.com', name: '김철수', deptCd: 'SI사업팀', gradeCd: '과장', skillLevel: '고급', employType: 'REG', role: 'EMP', jobCd: '설계', skillStack: 'Spring, PostgreSQL', careerStartDt: '2014-02-01' },
    { empId: 'E3003', email: 'younghee.lee@example.com', name: '이영희', deptCd: 'SM사업팀', gradeCd: '대리', skillLevel: '중급', employType: 'REG', role: 'EMP', jobCd: '운영', skillStack: 'Oracle, Linux', careerStartDt: '2018-05-01' },
    { empId: 'E3004', email: 'minsu.jung@example.com', name: '정민수', deptCd: 'SM사업팀', gradeCd: '사원', skillLevel: '초급', employType: 'CONT', role: 'EMP', jobCd: '개발', skillStack: 'Vue, Node.js', careerStartDt: '2024-01-02' },
    { empId: 'S1001', email: 'sales.choi@example.com', name: '최영업', deptCd: '영업팀', gradeCd: '차장', skillLevel: '고급', employType: 'REG', role: 'SALES', careerStartDt: '2012-01-02', utilTarget: false },
    { empId: 'P-0001', email: 'kang@hanbit.example.com', name: '강협력', deptCd: 'SI사업팀', gradeCd: '책임', skillLevel: '고급', employType: 'PARTNER', partnerId: 'PT-001', role: 'EMP', jobCd: '개발', careerStartDt: '2013-01-01' },
    { empId: 'P-0002', email: 'yoon.free@example.com', name: '윤프리', deptCd: 'SM사업팀', gradeCd: '선임', skillLevel: '중급', employType: 'FREE', partnerId: 'PT-002', role: 'EMP', jobCd: '운영', careerStartDt: '2017-01-01' },
  ];
  for (const e of emps) await prisma.employee.create({ data: { ...e, passwordHash: pw } });

  await prisma.project.createMany({
    data: [
      { prjCd: 'SM-2026-001', prjType: 'SM', prjNm: '○○병원 의료정보시스템 운영', customerNm: '○○병원', contractType: 'PRIME', startDt: '2026-01-01', endDt: '2026-12-31', contractMm: 48, contractAmt: 480000000, revenueMethod: 'MONTHLY', pmEmpId: 'E2002', residentType: 'ONSITE', statusCd: 'ACTIVE' },
      { prjCd: 'SI-2026-001', prjType: 'SI', prjNm: '○○병원 투약관리 구축', customerNm: '○○병원', contractType: 'PRIME', startDt: '2026-06-01', endDt: '2026-12-31', contractMm: 28, contractAmt: 350000000, revenueMethod: 'MM', pmEmpId: 'E2001', residentType: 'MIXED', statusCd: 'ACTIVE', plOpenYn: true },
      { prjCd: 'IN-2026-001', prjType: 'IN', prjNm: '자체 솔루션 고도화', startDt: '2026-01-01', endDt: '2026-12-31', pmEmpId: 'E2001', statusCd: 'ACTIVE' },
      { prjCd: 'PS-2026-001', prjType: 'PS', prjNm: '△△공사 차세대 제안', customerNm: '△△공사', startDt: '2026-09-01', endDt: '2026-10-31', pmEmpId: 'E2001', statusCd: 'ACTIVE' },
      { prjCd: 'SI-2026-002', prjType: 'SI', prjNm: '□□의료원 EMR 구축', customerNm: '□□의료원', contractType: 'SUB', primeContractor: '(주)대형SI', startDt: '2027-01-01', endDt: '2027-09-30', contractMm: 40, winProb: 60, revenueMethod: 'MM', statusCd: 'SALES' },
    ],
  });

  const asg = [
    { empId: 'E2001', prjCd: 'SI-2026-001', roleCd: 'PM', startDt: '2026-06-01', endDt: '2026-12-31', allocRate: 100 },
    { empId: 'E3001', prjCd: 'SI-2026-001', roleCd: 'DEV', startDt: '2026-06-01', endDt: '2026-10-20', allocRate: 100 },
    { empId: 'E3002', prjCd: 'SI-2026-001', roleCd: 'DESIGN', startDt: '2026-06-01', endDt: '2026-12-31', allocRate: 100 },
    { empId: 'E3002', prjCd: 'IN-2026-001', roleCd: 'DEV', startDt: '2026-09-01', endDt: '2026-11-30', allocRate: 30 },
    { empId: 'P-0001', prjCd: 'SI-2026-001', roleCd: 'DEV', startDt: '2026-07-01', endDt: '2026-12-31', allocRate: 100 },
    { empId: 'E2002', prjCd: 'SM-2026-001', roleCd: 'PL', startDt: '2026-01-01', endDt: '2026-12-31', allocRate: 100 },
    { empId: 'E3003', prjCd: 'SM-2026-001', roleCd: 'OPS', startDt: '2026-01-01', endDt: '2026-12-31', allocRate: 100 },
    { empId: 'P-0002', prjCd: 'SM-2026-001', roleCd: 'OPS', startDt: '2026-03-01', endDt: '2026-10-25', allocRate: 100 },
    // 다중 프로젝트 투입 예: 10월부터 SM 50% + 제안 50%
    { empId: 'E3004', prjCd: 'SM-2026-001', roleCd: 'DEV', startDt: '2026-10-01', endDt: '2026-12-31', allocRate: 50 },
    { empId: 'E3004', prjCd: 'PS-2026-001', roleCd: 'DEV', startDt: '2026-10-01', endDt: '2026-10-31', allocRate: 50 },
  ];
  await prisma.assignment.createMany({ data: asg.map((a) => ({ ...a, residentType: 'ONSITE', createdBy: 'admin' })) });

  // 9월(W36~W39) 승인된 주간 업무보고 — 가동률 데모용
  const holidays = new Set(HOLIDAYS_2026.map(([d]) => d));
  const weeks = ['2026-W36', '2026-W37', '2026-W38', '2026-W39'];
  const plan: Record<string, (d: string) => [string, number][]> = {
    E2001: () => [['SI-2026-001', 1]],
    E2002: () => [['SM-2026-001', 1]],
    E3001: (d) => (d === '2026-09-10' ? [['NP-LV', 1]] : [['SI-2026-001', 1]]),
    E3002: (d) => (new Date(d).getUTCDay() === 3 ? [['SI-2026-001', 0.5], ['IN-2026-001', 0.5]] : [['SI-2026-001', 1]]),
    E3003: () => [['SM-2026-001', 1]],
    E3004: (d) => (d === '2026-09-15' ? [['NP-EDU', 1]] : [['NP-BENCH', 1]]),
    'P-0001': () => [['SI-2026-001', 1]],
    'P-0002': () => [['SM-2026-001', 1]],
  };
  for (const week of weeks) {
    const days = weekDays(week);
    for (const [empId, f] of Object.entries(plan)) {
      const latest = week === '2026-W39';
      const ww = await prisma.weeklyWork.create({
        data: { empId, reportWeek: week, statusCd: 'SUBMITTED', submittedAt: new Date(`${days[4]}T09:00:00Z`) },
      });
      const ts = businessDays(days[0], days[6], holidays).flatMap((d) => f(d).map(([prjCd, md]) => ({ wwId: ww.wwId, empId, prjCd, workDt: d, md })));
      await prisma.timesheet.createMany({ data: ts });
      if (empId === 'E3001') {
        const n = weeks.indexOf(week);
        await prisma.workItem.createMany({
          data: [
            { wwId: ww.wwId, prjCd: 'SI-2026-001', itemType: 'ACTUAL', seq: 0, workNm: '투약화면 UI 구현', progressBefore: n * 15, progressAfter: (n + 1) * 15, targetProgress: (n + 1) * 15, statusCd: 'NORMAL' },
            { wwId: ww.wwId, prjCd: 'SI-2026-001', itemType: 'PLAN', seq: 0, workNm: '투약화면 UI 구현', targetProgress: (n + 2) * 15, content: '화면 개발 계속' },
            { wwId: ww.wwId, prjCd: 'SI-2026-001', itemType: 'PLAN', seq: 1, workNm: '처방 조회 API', targetProgress: (n + 1) * 10, content: 'API 개발' },
          ],
        });
        if (latest) await prisma.weeklyIssue.create({ data: { wwId: ww.wwId, prjCd: 'SI-2026-001', issueType: 'RISK', severity: 'H', content: '처방 인터페이스 사양 미확정', actionPlan: '고객 전산팀과 협의 일정 요청', supportReqYn: true } });
      }
      if (empId === 'E3003') {
        await prisma.workItem.createMany({
          data: [
            { wwId: ww.wwId, prjCd: 'SM-2026-001', itemType: 'ACTUAL', seq: 0, workNm: '사용자 요청 처리', smWorkType: 'REQUEST', smCount: 12, content: '권한 변경, 통계 추출 등' },
            { wwId: ww.wwId, prjCd: 'SM-2026-001', itemType: 'ACTUAL', seq: 1, workNm: '정기 점검', smWorkType: 'PERIODIC', smCount: 1 },
            { wwId: ww.wwId, prjCd: 'SM-2026-001', itemType: 'PLAN', seq: 0, workNm: '월간 백업 점검', smWorkType: 'PERIODIC' },
          ],
        });
      }
    }
  }
  console.log(`데모 데이터 생성 완료 (${isoWeek('2026-10-01')} 기준)`);
}

await base();
if (process.env.SEED_DEMO !== 'N') await demo();
await prisma.$disconnect();
console.log('Seed 완료');
