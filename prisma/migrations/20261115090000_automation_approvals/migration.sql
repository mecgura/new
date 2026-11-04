-- CreateTable
CREATE TABLE "AutomationApproval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "contactId" TEXT,
    "question" TEXT NOT NULL,
    "approverUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT NOT NULL DEFAULT '',
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AutomationApproval_organizationId_status_idx" ON "AutomationApproval"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationApproval_executionId_nodeId_key" ON "AutomationApproval"("executionId", "nodeId");

