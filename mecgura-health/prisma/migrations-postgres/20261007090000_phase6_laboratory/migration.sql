-- CreateTable
CREATE TABLE "LabConfigItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabConfigItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "testCode" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "shortName" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "sampleType" TEXT,
    "department" TEXT,
    "preparation" TEXT,
    "turnaroundHours" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationParameter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "resultType" TEXT NOT NULL DEFAULT 'NUMERIC',
    "unit" TEXT,
    "options" TEXT,
    "ranges" TEXT,

    CONSTRAINT "InvestigationParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabPartner" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contact" TEXT,
    "address" TEXT,
    "integrationType" TEXT NOT NULL DEFAULT 'MANUAL',
    "configRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consultationId" TEXT,
    "doctorUserId" TEXT NOT NULL,
    "doctorOrderId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'INTERNAL',
    "labPartnerId" TEXT,
    "externalRef" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "priorityRank" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "clinicalNotes" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestigationOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestigationOrderItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "investigationOrderId" TEXT NOT NULL,
    "investigationId" TEXT,
    "testNameSnapshot" TEXT NOT NULL,
    "sampleTypeSnapshot" TEXT,
    "snapshot" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "resultStatus" TEXT NOT NULL DEFAULT 'NONE',
    "notes" TEXT,
    "sampleId" TEXT,

    CONSTRAINT "InvestigationOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sampleNumber" TEXT NOT NULL,
    "barcodeToken" TEXT NOT NULL,
    "investigationOrderId" TEXT NOT NULL,
    "sampleType" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "previousSampleId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COLLECTED',
    "collectedById" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SampleEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "department" TEXT,
    "notes" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SampleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabResultEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "parameterName" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "numericValue" DOUBLE PRECISION,
    "unit" TEXT,
    "refText" TEXT,
    "flag" TEXT,
    "remarks" TEXT,
    "enteredById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabResultEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "investigationOrderId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNDER_REVIEW',
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "amendReason" TEXT,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabReportVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabReportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabReportReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabReportReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabConfigItem_tenantId_kind_idx" ON "LabConfigItem"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "LabConfigItem_tenantId_kind_name_key" ON "LabConfigItem"("tenantId", "kind", "name");

-- CreateIndex
CREATE INDEX "Investigation_tenantId_active_category_idx" ON "Investigation"("tenantId", "active", "category");

-- CreateIndex
CREATE INDEX "Investigation_tenantId_testName_idx" ON "Investigation"("tenantId", "testName");

-- CreateIndex
CREATE UNIQUE INDEX "Investigation_tenantId_testCode_key" ON "Investigation"("tenantId", "testCode");

-- CreateIndex
CREATE INDEX "InvestigationParameter_investigationId_position_idx" ON "InvestigationParameter"("investigationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "LabPartner_tenantId_code_key" ON "LabPartner"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "InvestigationOrder_doctorOrderId_key" ON "InvestigationOrder"("doctorOrderId");

-- CreateIndex
CREATE INDEX "InvestigationOrder_tenantId_status_priorityRank_orderedAt_idx" ON "InvestigationOrder"("tenantId", "status", "priorityRank", "orderedAt");

-- CreateIndex
CREATE INDEX "InvestigationOrder_tenantId_patientId_idx" ON "InvestigationOrder"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "InvestigationOrder_tenantId_doctorUserId_idx" ON "InvestigationOrder"("tenantId", "doctorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestigationOrder_tenantId_orderNumber_key" ON "InvestigationOrder"("tenantId", "orderNumber");

-- CreateIndex
CREATE INDEX "InvestigationOrderItem_tenantId_investigationOrderId_idx" ON "InvestigationOrderItem"("tenantId", "investigationOrderId");

-- CreateIndex
CREATE INDEX "InvestigationOrderItem_sampleId_idx" ON "InvestigationOrderItem"("sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_barcodeToken_key" ON "Sample"("barcodeToken");

-- CreateIndex
CREATE INDEX "Sample_tenantId_status_idx" ON "Sample"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Sample_investigationOrderId_idx" ON "Sample"("investigationOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_tenantId_sampleNumber_key" ON "Sample"("tenantId", "sampleNumber");

-- CreateIndex
CREATE INDEX "SampleEvent_sampleId_at_idx" ON "SampleEvent"("sampleId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "LabResultEntry_orderItemId_position_key" ON "LabResultEntry"("orderItemId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "LabReport_investigationOrderId_key" ON "LabReport"("investigationOrderId");

-- CreateIndex
CREATE INDEX "LabReport_tenantId_patientId_idx" ON "LabReport"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "LabReport_tenantId_status_idx" ON "LabReport"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LabReport_tenantId_reportNumber_key" ON "LabReport"("tenantId", "reportNumber");

-- CreateIndex
CREATE UNIQUE INDEX "LabReportVersion_reportId_version_key" ON "LabReportVersion"("reportId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LabReportReview_reportId_version_doctorUserId_key" ON "LabReportReview"("reportId", "version", "doctorUserId");

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_readAt_createdAt_idx" ON "Notification"("tenantId", "userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "InvestigationParameter" ADD CONSTRAINT "InvestigationParameter_investigationId_fkey" FOREIGN KEY ("investigationId") REFERENCES "Investigation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationOrder" ADD CONSTRAINT "InvestigationOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationOrder" ADD CONSTRAINT "InvestigationOrder_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestigationOrderItem" ADD CONSTRAINT "InvestigationOrderItem_investigationOrderId_fkey" FOREIGN KEY ("investigationOrderId") REFERENCES "InvestigationOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_investigationOrderId_fkey" FOREIGN KEY ("investigationOrderId") REFERENCES "InvestigationOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SampleEvent" ADD CONSTRAINT "SampleEvent_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResultEntry" ADD CONSTRAINT "LabResultEntry_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "InvestigationOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReport" ADD CONSTRAINT "LabReport_investigationOrderId_fkey" FOREIGN KEY ("investigationOrderId") REFERENCES "InvestigationOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReportVersion" ADD CONSTRAINT "LabReportVersion_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "LabReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabReportReview" ADD CONSTRAINT "LabReportReview_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "LabReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

