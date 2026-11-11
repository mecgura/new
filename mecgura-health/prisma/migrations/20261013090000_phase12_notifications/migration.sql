-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "roles" TEXT NOT NULL DEFAULT '[]',
    "priority" TEXT,
    "ackRequired" BOOLEAN,
    "escalateAfterMin" INTEGER,
    "externalChannels" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NotificationUserSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "quietEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietStartMin" INTEGER NOT NULL DEFAULT 1320,
    "quietEndMin" INTEGER NOT NULL DEFAULT 480,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "retentionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "archiveReadAfterDays" INTEGER NOT NULL DEFAULT 30,
    "expireAfterDays" INTEGER NOT NULL DEFAULT 180,
    "lowStockCheck" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "actionUrl" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "patientId" TEXT,
    "readAt" DATETIME,
    "archivedAt" DATETIME,
    "expiresAt" DATETIME,
    "visibleAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackRequired" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedAt" DATETIME,
    "acknowledgedById" TEXT,
    "escalatedAt" DATETIME,
    "sourceEventId" TEXT,
    "groupKey" TEXT,
    "groupCount" INTEGER NOT NULL DEFAULT 1,
    "metadata" TEXT,
    "dedupeKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Notification" ("body", "createdAt", "dedupeKey", "entityId", "entityType", "id", "readAt", "tenantId", "title", "type", "userId") SELECT "body", "createdAt", "dedupeKey", "entityId", "entityType", "id", "readAt", "tenantId", "title", "type", "userId" FROM "Notification";
DROP TABLE "Notification";
ALTER TABLE "new_Notification" RENAME TO "Notification";
CREATE INDEX "Notification_tenantId_userId_readAt_createdAt_idx" ON "Notification"("tenantId", "userId", "readAt", "createdAt");
CREATE INDEX "Notification_userId_archivedAt_createdAt_idx" ON "Notification"("userId", "archivedAt", "createdAt");
CREATE INDEX "Notification_userId_category_createdAt_idx" ON "Notification"("userId", "category", "createdAt");
CREATE INDEX "Notification_tenantId_entityType_entityId_idx" ON "Notification"("tenantId", "entityType", "entityId");
CREATE INDEX "Notification_priority_createdAt_idx" ON "Notification"("priority", "createdAt");
CREATE INDEX "Notification_userId_groupKey_idx" ON "Notification"("userId", "groupKey");
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "NotificationEvent_createdAt_idx" ON "NotificationEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationEvent_userId_eventKey_key" ON "NotificationEvent"("userId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRule_tenantId_type_key" ON "NotificationRule"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_category_key" ON "NotificationPreference"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationUserSettings_userId_key" ON "NotificationUserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_tenantId_key" ON "NotificationSettings"("tenantId");

