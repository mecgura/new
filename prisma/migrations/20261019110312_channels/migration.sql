-- CreateTable
CREATE TABLE "ChannelAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "publicKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'demo',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContactIdentity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactIdentity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "whatsappAccountId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "channelAccountId" TEXT,
    "externalThreadId" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
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
    CONSTRAINT "Conversation_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Conversation" ("aiHandoffAt", "aiHandoffReason", "aiResumeAt", "aiStatus", "assignedToUserId", "contactId", "createdAt", "id", "isDemo", "lastInboundAt", "lastMessageAt", "lastMessagePreview", "organizationId", "status", "unreadCount", "updatedAt", "whatsappAccountId") SELECT "aiHandoffAt", "aiHandoffReason", "aiResumeAt", "aiStatus", "assignedToUserId", "contactId", "createdAt", "id", "isDemo", "lastInboundAt", "lastMessageAt", "lastMessagePreview", "organizationId", "status", "unreadCount", "updatedAt", "whatsappAccountId" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE INDEX "Conversation_organizationId_lastMessageAt_idx" ON "Conversation"("organizationId", "lastMessageAt");
CREATE INDEX "Conversation_organizationId_assignedToUserId_idx" ON "Conversation"("organizationId", "assignedToUserId");
CREATE INDEX "Conversation_organizationId_status_idx" ON "Conversation"("organizationId", "status");
CREATE UNIQUE INDEX "Conversation_whatsappAccountId_contactId_key" ON "Conversation"("whatsappAccountId", "contactId");
CREATE UNIQUE INDEX "Conversation_channelAccountId_contactId_externalThreadId_key" ON "Conversation"("channelAccountId", "contactId", "externalThreadId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ChannelAccount_publicKey_key" ON "ChannelAccount"("publicKey");

-- CreateIndex
CREATE INDEX "ChannelAccount_organizationId_kind_idx" ON "ChannelAccount"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "ContactIdentity_contactId_idx" ON "ContactIdentity"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactIdentity_organizationId_kind_value_key" ON "ContactIdentity"("organizationId", "kind", "value");
