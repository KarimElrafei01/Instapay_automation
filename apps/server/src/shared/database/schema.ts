import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string; driverData: string }>({
  dataType: () => "citext",
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const attemptStatus = pgEnum("attempt_status", [
  "awaiting_proof",
  "awaiting_bank_alert",
  "automatically_approved",
  "manual_verification_required",
  "ambiguous_match",
  "rejected",
  "expired",
]);

export const sourceStatus = pgEnum("source_status", [
  "pending_verification",
  "active",
  "disabled",
]);

export const devicePlatform = pgEnum("device_platform", [
  "android_automation", "ios_shortcuts",
]);

export const evidenceState = pgEnum("evidence_state", [
  "upload_pending", "uploaded", "scanning", "clean", "canonicalizing", "malicious",
  "corrupt", "extracting", "extracted", "unreadable", "superseded", "deleted",
]);

export const alertParseState = pgEnum("alert_parse_state", ["queued", "parsed", "unparseable", "rejected"]);
export const platformKind = pgEnum("platform_kind", ["shopify", "woocommerce"]);
export const platformConnectionStatus = pgEnum("platform_connection_status", [
  "active", "disconnected", "revoked", "scope_invalid",
]);
export const platformOrderSyncStatus = pgEnum("platform_order_sync_status", [
  "pending", "syncing", "marked_paid", "retry_scheduled", "failed", "not_eligible",
]);

export type ProofMatchFacts = {
  successful: boolean;
  amountMinor?: number;
  recipientNormalized?: string;
  claimedAt?: string;
  payerNormalized?: string;
  transactionReferenceNormalized?: string;
  extractorVersion: string;
};

export type RuleResults = Record<string, boolean | string | number | null>;

export const owners = pgTable("owners", {
  id: uuid("id").primaryKey(),
  phoneE164: varchar("phone_e164", { length: 16 }).notNull().unique(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("owners_phone_e164_check", sql`${table.phoneE164} ~ '^[+][1-9][0-9]{7,14}$'`),
]);

export const stores = pgTable("stores", {
  id: uuid("id").primaryKey(),
  ownerId: uuid("owner_id").notNull().unique().references(() => owners.id, { onDelete: "restrict" }),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  accountHolderName: varchar("account_holder_name", { length: 160 }).notNull(),
  ipa: varchar("ipa", { length: 160 }).notNull().unique(),
  matchingWindowMinutes: smallint("matching_window_minutes").notNull().default(15),
  defaultWebhookUrlEncrypted: bytea("default_webhook_url_encrypted").notNull(),
  webhookSecretEncrypted: bytea("webhook_secret_encrypted").notNull(),
  integrationSecretHash: text("integration_secret_hash").notNull(),
  integrationSecretPrefix: varchar("integration_secret_prefix", { length: 18 }).notNull().unique(),
  integrationSecretRotatedAt: timestamp("integration_secret_rotated_at", { withTimezone: true }).notNull().defaultNow(),
  integrationSecretLastUsedAt: timestamp("integration_secret_last_used_at", { withTimezone: true }),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("stores_matching_window_minutes_check", sql`${table.matchingWindowMinutes} in (5, 10, 15, 20, 30)`),
]);

export const platformConnections = pgTable("platform_connections", {
  id: uuid("id").primaryKey(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  platform: platformKind("platform").notNull(),
  externalAccountId: varchar("external_account_id", { length: 255 }).notNull(),
  externalAccountDomain: citext("external_account_domain"),
  credentialEncrypted: bytea("credential_encrypted").notNull(),
  grantedScopes: text("granted_scopes").array().notNull().default(sql`'{}'::text[]`),
  providerApiVersion: varchar("provider_api_version", { length: 40 }).notNull(),
  status: platformConnectionStatus("status").notNull().default("active"),
  credentialExpiresAt: timestamp("credential_expires_at", { withTimezone: true }),
  credentialsUpdatedAt: timestamp("credentials_updated_at", { withTimezone: true }).notNull().defaultNow(),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("platform_connections_store_platform_unique").on(table.storeId, table.platform),
  uniqueIndex("platform_connections_platform_account_unique").on(table.platform, table.externalAccountId),
  uniqueIndex("platform_connections_shopify_domain_unique")
    .on(table.externalAccountDomain)
    .where(sql`${table.platform} = 'shopify' and ${table.externalAccountDomain} is not null`),
]);

export const paymentAttempts = pgTable("payment_attempts", {
  id: uuid("id").primaryKey(),
  publicId: varchar("public_id", { length: 40 }).notNull().unique(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  merchantOrderId: varchar("merchant_order_id", { length: 128 }).notNull(),
  orderReference: varchar("order_reference", { length: 100 }).notNull(),
  customerReferenceEncrypted: bytea("customer_reference_encrypted"),
  amountMinor: integer("amount_minor").notNull(),
  currency: char("currency", { length: 3 }).notNull().default("EGP"),
  status: attemptStatus("status").notNull().default("awaiting_proof"),
  checkoutTokenHash: bytea("checkout_token_hash").notNull().unique(),
  recipientIpaSnapshot: varchar("recipient_ipa_snapshot", { length: 160 }).notNull(),
  accountHolderNameSnapshot: varchar("account_holder_name_snapshot", { length: 160 }).notNull(),
  webhookUrlSnapshotEncrypted: bytea("webhook_url_snapshot_encrypted").notNull(),
  matchingWindowMinutesSnapshot: smallint("matching_window_minutes_snapshot").notNull(),
  proofSubmittedAt: timestamp("proof_submitted_at", { withTimezone: true }),
  proofRevision: uuid("proof_revision"),
  proofStorageKey: varchar("proof_storage_key", { length: 512 }).unique(),
  proofInputSha256: bytea("proof_input_sha256"),
  proofCanonicalSha256: bytea("proof_canonical_sha256").unique(),
  proofState: evidenceState("proof_state").notNull().default("upload_pending"),
  proofMatchFactsEncrypted: bytea("proof_match_facts_encrypted"),
  proofRetentionDeleteAt: timestamp("proof_retention_delete_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  statusUpdatedAt: timestamp("status_updated_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("payment_attempts_store_merchant_order_unique").on(table.storeId, table.merchantOrderId),
  index("payment_attempts_store_status_created_idx").on(table.storeId, table.status, table.createdAt),
  index("payment_attempts_match_candidates_idx").on(table.storeId, table.amountMinor, table.status, table.expiresAt),
  index("payment_attempts_proof_retention_delete_idx")
    .on(table.proofRetentionDeleteAt)
    .where(sql`${table.proofState} <> 'deleted' and ${table.proofRetentionDeleteAt} is not null`),
  check("payment_attempts_amount_minor_check", sql`${table.amountMinor} between 100 and 10000000`),
  check("payment_attempts_currency_check", sql`${table.currency} = 'EGP'`),
  check("payment_attempts_expires_after_created_check", sql`${table.expiresAt} > ${table.createdAt}`),
]);

export const platformOrderLinks = pgTable("platform_order_links", {
  id: uuid("id").primaryKey(),
  platformConnectionId: uuid("platform_connection_id").notNull().references(() => platformConnections.id, { onDelete: "restrict" }),
  paymentAttemptId: uuid("payment_attempt_id").notNull().unique().references(() => paymentAttempts.id, { onDelete: "restrict" }),
  externalOrderId: varchar("external_order_id", { length: 255 }).notNull(),
  externalOrderReference: varchar("external_order_reference", { length: 255 }),
  syncStatus: platformOrderSyncStatus("sync_status").notNull().default("pending"),
  markPaidIdempotencyKey: uuid("mark_paid_idempotency_key").notNull().unique(),
  syncAttemptCount: smallint("sync_attempt_count").notNull().default(0),
  lastErrorCode: varchar("last_error_code", { length: 80 }),
  lastSyncAttemptAt: timestamp("last_sync_attempt_at", { withTimezone: true }),
  markedPaidAt: timestamp("marked_paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("platform_order_links_connection_order_unique").on(table.platformConnectionId, table.externalOrderId),
  index("platform_order_links_pending_sync_idx")
    .on(table.syncStatus, table.createdAt)
    .where(sql`${table.syncStatus} in ('pending', 'retry_scheduled')`),
  check("platform_order_links_sync_attempt_count_check", sql`${table.syncAttemptCount} >= 0`),
]);

export const receivingSources = pgTable("receiving_sources", {
  id: uuid("id").primaryKey(),
  storeId: uuid("store_id").notNull().unique().references(() => stores.id, { onDelete: "restrict" }),
  bankCode: varchar("bank_code", { length: 40 }).notNull(),
  accountLabelEncrypted: bytea("account_label_encrypted").notNull(),
  maskedAccountSuffixEncrypted: bytea("masked_account_suffix_encrypted"),
  inputKind: varchar("input_kind", { length: 20 }).notNull(),
  allowedIdentityNormalized: varchar("allowed_identity_normalized", { length: 200 }).notNull(),
  status: sourceStatus("status").notNull().default("pending_verification"),
  deviceId: uuid("device_id").notNull().unique(),
  devicePlatform: devicePlatform("device_platform").notNull(),
  deviceCredentialHash: text("device_credential_hash").notNull(),
  deviceCredentialPrefix: varchar("device_credential_prefix", { length: 18 }).notNull().unique(),
  deviceSigningKeyEncrypted: bytea("device_signing_key_encrypted").notNull(),
  testExpiresAt: timestamp("test_expires_at", { withTimezone: true }),
  testAlertEventId: uuid("test_alert_event_id"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("receiving_sources_input_kind_check", sql`${table.inputKind} in ('sms', 'notification')`),
]);

export const alertEvents = pgTable("alert_events", {
  id: uuid("id").primaryKey(),
  sourceId: uuid("source_id").notNull().references(() => receivingSources.id, { onDelete: "restrict" }),
  externalEventId: uuid("external_event_id").notNull(),
  senderOrAppIdentityNormalized: varchar("sender_or_app_identity_normalized", { length: 200 }).notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  alertOccurredAt: timestamp("alert_occurred_at", { withTimezone: true }),
  rawTextEncrypted: bytea("raw_text_encrypted"),
  payloadHash: bytea("payload_hash").notNull(),
  parseState: alertParseState("parse_state").notNull().default("queued"),
  direction: varchar("direction", { length: 10 }),
  amountMinor: integer("amount_minor"),
  currency: char("currency", { length: 3 }),
  payerNameEncrypted: bytea("payer_name_encrypted"),
  payerNameNormalized: varchar("payer_name_normalized", { length: 200 }),
  accountSuffixEncrypted: bytea("account_suffix_encrypted"),
  transactionReferenceEncrypted: bytea("transaction_reference_encrypted"),
  transactionReferenceNormalized: varchar("transaction_reference_normalized", { length: 200 }),
  parserName: varchar("parser_name", { length: 80 }),
  parserVersion: varchar("parser_version", { length: 40 }),
  parserConfidence: numeric("parser_confidence", { precision: 5, scale: 4 }),
  isTest: boolean("is_test").notNull().default(false),
  matchedAttemptId: uuid("matched_attempt_id").references(() => paymentAttempts.id, { onDelete: "restrict" }),
  rawDeleteAt: timestamp("raw_delete_at", { withTimezone: true }).notNull(),
  parsedAt: timestamp("parsed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("alert_events_source_external_event_unique").on(table.sourceId, table.externalEventId),
  uniqueIndex("alert_events_one_attempt_allocation_idx").on(table.matchedAttemptId)
    .where(sql`${table.matchedAttemptId} is not null`),
  index("alert_events_match_candidates_idx").on(table.sourceId, table.amountMinor, table.receivedAt)
    .where(sql`${table.parseState} = 'parsed'`),
  check("alert_events_currency_check", sql`${table.currency} is null or ${table.currency} = 'EGP'`),
]);

export const auditRecords = pgTable("audit_records", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  storeId: uuid("store_id").notNull().references(() => stores.id, { onDelete: "restrict" }),
  attemptId: uuid("attempt_id").references(() => paymentAttempts.id, { onDelete: "restrict" }),
  alertEventId: uuid("alert_event_id").references(() => alertEvents.id, { onDelete: "restrict" }),
  actorType: varchar("actor_type", { length: 20 }).notNull(),
  actorOwnerId: uuid("actor_owner_id").references(() => owners.id, { onDelete: "restrict" }),
  action: varchar("action", { length: 80 }).notNull(),
  outcome: varchar("outcome", { length: 80 }).notNull(),
  reasonCode: varchar("reason_code", { length: 80 }),
  ruleResults: jsonb("rule_results").$type<RuleResults>().notNull().default({}),
  proofRevision: uuid("proof_revision"),
  proofCanonicalSha256: bytea("proof_canonical_sha256"),
  requestId: uuid("request_id"),
  metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_records_attempt_created_idx").on(table.attemptId, table.createdAt),
  index("audit_records_store_created_idx").on(table.storeId, table.createdAt),
  check("audit_records_actor_type_check", sql`${table.actorType} in ('system', 'owner', 'merchant', 'device', 'platform')`),
]);
