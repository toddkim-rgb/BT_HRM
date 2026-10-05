export type Role = 'EMP' | 'PM' | 'EXEC' | 'ADMIN' | 'SALES';

export const ROLE_LABEL: Record<Role, string> = {
  EMP: '투입인력',
  PM: 'PM/PL',
  EXEC: '사업부장/경영진',
  ADMIN: '시스템관리자',
  SALES: '영업담당',
};

export const EMPLOY_TYPE: Record<string, string> = { REG: '정규직', CONT: '계약직', FREE: '프리랜서', PARTNER: '협력사' };
export const EMP_STATUS: Record<string, string> = { ACTIVE: '재직', LEAVE: '휴직', RETIRED: '퇴사' };
export const SKILL_LEVELS = ['초급', '중급', '고급', '특급'];

export const PRJ_TYPE: Record<string, string> = { SM: 'SM', SI: 'SI', IN: '내부', PS: '제안', ETC: '기타', NP: '공통' };
export const PRJ_STATUS: Record<string, string> = { PROPOSAL: '제안', ACTIVE: '진행중', DONE: '완료', STOP: '중단' };
export const CONTRACT_TYPE: Record<string, string> = { PRIME: '원도급', SUB: '하도급' };
export const RESIDENT: Record<string, string> = { ONSITE: '상주', OFFSITE: '비상주', MIXED: '혼합' };
export const REVENUE_METHOD: Record<string, string> = { MONTHLY: '월정액', MM: '투입MM × 청구단가' };

export const ASG_ROLE: Record<string, string> = { PM: 'PM', PL: 'PL', DESIGN: '설계', DEV: '개발', OPS: '운영(SM)', QA: '테스트', ETC: '기타' };
export const ASG_STATUS: Record<string, string> = { PLANNED: '투입예정', ACTIVE: '투입중', ENDED: '종료', CANCELED: '취소' };

export const WW_STATUS: Record<string, string> = { NEW: '미작성', NONE: '미작성', DRAFT: '작성중', SUBMITTED: '제출' };
export const ITEM_STATUS: Record<string, string> = { NORMAL: '정상', DELAY: '지연', DONE: '완료' };
export const SM_WORK_TYPE: Record<string, string> = { PERIODIC: '정기점검', REQUEST: '요청처리', INCIDENT: '장애대응', IMPROVE: '개선개발', ETC: '기타' };
export const ISSUE_TYPE: Record<string, string> = { ISSUE: '이슈', RISK: '리스크', REQUEST: '요청사항' };
export const SEVERITY: Record<string, string> = { H: '상', M: '중', L: '하' };

export const PARTNER_STATUS: Record<string, string> = { ACTIVE: '거래중', STOPPED: '거래중지' };

export const SETTING_LABEL: Record<string, string> = {
  MD_PER_MM: '1MM 환산 MD',
  HOURS_PER_MD: '1MD 시간',
  OVERHEAD_RATE: '간접비율 (자사 원가단가)',
  ALERT_RELEASE_DAYS: '철수 임박 알림 (D-일, 쉼표 구분)',
  ALERT_MM_BURN: 'MM 소진 알림 (%, 쉼표 구분)',
  ALERT_PARTNER_END_DAYS: '협력사 계약 종료 알림 (D-일)',
  ALERT_BENCH_WEEKS: '장기 대기 알림 (주)',
  ALERT_PROGRESS_DELAY_PP: '진도 지연 기준 (%p)',
};
