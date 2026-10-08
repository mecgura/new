-- CreateTable
CREATE TABLE "SubscriptionBillingProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "billingName" TEXT,
    "billingEmail" TEXT NOT NULL,
    "billingPhone" TEXT,
    "contactName" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "stateCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "pincode" TEXT,
    "gstin" TEXT,
    "taxId" TEXT,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SaasInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RENEWAL',
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "discountMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMode" TEXT NOT NULL DEFAULT 'EXCLUSIVE',
    "taxSnapshot" TEXT NOT NULL DEFAULT '{}',
    "vendorSnapshot" TEXT NOT NULL DEFAULT '{}',
    "billToSnapshot" TEXT NOT NULL DEFAULT '{}',
    "planName" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "changeJson" TEXT,
    "issuedAt" DATETIME,
    "dueAt" DATETIME,
    "paidAt" DATETIME,
    "voidedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SaasInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SaasInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaasInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaasPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "method" TEXT NOT NULL DEFAULT 'ONLINE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "providerOrderId" TEXT,
    "transactionReference" TEXT,
    "receiptNumber" TEXT,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "idempotencyKey" TEXT NOT NULL,
    "paidAt" DATETIME,
    "recordedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SaasRefund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "refundNumber" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "providerRefundId" TEXT,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SubscriptionWebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SubscriptionUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "limitKey" TEXT NOT NULL,
    "periodStart" DATETIME NOT NULL,
    "periodEnd" DATETIME NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "limitValue" INTEGER,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "fromPlanId" TEXT,
    "toPlanId" TEXT,
    "actorId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PlatformCounter" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modules" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiresAttribution" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "monthlyPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "annualPriceMinor" INTEGER NOT NULL DEFAULT 0,
    "setupFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "features" TEXT NOT NULL DEFAULT '{}',
    "limits" TEXT NOT NULL DEFAULT '{}',
    "supportLevel" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" DATETIME
);
INSERT INTO "new_Plan" ("createdAt", "id", "isActive", "key", "modules", "name", "requiresAttribution", "updatedAt") SELECT "createdAt", "id", "isActive", "key", "modules", "name", "requiresAttribution", "updatedAt" FROM "Plan";
DROP TABLE "Plan";
ALTER TABLE "new_Plan" RENAME TO "Plan";
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");
CREATE INDEX "Plan_status_sortOrder_idx" ON "Plan"("status", "sortOrder");
CREATE TABLE "new_Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRIAL',
    "startsAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "managed" BOOLEAN NOT NULL DEFAULT false,
    "billingInterval" TEXT NOT NULL DEFAULT 'MONTHLY',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "planVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" TEXT NOT NULL DEFAULT '{}',
    "trialStart" DATETIME,
    "trialEnd" DATETIME,
    "trialUsed" BOOLEAN NOT NULL DEFAULT false,
    "currentPeriodStart" DATETIME,
    "currentPeriodEnd" DATETIME,
    "nextBillingDate" DATETIME,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "cancellationNotes" TEXT,
    "gracePeriodStart" DATETIME,
    "gracePeriodEnd" DATETIME,
    "pausedAt" DATETIME,
    "suspendedAt" DATETIME,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "scheduledChange" TEXT,
    "failedPaymentCount" INTEGER NOT NULL DEFAULT 0,
    "dunningStage" INTEGER NOT NULL DEFAULT 0,
    "lastPaymentFailedAt" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'SYSTEM',
    "provider" TEXT,
    "externalCustomerId" TEXT,
    "externalSubscriptionId" TEXT,
    CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Subscription" ("createdAt", "endsAt", "id", "planId", "startsAt", "status", "tenantId", "updatedAt") SELECT "createdAt", "endsAt", "id", "planId", "startsAt", "status", "tenantId", "updatedAt" FROM "Subscription";
DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");
CREATE UNIQUE INDEX "Subscription_externalSubscriptionId_key" ON "Subscription"("externalSubscriptionId");
CREATE INDEX "Subscription_planId_idx" ON "Subscription"("planId");
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");
CREATE INDEX "Subscription_nextBillingDate_idx" ON "Subscription"("nextBillingDate");
CREATE INDEX "Subscription_status_trialEnd_idx" ON "Subscription"("status", "trialEnd");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionBillingProfile_tenantId_key" ON "SubscriptionBillingProfile"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SaasInvoice_invoiceNumber_key" ON "SaasInvoice"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SaasInvoice_dedupeKey_key" ON "SaasInvoice"("dedupeKey");

-- CreateIndex
CREATE INDEX "SaasInvoice_tenantId_createdAt_idx" ON "SaasInvoice"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SaasInvoice_tenantId_status_idx" ON "SaasInvoice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SaasInvoice_subscriptionId_periodStart_idx" ON "SaasInvoice"("subscriptionId", "periodStart");

-- CreateIndex
CREATE INDEX "SaasInvoice_status_dueAt_idx" ON "SaasInvoice"("status", "dueAt");

-- CreateIndex
CREATE INDEX "SaasInvoiceItem_invoiceId_idx" ON "SaasInvoiceItem"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "SaasPayment_receiptNumber_key" ON "SaasPayment"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SaasPayment_idempotencyKey_key" ON "SaasPayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SaasPayment_tenantId_createdAt_idx" ON "SaasPayment"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SaasPayment_invoiceId_idx" ON "SaasPayment"("invoiceId");

-- CreateIndex
CREATE INDEX "SaasPayment_subscriptionId_status_idx" ON "SaasPayment"("subscriptionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SaasPayment_provider_providerPaymentId_key" ON "SaasPayment"("provider", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SaasRefund_refundNumber_key" ON "SaasRefund"("refundNumber");

-- CreateIndex
CREATE INDEX "SaasRefund_tenantId_createdAt_idx" ON "SaasRefund"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SaasRefund_paymentId_idx" ON "SaasRefund"("paymentId");

-- CreateIndex
CREATE INDEX "SubscriptionWebhookEvent_receivedAt_idx" ON "SubscriptionWebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionWebhookEvent_provider_eventId_key" ON "SubscriptionWebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "SubscriptionUsage_subscriptionId_periodStart_idx" ON "SubscriptionUsage"("subscriptionId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionUsage_tenantId_limitKey_periodStart_key" ON "SubscriptionUsage"("tenantId", "limitKey", "periodStart");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_tenantId_createdAt_idx" ON "SubscriptionEvent"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_type_createdAt_idx" ON "SubscriptionEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx" ON "SubscriptionEvent"("subscriptionId", "createdAt");

