-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "ageYears" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantCounter" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TenantCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorSchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "slotMinutes" INTEGER NOT NULL DEFAULT 15,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "maxPerDay" INTEGER,
    "onlineBooking" BOOLEAN NOT NULL DEFAULT false,
    "advanceDays" INTEGER NOT NULL DEFAULT 30,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 60,
    "roomLabel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityWindow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,

    CONSTRAINT "AvailabilityWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockedTime" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctorUserId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedTime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "patientId" TEXT,
    "serviceId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'OPD',
    "source" TEXT NOT NULL DEFAULT 'RECEPTION',
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "slotLock" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "contactDob" TEXT,
    "contactGender" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "calledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "noShowAt" TIMESTAMP(3),
    "noShowById" TEXT,
    "noShowReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpdVisit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "visitType" TEXT NOT NULL DEFAULT 'WALK_IN',
    "queueType" TEXT NOT NULL DEFAULT 'GENERAL',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "tokenDate" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL DEFAULT '',
    "tokenNumber" INTEGER NOT NULL,
    "tokenLabel" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "queueSeq" INTEGER NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "calledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "heldAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "priorityChangedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpdVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpdSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenFormat" TEXT NOT NULL DEFAULT 'NUMERIC',
    "tokenPad" INTEGER NOT NULL DEFAULT 2,
    "prefixes" TEXT NOT NULL DEFAULT '{}',
    "voiceAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "showNextOnDisplay" BOOLEAN NOT NULL DEFAULT true,
    "onlineTokens" BOOLEAN NOT NULL DEFAULT false,
    "bookingMode" TEXT NOT NULL DEFAULT 'AUTO_CONFIRM',
    "displayKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpdSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Patient_tenantId_phone_idx" ON "Patient"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "Patient_tenantId_name_idx" ON "Patient"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_tenantId_code_key" ON "Patient"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TenantCounter_tenantId_key_key" ON "TenantCounter"("tenantId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorSchedule_doctorUserId_key" ON "DoctorSchedule"("doctorUserId");

-- CreateIndex
CREATE INDEX "DoctorSchedule_tenantId_idx" ON "DoctorSchedule"("tenantId");

-- CreateIndex
CREATE INDEX "AvailabilityWindow_tenantId_doctorUserId_weekday_idx" ON "AvailabilityWindow"("tenantId", "doctorUserId", "weekday");

-- CreateIndex
CREATE INDEX "BlockedTime_tenantId_startsAt_idx" ON "BlockedTime"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "BlockedTime_tenantId_doctorUserId_startsAt_idx" ON "BlockedTime"("tenantId", "doctorUserId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_slotLock_key" ON "Appointment"("slotLock");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_startsAt_idx" ON "Appointment"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_doctorUserId_startsAt_idx" ON "Appointment"("tenantId", "doctorUserId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_status_startsAt_idx" ON "Appointment"("tenantId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_tenantId_publicId_key" ON "Appointment"("tenantId", "publicId");

-- CreateIndex
CREATE UNIQUE INDEX "OpdVisit_appointmentId_key" ON "OpdVisit"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "OpdVisit_publicToken_key" ON "OpdVisit"("publicToken");

-- CreateIndex
CREATE INDEX "OpdVisit_tenantId_tokenDate_doctorUserId_status_idx" ON "OpdVisit"("tenantId", "tokenDate", "doctorUserId", "status");

-- CreateIndex
CREATE INDEX "OpdVisit_tenantId_tokenDate_status_idx" ON "OpdVisit"("tenantId", "tokenDate", "status");

-- CreateIndex
CREATE INDEX "OpdVisit_patientId_idx" ON "OpdVisit"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "OpdVisit_tenantId_tokenDate_tokenPrefix_tokenNumber_key" ON "OpdVisit"("tenantId", "tokenDate", "tokenPrefix", "tokenNumber");

-- CreateIndex
CREATE UNIQUE INDEX "OpdSettings_tenantId_key" ON "OpdSettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OpdSettings_displayKey_key" ON "OpdSettings"("displayKey");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantCounter" ADD CONSTRAINT "TenantCounter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorSchedule" ADD CONSTRAINT "DoctorSchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorSchedule" ADD CONSTRAINT "DoctorSchedule_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityWindow" ADD CONSTRAINT "AvailabilityWindow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedTime" ADD CONSTRAINT "BlockedTime_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpdVisit" ADD CONSTRAINT "OpdVisit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpdVisit" ADD CONSTRAINT "OpdVisit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpdVisit" ADD CONSTRAINT "OpdVisit_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpdVisit" ADD CONSTRAINT "OpdVisit_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpdSettings" ADD CONSTRAINT "OpdSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

