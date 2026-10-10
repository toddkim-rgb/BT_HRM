-- CreateTable
CREATE TABLE "CostGrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gradeCd" TEXT NOT NULL,
    "monthlySalary" INTEGER NOT NULL,
    "applyStartDt" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CostConfig" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "MarginRule" (
    "prjType" TEXT NOT NULL PRIMARY KEY,
    "targetRate" REAL NOT NULL,
    "minRate" REAL NOT NULL
);

-- CreateTable
CREATE TABLE "PartnerGradeRate" (
    "gradeCd" TEXT NOT NULL PRIMARY KEY,
    "monthlyRate" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "KosaWage" (
    "year" INTEGER NOT NULL,
    "jobNm" TEXT NOT NULL,
    "dailyWage" INTEGER NOT NULL,
    "monthlyWage" INTEGER,
    "seq" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("year", "jobNm")
);

-- CreateTable
CREATE TABLE "RoleJobMap" (
    "roleCd" TEXT NOT NULL PRIMARY KEY,
    "jobNm" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CostGrade_gradeCd_applyStartDt_key" ON "CostGrade"("gradeCd", "applyStartDt");

-- 기준값 설정의 간접비율(OVERHEAD_RATE, 비율 0.2)을 원가 기준(%)으로 이관
INSERT OR IGNORE INTO "CostConfig" ("key", "value")
SELECT 'OVERHEAD_RATE', CAST("value" AS REAL) * 100 FROM "Setting" WHERE "key" = 'OVERHEAD_RATE' AND CAST("value" AS REAL) > 0;
