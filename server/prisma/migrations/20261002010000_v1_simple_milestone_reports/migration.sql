-- DropIndex
DROP INDEX "MsVersion_prjCd_versionNo_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MsSchedule";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MsTemplate";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MsTemplateItem";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "MsVersion";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Milestone" (
    "msId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "prjCd" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "msNm" TEXT NOT NULL,
    "planDt" TEXT NOT NULL,
    "doneDt" TEXT,
    "note" TEXT,
    CONSTRAINT "Milestone_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Milestone" ("doneDt", "msId", "msNm", "prjCd", "seq", "planDt") SELECT "doneDt", "msId", "msNm", "prjCd", "seq", '' FROM "Milestone";
DROP TABLE "Milestone";
ALTER TABLE "new_Milestone" RENAME TO "Milestone";
CREATE TABLE "new_WeeklyComment" (
    "wcId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportWeek" TEXT NOT NULL,
    "prjCd" TEXT NOT NULL,
    "pmOpinion" TEXT,
    "confirmedYn" BOOLEAN NOT NULL DEFAULT false,
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    "snapshot" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeeklyComment_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WeeklyComment" ("confirmedYn", "pmOpinion", "prjCd", "reportWeek", "updatedAt", "wcId") SELECT "confirmedYn", "pmOpinion", "prjCd", "reportWeek", "updatedAt", "wcId" FROM "WeeklyComment";
DROP TABLE "WeeklyComment";
ALTER TABLE "new_WeeklyComment" RENAME TO "WeeklyComment";
CREATE UNIQUE INDEX "WeeklyComment_reportWeek_prjCd_key" ON "WeeklyComment"("reportWeek", "prjCd");
CREATE TABLE "new_WeeklyReport" (
    "reportWeek" TEXT NOT NULL PRIMARY KEY,
    "snapshot" TEXT,
    "statusCd" TEXT NOT NULL DEFAULT 'DRAFT',
    "execNote" TEXT,
    "nextPlan" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_WeeklyReport" ("confirmedAt", "confirmedBy", "nextPlan", "reportWeek", "snapshot", "statusCd", "updatedAt") SELECT "confirmedAt", "confirmedBy", "nextPlan", "reportWeek", "snapshot", "statusCd", "updatedAt" FROM "WeeklyReport";
DROP TABLE "WeeklyReport";
ALTER TABLE "new_WeeklyReport" RENAME TO "WeeklyReport";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

