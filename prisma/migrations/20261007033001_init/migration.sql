-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "status" TEXT NOT NULL DEFAULT 'active',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "agentStatus" TEXT NOT NULL DEFAULT 'offline',
    "agentStatusAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL DEFAULT '',
    "targetId" TEXT NOT NULL DEFAULT '',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Plan" (
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
    "features" TEXT NOT NULL DEFAULT '["campaigns","automations","flows","ai_agent","api","webhooks","analytics"]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "selfServe" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "priceMonthly" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "endReason" TEXT NOT NULL DEFAULT '',
    "billingMode" TEXT NOT NULL DEFAULT 'complimentary',
    "currentPeriodStart" DATETIME,
    "currentPeriodEnd" DATETIME,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" DATETIME,
    "pendingPlanId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationService_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "notificationEmail" TEXT NOT NULL DEFAULT '',
    "businessHours" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "businessName" TEXT NOT NULL DEFAULT '',
    "phoneNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL DEFAULT 'meta_cloud_api',
    "wabaId" TEXT NOT NULL DEFAULT '',
    "phoneNumberId" TEXT NOT NULL DEFAULT '',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "wabaRecordId" TEXT,
    "phoneRecordId" TEXT,
    "connectionId" TEXT,
    "connectedAt" DATETIME,
    "disconnectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppAccount_wabaRecordId_fkey" FOREIGN KEY ("wabaRecordId") REFERENCES "WhatsAppBusinessAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppAccount_phoneRecordId_fkey" FOREIGN KEY ("phoneRecordId") REFERENCES "PhoneNumber" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppBusinessAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "businessPortfolioId" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT '',
    "timezoneId" TEXT NOT NULL DEFAULT '',
    "accountStatus" TEXT NOT NULL DEFAULT '',
    "lastAccountEvent" TEXT NOT NULL DEFAULT '',
    "lastAccountEventAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppBusinessAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PhoneNumber" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "wabaRecordId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "e164" TEXT NOT NULL,
    "verifiedName" TEXT NOT NULL DEFAULT '',
    "qualityRating" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "messagingLimitTier" TEXT NOT NULL DEFAULT '',
    "codeVerificationStatus" TEXT NOT NULL DEFAULT '',
    "nameStatus" TEXT NOT NULL DEFAULT '',
    "platformType" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "lastQualityEvent" TEXT NOT NULL DEFAULT '',
    "messagesSent" INTEGER NOT NULL DEFAULT 0,
    "messagesReceived" INTEGER NOT NULL DEFAULT 0,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PhoneNumber_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PhoneNumber_wabaRecordId_fkey" FOREIGN KEY ("wabaRecordId") REFERENCES "WhatsAppBusinessAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "stateHash" TEXT,
    "stateExpiresAt" DATETIME,
    "wabaRecordId" TEXT,
    "encryptedAccessToken" TEXT NOT NULL DEFAULT '',
    "tokenLast4" TEXT NOT NULL DEFAULT '',
    "encryptedAppSecret" TEXT NOT NULL DEFAULT '',
    "tokenObtainedAt" DATETIME,
    "error" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "connectedAt" DATETIME,
    "disconnectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppConnection_wabaRecordId_fkey" FOREIGN KEY ("wabaRecordId") REFERENCES "WhatsAppBusinessAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookConfiguration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "wabaRecordId" TEXT,
    "callbackUrl" TEXT NOT NULL,
    "verifyTokenHash" TEXT NOT NULL DEFAULT '',
    "encryptedVerifyToken" TEXT NOT NULL DEFAULT '',
    "subscribedFields" TEXT NOT NULL DEFAULT '["messages"]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastVerifiedAt" DATETIME,
    "lastEventAt" DATETIME,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookConfiguration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebhookConfiguration_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebhookConfiguration_wabaRecordId_fkey" FOREIGN KEY ("wabaRecordId") REFERENCES "WhatsAppBusinessAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'meta',
    "organizationId" TEXT,
    "wabaId" TEXT NOT NULL DEFAULT '',
    "field" TEXT NOT NULL DEFAULT '',
    "eventType" TEXT NOT NULL DEFAULT '',
    "dedupeKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT NOT NULL DEFAULT '',
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    CONSTRAINT "WebhookEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UsageCounter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "lifecycle" TEXT NOT NULL DEFAULT 'lead',
    "leadStatus" TEXT NOT NULL DEFAULT 'new',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "ownerUserId" TEXT,
    "optInStatus" TEXT NOT NULL DEFAULT 'unknown',
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressionReason" TEXT NOT NULL DEFAULT '',
    "customFields" TEXT NOT NULL DEFAULT '{}',
    "lastMessageAt" DATETIME,
    "lastInboundAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Contact_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'emerald',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("contactId", "tagId"),
    CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "whatsappAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignedToUserId" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT NOT NULL DEFAULT '',
    "lastInboundAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "aiStatus" TEXT NOT NULL DEFAULT '',
    "aiHandoffAt" DATETIME,
    "aiHandoffReason" TEXT NOT NULL DEFAULT '',
    "aiResumeAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_whatsappAccountId_fkey" FOREIGN KEY ("whatsappAccountId") REFERENCES "WhatsAppAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "externalId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT NOT NULL DEFAULT '',
    "replyToId" TEXT,
    "senderUserId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "deliveredAt" DATETIME,
    "readAt" DATETIME,
    "failedAt" DATETIME,
    CONSTRAINT "Message_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "messageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT '',
    "filename" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "providerMediaId" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "sha256" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "byUserId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConversationAssignment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactNote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContactNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "source" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '',
    "recordedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsentRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsentRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ConsentRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "wabaRecordId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "headerType" TEXT NOT NULL DEFAULT 'none',
    "headerText" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "footer" TEXT NOT NULL DEFAULT '',
    "buttons" TEXT NOT NULL DEFAULT '[]',
    "examples" TEXT NOT NULL DEFAULT '{}',
    "authOptions" TEXT NOT NULL DEFAULT '{}',
    "metaTemplateId" TEXT NOT NULL DEFAULT '',
    "metaStatus" TEXT NOT NULL DEFAULT '',
    "rejectedReason" TEXT NOT NULL DEFAULT '',
    "qualityScore" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT NOT NULL DEFAULT 'mecgura',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "lastSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessageTemplate_wabaRecordId_fkey" FOREIGN KEY ("wabaRecordId") REFERENCES "WhatsAppBusinessAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessageTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "filters" TEXT NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Segment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Segment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "whatsappAccountId" TEXT,
    "templateId" TEXT,
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
    CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
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

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "whatsappAccountId" TEXT,
    "graph" TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "publishedVersionId" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "triggerType" TEXT NOT NULL DEFAULT '',
    "triggerConfig" TEXT NOT NULL DEFAULT '{}',
    "webhookSecretHash" TEXT NOT NULL DEFAULT '',
    "lastScheduledAt" DATETIME,
    "lastRunAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Automation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Automation_whatsappAccountId_fkey" FOREIGN KEY ("whatsappAccountId") REFERENCES "WhatsAppAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Automation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggerConfig" TEXT NOT NULL DEFAULT '{}',
    "note" TEXT NOT NULL DEFAULT '',
    "publishedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationVersion_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationExecution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "graph" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "waitState" TEXT NOT NULL DEFAULT '',
    "triggerType" TEXT NOT NULL,
    "triggerData" TEXT NOT NULL DEFAULT '{}',
    "context" TEXT NOT NULL DEFAULT '{}',
    "currentNodeId" TEXT,
    "nextRunAt" DATETIME,
    "lockedUntil" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "skipDelays" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT NOT NULL DEFAULT '',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutomationExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutomationExecution_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutomationExecution_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutomationExecutionStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "output" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AutomationExecutionStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "AutomationExecution" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "wabaRecordId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "template" TEXT NOT NULL DEFAULT 'custom',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "definition" TEXT NOT NULL DEFAULT '{}',
    "flowJson" TEXT NOT NULL DEFAULT '',
    "metaFlowId" TEXT NOT NULL DEFAULT '',
    "metaStatus" TEXT NOT NULL DEFAULT '',
    "validationErrors" TEXT NOT NULL DEFAULT '[]',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Flow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Flow_wabaRecordId_fkey" FOREIGN KEY ("wabaRecordId") REFERENCES "WhatsAppBusinessAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Flow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FlowSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "answers" TEXT NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL,
    "flowToken" TEXT NOT NULL DEFAULT '',
    "crmResult" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlowSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FlowSubmission_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FlowSubmission_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "accountIds" TEXT NOT NULL DEFAULT '[]',
    "instructions" TEXT NOT NULL DEFAULT '',
    "knowledge" TEXT NOT NULL DEFAULT '{}',
    "actions" TEXT NOT NULL DEFAULT '{}',
    "handoff" TEXT NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiAgent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AiAgent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'text/plain',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiDocument_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "conversationId" TEXT,
    "contactId" TEXT,
    "mode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "input" TEXT NOT NULL DEFAULT '',
    "output" TEXT NOT NULL DEFAULT '',
    "actions" TEXT NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL DEFAULT '',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiInteraction_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT,
    "service" TEXT NOT NULL DEFAULT '',
    "requestedFor" TEXT NOT NULL DEFAULT '',
    "startsAt" DATETIME,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'requested',
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Appointment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "lastUsedAt" DATETIME,
    "lastUsedIp" TEXT NOT NULL DEFAULT '',
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "rotatedFromId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApiKey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApiRequestLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "errorCode" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiRequestLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApiRequestLog_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "events" TEXT NOT NULL DEFAULT '[]',
    "secretEnc" TEXT NOT NULL,
    "secretLast4" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "disabledReason" TEXT NOT NULL DEFAULT '',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" DATETIME,
    "lastFailureAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebhookEndpoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "lockedUntil" DATETIME,
    "responseStatus" INTEGER,
    "durationMs" INTEGER,
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" DATETIME,
    CONSTRAINT "WebhookDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'subscription',
    "status" TEXT NOT NULL DEFAULT 'open',
    "description" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "taxBps" INTEGER NOT NULL DEFAULT 0,
    "taxAmount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "lines" TEXT NOT NULL DEFAULT '[]',
    "issuer" TEXT NOT NULL DEFAULT '{}',
    "billTo" TEXT NOT NULL DEFAULT '{}',
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "targetPlanId" TEXT,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    "voidedAt" DATETIME,
    "overdueNotifiedAt" DATETIME,
    "paidVia" TEXT NOT NULL DEFAULT '',
    "paymentNote" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayRef" TEXT NOT NULL DEFAULT '',
    "gatewayPaymentId" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'created',
    "failureCode" TEXT NOT NULL DEFAULT '',
    "failureReason" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gateway" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT '',
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "outcome" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "year" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "last" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

