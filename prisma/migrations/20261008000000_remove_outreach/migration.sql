-- Affiliate Magnet only finds and shortlists partners now; emailing was removed.

-- Leads that had reached the removed statuses keep their meaning as closely as possible.
UPDATE "leads" SET "status" = 'APPROVED' WHERE "status" IN ('CONTACTED', 'REPLIED');
UPDATE "leads" SET "status" = 'REJECTED' WHERE "status" = 'DO_NOT_CONTACT';

-- AlterEnum
BEGIN;
CREATE TYPE "LeadStatus_new" AS ENUM ('NEW', 'SCORED', 'APPROVED', 'REJECTED');
ALTER TABLE "leads" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "status" TYPE "LeadStatus_new" USING ("status"::text::"LeadStatus_new");
ALTER TYPE "LeadStatus" RENAME TO "LeadStatus_old";
ALTER TYPE "LeadStatus_new" RENAME TO "LeadStatus";
DROP TYPE "LeadStatus_old";
ALTER TABLE "leads" ALTER COLUMN "status" SET DEFAULT 'NEW';
COMMIT;

-- DropForeignKey
ALTER TABLE "outreach" DROP CONSTRAINT "outreach_leadId_fkey";

-- DropTable
DROP TABLE "outreach";
DROP TABLE "suppressions";

-- DropEnum
DROP TYPE "OutreachStatus";
