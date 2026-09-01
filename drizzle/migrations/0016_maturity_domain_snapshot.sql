ALTER TABLE "maturity_scores" ADD COLUMN "domain_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "maturity_scores" ADD COLUMN "domain_code_snapshot" text;--> statement-breakpoint
ALTER TABLE "maturity_scores" ADD COLUMN "domain_description_snapshot" text;--> statement-breakpoint
ALTER TABLE "maturity_scores" ADD CONSTRAINT "maturity_scores_domain_snapshot_presence_check" CHECK ((maturity_domain_id IS NULL AND domain_name_snapshot IS NULL AND domain_code_snapshot IS NULL AND domain_description_snapshot IS NULL)
          OR (maturity_domain_id IS NOT NULL AND domain_name_snapshot IS NOT NULL AND domain_code_snapshot IS NOT NULL));