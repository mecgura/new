-- CreateTable
CREATE TABLE "VoiceCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'demo',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "goal" TEXT NOT NULL,
    "script" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT 'en',
    "consentNote" TEXT NOT NULL DEFAULT '',
    "providerCallId" TEXT NOT NULL DEFAULT '',
    "transcript" TEXT NOT NULL DEFAULT '[]',
    "summary" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL DEFAULT '',
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VoiceCall_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VoiceCall_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VoiceCall_organizationId_createdAt_idx" ON "VoiceCall"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "VoiceCall_contactId_idx" ON "VoiceCall"("contactId");
