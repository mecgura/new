-- CreateTable
CREATE TABLE "PharmacySettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "nearExpiryDays" INTEGER NOT NULL DEFAULT 90,
    "allowOverDispense" BOOLEAN NOT NULL DEFAULT false,
    "allowPatientReturns" BOOLEAN NOT NULL DEFAULT false,
    "returnWindowDays" INTEGER NOT NULL DEFAULT 7,
    "billFooter" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PharmacyConfigItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Medicine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "medicineCode" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "brandName" TEXT,
    "strength" TEXT,
    "dosageForm" TEXT,
    "route" TEXT,
    "manufacturer" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "packSize" INTEGER,
    "barcode" TEXT,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "maximumStock" INTEGER,
    "purchasePriceMinor" INTEGER NOT NULL DEFAULT 0,
    "sellingPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "prescriptionRequired" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "supplierCode" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxId" TEXT,
    "paymentTerms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseNumber" TEXT NOT NULL,
    "supplierInvoiceNumber" TEXT,
    "purchaseDate" TEXT NOT NULL,
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "receivedAt" DATETIME,
    "receivedById" TEXT,
    "completedAt" DATETIME,
    "completedById" TEXT,
    "cancelledAt" DATETIME,
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Purchase_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TEXT NOT NULL,
    "manufacturingDate" TEXT,
    "quantity" INTEGER NOT NULL,
    "freeQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitPurchasePriceMinor" INTEGER NOT NULL,
    "sellingPriceMinor" INTEGER NOT NULL,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "lineTotalMinor" INTEGER NOT NULL,
    "batchId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseItem_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MedicineBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TEXT NOT NULL,
    "manufacturingDate" TEXT,
    "purchasePriceMinor" INTEGER NOT NULL DEFAULT 0,
    "sellingPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "quantityReceived" INTEGER NOT NULL DEFAULT 0,
    "quantityAvailable" INTEGER NOT NULL DEFAULT 0,
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "dispensedQuantity" INTEGER NOT NULL DEFAULT 0,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
    "expiredQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "blockedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MedicineBatch_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockTransaction_medicineId_fkey" FOREIGN KEY ("medicineId") REFERENCES "Medicine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StockTransaction_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "MedicineBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dispensing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "prescriptionVersion" INTEGER NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "dispensingNumber" TEXT NOT NULL,
    "dispensedById" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "dispensedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "cancelledAt" DATETIME,
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    CONSTRAINT "Dispensing_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Dispensing_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DispensingItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "dispensingId" TEXT NOT NULL,
    "prescriptionItemId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "medicineNameSnapshot" TEXT NOT NULL,
    "batchNumberSnapshot" TEXT NOT NULL,
    "expirySnapshot" TEXT NOT NULL,
    "prescribedQuantity" INTEGER NOT NULL,
    "dispensedQuantity" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "taxName" TEXT,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL,
    "returnedQuantity" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DISPENSED',
    "batchOverrideReason" TEXT,
    "notes" TEXT,
    CONSTRAINT "DispensingItem_dispensingId_fkey" FOREIGN KEY ("dispensingId") REFERENCES "Dispensing" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MedicineReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "condition" TEXT,
    "patientId" TEXT,
    "dispensingItemId" TEXT,
    "supplierId" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "receivedById" TEXT,
    "resolvedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "countNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "appliedById" TEXT,
    "appliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "medicineId" TEXT NOT NULL,
    "systemQuantity" INTEGER NOT NULL,
    "physicalQuantity" INTEGER,
    "difference" INTEGER,
    "reason" TEXT,
    CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PharmacySettings_tenantId_key" ON "PharmacySettings"("tenantId");

-- CreateIndex
CREATE INDEX "PharmacyConfigItem_tenantId_kind_idx" ON "PharmacyConfigItem"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PharmacyConfigItem_tenantId_kind_name_key" ON "PharmacyConfigItem"("tenantId", "kind", "name");

-- CreateIndex
CREATE INDEX "Medicine_tenantId_genericName_idx" ON "Medicine"("tenantId", "genericName");

-- CreateIndex
CREATE INDEX "Medicine_tenantId_brandName_idx" ON "Medicine"("tenantId", "brandName");

