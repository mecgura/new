-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "whatsappAccountId" TEXT,
    "templateId" TEXT,
    "abTemplateId" TEXT,
    "abVariables" TEXT NOT NULL DEFAULT '{}',
    "abSplit" INTEGER NOT NULL DEFAULT 0,
    "segmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "step" INTEGER NOT NULL DEFAULT 1,
    "audience" TEXT NOT NULL DEFAULT '{}',
    "variables" TEXT NOT NULL DEFAULT '{}',
    "scheduledAt" DATETIME,
    "review" TEXT NOT NULL DEFAULT '{}',
    "reviewedAt" DATETIME,
    "statusReason" TEXT NOT NULL DEFAULT '',
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Campaign_whatsappAccountId_fkey" FOREIGN KEY ("whatsappAccountId") REFERENCES "WhatsAppAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Campaign_abTemplateId_fkey" FOREIGN KEY ("abTemplateId") REFERENCES "MessageTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Campaign" ("audience", "completedAt", "createdAt", "createdById", "description", "id", "isDemo", "name", "organizationId", "review", "reviewedAt", "scheduledAt", "segmentId", "startedAt", "status", "statusReason", "step", "templateId", "totalRecipients", "updatedAt", "variables", "whatsappAccountId") SELECT "audience", "completedAt", "createdAt", "createdById", "description", "id", "isDemo", "name", "organizationId", "review", "reviewedAt", "scheduledAt", "segmentId", "startedAt", "status", "statusReason", "step", "templateId", "totalRecipients", "updatedAt", "variables", "whatsappAccountId" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE INDEX "Campaign_organizationId_status_idx" ON "Campaign"("organizationId", "status");
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");
CREATE TABLE "new_CampaignRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "variant" TEXT NOT NULL DEFAULT 'A',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "variables" TEXT NOT NULL DEFAULT '{}',
    "messageId" TEXT,
    "error" TEXT NOT NULL DEFAULT '',
    "attemptedAt" DATETIME,
    "sentAt" DATETIME,
    "deliveredAt" DATETIME,
    "readAt" DATETIME,
    "failedAt" DATETIME,
    "repliedAt" DATETIME,
    "optedOutAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignRecipient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CampaignRecipient_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CampaignRecipient" ("attemptedAt", "campaignId", "contactId", "createdAt", "deliveredAt", "error", "failedAt", "id", "messageId", "name", "optedOutAt", "organizationId", "phone", "readAt", "repliedAt", "sentAt", "status", "variables") SELECT "attemptedAt", "campaignId", "contactId", "createdAt", "deliveredAt", "error", "failedAt", "id", "messageId", "name", "optedOutAt", "organizationId", "phone", "readAt", "repliedAt", "sentAt", "status", "variables" FROM "CampaignRecipient";
DROP TABLE "CampaignRecipient";
ALTER TABLE "new_CampaignRecipient" RENAME TO "CampaignRecipient";
CREATE UNIQUE INDEX "CampaignRecipient_messageId_key" ON "CampaignRecipient"("messageId");
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");
CREATE INDEX "CampaignRecipient_contactId_sentAt_idx" ON "CampaignRecipient"("contactId", "sentAt");
CREATE INDEX "CampaignRecipient_organizationId_sentAt_idx" ON "CampaignRecipient"("organizationId", "sentAt");
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_phone_key" ON "CampaignRecipient"("campaignId", "phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

