import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DATA_ENCRYPTOR, type DataEncryptor } from "../../../shared/crypto/data-encryptor.js";
import { DATABASE, type Database } from "../../../shared/database/database.module.js";
import { alertEvents, receivingSources, stores } from "../../../shared/database/schema.js";
import { DuplicateDeviceEventError, ReceivingSourceAlreadyExistsError } from "../domain/errors.js";
import { normalizeBankIdentity } from "../domain/receiving-source-input.js";
import type { ChannelVerification, CreateReceivingSourceInput, ParsedTestAlert, ReceivingSource, ReceivingSourceRepository, StoredReceivingSource, TestProof } from "../domain/ports.js";

const RAW_ALERT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

@Injectable()
export class DrizzleReceivingSourceRepository implements ReceivingSourceRepository {
  public constructor(@Inject(DATABASE) private readonly database: Database, @Inject(DATA_ENCRYPTOR) private readonly encryptor: DataEncryptor) {}

  public async create(input: CreateReceivingSourceInput): Promise<ReceivingSource> {
    const now = new Date();
    try {
      const [row] = await this.database.insert(receivingSources).values({
        id: randomUUID(), storeId: input.storeId, bankName: input.bankName, accountLabelEncrypted: this.encryptor.encrypt(input.expectedIpa),
        selectedChannels: input.selectedChannels, channelVerification: encodeChannels(input.selectedChannels.map((channel) => ({ channel, status: "awaiting_test", verifiedAt: null, lastFailureCode: null }))),
        allowedIdentityNormalized: normalizeBankIdentity(input.bankName), status: "pending_verification", deviceId: randomUUID(),
        devicePlatform: input.devicePlatform === "android" ? "android_automation" : "ios_shortcuts", deviceCredentialHash: input.deviceCredentialHash,
        deviceCredentialPrefix: input.deviceCredentialPrefix, deviceSigningKeyEncrypted: this.encryptor.encrypt(input.deviceSigningKey), testExpiresAt: input.testExpiresAt,
        createdAt: now, updatedAt: now,
      }).returning();
      if (!row) throw new Error("Receiving source insert did not return a row.");
      return this.toPublic(row, input.ownerId, input.expectedIpa, []);
    } catch (error) {
      if (unique(error, "receiving_sources_store_id_unique")) throw new ReceivingSourceAlreadyExistsError();
      throw error;
    }
  }

  public async findByOwnerAndStore(ownerId: string, storeId: string): Promise<ReceivingSource | null> {
    const row = await this.findRow(and(eq(receivingSources.storeId, storeId), eq(stores.ownerId, ownerId)));
    return row ? this.toPublic(row.source, row.ownerId, row.ipa, await this.recentAlerts(row.source.id)) : null;
  }

  public async findByIdForOwner(id: string, ownerId: string): Promise<ReceivingSource | null> {
    const row = await this.findRow(and(eq(receivingSources.id, id), eq(stores.ownerId, ownerId)));
    return row ? this.toPublic(row.source, row.ownerId, row.ipa, await this.recentAlerts(row.source.id)) : null;
  }

  public async findStoredById(id: string): Promise<StoredReceivingSource | null> {
    const row = await this.findRow(eq(receivingSources.id, id));
    if (!row) return null;
    return { ...this.toPublic(row.source, row.ownerId, row.ipa, await this.recentAlerts(row.source.id)), deviceCredentialHash: row.source.deviceCredentialHash, deviceCredentialPrefix: row.source.deviceCredentialPrefix, deviceSigningKey: this.encryptor.decrypt(row.source.deviceSigningKeyEncrypted) };
  }

  public async save(source: StoredReceivingSource): Promise<ReceivingSource> {
    const now = new Date();
    await this.database.update(receivingSources).set({ channelVerification: encodeChannels(source.channelVerification), status: source.status, testProofStorageKey: source.testProof?.storageKey ?? null, testProofFactsEncrypted: source.testProof ? this.encryptor.encrypt(JSON.stringify(encodeProof(source.testProof))) : null, verifiedAt: source.status === "active" ? now : null, updatedAt: now }).where(eq(receivingSources.id, source.id));
    return publicSource(source, now);
  }

