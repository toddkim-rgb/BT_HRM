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
    "email" TEXT,
    "phone" TEXT,
    "statusCd" TEXT NOT NULL DEFAULT 'ACTIVE',
    "hireDt" TEXT,
    "retireDt" TEXT,
    "utilTarget" BOOLEAN NOT NULL DEFAULT true,
    "role" TEXT NOT NULL DEFAULT 'EMP',
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("partnerId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Employee" ("careerStartDt", "createdAt", "deptCd", "email", "empId", "employType", "gradeCd", "hireDt", "jobCd", "name", "partnerId", "passwordHash", "phone", "retireDt", "role", "skillLevel", "skillStack", "statusCd", "updatedAt") SELECT "careerStartDt", "createdAt", "deptCd", "email", "empId", "employType", "gradeCd", "hireDt", "jobCd", "name", "partnerId", "passwordHash", "phone", "retireDt", "role", "skillLevel", "skillStack", "statusCd", "updatedAt" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
