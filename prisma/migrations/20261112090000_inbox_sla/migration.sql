-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "slaAlertedAt" DATETIME;
ALTER TABLE "Conversation" ADD COLUMN "waitingSince" DATETIME;

-- CreateTable
CREATE TABLE "InboxResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "waitedMs" INTEGER NOT NULL,
    "breached" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InboxResponse_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CsatSurvey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "agentUserId" TEXT,
    "rating" INTEGER,
    "comment" TEXT NOT NULL DEFAULT '',
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ratedAt" DATETIME,
    CONSTRAINT "CsatSurvey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationPresence" (
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "typing" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("conversationId", "userId")
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
    "inboxSla" TEXT NOT NULL DEFAULT '',
    "loyalty" TEXT NOT NULL DEFAULT '',
    "reviews" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrganizationSettings" ("businessHours", "creditMarketing", "creditUtility", "currency", "id", "leadScoring", "locale", "loyalty", "metaBillingMode", "notificationEmail", "organizationId", "packageAlerts", "prepaidMarkupPaise", "reviews", "timezone", "updatedAt", "weeklyReportAt") SELECT "businessHours", "creditMarketing", "creditUtility", "currency", "id", "leadScoring", "locale", "loyalty", "metaBillingMode", "notificationEmail", "organizationId", "packageAlerts", "prepaidMarkupPaise", "reviews", "timezone", "updatedAt", "weeklyReportAt" FROM "OrganizationSettings";
DROP TABLE "OrganizationSettings";
ALTER TABLE "new_OrganizationSettings" RENAME TO "OrganizationSettings";
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "InboxResponse_organizationId_createdAt_idx" ON "InboxResponse"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "InboxResponse_userId_createdAt_idx" ON "InboxResponse"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CsatSurvey_organizationId_sentAt_idx" ON "CsatSurvey"("organizationId", "sentAt");

-- CreateIndex
CREATE INDEX "CsatSurvey_conversationId_sentAt_idx" ON "CsatSurvey"("conversationId", "sentAt");

-- CreateIndex
CREATE INDEX "ConversationPresence_organizationId_updatedAt_idx" ON "ConversationPresence"("organizationId", "updatedAt");

-- CreateIndex
CREATE INDEX "Conversation_status_waitingSince_idx" ON "Conversation"("status", "waitingSince");

