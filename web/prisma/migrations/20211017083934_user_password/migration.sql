/*
  Warnings:

  - You are about to drop the column `access_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `expires_at` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `id_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `oauth_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `oauth_token_secret` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `refresh_token` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `session_state` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `token_type` on the `Account` table. All the data in the column will be lost.
  - You are about to drop the column `interval_count` on the `Price` table. All the data in the column will be lost.
  - You are about to drop the column `trial_period_days` on the `Price` table. All the data in the column will be lost.
  - You are about to drop the column `unit_amount` on the `Price` table. All the data in the column will be lost.
  - You are about to drop the column `expires` on the `Session` table. All the data in the column will be lost.
  - You are about to drop the column `cancel_at` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `cancel_at_period_end` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `canceled_at` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `ended_at` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `start_date` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `trial_end` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `trial_start` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the `VerificationToken` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `updatedAt` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "TokenType" AS ENUM ('VERIFY_PASSWORD', 'RESET_PASSWORD');

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "access_token",
DROP COLUMN "expires_at",
DROP COLUMN "id_token",
DROP COLUMN "oauth_token",
DROP COLUMN "oauth_token_secret",
DROP COLUMN "refresh_token",
DROP COLUMN "session_state",
DROP COLUMN "token_type",
ADD COLUMN     "accessToken" TEXT,
ADD COLUMN     "expiresAt" INTEGER,
ADD COLUMN     "idToken" TEXT,
ADD COLUMN     "oauthToken" TEXT,
ADD COLUMN     "oauthTokenSecret" TEXT,
ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "sessionState" TEXT,
ADD COLUMN     "tokenType" TEXT;

-- AlterTable
ALTER TABLE "Price" DROP COLUMN "interval_count",
DROP COLUMN "trial_period_days",
DROP COLUMN "unit_amount",
ADD COLUMN     "intervalCount" INTEGER,
ADD COLUMN     "trialPeriodDays" INTEGER,
ADD COLUMN     "unitAmount" INTEGER;

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "expires",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "cancel_at",
DROP COLUMN "cancel_at_period_end",
DROP COLUMN "canceled_at",
DROP COLUMN "ended_at",
DROP COLUMN "start_date",
DROP COLUMN "trial_end",
DROP COLUMN "trial_start",
ADD COLUMN     "cancelAt" TIMESTAMP(3),
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN,
ADD COLUMN     "canceledAt" TIMESTAMP(3),
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "startDate" TIMESTAMP(3),
ADD COLUMN     "trialEnd" TIMESTAMP(3),
ADD COLUMN     "trialStart" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT E'USER';

-- DropTable
DROP TABLE "VerificationToken";

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "type" "TokenType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sentTo" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Token_hashedToken_type_key" ON "Token"("hashedToken", "type");

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
