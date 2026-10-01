-- CreateTable
CREATE TABLE "Employee" (
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
    "role" TEXT NOT NULL DEFAULT 'EMP',
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Employee_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("partnerId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Partner" (
    "partnerId" TEXT NOT NULL PRIMARY KEY,
    "partnerNm" TEXT NOT NULL,
    "bizRegNo" TEXT,
    "contactNm" TEXT,
    "contactPhone" TEXT,
    "contractStartDt" TEXT,
    "contractEndDt" TEXT,
    "statusCd" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PartnerContract" (
    "pcId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partnerId" TEXT NOT NULL,
    "empId" TEXT NOT NULL,
    "prjCd" TEXT,
    "startDt" TEXT NOT NULL,
    "endDt" TEXT NOT NULL,
    "monthlyRate" INTEGER NOT NULL,
    "contractMm" REAL,
    "contractAmt" INTEGER,
    "statusCd" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerContract_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("partnerId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PartnerContract_empId_fkey" FOREIGN KEY ("empId") REFERENCES "Employee" ("empId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostRate" (
    "crId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empId" TEXT,
    "gradeCd" TEXT,
    "monthlyCost" INTEGER NOT NULL,
    "applyStartDt" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostRate_empId_fkey" FOREIGN KEY ("empId") REFERENCES "Employee" ("empId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
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
    "winProb" INTEGER,
    "plOpenYn" BOOLEAN NOT NULL DEFAULT false,
    "pmEmpId" TEXT,
    "residentType" TEXT,
    "statusCd" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_pmEmpId_fkey" FOREIGN KEY ("pmEmpId") REFERENCES "Employee" ("empId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillRate" (
    "brId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "prjCd" TEXT NOT NULL,
    "roleCd" TEXT NOT NULL,
    "gradeCd" TEXT NOT NULL,
    "monthlyRate" INTEGER NOT NULL,
    "applyStartDt" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillRate_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assignment" (
    "asgId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empId" TEXT NOT NULL,
    "prjCd" TEXT NOT NULL,
    "roleCd" TEXT NOT NULL,
    "startDt" TEXT NOT NULL,
    "endDt" TEXT NOT NULL,
    "allocRate" INTEGER NOT NULL,
    "residentType" TEXT NOT NULL DEFAULT 'ONSITE',
    "canceled" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Assignment_empId_fkey" FOREIGN KEY ("empId") REFERENCES "Employee" ("empId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assignment_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DemandPlan" (
    "dpId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "prjCd" TEXT NOT NULL,
    "roleCd" TEXT NOT NULL,
    "gradeCd" TEXT NOT NULL,
    "headcount" INTEGER NOT NULL,
    "startYm" TEXT NOT NULL,
    "endYm" TEXT NOT NULL,
    "allocRate" INTEGER NOT NULL DEFAULT 100,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DemandPlan_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyWork" (
    "wwId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "empId" TEXT NOT NULL,
    "reportWeek" TEXT NOT NULL,
    "statusCd" TEXT NOT NULL DEFAULT 'DRAFT',
    "remark" TEXT,
    "submittedAt" DATETIME,
    "approvedBy" TEXT,
    "approvedAt" DATETIME,
    "rejectReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeeklyWork_empId_fkey" FOREIGN KEY ("empId") REFERENCES "Employee" ("empId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Timesheet" (
    "tsId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "wwId" INTEGER NOT NULL,
    "empId" TEXT NOT NULL,
    "prjCd" TEXT NOT NULL,
    "workDt" TEXT NOT NULL,
    "md" REAL NOT NULL,
    CONSTRAINT "Timesheet_wwId_fkey" FOREIGN KEY ("wwId") REFERENCES "WeeklyWork" ("wwId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Timesheet_empId_fkey" FOREIGN KEY ("empId") REFERENCES "Employee" ("empId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Timesheet_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "wiId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "wwId" INTEGER NOT NULL,
    "prjCd" TEXT NOT NULL,
    "msId" INTEGER,
    "itemType" TEXT NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "workNm" TEXT NOT NULL,
    "content" TEXT,
    "progressBefore" INTEGER,
    "progressAfter" INTEGER,
    "targetProgress" INTEGER,
    "dueDt" TEXT,
    "statusCd" TEXT,
    "delayReason" TEXT,
    "smWorkType" TEXT,
    "smCount" INTEGER,
    CONSTRAINT "WorkItem_wwId_fkey" FOREIGN KEY ("wwId") REFERENCES "WeeklyWork" ("wwId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkItem_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkItem_msId_fkey" FOREIGN KEY ("msId") REFERENCES "Milestone" ("msId") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyIssue" (
    "wisId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "wwId" INTEGER NOT NULL,
    "prjCd" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "actionPlan" TEXT,
    "supportReqYn" BOOLEAN NOT NULL DEFAULT false,
    "onepageYn" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WeeklyIssue_wwId_fkey" FOREIGN KEY ("wwId") REFERENCES "WeeklyWork" ("wwId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WeeklyIssue_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Milestone" (
    "msId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "prjCd" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "msNm" TEXT NOT NULL,
    "deliverable" TEXT,
    "statusCd" TEXT NOT NULL DEFAULT 'PLANNED',
    "actualStartDt" TEXT,
    "doneDt" TEXT,
    CONSTRAINT "Milestone_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MsVersion" (
    "verId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "prjCd" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "baselineYn" BOOLEAN NOT NULL DEFAULT false,
    "changeReason" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MsVersion_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MsSchedule" (
    "schId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "msId" INTEGER NOT NULL,
    "verId" INTEGER NOT NULL,
    "planStartDt" TEXT NOT NULL,
    "planEndDt" TEXT NOT NULL,
    CONSTRAINT "MsSchedule_msId_fkey" FOREIGN KEY ("msId") REFERENCES "Milestone" ("msId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MsSchedule_verId_fkey" FOREIGN KEY ("verId") REFERENCES "MsVersion" ("verId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MsTemplate" (
    "tplId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tplNm" TEXT NOT NULL,
    "prjType" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "MsTemplateItem" (
    "tplItemId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tplId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "msNm" TEXT NOT NULL,
    "durationRatio" INTEGER NOT NULL,
    "deliverable" TEXT,
    CONSTRAINT "MsTemplateItem_tplId_fkey" FOREIGN KEY ("tplId") REFERENCES "MsTemplate" ("tplId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProjectExpense" (
    "exId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "prjCd" TEXT NOT NULL,
    "expenseYm" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "expenseType" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectExpense_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Alert" (
    "alertId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alertCd" TEXT NOT NULL,
    "targetEmpId" TEXT NOT NULL,
    "refKey" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readYn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Alert_targetEmpId_fkey" FOREIGN KEY ("targetEmpId") REFERENCES "Employee" ("empId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "reportWeek" TEXT NOT NULL PRIMARY KEY,
    "snapshot" TEXT NOT NULL,
    "statusCd" TEXT NOT NULL DEFAULT 'DRAFT',
    "nextPlan" TEXT,
    "confirmedBy" TEXT,
    "confirmedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WeeklyComment" (
    "wcId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "reportWeek" TEXT NOT NULL,
    "prjCd" TEXT NOT NULL,
    "planProgress" REAL,
    "actualProgress" REAL,
    "pmOpinion" TEXT,
    "confirmedYn" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WeeklyComment_prjCd_fkey" FOREIGN KEY ("prjCd") REFERENCES "Project" ("prjCd") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Holiday" (
    "dt" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyWork_empId_reportWeek_key" ON "WeeklyWork"("empId", "reportWeek");

-- CreateIndex
CREATE UNIQUE INDEX "Timesheet_empId_prjCd_workDt_key" ON "Timesheet"("empId", "prjCd", "workDt");

-- CreateIndex
CREATE UNIQUE INDEX "MsVersion_prjCd_versionNo_key" ON "MsVersion"("prjCd", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_alertCd_targetEmpId_refKey_key" ON "Alert"("alertCd", "targetEmpId", "refKey");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyComment_reportWeek_prjCd_key" ON "WeeklyComment"("reportWeek", "prjCd");
