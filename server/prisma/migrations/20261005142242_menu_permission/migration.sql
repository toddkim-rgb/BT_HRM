-- CreateTable
CREATE TABLE "MenuPermission" (
    "role" TEXT NOT NULL,
    "menu" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'NONE',

    PRIMARY KEY ("role", "menu")
);