-- CreateIndex
CREATE INDEX "Organization_createdAt_idx" ON "Organization"("createdAt");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SiteSetting_key_key" ON "SiteSetting"("key");

-- CreateIndex
CREATE INDEX "SiteSetting_key_idx" ON "SiteSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_slug_key" ON "Plan"("slug");

-- CreateIndex
CREATE INDEX "Plan_isActive_sortOrder_idx" ON "Plan"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Subscription_organizationId_status_idx" ON "Subscription"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Subscription_planId_status_idx" ON "Subscription"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationService_organizationId_service_key" ON "OrganizationService"("organizationId", "service");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSettings_organizationId_key" ON "OrganizationSettings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_phoneNumber_key" ON "WhatsAppAccount"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppAccount_phoneRecordId_key" ON "WhatsAppAccount"("phoneRecordId");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_organizationId_idx" ON "WhatsAppAccount"("organizationId");

-- CreateIndex
CREATE INDEX "WhatsAppAccount_status_idx" ON "WhatsAppAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppBusinessAccount_wabaId_key" ON "WhatsAppBusinessAccount"("wabaId");

-- CreateIndex
CREATE INDEX "WhatsAppBusinessAccount_organizationId_idx" ON "WhatsAppBusinessAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneNumber_phoneNumberId_key" ON "PhoneNumber"("phoneNumberId");

