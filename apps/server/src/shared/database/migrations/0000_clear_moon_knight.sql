CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."alert_parse_state" AS ENUM('queued', 'parsed', 'unparseable', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."attempt_status" AS ENUM('awaiting_proof', 'awaiting_bank_alert', 'automatically_approved', 'manual_verification_required', 'ambiguous_match', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('android_automation', 'ios_shortcuts');--> statement-breakpoint
CREATE TYPE "public"."evidence_state" AS ENUM('upload_pending', 'uploaded', 'scanning', 'clean', 'canonicalizing', 'malicious', 'corrupt', 'extracting', 'extracted', 'unreadable', 'superseded', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."platform_connection_status" AS ENUM('active', 'disconnected', 'revoked', 'scope_invalid');--> statement-breakpoint
CREATE TYPE "public"."platform_kind" AS ENUM('shopify', 'woocommerce');--> statement-breakpoint
CREATE TYPE "public"."platform_order_sync_status" AS ENUM('pending', 'syncing', 'marked_paid', 'retry_scheduled', 'failed', 'not_eligible');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('pending_verification', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "alert_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"external_event_id" uuid NOT NULL,
	"sender_or_app_identity_normalized" varchar(200) NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"alert_occurred_at" timestamp with time zone,
	"raw_text_encrypted" "bytea",
	"payload_hash" "bytea" NOT NULL,
	"parse_state" "alert_parse_state" DEFAULT 'queued' NOT NULL,
	"direction" varchar(10),
	"amount_minor" integer,
	"currency" char(3),
	"payer_name_encrypted" "bytea",
	"payer_name_normalized" varchar(200),
	"account_suffix_encrypted" "bytea",
	"transaction_reference_encrypted" "bytea",
	"transaction_reference_normalized" varchar(200),
	"parser_name" varchar(80),
	"parser_version" varchar(40),
	"parser_confidence" numeric(5, 4),
	"is_test" boolean DEFAULT false NOT NULL,
	"matched_attempt_id" uuid,
	"raw_delete_at" timestamp with time zone NOT NULL,
	"parsed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_events_currency_check" CHECK ("alert_events"."currency" is null or "alert_events"."currency" = 'EGP')
);
--> statement-breakpoint
CREATE TABLE "audit_records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"store_id" uuid NOT NULL,
	"attempt_id" uuid,
	"alert_event_id" uuid,
	"actor_type" varchar(20) NOT NULL,
	"actor_owner_id" uuid,
	"action" varchar(80) NOT NULL,
	"outcome" varchar(80) NOT NULL,
	"reason_code" varchar(80),
	"rule_results" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proof_revision" uuid,
	"proof_canonical_sha256" "bytea",
	"request_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_records_actor_type_check" CHECK ("audit_records"."actor_type" in ('system', 'owner', 'merchant', 'device', 'platform'))
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone_e164" varchar(16) NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owners_phone_e164_unique" UNIQUE("phone_e164"),
	CONSTRAINT "owners_phone_e164_check" CHECK ("owners"."phone_e164" ~ '^[+][1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"public_id" varchar(40) NOT NULL,
	"store_id" uuid NOT NULL,
	"merchant_order_id" varchar(128) NOT NULL,
	"order_reference" varchar(100) NOT NULL,
	"customer_reference_encrypted" "bytea",
	"amount_minor" integer NOT NULL,
	"currency" char(3) DEFAULT 'EGP' NOT NULL,
	"status" "attempt_status" DEFAULT 'awaiting_proof' NOT NULL,
	"checkout_token_hash" "bytea" NOT NULL,
	"recipient_ipa_snapshot" varchar(160) NOT NULL,
	"account_holder_name_snapshot" varchar(160) NOT NULL,
	"webhook_url_snapshot_encrypted" "bytea" NOT NULL,
	"matching_window_minutes_snapshot" smallint NOT NULL,
	"proof_submitted_at" timestamp with time zone,
	"proof_revision" uuid,
	"proof_storage_key" varchar(512),
	"proof_input_sha256" "bytea",
	"proof_canonical_sha256" "bytea",
	"proof_state" "evidence_state" DEFAULT 'upload_pending' NOT NULL,
	"proof_match_facts_encrypted" "bytea",
	"proof_retention_delete_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"status_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "payment_attempts_checkout_token_hash_unique" UNIQUE("checkout_token_hash"),
	CONSTRAINT "payment_attempts_proof_storage_key_unique" UNIQUE("proof_storage_key"),
	CONSTRAINT "payment_attempts_proof_canonical_sha256_unique" UNIQUE("proof_canonical_sha256"),
	CONSTRAINT "payment_attempts_amount_minor_check" CHECK ("payment_attempts"."amount_minor" between 100 and 10000000),
	CONSTRAINT "payment_attempts_currency_check" CHECK ("payment_attempts"."currency" = 'EGP'),
	CONSTRAINT "payment_attempts_expires_after_created_check" CHECK ("payment_attempts"."expires_at" > "payment_attempts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "platform_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"platform" "platform_kind" NOT NULL,
	"external_account_id" varchar(255) NOT NULL,
	"external_account_domain" "citext",
	"credential_encrypted" "bytea" NOT NULL,
	"granted_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"provider_api_version" varchar(40) NOT NULL,
	"status" "platform_connection_status" DEFAULT 'active' NOT NULL,
	"credential_expires_at" timestamp with time zone,
	"credentials_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_order_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform_connection_id" uuid NOT NULL,
	"payment_attempt_id" uuid NOT NULL,
	"external_order_id" varchar(255) NOT NULL,
	"external_order_reference" varchar(255),
	"sync_status" "platform_order_sync_status" DEFAULT 'pending' NOT NULL,
	"mark_paid_idempotency_key" uuid NOT NULL,
	"sync_attempt_count" smallint DEFAULT 0 NOT NULL,
	"last_error_code" varchar(80),
	"last_sync_attempt_at" timestamp with time zone,
	"marked_paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_order_links_payment_attempt_id_unique" UNIQUE("payment_attempt_id"),
	CONSTRAINT "platform_order_links_mark_paid_idempotency_key_unique" UNIQUE("mark_paid_idempotency_key"),
	CONSTRAINT "platform_order_links_sync_attempt_count_check" CHECK ("platform_order_links"."sync_attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receiving_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"bank_code" varchar(40) NOT NULL,
	"account_label_encrypted" "bytea" NOT NULL,
	"masked_account_suffix_encrypted" "bytea",
	"input_kind" varchar(20) NOT NULL,
	"allowed_identity_normalized" varchar(200) NOT NULL,
	"status" "source_status" DEFAULT 'pending_verification' NOT NULL,
	"device_id" uuid NOT NULL,
	"device_platform" "device_platform" NOT NULL,
	"device_credential_hash" text NOT NULL,
	"device_credential_prefix" varchar(18) NOT NULL,
	"device_signing_key_encrypted" "bytea" NOT NULL,
	"test_expires_at" timestamp with time zone,
	"test_alert_event_id" uuid,
	"verified_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receiving_sources_store_id_unique" UNIQUE("store_id"),
	CONSTRAINT "receiving_sources_device_id_unique" UNIQUE("device_id"),
	CONSTRAINT "receiving_sources_device_credential_prefix_unique" UNIQUE("device_credential_prefix"),
	CONSTRAINT "receiving_sources_input_kind_check" CHECK ("receiving_sources"."input_kind" in ('sms', 'notification'))
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"account_holder_name" varchar(160) NOT NULL,
	"ipa" varchar(160) NOT NULL,
	"matching_window_minutes" smallint DEFAULT 15 NOT NULL,
	"default_webhook_url_encrypted" "bytea" NOT NULL,
	"webhook_secret_encrypted" "bytea" NOT NULL,
	"integration_secret_hash" text NOT NULL,
	"integration_secret_prefix" varchar(18) NOT NULL,
	"integration_secret_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"integration_secret_last_used_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_owner_id_unique" UNIQUE("owner_id"),
	CONSTRAINT "stores_ipa_unique" UNIQUE("ipa"),
	CONSTRAINT "stores_integration_secret_prefix_unique" UNIQUE("integration_secret_prefix"),
	CONSTRAINT "stores_matching_window_minutes_check" CHECK ("stores"."matching_window_minutes" in (5, 10, 15, 20, 30))
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_source_id_receiving_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."receiving_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_matched_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("matched_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_alert_event_id_alert_events_id_fk" FOREIGN KEY ("alert_event_id") REFERENCES "public"."alert_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_actor_owner_id_owners_id_fk" FOREIGN KEY ("actor_owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_connections" ADD CONSTRAINT "platform_connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_order_links" ADD CONSTRAINT "platform_order_links_platform_connection_id_platform_connections_id_fk" FOREIGN KEY ("platform_connection_id") REFERENCES "public"."platform_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_order_links" ADD CONSTRAINT "platform_order_links_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_sources" ADD CONSTRAINT "receiving_sources_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_source_external_event_unique" ON "alert_events" USING btree ("source_id","external_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_events_one_attempt_allocation_idx" ON "alert_events" USING btree ("matched_attempt_id") WHERE "alert_events"."matched_attempt_id" is not null;--> statement-breakpoint
CREATE INDEX "alert_events_match_candidates_idx" ON "alert_events" USING btree ("source_id","amount_minor","received_at") WHERE "alert_events"."parse_state" = 'parsed';--> statement-breakpoint
CREATE INDEX "audit_records_attempt_created_idx" ON "audit_records" USING btree ("attempt_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_records_store_created_idx" ON "audit_records" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_store_merchant_order_unique" ON "payment_attempts" USING btree ("store_id","merchant_order_id");--> statement-breakpoint
CREATE INDEX "payment_attempts_store_status_created_idx" ON "payment_attempts" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "payment_attempts_match_candidates_idx" ON "payment_attempts" USING btree ("store_id","amount_minor","status","expires_at");--> statement-breakpoint
CREATE INDEX "payment_attempts_proof_retention_delete_idx" ON "payment_attempts" USING btree ("proof_retention_delete_at") WHERE "payment_attempts"."proof_state" <> 'deleted' and "payment_attempts"."proof_retention_delete_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_connections_store_platform_unique" ON "platform_connections" USING btree ("store_id","platform");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_connections_platform_account_unique" ON "platform_connections" USING btree ("platform","external_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_connections_shopify_domain_unique" ON "platform_connections" USING btree ("external_account_domain") WHERE "platform_connections"."platform" = 'shopify' and "platform_connections"."external_account_domain" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_order_links_connection_order_unique" ON "platform_order_links" USING btree ("platform_connection_id","external_order_id");--> statement-breakpoint
CREATE INDEX "platform_order_links_pending_sync_idx" ON "platform_order_links" USING btree ("sync_status","created_at") WHERE "platform_order_links"."sync_status" in ('pending', 'retry_scheduled');
