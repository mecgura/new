-- CreateTable
CREATE TABLE "ClientAgreement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "token" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "businessType" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT NOT NULL DEFAULT '',
    "designation" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT '',
    "pincode" TEXT NOT NULL DEFAULT '',
    "gstin" TEXT NOT NULL DEFAULT '',
    "pan" TEXT NOT NULL DEFAULT '',
    "planName" TEXT NOT NULL DEFAULT '',
    "pricePaise" INTEGER NOT NULL DEFAULT 0,
    "setupFeePaise" INTEGER NOT NULL DEFAULT 0,
    "services" TEXT NOT NULL DEFAULT '[]',
    "billingMode" TEXT NOT NULL DEFAULT 'client_pays',
    "startDate" TEXT NOT NULL DEFAULT '',
    "termMonths" INTEGER NOT NULL DEFAULT 12,
    "extraTerms" TEXT NOT NULL DEFAULT '',
    "sentAt" DATETIME,
    "sendLog" TEXT NOT NULL DEFAULT '{}',
    "viewedAt" DATETIME,
    "signedAt" DATETIME,
    "signerName" TEXT NOT NULL DEFAULT '',
    "signerIp" TEXT NOT NULL DEFAULT '',
    "signerAgent" TEXT NOT NULL DEFAULT '',
    "signedHash" TEXT NOT NULL DEFAULT '',
    "signedText" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ClientAgreement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "agreementId" TEXT,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "data" BLOB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT NOT NULL DEFAULT '',
    "uploadedBy" TEXT NOT NULL DEFAULT 'client',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClientDocument_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "ClientAgreement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientAgreement_number_key" ON "ClientAgreement"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAgreement_token_key" ON "ClientAgreement"("token");

-- CreateIndex
CREATE INDEX "ClientAgreement_organizationId_createdAt_idx" ON "ClientAgreement"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientDocument_organizationId_idx" ON "ClientDocument"("organizationId");

-- CreateIndex
CREATE INDEX "ClientDocument_agreementId_idx" ON "ClientDocument"("agreementId");

