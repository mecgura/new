-- CreateTable
CREATE TABLE "OnePostBrand" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL DEFAULT '',
    "services" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "about" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "language" TEXT NOT NULL DEFAULT 'en',
    "defaultHashtags" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "logoType" TEXT NOT NULL DEFAULT '',
    "logo" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnePostBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnePost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL DEFAULT '',
    "postType" TEXT NOT NULL DEFAULT 'general',
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "city" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "spokespersonName" TEXT NOT NULL DEFAULT '',
    "spokespersonQuote" TEXT NOT NULL DEFAULT '',
    "videoUrl" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "OnePost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnePostMedia" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'image',
    "storage" TEXT NOT NULL DEFAULT 'db',
    "blobUrl" TEXT NOT NULL DEFAULT '',
    "blobPath" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "OnePostMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnePostVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '{}',
    "checks" TEXT NOT NULL DEFAULT '[]',
    "model" TEXT NOT NULL DEFAULT '',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "editedById" TEXT,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnePostVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnePostEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnePostEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnePostConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "encryptedAccess" TEXT NOT NULL DEFAULT '',
    "encryptedRefresh" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT NOT NULL DEFAULT '',
    "externalId" TEXT NOT NULL DEFAULT '',
    "externalName" TEXT NOT NULL DEFAULT '',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnePostConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnePostOAuthState" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnePostOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnePostDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "snapshot" TEXT NOT NULL DEFAULT '{}',
    "externalId" TEXT NOT NULL DEFAULT '',
    "externalUrl" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnePostDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnePostBrand_organizationId_key" ON "OnePostBrand"("organizationId");

-- CreateIndex
CREATE INDEX "OnePost_organizationId_status_updatedAt_idx" ON "OnePost"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "OnePost_organizationId_createdAt_idx" ON "OnePost"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OnePostMedia_postId_position_idx" ON "OnePostMedia"("postId", "position");

-- CreateIndex
CREATE INDEX "OnePostMedia_organizationId_idx" ON "OnePostMedia"("organizationId");

-- CreateIndex
CREATE INDEX "OnePostVersion_organizationId_idx" ON "OnePostVersion"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "OnePostVersion_postId_channel_key" ON "OnePostVersion"("postId", "channel");

-- CreateIndex
CREATE INDEX "OnePostEvent_postId_createdAt_idx" ON "OnePostEvent"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "OnePostEvent_organizationId_idx" ON "OnePostEvent"("organizationId");

-- CreateIndex
CREATE INDEX "OnePostConnection_organizationId_provider_idx" ON "OnePostConnection"("organizationId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "OnePostOAuthState_stateHash_key" ON "OnePostOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "OnePostOAuthState_expiresAt_idx" ON "OnePostOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "OnePostDelivery_status_nextAttemptAt_idx" ON "OnePostDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OnePostDelivery_organizationId_scheduledAt_idx" ON "OnePostDelivery"("organizationId", "scheduledAt");

-- CreateIndex
CREATE INDEX "OnePostDelivery_postId_idx" ON "OnePostDelivery"("postId");

-- AddForeignKey
ALTER TABLE "OnePostBrand" ADD CONSTRAINT "OnePostBrand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnePost" ADD CONSTRAINT "OnePost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnePostMedia" ADD CONSTRAINT "OnePostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OnePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnePostVersion" ADD CONSTRAINT "OnePostVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OnePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnePostEvent" ADD CONSTRAINT "OnePostEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OnePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnePostConnection" ADD CONSTRAINT "OnePostConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnePostDelivery" ADD CONSTRAINT "OnePostDelivery_postId_fkey" FOREIGN KEY ("postId") REFERENCES "OnePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

