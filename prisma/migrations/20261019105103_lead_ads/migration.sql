-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "formId" TEXT NOT NULL DEFAULT '',
    "encryptedPageToken" TEXT NOT NULL,
    "tokenLast4" TEXT NOT NULL DEFAULT '',
    "whatsappAccountId" TEXT NOT NULL,
    "templateId" TEXT,
    "variables" TEXT NOT NULL DEFAULT '{}',
    "phoneField" TEXT NOT NULL DEFAULT 'phone_number',
    "nameField" TEXT NOT NULL DEFAULT 'full_name',
    "emailField" TEXT NOT NULL DEFAULT 'email',
    "consentConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "leadsCount" INTEGER NOT NULL DEFAULT 0,
    "lastLeadAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeadSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "leadgenId" TEXT NOT NULL,
    "formId" TEXT NOT NULL DEFAULT '',
    "contactId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'received',
    "error" TEXT NOT NULL DEFAULT '',
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Lead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_pageId_key" ON "LeadSource"("pageId");

-- CreateIndex
CREATE INDEX "LeadSource_organizationId_idx" ON "LeadSource"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_leadgenId_key" ON "Lead"("leadgenId");

-- CreateIndex
CREATE INDEX "Lead_organizationId_createdAt_idx" ON "Lead"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_sourceId_createdAt_idx" ON "Lead"("sourceId", "createdAt");
