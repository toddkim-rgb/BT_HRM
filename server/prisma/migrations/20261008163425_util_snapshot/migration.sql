-- CreateTable
CREATE TABLE "UtilSnapshot" (
    "week" TEXT NOT NULL PRIMARY KEY,
    "total" INTEGER NOT NULL,
    "assigned" INTEGER NOT NULL,
    "rate" REAL,
    "fteRate" REAL,
    "data" TEXT NOT NULL,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

