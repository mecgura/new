-- CreateTable
CREATE TABLE "FoodSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "whatsappAccountId" TEXT,
    "venueName" TEXT NOT NULL DEFAULT '',
    "paymentModes" TEXT NOT NULL DEFAULT '["room_bill","counter"]',
    "razorpayKeyId" TEXT NOT NULL DEFAULT '',
    "encryptedKeySecret" TEXT NOT NULL DEFAULT '',
    "encryptedWebhookSecret" TEXT NOT NULL DEFAULT '',
    "taxPercent" REAL NOT NULL DEFAULT 0,
    "welcomeNote" TEXT NOT NULL DEFAULT '',
    "acceptingOrders" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FoodSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Menu',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "pricePaise" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "veg" BOOLEAN NOT NULL DEFAULT true,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiningSpot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'table',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiningSpot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FoodOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "spotLabel" TEXT NOT NULL DEFAULT '',
    "contactId" TEXT,
    "conversationId" TEXT,
    "guestName" TEXT NOT NULL DEFAULT '',
    "items" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT NOT NULL DEFAULT '',
    "subtotalPaise" INTEGER NOT NULL DEFAULT 0,
    "taxPaise" INTEGER NOT NULL DEFAULT 0,
    "totalPaise" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentMode" TEXT NOT NULL DEFAULT 'counter',
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "paymentLinkId" TEXT NOT NULL DEFAULT '',
    "paymentLinkUrl" TEXT NOT NULL DEFAULT '',
    "paidAt" DATETIME,
    "placedAt" DATETIME,
    "acceptedAt" DATETIME,
    "readyAt" DATETIME,
    "deliveredAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FoodOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FoodSettings_organizationId_key" ON "FoodSettings"("organizationId");

-- CreateIndex
CREATE INDEX "MenuItem_organizationId_category_sortOrder_idx" ON "MenuItem"("organizationId", "category", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DiningSpot_organizationId_code_key" ON "DiningSpot"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FoodOrder_code_key" ON "FoodOrder"("code");

-- CreateIndex
CREATE INDEX "FoodOrder_organizationId_status_createdAt_idx" ON "FoodOrder"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FoodOrder_organizationId_number_key" ON "FoodOrder"("organizationId", "number");

