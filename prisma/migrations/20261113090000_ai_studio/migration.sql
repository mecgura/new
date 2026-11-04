-- AlterTable
ALTER TABLE "AiDocument" ADD COLUMN "sourceUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AiDocument" ADD COLUMN "syncedAt" DATETIME;

-- AlterTable
ALTER TABLE "AiInteraction" ADD COLUMN "feedback" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AiInteraction" ADD COLUMN "feedbackNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AiInteraction" ADD COLUMN "feedbackById" TEXT;
ALTER TABLE "AiInteraction" ADD COLUMN "feedbackAt" DATETIME;

-- CreateTable
CREATE TABLE "AiAgentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "knowledge" TEXT NOT NULL DEFAULT '{}',
    "actions" TEXT NOT NULL DEFAULT '{}',
    "handoff" TEXT NOT NULL DEFAULT '{}',
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiAgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AiAgentVersion_agentId_version_key" ON "AiAgentVersion"("agentId", "version");
