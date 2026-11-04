-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "blocks" TEXT NOT NULL DEFAULT '[]',
    "publishedBlocks" TEXT NOT NULL DEFAULT '[]',
    "theme" TEXT NOT NULL DEFAULT '{}',
    "seoTitle" TEXT NOT NULL DEFAULT '',
    "seoDescription" TEXT NOT NULL DEFAULT '',
    "noIndex" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LandingPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LandingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "visitor" TEXT NOT NULL DEFAULT '',
    "utmSource" TEXT NOT NULL DEFAULT '',
    "utmMedium" TEXT NOT NULL DEFAULT '',
    "utmCampaign" TEXT NOT NULL DEFAULT '',
    "referrerHost" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LandingEvent_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "LandingPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LandingSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "contactId" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "utmSource" TEXT NOT NULL DEFAULT '',
    "utmMedium" TEXT NOT NULL DEFAULT '',
    "utmCampaign" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LandingSubmission_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "LandingPage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LandingImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/webp',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LandingImage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LandingPage_organizationId_updatedAt_idx" ON "LandingPage"("organizationId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_organizationId_slug_key" ON "LandingPage"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "LandingEvent_pageId_createdAt_idx" ON "LandingEvent"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "LandingEvent_organizationId_createdAt_idx" ON "LandingEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LandingSubmission_pageId_createdAt_idx" ON "LandingSubmission"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "LandingSubmission_organizationId_createdAt_idx" ON "LandingSubmission"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LandingImage_organizationId_createdAt_idx" ON "LandingImage"("organizationId", "createdAt");

