-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "priceYearly" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "interval" TEXT NOT NULL DEFAULT 'month';
ALTER TABLE "Subscription" ADD COLUMN "periodPrice" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Subscription" ADD COLUMN "trialEndsAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "trialReminderAt" DATETIME;
ALTER TABLE "Subscription" ADD COLUMN "pendingInterval" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "remindersSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN "lastReminderAt" DATETIME;
ALTER TABLE "Invoice" ADD COLUMN "targetInterval" TEXT;
