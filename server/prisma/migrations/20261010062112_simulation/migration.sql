-- CreateTable
CREATE TABLE "Simulation" (
    "simId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "prjCd" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "statusCd" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER,
    "startDt" TEXT NOT NULL,
    "endDt" TEXT NOT NULL,
    "reserveRate" REAL NOT NULL,
    "targetRate" REAL NOT NULL,
    "minRate" REAL NOT NULL,
    "proposedAmt" INTEGER,
    "memo" TEXT,
    "rows" TEXT NOT NULL,
    "expenses" TEXT NOT NULL,
    "snapshot" TEXT,
    "createdBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Simulation_prjCd_idx" ON "Simulation"("prjCd");
