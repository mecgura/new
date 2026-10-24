-- AlterTable
ALTER TABLE "WhatsAppAccount" ADD COLUMN "callingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WaCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "whatsappAccountId" TEXT NOT NULL,
    "contactId" TEXT,
    "metaCallId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "peerPhone" TEXT NOT NULL,
    "peerName" TEXT NOT NULL DEFAULT '',
    "offerSdp" TEXT NOT NULL DEFAULT '',
    "answerSdp" TEXT NOT NULL DEFAULT '',
    "answeredByUserId" TEXT,
    "startedByUserId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" DATETIME,
    "endedAt" DATETIME,
    "durationSec" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WaCall_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WaCall_metaCallId_key" ON "WaCall"("metaCallId");
CREATE INDEX "WaCall_organizationId_status_idx" ON "WaCall"("organizationId", "status");
CREATE INDEX "WaCall_organizationId_startedAt_idx" ON "WaCall"("organizationId", "startedAt");
