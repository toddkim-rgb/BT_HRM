-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "prjCd" TEXT NOT NULL PRIMARY KEY,
    "prjType" TEXT NOT NULL,
    "prjNm" TEXT NOT NULL,
    "customerNm" TEXT,
    "contractType" TEXT,
    "primeContractor" TEXT,
    "startDt" TEXT,
    "endDt" TEXT,
    "contractMm" REAL,
    "contractAmt" INTEGER,
    "revenueMethod" TEXT,
    "plOpenYn" BOOLEAN NOT NULL DEFAULT false,
    "pmEmpId" TEXT,
    "residentType" TEXT,
    "statusCd" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_pmEmpId_fkey" FOREIGN KEY ("pmEmpId") REFERENCES "Employee" ("empId") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("contractAmt", "contractMm", "contractType", "createdAt", "customerNm", "endDt", "plOpenYn", "pmEmpId", "primeContractor", "prjCd", "prjNm", "prjType", "residentType", "revenueMethod", "startDt", "statusCd", "updatedAt") SELECT "contractAmt", "contractMm", "contractType", "createdAt", "customerNm", "endDt", "plOpenYn", "pmEmpId", "primeContractor", "prjCd", "prjNm", "prjType", "residentType", "revenueMethod", "startDt", "statusCd", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

