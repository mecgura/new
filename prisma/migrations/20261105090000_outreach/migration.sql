-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MarketingLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "business" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "campaign" TEXT NOT NULL DEFAULT '',
    "medium" TEXT NOT NULL DEFAULT '',
    "ref" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "valuePaise" INTEGER NOT NULL DEFAULT 0,
    "lostReason" TEXT NOT NULL DEFAULT '',
    "nextFollowUpAt" DATETIME,
    "lastContactAt" DATETIME,
    "organizationId" TEXT,
    "website" TEXT NOT NULL DEFAULT '',
    "placeId" TEXT NOT NULL DEFAULT '',
    "emailOptOut" BOOLEAN NOT NULL DEFAULT false,
    "lastEmailedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_MarketingLead" ("business", "campaign", "city", "createdAt", "email", "id", "lastContactAt", "lostReason", "medium", "name", "nextFollowUpAt", "organizationId", "phone", "ref", "source", "stage", "updatedAt", "valuePaise") SELECT "business", "campaign", "city", "createdAt", "email", "id", "lastContactAt", "lostReason", "medium", "name", "nextFollowUpAt", "organizationId", "phone", "ref", "source", "stage", "updatedAt", "valuePaise" FROM "MarketingLead";
DROP TABLE "MarketingLead";
ALTER TABLE "new_MarketingLead" RENAME TO "MarketingLead";
CREATE UNIQUE INDEX "MarketingLead_phone_key" ON "MarketingLead"("phone");
CREATE INDEX "MarketingLead_stage_nextFollowUpAt_idx" ON "MarketingLead"("stage", "nextFollowUpAt");
CREATE INDEX "MarketingLead_createdAt_idx" ON "MarketingLead"("createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

