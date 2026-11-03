-- CreateTable
CREATE TABLE "MarketingLead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "business" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "campaign" TEXT NOT NULL DEFAULT '',
    "medium" TEXT NOT NULL DEFAULT '',
    "ref" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "valuePaise" INTEGER NOT NULL DEFAULT 0,
    "lostReason" TEXT NOT NULL DEFAULT '',
    "nextFollowUpAt" DATETIME,
    "lastContactAt" DATETIME,
    "organizationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketingLeadActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingLeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketingLead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "path" TEXT NOT NULL DEFAULT '/',
    "source" TEXT NOT NULL DEFAULT 'direct',
    "campaign" TEXT NOT NULL DEFAULT '',
    "ref" TEXT NOT NULL DEFAULT '',
    "visitor" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MarketingPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "channels" TEXT NOT NULL DEFAULT '["instagram"]',
    "title" TEXT NOT NULL DEFAULT '',
    "caption" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'post',
    "status" TEXT NOT NULL DEFAULT 'idea',
    "festival" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingLead_phone_key" ON "MarketingLead"("phone");

-- CreateIndex
CREATE INDEX "MarketingLead_stage_nextFollowUpAt_idx" ON "MarketingLead"("stage", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "MarketingLead_createdAt_idx" ON "MarketingLead"("createdAt");

-- CreateIndex
CREATE INDEX "MarketingLeadActivity_leadId_createdAt_idx" ON "MarketingLeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingEvent_kind_createdAt_idx" ON "MarketingEvent"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingEvent_createdAt_idx" ON "MarketingEvent"("createdAt");

-- CreateIndex
CREATE INDEX "MarketingPost_date_idx" ON "MarketingPost"("date");

