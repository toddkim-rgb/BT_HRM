-- 승인 절차 삭제: 기존 승인/반려 보고서는 제출로 전환
UPDATE "WeeklyWork" SET "statusCd" = 'SUBMITTED' WHERE "statusCd" IN ('APPROVED', 'REJECTED');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Employee" (
    "empId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "deptCd" TEXT NOT NULL,
    "gradeCd" TEXT NOT NULL,
    "jobCd" TEXT,
    "skillLevel" TEXT NOT NULL,
    "skillStack" TEXT,
    "employType" TEXT NOT NULL,
    "partnerId" TEXT,
    "careerStartDt" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "statusCd" TEXT NOT NULL DEFAULT 'ACTIVE',
    "utilTarget" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT NOT NULL DEFAULT 'EMP',
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("partnerId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Employee" ("careerStartDt", "createdAt", "deptCd", "email", "empId", "employType", "gradeCd", "jobCd", "name", "partnerId", "passwordHash", "phone", "role", "skillLevel", "skillStack", "statusCd", "updatedAt", "utilTarget") SELECT "careerStartDt", "createdAt", "deptCd", "email", "empId", "employType", "gradeCd", "jobCd", "name", "partnerId", "passwordHash", "phone", "role", "skillLevel", "skillStack", "statusCd", "updatedAt", "utilTarget" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
CREATE TABLE "new_WeeklyWork" (
    "wwId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empId" TEXT NOT NULL,
    "reportWeek" TEXT NOT NULL,
    "statusCd" TEXT NOT NULL DEFAULT 'DRAFT',
    "remark" TEXT,
    "submittedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeeklyWork_empId_fkey" FOREIGN KEY ("empId") REFERENCES "Employee" ("empId") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WeeklyWork" ("createdAt", "empId", "remark", "reportWeek", "statusCd", "submittedAt", "updatedAt", "wwId") SELECT "createdAt", "empId", "remark", "reportWeek", "statusCd", "submittedAt", "updatedAt", "wwId" FROM "WeeklyWork";
DROP TABLE "WeeklyWork";
ALTER TABLE "new_WeeklyWork" RENAME TO "WeeklyWork";
CREATE UNIQUE INDEX "WeeklyWork_empId_reportWeek_key" ON "WeeklyWork"("empId", "reportWeek");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

