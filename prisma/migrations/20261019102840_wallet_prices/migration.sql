-- CreateTable
CREATE TABLE "WalletPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL,
    "pricePaise" INTEGER NOT NULL,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletPrice_organizationId_category_key" ON "WalletPrice"("organizationId", "category");
