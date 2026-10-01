-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccountRequest" (
    "reqId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reqType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "contact" TEXT,
    "message" TEXT,
    "matchedEmpId" TEXT,
    "statusCd" TEXT NOT NULL DEFAULT 'OPEN',
    "handledBy" TEXT,
    "handledAt" DATETIME,
    "handleNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AccountRequest" ("contact", "createdAt", "email", "handleNote", "handledAt", "handledBy", "matchedEmpId", "message", "name", "reqId", "reqType", "statusCd") SELECT "contact", "createdAt", "email", "handleNote", "handledAt", "handledBy", "matchedEmpId", "message", "name", "reqId", "reqType", "statusCd" FROM "AccountRequest";
DROP TABLE "AccountRequest";
ALTER TABLE "new_AccountRequest" RENAME TO "AccountRequest";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

