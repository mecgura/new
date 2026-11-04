-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Purchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Purchase_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoyaltyEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "note" TEXT NOT NULL DEFAULT '',
    "refType" TEXT NOT NULL DEFAULT '',
    "refId" TEXT NOT NULL DEFAULT '',
    "expiresAt" DATETIME,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoyaltyEntry_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoyaltyReward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyReward_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferralCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReferralCode_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "referrerContactId" TEXT NOT NULL,
    "refereeContactId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "flag" TEXT NOT NULL DEFAULT '',
    "qualifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Referral_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Referral_referrerContactId_fkey" FOREIGN KEY ("referrerContactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Referral_refereeContactId_fkey" FOREIGN KEY ("refereeContactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrganizationSettings" ("businessHours", "creditMarketing", "creditUtility", "currency", "id", "leadScoring", "locale", "metaBillingMode", "notificationEmail", "organizationId", "packageAlerts", "prepaidMarkupPaise", "timezone", "updatedAt", "weeklyReportAt") SELECT "businessHours", "creditMarketing", "creditUtility", "currency", "id", "leadScoring", "locale", "metaBillingMode", "notificationEmail", "organizationId", "packageAlerts", "prepaidMarkupPaise", "timezone", "updatedAt", "weeklyReportAt" FROM "OrganizationSettings";
DROP TABLE "OrganizationSettings";
ALTER TABLE "new_OrganizationSettings" RENAME TO "OrganizationSettings";
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Purchase_organizationId_createdAt_idx" ON "Purchase"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Purchase_contactId_createdAt_idx" ON "Purchase"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_organizationId_createdAt_idx" ON "LoyaltyEntry"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_contactId_createdAt_idx" ON "LoyaltyEntry"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_organizationId_status_idx" ON "LoyaltyEntry"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LoyaltyReward_organizationId_active_idx" ON "LoyaltyReward"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_contactId_key" ON "ReferralCode"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_organizationId_code_key" ON "ReferralCode"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Referral_organizationId_status_idx" ON "Referral"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Referral_referrerContactId_idx" ON "Referral"("referrerContactId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_organizationId_refereeContactId_key" ON "Referral"("organizationId", "refereeContactId");

