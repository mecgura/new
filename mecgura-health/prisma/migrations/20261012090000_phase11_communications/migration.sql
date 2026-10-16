-- CreateTable
CREATE TABLE "CommunicationSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "channelOrder" TEXT NOT NULL DEFAULT '["WHATSAPP","SMS","EMAIL"]',
    "senderName" TEXT,
    "replyTo" TEXT,
    "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
    "eventToggles" TEXT NOT NULL DEFAULT '{}',
    "reminderOffsets" TEXT NOT NULL DEFAULT '[1440]',
    "quietEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietStartMin" INTEGER NOT NULL DEFAULT 1320,
    "quietEndMin" INTEGER NOT NULL DEFAULT 480,
    "fallbackRules" TEXT NOT NULL DEFAULT '{}',
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "dailyCapPerPatient" INTEGER NOT NULL DEFAULT 8,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommunicationTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "providerTemplateId" TEXT,
    "variables" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommunicationMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT,
    "channel" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'TRANSACTIONAL',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "templateId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "entityType" TEXT,
    "entityId" TEXT,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "context" TEXT,
    "provider" TEXT,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "scheduledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" DATETIME,
    "sentAt" DATETIME,
    "deliveredAt" DATETIME,
    "readAt" DATETIME,
    "failedAt" DATETIME,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "dedupeKey" TEXT NOT NULL,
    "fallbackOfId" TEXT,
    "resendOfId" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommunicationAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "code" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunicationAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunicationMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommunicationWebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "messageId" TEXT,
    "status" TEXT,
    "outcome" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationSettings_tenantId_key" ON "CommunicationSettings"("tenantId");

-- CreateIndex
CREATE INDEX "CommunicationTemplate_tenantId_channel_eventType_status_idx" ON "CommunicationTemplate"("tenantId", "channel", "eventType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationTemplate_tenantId_channel_eventType_language_name_key" ON "CommunicationTemplate"("tenantId", "channel", "eventType", "language", "name");

-- CreateIndex
CREATE INDEX "CommunicationMessage_tenantId_status_scheduledAt_idx" ON "CommunicationMessage"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_tenantId_patientId_createdAt_idx" ON "CommunicationMessage"("tenantId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_tenantId_channel_eventType_createdAt_idx" ON "CommunicationMessage"("tenantId", "channel", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_entityType_entityId_idx" ON "CommunicationMessage"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_provider_providerMessageId_idx" ON "CommunicationMessage"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "CommunicationMessage_status_nextAttemptAt_idx" ON "CommunicationMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationMessage_tenantId_dedupeKey_key" ON "CommunicationMessage"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "CommunicationAttempt_tenantId_messageId_createdAt_idx" ON "CommunicationAttempt"("tenantId", "messageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunicationWebhookEvent_eventKey_key" ON "CommunicationWebhookEvent"("eventKey");

-- CreateIndex
CREATE INDEX "CommunicationWebhookEvent_provider_receivedAt_idx" ON "CommunicationWebhookEvent"("provider", "receivedAt");

