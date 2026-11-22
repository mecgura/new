-- CreateTable
CREATE TABLE "OnePostApprovalLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "decision" TEXT NOT NULL DEFAULT '',
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "decidedBy" TEXT NOT NULL DEFAULT '',
    "decidedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnePostApprovalLink_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OnePost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OnePostContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outlet" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL,
    "city" TEXT NOT NULL DEFAULT '',
    "beat" TEXT NOT NULL DEFAULT '',
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "optToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "OnePostContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OnePostPitch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT NOT NULL DEFAULT '',
    "sentAt" DATETIME,
    "openedAt" DATETIME,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "trackToken" TEXT NOT NULL,
    "coverageUrl" TEXT NOT NULL DEFAULT '',
    "coverageNote" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnePostPitch_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OnePost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OnePostPitch_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "OnePostContact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OnePost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL DEFAULT '',
    "postType" TEXT NOT NULL DEFAULT 'general',
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "city" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "spokespersonName" TEXT NOT NULL DEFAULT '',
    "spokespersonQuote" TEXT NOT NULL DEFAULT '',
    "videoUrl" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "submittedAt" DATETIME,
    "approvedAt" DATETIME,
    "approvedById" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "scheduledAt" DATETIME,
    "publishedAt" DATETIME,
    "eventName" TEXT NOT NULL DEFAULT '',
    "eventDate" DATETIME,
    "eventPlace" TEXT NOT NULL DEFAULT '',
    "eventHighlights" TEXT NOT NULL DEFAULT '',
    "eventGroupId" TEXT NOT NULL DEFAULT '',
    "eventPhase" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "OnePost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OnePost" ("approvedAt", "approvedById", "brief", "city", "createdAt", "createdById", "id", "keywords", "language", "organizationId", "postType", "publishedAt", "reviewNote", "scheduledAt", "spokespersonName", "spokespersonQuote", "status", "submittedAt", "title", "tone", "updatedAt", "videoUrl") SELECT "approvedAt", "approvedById", "brief", "city", "createdAt", "createdById", "id", "keywords", "language", "organizationId", "postType", "publishedAt", "reviewNote", "scheduledAt", "spokespersonName", "spokespersonQuote", "status", "submittedAt", "title", "tone", "updatedAt", "videoUrl" FROM "OnePost";
DROP TABLE "OnePost";
ALTER TABLE "new_OnePost" RENAME TO "OnePost";
CREATE INDEX "OnePost_organizationId_status_updatedAt_idx" ON "OnePost"("organizationId", "status", "updatedAt");
CREATE INDEX "OnePost_organizationId_createdAt_idx" ON "OnePost"("organizationId", "createdAt");
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
    "variantOf" TEXT NOT NULL DEFAULT '',
    "ratio" TEXT NOT NULL DEFAULT '',
    "watermarked" BOOLEAN NOT NULL DEFAULT false,
    "thumbUrl" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "OnePostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OnePost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OnePostMedia" ("blobPath", "blobUrl", "bytes", "createdAt", "id", "kind", "mimeType", "name", "organizationId", "position", "postId", "sizeBytes", "storage") SELECT "blobPath", "blobUrl", "bytes", "createdAt", "id", "kind", "mimeType", "name", "organizationId", "position", "postId", "sizeBytes", "storage" FROM "OnePostMedia";
DROP TABLE "OnePostMedia";
ALTER TABLE "new_OnePostMedia" RENAME TO "OnePostMedia";
CREATE INDEX "OnePostMedia_postId_position_idx" ON "OnePostMedia"("postId", "position");
CREATE INDEX "OnePostMedia_organizationId_idx" ON "OnePostMedia"("organizationId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "OnePostApprovalLink_tokenHash_key" ON "OnePostApprovalLink"("tokenHash");

-- CreateIndex
CREATE INDEX "OnePostApprovalLink_postId_idx" ON "OnePostApprovalLink"("postId");

-- CreateIndex
CREATE INDEX "OnePostApprovalLink_organizationId_idx" ON "OnePostApprovalLink"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OnePostContact_optToken_key" ON "OnePostContact"("optToken");

-- CreateIndex
CREATE UNIQUE INDEX "OnePostContact_organizationId_email_key" ON "OnePostContact"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "OnePostPitch_trackToken_key" ON "OnePostPitch"("trackToken");

-- CreateIndex
CREATE INDEX "OnePostPitch_postId_idx" ON "OnePostPitch"("postId");

-- CreateIndex
CREATE INDEX "OnePostPitch_organizationId_createdAt_idx" ON "OnePostPitch"("organizationId", "createdAt");

