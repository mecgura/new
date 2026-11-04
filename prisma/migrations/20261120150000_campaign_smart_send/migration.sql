-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "smartSend" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Campaign" ADD COLUMN "freeText" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Campaign" ADD COLUMN "freeButtons" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "CampaignRecipient" ADD COLUMN "sendMode" TEXT NOT NULL DEFAULT 'template';