-- CreateIndex
CREATE INDEX "Medicine_tenantId_barcode_idx" ON "Medicine"("tenantId", "barcode");

-- CreateIndex
CREATE INDEX "Medicine_tenantId_category_idx" ON "Medicine"("tenantId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Medicine_tenantId_medicineCode_key" ON "Medicine"("tenantId", "medicineCode");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_supplierName_idx" ON "Supplier"("tenantId", "supplierName");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_tenantId_supplierCode_key" ON "Supplier"("tenantId", "supplierCode");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_status_purchaseDate_idx" ON "Purchase"("tenantId", "status", "purchaseDate");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_supplierId_idx" ON "Purchase"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_tenantId_purchaseNumber_key" ON "Purchase"("tenantId", "purchaseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_tenantId_supplierId_supplierInvoiceNumber_key" ON "Purchase"("tenantId", "supplierId", "supplierInvoiceNumber");

-- CreateIndex
CREATE INDEX "PurchaseItem_tenantId_purchaseId_idx" ON "PurchaseItem"("tenantId", "purchaseId");

-- CreateIndex
CREATE INDEX "PurchaseItem_tenantId_medicineId_idx" ON "PurchaseItem"("tenantId", "medicineId");

-- CreateIndex
CREATE INDEX "MedicineBatch_tenantId_medicineId_expiryDate_idx" ON "MedicineBatch"("tenantId", "medicineId", "expiryDate");

-- CreateIndex
CREATE INDEX "MedicineBatch_tenantId_expiryDate_idx" ON "MedicineBatch"("tenantId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineBatch_tenantId_medicineId_batchNumber_key" ON "MedicineBatch"("tenantId", "medicineId", "batchNumber");

-- CreateIndex
CREATE INDEX "StockTransaction_tenantId_createdAt_idx" ON "StockTransaction"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransaction_tenantId_medicineId_createdAt_idx" ON "StockTransaction"("tenantId", "medicineId", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransaction_tenantId_batchId_createdAt_idx" ON "StockTransaction"("tenantId", "batchId", "createdAt");

-- CreateIndex
CREATE INDEX "StockTransaction_tenantId_referenceType_referenceId_idx" ON "StockTransaction"("tenantId", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "Dispensing_tenantId_patientId_dispensedAt_idx" ON "Dispensing"("tenantId", "patientId", "dispensedAt");

-- CreateIndex
CREATE INDEX "Dispensing_tenantId_prescriptionId_idx" ON "Dispensing"("tenantId", "prescriptionId");

-- CreateIndex
CREATE INDEX "Dispensing_tenantId_dispensedAt_idx" ON "Dispensing"("tenantId", "dispensedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dispensing_tenantId_dispensingNumber_key" ON "Dispensing"("tenantId", "dispensingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Dispensing_tenantId_idempotencyKey_key" ON "Dispensing"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DispensingItem_tenantId_dispensingId_idx" ON "DispensingItem"("tenantId", "dispensingId");

-- CreateIndex
CREATE INDEX "DispensingItem_tenantId_prescriptionItemId_idx" ON "DispensingItem"("tenantId", "prescriptionItemId");

-- CreateIndex
CREATE INDEX "DispensingItem_tenantId_medicineId_idx" ON "DispensingItem"("tenantId", "medicineId");

-- CreateIndex
CREATE INDEX "DispensingItem_tenantId_batchId_idx" ON "DispensingItem"("tenantId", "batchId");

-- CreateIndex
CREATE INDEX "MedicineReturn_tenantId_status_createdAt_idx" ON "MedicineReturn"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MedicineReturn_tenantId_dispensingItemId_idx" ON "MedicineReturn"("tenantId", "dispensingItemId");

-- CreateIndex
CREATE INDEX "MedicineReturn_tenantId_batchId_idx" ON "MedicineReturn"("tenantId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicineReturn_tenantId_returnNumber_key" ON "MedicineReturn"("tenantId", "returnNumber");

-- CreateIndex
CREATE INDEX "StockCount_tenantId_status_idx" ON "StockCount"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenantId_countNumber_key" ON "StockCount"("tenantId", "countNumber");

-- CreateIndex
CREATE INDEX "StockCountLine_tenantId_countId_idx" ON "StockCountLine"("tenantId", "countId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_batchId_key" ON "StockCountLine"("countId", "batchId");