  public async recordTestAlert(source: StoredReceivingSource, alert: ParsedTestAlert): Promise<ReceivingSource> {
    const now = new Date();
    const eventId = randomUUID();
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.insert(alertEvents).values({
          id: eventId, sourceId: source.id, externalEventId: alert.eventId, ingestionChannel: alert.channel,
          senderOrAppIdentityNormalized: normalizeBankIdentity(alert.senderIdentity), receivedAt: alert.receivedAt,
          rawTextEncrypted: this.encryptor.encrypt(alert.rawText), payloadHash: createHash("sha256").update(alert.rawText, "utf8").digest(),
          parseState: alert.amountMinor === null ? "unparseable" : "parsed", direction: alert.indicatesCredit ? "credit" : "unknown",
          amountMinor: alert.amountMinor, currency: alert.amountMinor === null ? null : "EGP", parserName: "test-alert-parser", parserVersion: "1", parserConfidence: "1.0000", isTest: true,
          rawDeleteAt: new Date(now.getTime() + RAW_ALERT_RETENTION_MS), parsedAt: now,
        });
        await transaction.update(receivingSources).set({ channelVerification: encodeChannels(source.channelVerification), status: source.status, testAlertEventId: eventId, lastSeenAt: alert.receivedAt, verifiedAt: source.status === "active" ? now : null, updatedAt: now }).where(eq(receivingSources.id, source.id));
      });
    } catch (error) {
      if (unique(error, "alert_events_source_external_event_unique")) throw new DuplicateDeviceEventError();
      throw error;
    }
    return publicSource(source, now);
  }

  public async recordLiveAlert(source: StoredReceivingSource, alert: ParsedTestAlert): Promise<string> {
    const now = new Date();
    const eventId = randomUUID();
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.insert(alertEvents).values({
          id: eventId, sourceId: source.id, externalEventId: alert.eventId, ingestionChannel: alert.channel,
          senderOrAppIdentityNormalized: normalizeBankIdentity(alert.senderIdentity), receivedAt: alert.receivedAt,
          rawTextEncrypted: this.encryptor.encrypt(alert.rawText), payloadHash: createHash("sha256").update(alert.rawText, "utf8").digest(),
          parseState: alert.amountMinor === null ? "unparseable" : "parsed", direction: alert.indicatesCredit ? "credit" : "unknown",
          amountMinor: alert.amountMinor, currency: alert.amountMinor === null ? null : "EGP", parserName: "device-alert-parser", parserVersion: "1", parserConfidence: "1.0000", isTest: false,
          rawDeleteAt: new Date(now.getTime() + RAW_ALERT_RETENTION_MS), parsedAt: now,
        });
        await transaction.update(receivingSources).set({ lastSeenAt: alert.receivedAt, updatedAt: now }).where(eq(receivingSources.id, source.id));
      });
    } catch (error) {
      if (unique(error, "alert_events_source_external_event_unique")) throw new DuplicateDeviceEventError();
      throw error;
    }
    return eventId;
  }

  private async findRow(where: ReturnType<typeof eq> | ReturnType<typeof and>) {
    const [row] = await this.database.select({ source: receivingSources, ownerId: stores.ownerId, ipa: stores.ipa }).from(receivingSources).innerJoin(stores, eq(receivingSources.storeId, stores.id)).where(where).limit(1);
    return row ?? null;
  }

  private async recentAlerts(sourceId: string): Promise<ParsedTestAlert[]> {
    const rows = await this.database.select().from(alertEvents).where(and(eq(alertEvents.sourceId, sourceId), eq(alertEvents.isTest, true))).orderBy(desc(alertEvents.receivedAt)).limit(10);
    return rows.reverse().flatMap((row) => {
      if (!row.rawTextEncrypted || (row.ingestionChannel !== "sms" && row.ingestionChannel !== "notification")) return [];
      try { return [{ eventId: row.externalEventId, channel: row.ingestionChannel, senderIdentity: row.senderOrAppIdentityNormalized, rawText: this.encryptor.decrypt(row.rawTextEncrypted), receivedAt: row.receivedAt, amountMinor: row.amountMinor, indicatesCredit: row.direction === "credit" }]; } catch { return []; }
    });
  }

  private toPublic(row: typeof receivingSources.$inferSelect, ownerId: string, ipa: string, pendingAlerts: ParsedTestAlert[]): ReceivingSource {
    return { id: row.id, ownerId, storeId: row.storeId, bankName: row.bankName, expectedIpa: ipa, selectedChannels: row.selectedChannels as ReceivingSource["selectedChannels"], channelVerification: decodeChannels(row.selectedChannels, row.channelVerification), status: row.status as ReceivingSource["status"], deviceId: row.deviceId, devicePlatform: row.devicePlatform === "android_automation" ? "android" : "ios", testExpiresAt: row.testExpiresAt ?? new Date(0), testProof: decodeProof(row.testProofStorageKey, row.testProofFactsEncrypted, this.encryptor), pendingAlerts, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }
}

