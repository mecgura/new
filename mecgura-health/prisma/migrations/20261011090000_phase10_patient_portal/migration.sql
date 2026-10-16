-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "PatientAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "loginEmail" TEXT,
    "loginPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "verifiedAt" DATETIME,
    "lastLoginAt" DATETIME,
    "sessionsValidFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passwordChangedAt" DATETIME,
    "prefs" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PatientAccount_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'ACTIVATION',
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "revokedAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PatientRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "requestNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "field" TEXT,
    "currentValue" TEXT,
    "requestedValue" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "reviewNote" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PortalSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowBooking" BOOLEAN NOT NULL DEFAULT true,
    "allowCancel" BOOLEAN NOT NULL DEFAULT true,
    "allowReschedule" BOOLEAN NOT NULL DEFAULT true,
    "changeCutoffHours" INTEGER NOT NULL DEFAULT 24,
    "showDiagnoses" BOOLEAN NOT NULL DEFAULT false,
    "editableFields" TEXT NOT NULL DEFAULT '["preferredName","email","alternatePhone","addressLine","city","state","country","pincode","emergencyContactName","emergencyContactRelation","emergencyContactPhone"]',
    "supportNote" TEXT,
    "privacyNotice" TEXT,
    "consentVersion" TEXT NOT NULL DEFAULT 'v1',
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_userId_key" ON "PatientAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_patientId_key" ON "PatientAccount"("patientId");

-- CreateIndex
CREATE INDEX "PatientAccount_tenantId_status_idx" ON "PatientAccount"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_tenantId_loginEmail_key" ON "PatientAccount"("tenantId", "loginEmail");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccount_tenantId_loginPhone_key" ON "PatientAccount"("tenantId", "loginPhone");

-- CreateIndex
CREATE UNIQUE INDEX "PatientInvite_codeHash_key" ON "PatientInvite"("codeHash");

-- CreateIndex
CREATE INDEX "PatientInvite_tenantId_patientId_createdAt_idx" ON "PatientInvite"("tenantId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientRequest_tenantId_status_createdAt_idx" ON "PatientRequest"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PatientRequest_tenantId_patientId_createdAt_idx" ON "PatientRequest"("tenantId", "patientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientRequest_tenantId_requestNumber_key" ON "PatientRequest"("tenantId", "requestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PortalSettings_tenantId_key" ON "PortalSettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

