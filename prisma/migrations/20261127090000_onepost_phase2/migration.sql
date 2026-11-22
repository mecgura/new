-- AlterTable
ALTER TABLE "OnePost" ADD COLUMN "publishedAt" DATETIME;
ALTER TABLE "OnePost" ADD COLUMN "scheduledAt" DATETIME;

-- CreateTable
CREATE TABLE "OnePostConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "encryptedAccess" TEXT NOT NULL DEFAULT '',
    "encryptedRefresh" TEXT NOT NULL DEFAULT '',
    "expiresAt" DATETIME,
    "scopes" TEXT NOT NULL DEFAULT '',
    "externalId" TEXT NOT NULL DEFAULT '',
    "externalName" TEXT NOT NULL DEFAULT '',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "connectedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OnePostConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OnePostOAuthState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stateHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OnePostDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "scheduledAt" DATETIME NOT NULL,
    "nextAttemptAt" DATETIME NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "snapshot" TEXT NOT NULL DEFAULT '{}',
    "externalId" TEXT NOT NULL DEFAULT '',
    "externalUrl" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OnePostDelivery_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OnePost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OnePostMedia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bytes" BLOB NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "storage" TEXT NOT NULL DEFAULT 'db',
    "blobUrl" TEXT NOT NULL DEFAULT '',
    "blobPath" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "OnePostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OnePost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OnePostMedia" ("bytes", "createdAt", "id", "mimeType", "name", "organizationId", "position", "postId", "sizeBytes") SELECT "bytes", "createdAt", "id", "mimeType", "name", "organizationId", "position", "postId", "sizeBytes" FROM "OnePostMedia";
DROP TABLE "OnePostMedia";
ALTER TABLE "new_OnePostMedia" RENAME TO "OnePostMedia";
CREATE INDEX "OnePostMedia_postId_position_idx" ON "OnePostMedia"("postId", "position");
CREATE INDEX "OnePostMedia_organizationId_idx" ON "OnePostMedia"("organizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "OnePostConnection_organizationId_provider_idx" ON "OnePostConnection"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OnePostOAuthState_stateHash_key" ON "OnePostOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "OnePostOAuthState_expiresAt_idx" ON "OnePostOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "OnePostDelivery_status_nextAttemptAt_idx" ON "OnePostDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OnePostDelivery_organizationId_scheduledAt_idx" ON "OnePostDelivery"("organizationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "OnePostDelivery_postId_idx" ON "OnePostDelivery"("postId");

