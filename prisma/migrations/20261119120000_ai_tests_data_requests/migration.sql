-- CreateTable
CREATE TABLE "AiTestCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "mustInclude" TEXT NOT NULL DEFAULT '',
    "mustNotInclude" TEXT NOT NULL DEFAULT '',
    "expectAction" TEXT NOT NULL DEFAULT '',
    "lastStatus" TEXT NOT NULL DEFAULT '',
    "lastReply" TEXT NOT NULL DEFAULT '',
    "lastReasons" TEXT NOT NULL DEFAULT '[]',
    "lastMode" TEXT NOT NULL DEFAULT '',
    "lastModel" TEXT NOT NULL DEFAULT '',
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiTestCase_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AiAgent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'delete_workspace',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "requestedByEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "earliestAt" DATETIME NOT NULL,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AiTestCase_agentId_idx" ON "AiTestCase"("agentId");

-- CreateIndex
CREATE INDEX "DataRequest_status_createdAt_idx" ON "DataRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DataRequest_organizationId_idx" ON "DataRequest"("organizationId");

