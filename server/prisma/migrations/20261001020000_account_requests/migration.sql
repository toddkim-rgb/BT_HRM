-- CreateTable
CREATE TABLE "AccountRequest" (
    "reqId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reqType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "empId" TEXT,
    "contact" TEXT,
    "message" TEXT,
    "matchedEmpId" TEXT,
    "statusCd" TEXT NOT NULL DEFAULT 'OPEN',
    "handledBy" TEXT,
    "handledAt" DATETIME,
    "handleNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
    "mustChangePw" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("partnerId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Employee" ("careerStartDt", "createdAt", "deptCd", "email", "empId", "employType", "gradeCd", "jobCd", "name", "partnerId", "passwordHash", "phone", "role", "skillLevel", "skillStack", "statusCd", "updatedAt", "utilTarget") SELECT "careerStartDt", "createdAt", "deptCd", "email", "empId", "employType", "gradeCd", "jobCd", "name", "partnerId", "passwordHash", "phone", "role", "skillLevel", "skillStack", "statusCd", "updatedAt", "utilTarget" FROM "Employee";
DROP TABLE "Employee";
ALTER TABLE "new_Employee" RENAME TO "Employee";
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

