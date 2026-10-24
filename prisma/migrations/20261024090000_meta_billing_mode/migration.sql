-- AlterTable
ALTER TABLE "OrganizationSettings" ADD COLUMN "metaBillingMode" TEXT NOT NULL DEFAULT 'client_pays';
ALTER TABLE "OrganizationSettings" ADD COLUMN "prepaidMarkupPaise" INTEGER NOT NULL DEFAULT 20;
