import { randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt } from "drizzle-orm";
import * as argon2 from "argon2";
import { DATA_ENCRYPTOR, type DataEncryptor } from "../../../shared/crypto/data-encryptor.js";
import { DATABASE, type Database } from "../../../shared/database/database.module.js";
import { hostedCheckoutSessions, paymentAttempts, stores } from "../../../shared/database/schema.js";
import type { HostedCheckoutSession, PaymentAttempt, PaymentAttemptRepository, StoredHostedCheckoutSession, SubmittedProof } from "../domain/ports.js";

@Injectable()
export class DrizzlePaymentAttemptRepository implements PaymentAttemptRepository {
  public constructor(@Inject(DATABASE) private readonly database: Database, @Inject(DATA_ENCRYPTOR) private readonly encryptor: DataEncryptor) {}
  public async authenticateMerchantCredential(token: string) {
    if (!/^ipk_live_[A-Za-z0-9_-]{43}$/u.test(token)) return null;
    const [store] = await this.database.select().from(stores).where(eq(stores.integrationSecretPrefix, token.slice(0, 18))).limit(1);
    if (!store || store.disabledAt || !(await argon2.verify(store.integrationSecretHash, token))) return null;
    await this.database.update(stores).set({ integrationSecretLastUsedAt: new Date(), updatedAt: new Date() }).where(eq(stores.id, store.id));
    return { id: store.id, ipa: store.ipa, accountHolderName: store.accountHolderName, defaultWebhookUrl: this.encryptor.decrypt(store.defaultWebhookUrlEncrypted), matchingWindowMinutes: store.matchingWindowMinutes as 5 | 10 | 15 | 20 | 30 };
  }
  public async createCheckoutSession(input: StoredHostedCheckoutSession): Promise<HostedCheckoutSession> {
    const [row] = await this.database.insert(hostedCheckoutSessions).values({ id: input.id, publicId: input.publicId, storeId: input.storeId, merchantOrderId: input.merchantOrderId, orderReference: input.orderReference, amountMinor: input.amountMinor, currency: input.currency, checkoutTokenHash: input.checkoutTokenHash, recipientIpaSnapshot: input.recipientIpa, accountHolderNameSnapshot: input.accountHolderName, webhookUrlSnapshotEncrypted: this.encryptor.encrypt(input.webhookUrl), matchingWindowMinutesSnapshot: input.matchingWindowMinutes, status: input.status, expiresAt: input.expiresAt, createdAt: input.createdAt }).returning();
    if (!row) throw new Error("Hosted checkout session insert did not return a row.");
    return toCheckoutSession(row);
  }
  public async findCheckoutSession(publicId: string): Promise<StoredHostedCheckoutSession | null> {
    const [row] = await this.database.select().from(hostedCheckoutSessions).where(eq(hostedCheckoutSessions.publicId, publicId)).limit(1);
    return row ? { ...toCheckoutSession(row), checkoutTokenHash: row.checkoutTokenHash, webhookUrl: this.encryptor.decrypt(row.webhookUrlSnapshotEncrypted), matchingWindowMinutes: row.matchingWindowMinutesSnapshot as StoredHostedCheckoutSession["matchingWindowMinutes"] } : null;
  }
  public async createAttemptFromSubmittedProof(session: StoredHostedCheckoutSession, proof: SubmittedProof): Promise<PaymentAttempt> {
    const now = new Date();
    return this.database.transaction(async (transaction) => {
      const [claimed] = await transaction.update(hostedCheckoutSessions).set({ status: "submitted", submittedAt: proof.submittedAt, updatedAt: now }).where(and(eq(hostedCheckoutSessions.id, session.id), eq(hostedCheckoutSessions.status, "active"), gt(hostedCheckoutSessions.expiresAt, proof.submittedAt))).returning({ id: hostedCheckoutSessions.id });
      if (!claimed) throw new Error("Checkout session is no longer available.");
      const [attempt] = await transaction.insert(paymentAttempts).values({ id: randomUUID(), publicId: `pat_${randomBytes(18).toString("base64url")}`, checkoutSessionId: session.id, storeId: session.storeId, merchantOrderId: session.merchantOrderId, orderReference: session.orderReference, amountMinor: session.amountMinor, currency: "EGP", status: "awaiting_bank_alert", checkoutTokenHash: randomBytes(32), recipientIpaSnapshot: session.recipientIpa, accountHolderNameSnapshot: session.accountHolderName, webhookUrlSnapshotEncrypted: this.encryptor.encrypt(session.webhookUrl), matchingWindowMinutesSnapshot: session.matchingWindowMinutes, proofSubmittedAt: proof.submittedAt, proofRevision: randomUUID(), proofStorageKey: proof.storageKey, proofInputSha256: proof.inputSha256, proofCanonicalSha256: proof.canonicalSha256, proofState: "uploaded", proofRetentionDeleteAt: proof.retentionDeleteAt, expiresAt: session.expiresAt, statusUpdatedAt: now }).returning();
      if (!attempt || !attempt.checkoutSessionId || !attempt.proofStorageKey || !attempt.proofInputSha256 || !attempt.proofCanonicalSha256) throw new Error("Payment attempt persistence failed.");
      return { id: attempt.id, publicId: attempt.publicId, checkoutSessionId: attempt.checkoutSessionId, storeId: attempt.storeId, merchantOrderId: attempt.merchantOrderId, orderReference: attempt.orderReference, amountMinor: attempt.amountMinor, currency: "EGP", status: "awaiting_bank_alert", proofStorageKey: attempt.proofStorageKey, proofInputSha256: attempt.proofInputSha256, proofCanonicalSha256: attempt.proofCanonicalSha256, recipientIpa: attempt.recipientIpaSnapshot, accountHolderName: attempt.accountHolderNameSnapshot, expiresAt: attempt.expiresAt, createdAt: attempt.createdAt };
    });
  }
}
function toCheckoutSession(row: typeof hostedCheckoutSessions.$inferSelect): HostedCheckoutSession { return { id: row.id, publicId: row.publicId, storeId: row.storeId, merchantOrderId: row.merchantOrderId, orderReference: row.orderReference, amountMinor: row.amountMinor, currency: "EGP", recipientIpa: row.recipientIpaSnapshot, accountHolderName: row.accountHolderNameSnapshot, expiresAt: row.expiresAt, status: row.status as HostedCheckoutSession["status"], createdAt: row.createdAt }; }
