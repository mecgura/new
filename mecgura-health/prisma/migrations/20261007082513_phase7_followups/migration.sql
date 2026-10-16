-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "followUpNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorUserId" TEXT,
    "consultationId" TEXT,
    "prescriptionId" TEXT,
    "investigationOrderId" TEXT,
    "labReportId" TEXT,
    "doctorOrderId" TEXT,
    "recallId" TEXT,
    "sourceAppointmentId" TEXT,
    "appointmentId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "doctorNotes" TEXT,
    "notes" TEXT,
    "dueDate" TEXT NOT NULL,
    "preferredDate" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "assignedById" TEXT,
    "assignedAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "dedupeKey" TEXT,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT,
    "outcomeNotes" TEXT,
    "completedAt" DATETIME,
    "completedById" TEXT,
    "cancelledAt" DATETIME,
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FollowUp_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUpContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "contactedById" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "notes" TEXT,
    "contactedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAction" TEXT,
    "nextActionDate" TEXT,
    CONSTRAINT "FollowUpContact_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUpEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUpEvent_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorUserId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'ROUTINE_RECALL',
    "title" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'ONE_TIME',
    "customMonths" INTEGER,
    "maxOccurrences" INTEGER NOT NULL DEFAULT 1,
    "occurrence" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "followUpId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Recall_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FollowUpSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "createOnNoShow" BOOLEAN NOT NULL DEFAULT true,
    "createOnCancellation" BOOLEAN NOT NULL DEFAULT false,
    "recallCreatesFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "completeWhenVisitDone" BOOLEAN NOT NULL DEFAULT false,
    "contactOutcomes" TEXT,
    "completionOutcomes" TEXT,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "FollowUp_tenantId_status_dueDate_idx" ON "FollowUp"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "FollowUp_tenantId_assignedToId_status_idx" ON "FollowUp"("tenantId", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "FollowUp_tenantId_doctorUserId_status_idx" ON "FollowUp"("tenantId", "doctorUserId", "status");

-- CreateIndex
CREATE INDEX "FollowUp_tenantId_patientId_idx" ON "FollowUp"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "FollowUp_tenantId_appointmentId_idx" ON "FollowUp"("tenantId", "appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_tenantId_followUpNumber_key" ON "FollowUp"("tenantId", "followUpNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_tenantId_dedupeKey_key" ON "FollowUp"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "FollowUpContact_tenantId_followUpId_contactedAt_idx" ON "FollowUpContact"("tenantId", "followUpId", "contactedAt");

-- CreateIndex
CREATE INDEX "FollowUpEvent_tenantId_followUpId_at_idx" ON "FollowUpEvent"("tenantId", "followUpId", "at");

-- CreateIndex
CREATE INDEX "FollowUpEvent_tenantId_patientId_at_idx" ON "FollowUpEvent"("tenantId", "patientId", "at");

-- CreateIndex
CREATE INDEX "Recall_tenantId_status_dueDate_idx" ON "Recall"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Recall_tenantId_patientId_idx" ON "Recall"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpSettings_tenantId_key" ON "FollowUpSettings"("tenantId");
