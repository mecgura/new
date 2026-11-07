-- CreateTable
CREATE TABLE "SponsoredAd" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "ctaLabel" TEXT NOT NULL DEFAULT 'Learn more',
    "linkType" TEXT NOT NULL DEFAULT 'url',
    "link" TEXT NOT NULL,
    "waMessage" TEXT NOT NULL DEFAULT '',
    "imageKey" TEXT,
    "imageMime" TEXT NOT NULL DEFAULT '',
    "imageBytes" BLOB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "reviewedAt" DATETIME,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "maxImpressions" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SponsoredAd_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SponsoredStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SponsoredStat_adId_fkey" FOREIGN KEY ("adId") REFERENCES "SponsoredAd" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SponsoredAd_imageKey_key" ON "SponsoredAd"("imageKey");

-- CreateIndex
CREATE INDEX "SponsoredAd_status_startsAt_endsAt_idx" ON "SponsoredAd"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "SponsoredAd_organizationId_createdAt_idx" ON "SponsoredAd"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SponsoredStat_adId_day_key" ON "SponsoredStat"("adId", "day");

