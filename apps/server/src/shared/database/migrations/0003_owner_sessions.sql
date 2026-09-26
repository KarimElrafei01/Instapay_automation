CREATE TABLE "owner_sessions" (
  "id" uuid PRIMARY KEY NOT NULL,
  "owner_id" uuid NOT NULL,
  "token_hash" "bytea" NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "owner_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "owner_sessions_owner_expires_idx" ON "owner_sessions" USING btree ("owner_id", "expires_at");
--> statement-breakpoint
CREATE INDEX "owner_sessions_active_expires_idx" ON "owner_sessions" USING btree ("expires_at") WHERE "owner_sessions"."revoked_at" is null;
