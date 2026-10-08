-- CreateTable
CREATE TABLE "AnalyticsSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "thresholds" TEXT NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "filters" TEXT NOT NULL DEFAULT '{}',
    "frequency" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'CSV',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSettings_tenantId_key" ON "AnalyticsSettings"("tenantId");

-- CreateIndex
CREATE INDEX "ScheduledReport_tenantId_enabled_idx" ON "ScheduledReport"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "Consultation_tenantId_startedAt_idx" ON "Consultation"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "InvestigationOrder_tenantId_orderedAt_idx" ON "InvestigationOrder"("tenantId", "orderedAt");

-- CreateIndex
CREATE INDEX "CommunicationMessage_tenantId_createdAt_idx" ON "CommunicationMessage"("tenantId", "createdAt");

