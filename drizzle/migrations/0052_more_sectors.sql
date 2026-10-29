-- PRIMUS PRIVACY — Migration 0052: more sectors.
--
-- Adds pharmaceuticals, public sector undertakings, energy and utilities,
-- manufacturing, real estate, logistics and IT services/BPO/GCC to the list of
-- sectors an engagement can be assessed under. The rules for each sector live
-- in code (lib/regulation); only the allowed keys are checked here.

ALTER TABLE "engagement_sectors" DROP CONSTRAINT "engagement_sectors_key_check";
--> statement-breakpoint
ALTER TABLE "engagement_sectors" ADD CONSTRAINT "engagement_sectors_key_check" CHECK (sector_key IN ('broking','banking','insurance','healthcare','pharma','telecom','ecommerce','ott','aviation','logistics','energy','manufacturing','realestate','itbpo','ai','education','msme','government','psu'));
