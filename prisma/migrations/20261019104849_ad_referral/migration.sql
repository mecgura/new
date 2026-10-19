-- CreateTable
CREATE TABLE "AdReferral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "headline" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "ctwaClid" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AdReferral_messageId_key" ON "AdReferral"("messageId");

-- CreateIndex
CREATE INDEX "AdReferral_organizationId_createdAt_idx" ON "AdReferral"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdReferral_organizationId_sourceId_idx" ON "AdReferral"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "AdReferral_contactId_idx" ON "AdReferral"("contactId");
