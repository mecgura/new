-- CreateTable
CREATE TABLE "FamilyGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PatientAllergy" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "allergen" TEXT NOT NULL,
    "reaction" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "recordedById" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientAllergy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientMedication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strength" TEXT,
    "frequency" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'PATIENT_REPORTED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "recordedById" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientMedication_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "occurredOn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "notes" TEXT,
    "recordedById" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientHistory_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientFamilyHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "notes" TEXT,
    "recordedById" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PatientFamilyHistory_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'GENERAL',
    "content" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PatientConsent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientConsent_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Patient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "preferredName" TEXT,
    "phone" TEXT,
    "alternatePhone" TEXT,
    "email" TEXT,
    "gender" TEXT,
    "dateOfBirth" DATETIME,
    "ageYears" INTEGER,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "pincode" TEXT,
    "bloodGroup" TEXT,
    "maritalStatus" TEXT,
    "occupation" TEXT,
    "emergencyContactName" TEXT,
    "emergencyContactRelation" TEXT,
    "emergencyContactPhone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" DATETIME,
    "archivedReason" TEXT,
    "prefPhone" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "prefWhatsapp" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "prefSms" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "prefEmail" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "familyGroupId" TEXT,
    "familyRelation" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Patient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Patient_familyGroupId_fkey" FOREIGN KEY ("familyGroupId") REFERENCES "FamilyGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Patient" ("ageYears", "code", "createdAt", "createdById", "dateOfBirth", "deletedAt", "email", "gender", "id", "name", "phone", "tenantId", "updatedAt") SELECT "ageYears", "code", "createdAt", "createdById", "dateOfBirth", "deletedAt", "email", "gender", "id", "name", "phone", "tenantId", "updatedAt" FROM "Patient";
DROP TABLE "Patient";
ALTER TABLE "new_Patient" RENAME TO "Patient";
CREATE INDEX "Patient_tenantId_phone_idx" ON "Patient"("tenantId", "phone");
CREATE INDEX "Patient_tenantId_name_idx" ON "Patient"("tenantId", "name");
CREATE INDEX "Patient_tenantId_status_createdAt_idx" ON "Patient"("tenantId", "status", "createdAt");
CREATE INDEX "Patient_familyGroupId_idx" ON "Patient"("familyGroupId");
CREATE UNIQUE INDEX "Patient_tenantId_code_key" ON "Patient"("tenantId", "code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "FamilyGroup_tenantId_idx" ON "FamilyGroup"("tenantId");

-- CreateIndex
CREATE INDEX "PatientAllergy_tenantId_patientId_idx" ON "PatientAllergy"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "PatientMedication_tenantId_patientId_idx" ON "PatientMedication"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "PatientHistory_tenantId_patientId_idx" ON "PatientHistory"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "PatientFamilyHistory_tenantId_patientId_idx" ON "PatientFamilyHistory"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "PatientNote_tenantId_patientId_createdAt_idx" ON "PatientNote"("tenantId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PatientConsent_tenantId_patientId_type_recordedAt_idx" ON "PatientConsent"("tenantId", "patientId", "type", "recordedAt");
