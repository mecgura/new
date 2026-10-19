-- CreateTable
CREATE TABLE "AdConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "adAccountName" TEXT NOT NULL DEFAULT '',
    "pageId" TEXT NOT NULL,
    "pageName" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "encryptedToken" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dailyBudget" INTEGER NOT NULL,
    "whatsappAccountId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "imageHash" TEXT NOT NULL DEFAULT '',
    "ageMin" INTEGER NOT NULL DEFAULT 18,
    "ageMax" INTEGER NOT NULL DEFAULT 55,
    "gender" TEXT NOT NULL DEFAULT 'all',
    "startAt" DATETIME,
    "endAt" DATETIME,
    "metaCampaignId" TEXT NOT NULL DEFAULT '',
    "metaAdSetId" TEXT NOT NULL DEFAULT '',
    "metaCreativeId" TEXT NOT NULL DEFAULT '',
    "metaAdId" TEXT NOT NULL DEFAULT '',
    "lastError" TEXT NOT NULL DEFAULT '',
    "spend" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" DATETIME,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AdConnection_organizationId_key" ON "AdConnection"("organizationId");

-- CreateIndex
CREATE INDEX "AdCampaign_organizationId_createdAt_idx" ON "AdCampaign"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdCampaign_metaAdId_idx" ON "AdCampaign"("metaAdId");
