import type { Prisma } from '@prisma/client';

// 인력 상태는 선택 입력(null = 미지정, 재직으로 간주). 삭제 처리된 인력은 deletedAt 보유

/** 퇴사가 아닌 인력 (상태 미지정 포함 — SQL에서 NULL은 not 조건에 걸리지 않으므로 명시) */
export const notRetired: Prisma.EmployeeWhereInput = { OR: [{ statusCd: null }, { statusCd: { not: 'RETIRED' } }] };

/** 현재 사용 중인 인력: 삭제 처리되지 않았고 퇴사가 아닌 인력 */
export const usableEmp: Prisma.EmployeeWhereInput = { AND: [{ deletedAt: null }, notRetired] };

export const isUsable = (e: { deletedAt: Date | null; statusCd: string | null }) => !e.deletedAt && e.statusCd !== 'RETIRED';
