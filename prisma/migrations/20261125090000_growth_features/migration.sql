-- AlterTable
ALTER TABLE "WhatsAppBusinessAccount" ADD COLUMN "capiDatasetId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OrganizationSettings" ADD COLUMN "adConversions" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "OrganizationSettings" ADD COLUMN "voiceNotes" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "OrganizationSettings" ADD COLUMN "sheetsWebhookUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Message" ADD COLUMN "transcript" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MessageTemplate" ADD COLUMN "cards" TEXT NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "CommentRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "dmText" TEXT NOT NULL,
    "publicReply" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplyAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "CommentReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "fromUsername" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommentReply_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommentRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "DueReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL DEFAULT '',
    "amountPaise" INTEGER NOT NULL,
    "dueDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" DATETIME,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "AdConversion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "adId" TEXT NOT NULL DEFAULT '',
    "valuePaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "CommentRule_organizationId_idx" ON "CommentRule"("organizationId");
CREATE INDEX "CommentRule_channelAccountId_status_idx" ON "CommentRule"("channelAccountId", "status");
CREATE UNIQUE INDEX "CommentReply_commentId_key" ON "CommentReply"("commentId");
CREATE INDEX "CommentReply_organizationId_createdAt_idx" ON "CommentReply"("organizationId", "createdAt");
CREATE INDEX "DueReminder_organizationId_status_idx" ON "DueReminder"("organizationId", "status");
CREATE UNIQUE INDEX "DueReminder_organizationId_phone_invoiceNo_key" ON "DueReminder"("organizationId", "phone", "invoiceNo");
CREATE INDEX "AdConversion_organizationId_createdAt_idx" ON "AdConversion"("organizationId", "createdAt");
CREATE UNIQUE INDEX "AdConversion_contactId_event_key" ON "AdConversion"("contactId", "event");
