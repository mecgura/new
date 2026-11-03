-- CreateTable
CREATE TABLE "MarketingImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "aspect" TEXT NOT NULL DEFAULT 'post',
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "data" BLOB NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "MarketingImage_createdAt_idx" ON "MarketingImage"("createdAt");

