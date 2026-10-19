-- DropIndex
DROP INDEX "Conversation_channelAccountId_contactId_externalThreadId_key";

-- CreateIndex
CREATE INDEX "Conversation_channelAccountId_contactId_externalThreadId_idx" ON "Conversation"("channelAccountId", "contactId", "externalThreadId");