-- CreateIndex
CREATE INDEX "PhoneNumber_organizationId_idx" ON "PhoneNumber"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_stateHash_key" ON "WhatsAppConnection"("stateHash");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_organizationId_status_idx" ON "WhatsAppConnection"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookConfiguration_connectionId_key" ON "WebhookConfiguration"("connectionId");

-- CreateIndex
CREATE INDEX "WebhookConfiguration_verifyTokenHash_idx" ON "WebhookConfiguration"("verifyTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_dedupeKey_key" ON "WebhookEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_organizationId_receivedAt_idx" ON "WebhookEvent"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "UsageCounter_metric_day_idx" ON "UsageCounter"("metric", "day");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_organizationId_metric_day_key" ON "UsageCounter"("organizationId", "metric", "day");

-- CreateIndex
CREATE INDEX "Contact_organizationId_lifecycle_idx" ON "Contact"("organizationId", "lifecycle");

-- CreateIndex
CREATE INDEX "Contact_organizationId_optInStatus_idx" ON "Contact"("organizationId", "optInStatus");

-- CreateIndex
CREATE INDEX "Contact_organizationId_lastMessageAt_idx" ON "Contact"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_organizationId_phone_key" ON "Contact"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_organizationId_name_key" ON "Tag"("organizationId", "name");

-- CreateIndex
CREATE INDEX "ContactTag_tagId_idx" ON "ContactTag"("tagId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_lastMessageAt_idx" ON "Conversation"("organizationId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_assignedToUserId_idx" ON "Conversation"("organizationId", "assignedToUserId");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_status_idx" ON "Conversation"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_whatsappAccountId_contactId_key" ON "Conversation"("whatsappAccountId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_externalId_key" ON "Message"("externalId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_organizationId_createdAt_idx" ON "Message"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "ConversationAssignment_conversationId_createdAt_idx" ON "ConversationAssignment"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactNote_contactId_createdAt_idx" ON "ContactNote"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_contactId_createdAt_idx" ON "ConsentRecord"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageTemplate_organizationId_status_idx" ON "MessageTemplate"("organizationId", "status");

-- CreateIndex
CREATE INDEX "MessageTemplate_metaTemplateId_idx" ON "MessageTemplate"("metaTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_wabaRecordId_name_language_key" ON "MessageTemplate"("wabaRecordId", "name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_organizationId_name_key" ON "Segment"("organizationId", "name");

-- CreateIndex
CREATE INDEX "Campaign_organizationId_status_idx" ON "Campaign"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_messageId_key" ON "CampaignRecipient"("messageId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_contactId_sentAt_idx" ON "CampaignRecipient"("contactId", "sentAt");

-- CreateIndex
CREATE INDEX "CampaignRecipient_organizationId_sentAt_idx" ON "CampaignRecipient"("organizationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_phone_key" ON "CampaignRecipient"("campaignId", "phone");

-- CreateIndex
CREATE INDEX "Automation_organizationId_status_idx" ON "Automation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Automation_status_triggerType_idx" ON "Automation"("status", "triggerType");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationVersion_automationId_version_key" ON "AutomationVersion"("automationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationExecution_dedupeKey_key" ON "AutomationExecution"("dedupeKey");

-- CreateIndex
CREATE INDEX "AutomationExecution_automationId_createdAt_idx" ON "AutomationExecution"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_status_nextRunAt_idx" ON "AutomationExecution"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "AutomationExecution_organizationId_contactId_status_idx" ON "AutomationExecution"("organizationId", "contactId", "status");

-- CreateIndex
CREATE INDEX "AutomationExecutionStep_executionId_startedAt_idx" ON "AutomationExecutionStep"("executionId", "startedAt");

-- CreateIndex
CREATE INDEX "AutomationExecutionStep_organizationId_nodeId_idx" ON "AutomationExecutionStep"("organizationId", "nodeId");

-- CreateIndex
CREATE INDEX "Flow_organizationId_status_idx" ON "Flow"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Flow_organizationId_name_key" ON "Flow"("organizationId", "name");

-- CreateIndex
CREATE INDEX "FlowSubmission_flowId_createdAt_idx" ON "FlowSubmission"("flowId", "createdAt");

-- CreateIndex
CREATE INDEX "FlowSubmission_organizationId_contactId_idx" ON "FlowSubmission"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "AiAgent_organizationId_status_idx" ON "AiAgent"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AiDocument_agentId_idx" ON "AiDocument"("agentId");

-- CreateIndex
CREATE INDEX "AiInteraction_agentId_createdAt_idx" ON "AiInteraction"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_organizationId_conversationId_idx" ON "AiInteraction"("organizationId", "conversationId");

-- CreateIndex
CREATE INDEX "Appointment_organizationId_status_idx" ON "Appointment"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_createdAt_idx" ON "ApiKey"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_organizationId_createdAt_idx" ON "ApiRequestLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_apiKeyId_createdAt_idx" ON "ApiRequestLog"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_organizationId_status_idx" ON "WebhookEndpoint"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_organizationId_createdAt_idx" ON "WebhookDelivery"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_issuedAt_idx" ON "Invoice"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_status_dueAt_idx" ON "Invoice"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Payment_organizationId_createdAt_idx" ON "Payment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_gateway_gatewayRef_idx" ON "Payment"("gateway", "gatewayRef");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_gateway_eventId_key" ON "PaymentEvent"("gateway", "eventId");
