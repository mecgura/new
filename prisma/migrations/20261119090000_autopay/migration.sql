-- CreateTable
CREATE TABLE "Autopay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "gateway" TEXT NOT NULL DEFAULT 'razorpay',
    "gatewaySubId" TEXT NOT NULL,
    "gatewayPlanId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'created',
    "method" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL,
    "interval" TEXT NOT NULL DEFAULT 'month',
    "shortUrl" TEXT NOT NULL DEFAULT '',
    "startAt" DATETIME,
    "chargedCount" INTEGER NOT NULL DEFAULT 0,
    "lastChargedAt" DATETIME,
    "lastFailureReason" TEXT NOT NULL DEFAULT '',
    "endReason" TEXT NOT NULL DEFAULT '',
    "cancelledAt" DATETIME,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Autopay_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Autopay_gatewaySubId_key" ON "Autopay"("gatewaySubId");

-- CreateIndex
CREATE INDEX "Autopay_organizationId_status_idx" ON "Autopay"("organizationId", "status");

