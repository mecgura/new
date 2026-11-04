-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encryptedSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" DATETIME,
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "IntegrationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationEvent_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "IntegrationConnection_organizationId_idx" ON "IntegrationConnection"("organizationId");

-- CreateIndex
CREATE INDEX "IntegrationEvent_connectionId_createdAt_idx" ON "IntegrationEvent"("connectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationEvent_connectionId_topic_externalId_key" ON "IntegrationEvent"("connectionId", "topic", "externalId");

