-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ChannelAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "publicKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'demo',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "encryptedToken" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChannelAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ChannelAccount" ("address", "createdAt", "id", "kind", "name", "organizationId", "publicKey", "settings", "status", "updatedAt") SELECT "address", "createdAt", "id", "kind", "name", "organizationId", "publicKey", "settings", "status", "updatedAt" FROM "ChannelAccount";
DROP TABLE "ChannelAccount";
ALTER TABLE "new_ChannelAccount" RENAME TO "ChannelAccount";
CREATE UNIQUE INDEX "ChannelAccount_publicKey_key" ON "ChannelAccount"("publicKey");
CREATE INDEX "ChannelAccount_organizationId_kind_idx" ON "ChannelAccount"("organizationId", "kind");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
