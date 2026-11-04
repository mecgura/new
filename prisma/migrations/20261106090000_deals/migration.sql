-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "position" INTEGER NOT NULL DEFAULT 0,
    "probability" INTEGER NOT NULL DEFAULT 10,
    "kind" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PipelineStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "valuePaise" INTEGER NOT NULL DEFAULT 0,
    "ownerUserId" TEXT,
    "expectedCloseAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'open',
    "lostReason" TEXT NOT NULL DEFAULT '',
    "stageChangedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Deal_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DealActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DealActivity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrganizationSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "notificationEmail" TEXT NOT NULL DEFAULT '',
    "businessHours" TEXT NOT NULL DEFAULT '{}',
    "weeklyReportAt" DATETIME,
    "metaBillingMode" TEXT NOT NULL DEFAULT 'client_pays',
    "prepaidMarkupPaise" INTEGER NOT NULL DEFAULT 20,
    "creditMarketing" INTEGER NOT NULL DEFAULT 0,
    "creditUtility" INTEGER NOT NULL DEFAULT 0,
    "packageAlerts" TEXT NOT NULL DEFAULT '{}',
    "leadScoring" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrganizationSettings" ("businessHours", "creditMarketing", "creditUtility", "currency", "id", "locale", "metaBillingMode", "notificationEmail", "organizationId", "packageAlerts", "prepaidMarkupPaise", "timezone", "updatedAt", "weeklyReportAt") SELECT "businessHours", "creditMarketing", "creditUtility", "currency", "id", "locale", "metaBillingMode", "notificationEmail", "organizationId", "packageAlerts", "prepaidMarkupPaise", "timezone", "updatedAt", "weeklyReportAt" FROM "OrganizationSettings";
DROP TABLE "OrganizationSettings";
ALTER TABLE "new_OrganizationSettings" RENAME TO "OrganizationSettings";
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_organizationId_position_key" ON "PipelineStage"("organizationId", "position");

-- CreateIndex
CREATE INDEX "Deal_organizationId_stageId_idx" ON "Deal"("organizationId", "stageId");

-- CreateIndex
CREATE INDEX "Deal_organizationId_status_closedAt_idx" ON "Deal"("organizationId", "status", "closedAt");

-- CreateIndex
CREATE INDEX "Deal_contactId_idx" ON "Deal"("contactId");

-- CreateIndex
CREATE INDEX "DealActivity_dealId_createdAt_idx" ON "DealActivity"("dealId", "createdAt");

