-- CreateTable
CREATE TABLE "UserPref" (
    "empId" TEXT NOT NULL,
    "prefKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("empId", "prefKey")
);
