-- CreateTable
CREATE TABLE "BillingSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "receiptPrefix" TEXT NOT NULL DEFAULT 'REC',
    "paymentPrefix" TEXT NOT NULL DEFAULT 'PAY',
    "refundPrefix" TEXT NOT NULL DEFAULT 'REF',
    "taxMode" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
    "paymentMethods" TEXT,
    "discountRules" TEXT,
    "invoiceFooter" TEXT,
    "receiptFooter" TEXT,
    "paymentTerms" TEXT,
    "dueDays" INTEGER,
    "defaultConsultationServiceId" TEXT,
    "defaultFollowUpServiceId" TEXT,
    "autoBillConsultation" BOOLEAN NOT NULL DEFAULT false,
    "autoBillInvestigation" BOOLEAN NOT NULL DEFAULT false,
    "autoBillFollowUp" BOOLEAN NOT NULL DEFAULT false,
    "allowOverpayment" BOOLEAN NOT NULL DEFAULT false,
    "refundSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "useCashierSessions" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BillingTax" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BillingService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'OTHER',
    "category" TEXT,
    "priceMinor" INTEGER NOT NULL,
    "taxId" TEXT,
    "discountEligible" BOOLEAN NOT NULL DEFAULT true,
    "investigationId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "opdVisitId" TEXT,
    "consultationId" TEXT,
    "investigationOrderId" TEXT,
    "followUpId" TEXT,
    "doctorUserId" TEXT,
    "sourceKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "taxMode" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
    "invoiceDate" TEXT NOT NULL,
    "dueDate" TEXT,
    "discountType" TEXT,
    "discountValue" INTEGER,
    "discountReason" TEXT,
    "discountById" TEXT,
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "collectedMinor" INTEGER NOT NULL DEFAULT 0,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "dueMinor" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "footerSnapshot" TEXT,
    "termsSnapshot" TEXT,
    "issuedAt" DATETIME,
    "issuedById" TEXT,
    "createdById" TEXT NOT NULL,
    "cancelledAt" DATETIME,
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "serviceId" TEXT,
    "serviceCodeSnapshot" TEXT,
    "descriptionSnapshot" TEXT NOT NULL,
    "serviceTypeSnapshot" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "discountType" TEXT,
    "discountValue" INTEGER,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "invoiceDiscountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxName" TEXT,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "lineSubtotalMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "receiptNumber" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "transactionReference" TEXT,
    "idempotencyKey" TEXT,
    "paymentDate" TEXT NOT NULL,
    "notes" TEXT,
    "receivedById" TEXT NOT NULL,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "gatewayProvider" TEXT,
    "gatewayOrderId" TEXT,
    "gatewayTransactionId" TEXT,
    "cancelledAt" DATETIME,
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "refundNumber" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "processedById" TEXT,
    "processedAt" DATETIME,
    "rejectedById" TEXT,
    "rejectedAt" DATETIME,
    "rejectReason" TEXT,
    "reference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "amountMinor" INTEGER,
    "ref" TEXT,
    "note" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashierSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingMinor" INTEGER NOT NULL,
    "closedById" TEXT,
    "closedAt" DATETIME,
    "closingMinor" INTEGER,
    "expectedMinor" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingSettings_tenantId_key" ON "BillingSettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingTax_tenantId_name_key" ON "BillingTax"("tenantId", "name");

-- CreateIndex
CREATE INDEX "BillingService_tenantId_type_active_idx" ON "BillingService"("tenantId", "type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "BillingService_tenantId_serviceCode_key" ON "BillingService"("tenantId", "serviceCode");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_invoiceDate_idx" ON "Invoice"("tenantId", "status", "invoiceDate");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_patientId_idx" ON "Invoice"("tenantId", "patientId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_consultationId_idx" ON "Invoice"("tenantId", "consultationId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_appointmentId_idx" ON "Invoice"("tenantId", "appointmentId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_dueDate_idx" ON "Invoice"("tenantId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_invoiceNumber_key" ON "Invoice"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_sourceKey_key" ON "Invoice"("tenantId", "sourceKey");

-- CreateIndex
CREATE INDEX "InvoiceItem_tenantId_invoiceId_idx" ON "InvoiceItem"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceItem_tenantId_serviceId_idx" ON "InvoiceItem"("tenantId", "serviceId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_paymentDate_idx" ON "Payment"("tenantId", "paymentDate");

-- CreateIndex
CREATE INDEX "Payment_tenantId_invoiceId_idx" ON "Payment"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_patientId_idx" ON "Payment"("tenantId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_paymentNumber_key" ON "Payment"("tenantId", "paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_receiptNumber_key" ON "Payment"("tenantId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_idempotencyKey_key" ON "Payment"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_method_transactionReference_key" ON "Payment"("tenantId", "method", "transactionReference");

-- CreateIndex
CREATE INDEX "Refund_tenantId_status_idx" ON "Refund"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Refund_tenantId_invoiceId_idx" ON "Refund"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_tenantId_refundNumber_key" ON "Refund"("tenantId", "refundNumber");

-- CreateIndex
CREATE INDEX "InvoiceEvent_tenantId_invoiceId_at_idx" ON "InvoiceEvent"("tenantId", "invoiceId", "at");

-- CreateIndex
CREATE INDEX "InvoiceEvent_tenantId_patientId_at_idx" ON "InvoiceEvent"("tenantId", "patientId", "at");

-- CreateIndex
CREATE INDEX "CashierSession_tenantId_status_idx" ON "CashierSession"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CashierSession_tenantId_openedById_status_idx" ON "CashierSession"("tenantId", "openedById", "status");
