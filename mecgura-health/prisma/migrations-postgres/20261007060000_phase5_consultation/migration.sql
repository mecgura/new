-- CreateTable
CREATE TABLE "Consultation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "opdVisitId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "rev" INTEGER NOT NULL DEFAULT 0,
    "chiefComplaints" TEXT NOT NULL DEFAULT '[]',
    "symptoms" TEXT NOT NULL DEFAULT '[]',
    "history" TEXT NOT NULL DEFAULT '{}',
    "examination" TEXT NOT NULL DEFAULT '{}',
    "assessment" TEXT,
    "impression" TEXT,
    "differential" TEXT,
    "assessmentNotes" TEXT,
    "clinicalNotes" TEXT,
    "advice" TEXT,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpAfterDays" INTEGER,
    "followUpDate" TEXT,
    "followUpNotes" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "amendReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationVitals" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "pulse" INTEGER,
    "temperature" DOUBLE PRECISION,
    "tempUnit" TEXT NOT NULL DEFAULT 'F',
    "spo2" INTEGER,
    "respRate" INTEGER,
    "weightKg" DOUBLE PRECISION,
    "heightCm" DOUBLE PRECISION,
    "bmi" DOUBLE PRECISION,
    "bloodSugar" DOUBLE PRECISION,
    "sugarType" TEXT,
    "painScore" INTEGER,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationVitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationDiagnosis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "codeSystem" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SECONDARY',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "amendReason" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT,
    "brandName" TEXT,
    "strength" TEXT,
    "dose" TEXT,
    "route" TEXT,
    "frequency" TEXT,
    "morning" BOOLEAN NOT NULL DEFAULT false,
    "afternoon" BOOLEAN NOT NULL DEFAULT false,
    "evening" BOOLEAN NOT NULL DEFAULT false,
    "night" BOOLEAN NOT NULL DEFAULT false,
    "foodTiming" TEXT,
    "durationDays" INTEGER,
    "quantity" DOUBLE PRECISION,
    "quantityUnit" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "instructions" TEXT,
    "medicineRefId" TEXT,

    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "DoctorOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicineReference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT,
    "brandName" TEXT,
    "strength" TEXT,
    "form" TEXT,
    "source" TEXT NOT NULL DEFAULT 'CLINIC_IMPORT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicineReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_opdVisitId_key" ON "Consultation"("opdVisitId");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_appointmentId_key" ON "Consultation"("appointmentId");

-- CreateIndex
CREATE INDEX "Consultation_tenantId_patientId_startedAt_idx" ON "Consultation"("tenantId", "patientId", "startedAt");

-- CreateIndex
CREATE INDEX "Consultation_tenantId_doctorUserId_status_idx" ON "Consultation"("tenantId", "doctorUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_tenantId_number_key" ON "Consultation"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationVersion_consultationId_version_key" ON "ConsultationVersion"("consultationId", "version");

-- CreateIndex
CREATE INDEX "ConsultationVitals_tenantId_consultationId_idx" ON "ConsultationVitals"("tenantId", "consultationId");

-- CreateIndex
CREATE INDEX "ConsultationVitals_tenantId_patientId_recordedAt_idx" ON "ConsultationVitals"("tenantId", "patientId", "recordedAt");

-- CreateIndex
CREATE INDEX "ConsultationDiagnosis_tenantId_consultationId_idx" ON "ConsultationDiagnosis"("tenantId", "consultationId");

-- CreateIndex
CREATE INDEX "ConsultationDiagnosis_tenantId_patientId_idx" ON "ConsultationDiagnosis"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_consultationId_key" ON "Prescription"("consultationId");

-- CreateIndex
CREATE INDEX "Prescription_tenantId_patientId_idx" ON "Prescription"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_tenantId_number_key" ON "Prescription"("tenantId", "number");

-- CreateIndex
CREATE INDEX "PrescriptionItem_prescriptionId_position_idx" ON "PrescriptionItem"("prescriptionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionVersion_prescriptionId_version_key" ON "PrescriptionVersion"("prescriptionId", "version");

-- CreateIndex
CREATE INDEX "DoctorOrder_tenantId_status_createdAt_idx" ON "DoctorOrder"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DoctorOrder_tenantId_consultationId_idx" ON "DoctorOrder"("tenantId", "consultationId");

-- CreateIndex
CREATE INDEX "DoctorOrder_tenantId_assignedToId_status_idx" ON "DoctorOrder"("tenantId", "assignedToId", "status");

-- CreateIndex
CREATE INDEX "ConsultationTemplate_tenantId_doctorUserId_idx" ON "ConsultationTemplate"("tenantId", "doctorUserId");

-- CreateIndex
CREATE INDEX "MedicineReference_tenantId_name_idx" ON "MedicineReference"("tenantId", "name");

-- CreateIndex
CREATE INDEX "MedicineReference_tenantId_genericName_idx" ON "MedicineReference"("tenantId", "genericName");

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_opdVisitId_fkey" FOREIGN KEY ("opdVisitId") REFERENCES "OpdVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationVersion" ADD CONSTRAINT "ConsultationVersion_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationVitals" ADD CONSTRAINT "ConsultationVitals_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationDiagnosis" ADD CONSTRAINT "ConsultationDiagnosis_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionItem" ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionVersion" ADD CONSTRAINT "PrescriptionVersion_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorOrder" ADD CONSTRAINT "DoctorOrder_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

