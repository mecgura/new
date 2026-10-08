-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "annualPriceMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "features" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "limits" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "monthlyPriceMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "setupFeeMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "supportLevel" TEXT,
ADD COLUMN     "trialDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "billingInterval" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cancellationNotes" TEXT,
ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN     "dunningStage" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "externalCustomerId" TEXT,
ADD COLUMN     "externalSubscriptionId" TEXT,
ADD COLUMN     "failedPaymentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "gracePeriodEnd" TIMESTAMP(3),
ADD COLUMN     "gracePeriodStart" TIMESTAMP(3),
ADD COLUMN     "lastPaymentFailedAt" TIMESTAMP(3),
ADD COLUMN     "managed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nextBillingDate" TIMESTAMP(3),
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "planVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "priceMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "scheduledChange" TEXT,
ADD COLUMN     "snapshot" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "trialEnd" TIMESTAMP(3),
ADD COLUMN     "trialStart" TIMESTAMP(3),
ADD COLUMN     "trialUsed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SubscriptionBillingProfile" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionBillingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RENEWAL',
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
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
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasInvoiceItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SaasInvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasPayment" (
    "id" TEXT NOT NULL,
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
    "paidAt" TIMESTAMP(3),
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasRefund" (
    "id" TEXT NOT NULL,
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
    "decidedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SubscriptionWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "limitKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "limitValue" INTEGER,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlatformCounter_pkey" PRIMARY KEY ("key")
);

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

-- CreateIndex
CREATE INDEX "Plan_status_sortOrder_idx" ON "Plan"("status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_externalSubscriptionId_key" ON "Subscription"("externalSubscriptionId");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "Subscription_nextBillingDate_idx" ON "Subscription"("nextBillingDate");

-- CreateIndex
CREATE INDEX "Subscription_status_trialEnd_idx" ON "Subscription"("status", "trialEnd");

-- AddForeignKey
ALTER TABLE "SaasInvoiceItem" ADD CONSTRAINT "SaasInvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SaasInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

