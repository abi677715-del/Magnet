-- Scoring and review were removed: the app just finds partners and exports them.
DROP INDEX "leads_status_score_idx";

ALTER TABLE "leads"
  DROP COLUMN "status",
  DROP COLUMN "score",
  DROP COLUMN "category",
  DROP COLUMN "summary",
  DROP COLUMN "breakdown",
  DROP COLUMN "strengths",
  DROP COLUMN "concerns",
  DROP COLUMN "redFlags",
  DROP COLUMN "isPriority",
  DROP COLUMN "scoredAt",
  DROP COLUMN "scoreModel",
  DROP COLUMN "scoreError",
  DROP COLUMN "reviewedBy",
  DROP COLUMN "reviewedAt",
  DROP COLUMN "reviewNote";

DROP TYPE "LeadStatus";

-- Outreach stage, tracked by hand. Leads the team had already approved/contacted under the old statuses
-- were dropped with the column above, so everything starts at FOUND.
CREATE TYPE "PartnerStage" AS ENUM ('FOUND', 'CONTACTED', 'IN_PROGRESS', 'REGISTERED', 'DECLINED');
ALTER TABLE "leads"
  ADD COLUMN "stage" "PartnerStage" NOT NULL DEFAULT 'FOUND',
  ADD COLUMN "stageNote" TEXT,
  ADD COLUMN "stageBy" TEXT,
  ADD COLUMN "stageAt" TIMESTAMP(3);
CREATE INDEX "leads_stage_idx" ON "leads"("stage");

CREATE INDEX "leads_discoveredAt_idx" ON "leads"("discoveredAt");
