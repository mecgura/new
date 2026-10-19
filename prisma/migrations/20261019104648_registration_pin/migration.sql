-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WhatsAppConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "stateHash" TEXT,
    "stateExpiresAt" DATETIME,
    "wabaRecordId" TEXT,
    "encryptedAccessToken" TEXT NOT NULL DEFAULT '',
    "tokenLast4" TEXT NOT NULL DEFAULT '',
    "encryptedAppSecret" TEXT NOT NULL DEFAULT '',
    "encryptedRegistrationPin" TEXT NOT NULL DEFAULT '',
    "tokenObtainedAt" DATETIME,
    "error" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "connectedAt" DATETIME,
    "disconnectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppConnection_wabaRecordId_fkey" FOREIGN KEY ("wabaRecordId") REFERENCES "WhatsAppBusinessAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WhatsAppConnection" ("connectedAt", "createdAt", "createdById", "disconnectedAt", "encryptedAccessToken", "encryptedAppSecret", "error", "id", "isDemo", "method", "organizationId", "stateExpiresAt", "stateHash", "status", "tokenLast4", "tokenObtainedAt", "updatedAt", "wabaRecordId") SELECT "connectedAt", "createdAt", "createdById", "disconnectedAt", "encryptedAccessToken", "encryptedAppSecret", "error", "id", "isDemo", "method", "organizationId", "stateExpiresAt", "stateHash", "status", "tokenLast4", "tokenObtainedAt", "updatedAt", "wabaRecordId" FROM "WhatsAppConnection";
DROP TABLE "WhatsAppConnection";
ALTER TABLE "new_WhatsAppConnection" RENAME TO "WhatsAppConnection";
CREATE UNIQUE INDEX "WhatsAppConnection_stateHash_key" ON "WhatsAppConnection"("stateHash");
CREATE INDEX "WhatsAppConnection_organizationId_status_idx" ON "WhatsAppConnection"("organizationId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
