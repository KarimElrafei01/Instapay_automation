import { describe, expect, it } from "vitest";
import {
  CreateReceivingSourceUseCase,
  IngestDeviceTestAlertUseCase,
  SubmitTestProofUseCase,
} from "./receiving-source.use-cases.js";
import { InMemoryReceivingSourceRepository } from "../data/in-memory-receiving-source.repository.js";
import { canonicalDeviceAlertPayload, signatureFor } from "../domain/receiving-source-input.js";
import type { DeviceCredentialIssuer, ReceivingSourceProofStorage, TestProofOcr } from "../domain/ports.js";
import { DuplicateDeviceEventError, InvalidDeviceSignatureError } from "../domain/errors.js";

const credentials: DeviceCredentialIssuer = {
  issue: async () => ({ credential: "dvc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", credentialPrefix: "dvc_live_aaaaaaaa", credentialHash: "hash", signingKey: "signing-key" }),
  verify: async (hash, credential) => hash === "hash" && credential === "dvc_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};
const readableProofOcr: TestProofOcr = {
  extract: async () => ({ text: "Successful transfer 25.00 EGP merchant@instapay", amountMinor: 2_500, indicatesSuccess: true }),
};
const proofStorage: ReceivingSourceProofStorage = { put: async () => undefined };

describe("receiving-source verification", () => {
  it("activates after one selected channel verifies and leaves the other channel pending", async () => {
    const repository = new InMemoryReceivingSourceRepository();
    const create = new CreateReceivingSourceUseCase(repository, credentials);
    const upload = new SubmitTestProofUseCase(repository, readableProofOcr, proofStorage);
    const ingest = new IngestDeviceTestAlertUseCase(repository, credentials);
    const created = await create.execute({ ownerId: "owner", storeId: "store", ipa: "merchant@instapay", bankName: "Bank Alert", selectedChannels: ["sms", "notification"], devicePlatform: "android" });
    await upload.execute({ ownerId: "owner", sourceId: created.source.id, mediaType: "image/png", bytes: new Uint8Array(32) });
    const alert = { eventId: "2cf7a04c-d51c-418e-b494-c546925ef914", channel: "sms" as const, senderIdentity: "Bank Alert", rawText: "Your account was credited 25.00 EGP", receivedAt: new Date() };
    const signedPayload = canonicalDeviceAlertPayload(alert);
    const source = await ingest.execute({ sourceId: created.source.id, credential: created.deviceCredential, signature: signatureFor(signedPayload, created.deviceSigningKey), signedPayload, alert });

    expect(source.status).toBe("active");
    expect(source.channelVerification).toEqual([
      expect.objectContaining({ channel: "sms", status: "verified" }),
      expect.objectContaining({ channel: "notification", status: "awaiting_test" }),
    ]);
  });

  it("does not activate when the screenshot and trusted alert disagree", async () => {
    const repository = new InMemoryReceivingSourceRepository();
    const create = new CreateReceivingSourceUseCase(repository, credentials);
    const upload = new SubmitTestProofUseCase(repository, readableProofOcr, proofStorage);
    const ingest = new IngestDeviceTestAlertUseCase(repository, credentials);
    const created = await create.execute({ ownerId: "owner", storeId: "store", ipa: "merchant@instapay", bankName: "Bank Alert", selectedChannels: ["sms"], devicePlatform: "android" });
    await upload.execute({ ownerId: "owner", sourceId: created.source.id, mediaType: "image/png", bytes: new Uint8Array(32) });
    const alert = { eventId: "8a8b8647-0af8-4878-9701-cdac478cb106", channel: "sms" as const, senderIdentity: "Bank Alert", rawText: "Your account was credited 30.00 EGP", receivedAt: new Date() };
    const signedPayload = canonicalDeviceAlertPayload(alert);
    const source = await ingest.execute({ sourceId: created.source.id, credential: created.deviceCredential, signature: signatureFor(signedPayload, created.deviceSigningKey), signedPayload, alert });

    expect(source.status).toBe("pending_verification");
    expect(source.channelVerification[0]).toMatchObject({ status: "failed", lastFailureCode: "proof_alert_mismatch" });
  });

  it("rejects tampered and replayed device events", async () => {
    const repository = new InMemoryReceivingSourceRepository();
    const create = new CreateReceivingSourceUseCase(repository, credentials);
    const ingest = new IngestDeviceTestAlertUseCase(repository, credentials);
    const created = await create.execute({ ownerId: "owner", storeId: "store", ipa: "merchant@instapay", bankName: "Bank Alert", selectedChannels: ["sms"], devicePlatform: "android" });
    const alert = { eventId: "c85aa48d-eb7e-42e8-ae95-3d6669914e71", channel: "sms" as const, senderIdentity: "Bank Alert", rawText: "credited 25 EGP", receivedAt: new Date() };
    const signedPayload = canonicalDeviceAlertPayload(alert);
    await expect(ingest.execute({ sourceId: created.source.id, credential: created.deviceCredential, signature: "invalid", signedPayload, alert })).rejects.toBeInstanceOf(InvalidDeviceSignatureError);
    const signature = signatureFor(signedPayload, created.deviceSigningKey);
    await ingest.execute({ sourceId: created.source.id, credential: created.deviceCredential, signature, signedPayload, alert });
    await expect(ingest.execute({ sourceId: created.source.id, credential: created.deviceCredential, signature, signedPayload, alert })).rejects.toBeInstanceOf(DuplicateDeviceEventError);
  });
});