type EncodedProof = { mediaType: TestProof["mediaType"]; amountMinor: number | null; recipientMatched: boolean; indicatesSuccess: boolean; receivedAt: string };
function encodeProof(proof: TestProof): EncodedProof { return { mediaType: proof.mediaType, amountMinor: proof.amountMinor, recipientMatched: proof.recipientMatched, indicatesSuccess: proof.indicatesSuccess, receivedAt: proof.receivedAt.toISOString() }; }
function decodeProof(key: string | null, encrypted: Buffer | null, encryptor: DataEncryptor): TestProof | null { if (!key || !encrypted) return null; try { const value: unknown = JSON.parse(encryptor.decrypt(encrypted)); if (!isEncodedProof(value)) return null; return { storageKey: key, mediaType: value.mediaType, amountMinor: value.amountMinor, recipientMatched: value.recipientMatched, indicatesSuccess: value.indicatesSuccess, receivedAt: new Date(value.receivedAt) }; } catch { return null; } }
function isEncodedProof(value: unknown): value is EncodedProof { if (typeof value !== "object" || value === null) return false; const proof = value as Record<string, unknown>; return (proof.mediaType === "image/jpeg" || proof.mediaType === "image/png" || proof.mediaType === "image/webp") && (typeof proof.amountMinor === "number" || proof.amountMinor === null) && typeof proof.recipientMatched === "boolean" && typeof proof.indicatesSuccess === "boolean" && typeof proof.receivedAt === "string" && !Number.isNaN(new Date(proof.receivedAt).getTime()); }
function encodeChannels(channels: ChannelVerification[]): Record<string, { status: string; verifiedAt: string | null; lastFailureCode: string | null }> { return Object.fromEntries(channels.map((channel) => [channel.channel, { status: channel.status, verifiedAt: channel.verifiedAt?.toISOString() ?? null, lastFailureCode: channel.lastFailureCode }])); }
function decodeChannels(selected: readonly string[], channels: Record<string, { status: string; verifiedAt: string | null; lastFailureCode: string | null }>): ChannelVerification[] { return selected.flatMap((channel) => { if (channel !== "sms" && channel !== "notification") return []; const stored = channels[channel]; if (!stored || !isChannelStatus(stored.status) || !isFailureCode(stored.lastFailureCode)) return [{ channel, status: "awaiting_test", verifiedAt: null, lastFailureCode: null }]; const verifiedAt = stored.verifiedAt ? new Date(stored.verifiedAt) : null; return [{ channel, status: stored.status, verifiedAt: verifiedAt && !Number.isNaN(verifiedAt.getTime()) ? verifiedAt : null, lastFailureCode: stored.lastFailureCode }]; }); }
function isChannelStatus(value: string): value is ChannelVerification["status"] { return value === "awaiting_test" || value === "verified" || value === "failed"; }
function isFailureCode(value: string | null): value is ChannelVerification["lastFailureCode"] { return value === null || value === "proof_alert_mismatch" || value === "unreadable_proof" || value === "expired"; }
function publicSource(source: StoredReceivingSource, updatedAt: Date): ReceivingSource { const { deviceCredentialHash: _hash, deviceCredentialPrefix: _prefix, deviceSigningKey: _key, ...publicValue } = source; return { ...publicValue, updatedAt }; }
function unique(error: unknown, constraint: string): error is { code: string; constraint?: string } { return typeof error === "object" && error !== null && "code" in error && "constraint" in error && error.code === "23505" && error.constraint === constraint; }
