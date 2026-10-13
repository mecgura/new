-- AlterTable
ALTER TABLE "User" ADD COLUMN "sessionsValidFrom" DATETIME;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "hashKeyId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "reason" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "requestId" TEXT;

-- AlterTable
ALTER TABLE "PatientConsent" ADD COLUMN "ip" TEXT;
ALTER TABLE "PatientConsent" ADD COLUMN "purpose" TEXT;
ALTER TABLE "PatientConsent" ADD COLUMN "source" TEXT;

-- AlterTable
ALTER TABLE "PatientRequest" ADD COLUMN "dueAt" DATETIME;
ALTER TABLE "PatientRequest" ADD COLUMN "outcome" TEXT;
ALTER TABLE "PatientRequest" ADD COLUMN "resolvedAt" DATETIME;

-- CreateTable
CREATE TABLE "UserMfa" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "secretEnc" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "enabledAt" DATETIME,
    "backupHashes" TEXT NOT NULL DEFAULT '[]',
    "lastStep" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "expiresAt" DATETIME,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    "lastUsedAt" DATETIME,
    "lastUsedIp" TEXT,
    "allowedIps" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "actorId" TEXT,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentNumber" TEXT NOT NULL,
    "tenantId" TEXT,
    "severity" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "detectedById" TEXT,
    "assignedToId" TEXT,
    "affectedResource" TEXT,
    "evidence" TEXT,
    "actionsTaken" TEXT,
    "resolution" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SecurityIncidentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityIncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SecurityIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditSeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromAt" DATETIME NOT NULL,
    "toAt" DATETIME NOT NULL,
    "count" INTEGER NOT NULL,
    "chainHash" TEXT NOT NULL,
    "hmac" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "sealedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantKey" TEXT NOT NULL,
    "dataClass" TEXT NOT NULL,
    "retainDays" INTEGER,
    "action" TEXT NOT NULL DEFAULT 'ARCHIVE',
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "reason" TEXT NOT NULL,
    "placedById" TEXT NOT NULL,
    "placedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" DATETIME,
    "releasedById" TEXT,
    "releaseNote" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "UserMfa_userId_key" ON "UserMfa"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_tenantId_createdAt_idx" ON "ApiKey"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_severity_createdAt_idx" ON "SecurityEvent"("severity", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_category_createdAt_idx" ON "SecurityEvent"("category", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_tenantId_createdAt_idx" ON "SecurityEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_ip_createdAt_idx" ON "SecurityEvent"("type", "ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityIncident_incidentNumber_key" ON "SecurityIncident"("incidentNumber");

-- CreateIndex
CREATE INDEX "SecurityIncident_status_severity_detectedAt_idx" ON "SecurityIncident"("status", "severity", "detectedAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_tenantId_detectedAt_idx" ON "SecurityIncident"("tenantId", "detectedAt");

-- CreateIndex
CREATE INDEX "SecurityIncidentEvent_incidentId_createdAt_idx" ON "SecurityIncidentEvent"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditSeal_toAt_idx" ON "AuditSeal"("toAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_tenantKey_dataClass_key" ON "RetentionPolicy"("tenantKey", "dataClass");

-- CreateIndex
CREATE INDEX "LegalHold_tenantId_releasedAt_idx" ON "LegalHold"("tenantId", "releasedAt");

-- CreateIndex
CREATE INDEX "LegalHold_scopeType_scopeId_releasedAt_idx" ON "LegalHold"("scopeType", "scopeId", "releasedAt");


-- Phase 16: audit rows are append-only. Editing one is refused by the database itself.
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE ON "AuditLog"
BEGIN
  SELECT RAISE(ABORT, 'audit log rows are append-only');
END;
