-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN "social" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN "approvedAt" DATETIME;
ALTER TABLE "SocialPost" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN "reviewNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SocialPost" ADD COLUMN "submittedAt" DATETIME;

-- CreateTable
CREATE TABLE "SocialAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bytes" BLOB NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SocialAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SocialAsset_organizationId_createdAt_idx" ON "SocialAsset"("organizationId", "createdAt");
