-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "channel" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER,
    "comment" TEXT NOT NULL DEFAULT '',
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" DATETIME,
    "resolvedNote" TEXT NOT NULL DEFAULT '',
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" DATETIME,
    "ratedAt" DATETIME,
    "googleClickedAt" DATETIME,
    "actorId" TEXT,
    CONSTRAINT "ReviewRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewRequest_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "loyalty" TEXT NOT NULL DEFAULT '',
    "reviews" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrganizationSettings" ("businessHours", "creditMarketing", "creditUtility", "currency", "id", "leadScoring", "locale", "loyalty", "metaBillingMode", "notificationEmail", "organizationId", "packageAlerts", "prepaidMarkupPaise", "timezone", "updatedAt", "weeklyReportAt") SELECT "businessHours", "creditMarketing", "creditUtility", "currency", "id", "leadScoring", "locale", "loyalty", "metaBillingMode", "notificationEmail", "organizationId", "packageAlerts", "prepaidMarkupPaise", "timezone", "updatedAt", "weeklyReportAt" FROM "OrganizationSettings";
DROP TABLE "OrganizationSettings";
ALTER TABLE "new_OrganizationSettings" RENAME TO "OrganizationSettings";
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_token_key" ON "ReviewRequest"("token");

-- CreateIndex
CREATE INDEX "ReviewRequest_organizationId_sentAt_idx" ON "ReviewRequest"("organizationId", "sentAt");

-- CreateIndex
CREATE INDEX "ReviewRequest_organizationId_escalated_resolvedAt_idx" ON "ReviewRequest"("organizationId", "escalated", "resolvedAt");

-- CreateIndex
CREATE INDEX "ReviewRequest_contactId_sentAt_idx" ON "ReviewRequest"("contactId", "sentAt");

