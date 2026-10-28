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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrganizationSettings" ("businessHours", "currency", "id", "locale", "metaBillingMode", "notificationEmail", "organizationId", "prepaidMarkupPaise", "timezone", "updatedAt", "weeklyReportAt") SELECT "businessHours", "currency", "id", "locale", "metaBillingMode", "notificationEmail", "organizationId", "prepaidMarkupPaise", "timezone", "updatedAt", "weeklyReportAt" FROM "OrganizationSettings";
DROP TABLE "OrganizationSettings";
ALTER TABLE "new_OrganizationSettings" RENAME TO "OrganizationSettings";
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");
CREATE TABLE "new_Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceMonthly" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "maxUsers" INTEGER NOT NULL DEFAULT 3,
    "maxWhatsAppNumbers" INTEGER NOT NULL DEFAULT 1,
    "maxMonthlyMessages" INTEGER NOT NULL DEFAULT 1000,
    "maxContacts" INTEGER NOT NULL DEFAULT 1000,
    "maxCampaigns" INTEGER NOT NULL DEFAULT -1,
    "maxAutomations" INTEGER NOT NULL DEFAULT -1,
    "maxAiReplies" INTEGER NOT NULL DEFAULT -1,
    "maxApiRequests" INTEGER NOT NULL DEFAULT -1,
    "includedMarketing" INTEGER NOT NULL DEFAULT 0,
    "includedUtility" INTEGER NOT NULL DEFAULT 0,
    "features" TEXT NOT NULL DEFAULT '["campaigns","automations","flows","ai_agent","api","webhooks","analytics"]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "selfServe" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Plan" ("createdAt", "currency", "description", "features", "id", "isActive", "maxAiReplies", "maxApiRequests", "maxAutomations", "maxCampaigns", "maxContacts", "maxMonthlyMessages", "maxUsers", "maxWhatsAppNumbers", "name", "priceMonthly", "selfServe", "slug", "sortOrder", "updatedAt") SELECT "createdAt", "currency", "description", "features", "id", "isActive", "maxAiReplies", "maxApiRequests", "maxAutomations", "maxCampaigns", "maxContacts", "maxMonthlyMessages", "maxUsers", "maxWhatsAppNumbers", "name", "priceMonthly", "selfServe", "slug", "sortOrder", "updatedAt" FROM "Plan";
DROP TABLE "Plan";
ALTER TABLE "new_Plan" RENAME TO "Plan";
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");
CREATE INDEX "Plan_isActive_sortOrder_idx" ON "Plan"("isActive", "sortOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

