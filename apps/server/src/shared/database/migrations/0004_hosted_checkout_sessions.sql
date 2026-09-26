CREATE TYPE "checkout_session_status" AS ENUM ('active', 'submitted', 'expired');

CREATE TABLE "hosted_checkout_sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "public_id" varchar(40) NOT NULL UNIQUE,
  "store_id" uuid NOT NULL REFERENCES "stores"("id") ON DELETE restrict,
  "merchant_order_id" varchar(128) NOT NULL,
  "order_reference" varchar(100) NOT NULL,
  "amount_minor" integer NOT NULL,
  "currency" char(3) NOT NULL DEFAULT 'EGP',
  "checkout_token_hash" bytea NOT NULL UNIQUE,
  "recipient_ipa_snapshot" varchar(160) NOT NULL,
  "account_holder_name_snapshot" varchar(160) NOT NULL,
  "webhook_url_snapshot_encrypted" bytea NOT NULL,
  "matching_window_minutes_snapshot" smallint NOT NULL,
  "status" "checkout_session_status" NOT NULL DEFAULT 'active',
  "expires_at" timestamp with time zone NOT NULL,
  "submitted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "hosted_checkout_sessions_amount_minor_check" CHECK ("amount_minor" between 100 and 10000000),
  CONSTRAINT "hosted_checkout_sessions_currency_check" CHECK ("currency" = 'EGP'),
  CONSTRAINT "hosted_checkout_sessions_expires_after_created_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "hosted_checkout_sessions_store_merchant_order_unique" UNIQUE("store_id", "merchant_order_id")
);

CREATE INDEX "hosted_checkout_sessions_public_active_idx" ON "hosted_checkout_sessions" ("public_id", "status", "expires_at");
ALTER TABLE "payment_attempts" ADD COLUMN "checkout_session_id" uuid;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_checkout_session_id_hosted_checkout_sessions_id_fk" FOREIGN KEY ("checkout_session_id") REFERENCES "hosted_checkout_sessions"("id") ON DELETE restrict;
CREATE UNIQUE INDEX "payment_attempts_checkout_session_id_unique" ON "payment_attempts" ("checkout_session_id");
ALTER TABLE "payment_attempts" ALTER COLUMN "checkout_session_id" SET NOT NULL;
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_submitted_proof_check" CHECK ("proof_submitted_at" is not null and "proof_storage_key" is not null and "proof_input_sha256" is not null and "proof_canonical_sha256" is not null and "proof_retention_delete_at" is not null and "proof_state" in ('uploaded', 'scanning', 'clean', 'canonicalizing', 'extracting', 'extracted', 'unreadable', 'malicious', 'corrupt', 'superseded', 'deleted')) NOT VALID;
