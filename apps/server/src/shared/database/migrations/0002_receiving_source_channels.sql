ALTER TABLE "receiving_sources" ADD COLUMN "bank_name" varchar(120);--> statement-breakpoint
UPDATE "receiving_sources" SET "bank_name" = "bank_code";--> statement-breakpoint
ALTER TABLE "receiving_sources" ALTER COLUMN "bank_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "receiving_sources" ADD COLUMN "selected_channels" text[];--> statement-breakpoint
UPDATE "receiving_sources" SET "selected_channels" = ARRAY["input_kind"];--> statement-breakpoint
ALTER TABLE "receiving_sources" ALTER COLUMN "selected_channels" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "receiving_sources" ADD COLUMN "channel_verification" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "receiving_sources" ADD COLUMN "test_proof_storage_key" varchar(512);--> statement-breakpoint
ALTER TABLE "receiving_sources" ADD COLUMN "test_proof_facts_encrypted" "bytea";--> statement-breakpoint
ALTER TABLE "receiving_sources" DROP CONSTRAINT "receiving_sources_input_kind_check";--> statement-breakpoint
ALTER TABLE "receiving_sources" DROP COLUMN "bank_code";--> statement-breakpoint
ALTER TABLE "receiving_sources" DROP COLUMN "input_kind";--> statement-breakpoint
ALTER TABLE "receiving_sources" ADD CONSTRAINT "receiving_sources_selected_channels_check" CHECK (cardinality("selected_channels") between 1 and 2 and "selected_channels" <@ ARRAY['sms', 'notification']::text[]);
