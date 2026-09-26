import { Inject, Injectable } from "@nestjs/common";
import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  DEVICE_CREDENTIAL_ISSUER,
  RECEIVING_SOURCE_REPOSITORY,
  TEST_PROOF_OCR,
  RECEIVING_SOURCE_PROOF_STORAGE,
  type DeviceCredentialIssuer,
  type DeviceTestAlert,
  type ReceivingChannel,
  type ReceivingSource,
  type ReceivingSourceRepository,
  type StoredReceivingSource,
  type TestProofOcr,
  type ReceivingSourceProofStorage,
} from "../domain/ports.js";
import {
  DuplicateDeviceEventError,
  InvalidDeviceCredentialError,
  InvalidDeviceSignatureError,
  ReceivingSourceAlreadyExistsError,
  ReceivingSourceNotFoundError,
  TestWindowExpiredError,
} from "../domain/errors.js";
import {
  canonicalizeBankName,
  canonicalizeChannels,
  hasValidSignature,
  normalizeBankIdentity,
  parseTestAlert,
} from "../domain/receiving-source-input.js";
import { MatchNewAlertUseCase } from "../../payment-attempts/application/match-payment-attempt.use-case.js";

const TEST_WINDOW_MS = 15 * 60 * 1_000;

export type CreateReceivingSourceCommand = {
  ownerId: string;
  storeId: string;
  ipa: string;
  bankName: string;
  selectedChannels: string[];
  devicePlatform: "android" | "ios";
};

export type CreatedReceivingSource = { source: ReceivingSource; deviceCredential: string; deviceSigningKey: string };

@Injectable()
export class CreateReceivingSourceUseCase {
  public constructor(
    @Inject(RECEIVING_SOURCE_REPOSITORY) private readonly sources: ReceivingSourceRepository,
    @Inject(DEVICE_CREDENTIAL_ISSUER) private readonly credentials: DeviceCredentialIssuer,
  ) {}

  public async execute(command: CreateReceivingSourceCommand): Promise<CreatedReceivingSource> {
    const credential = await this.credentials.issue();
    const source = await this.sources.create({
      ownerId: command.ownerId,
      storeId: command.storeId,
      expectedIpa: command.ipa,
      bankName: canonicalizeBankName(command.bankName),
      selectedChannels: canonicalizeChannels(command.selectedChannels),
      devicePlatform: command.devicePlatform,
      deviceCredentialHash: credential.credentialHash,
      deviceCredentialPrefix: credential.credentialPrefix,
      deviceSigningKey: credential.signingKey,
      testExpiresAt: new Date(Date.now() + TEST_WINDOW_MS),
    });
    return { source, deviceCredential: credential.credential, deviceSigningKey: credential.signingKey };
  }
}

@Injectable()
export class GetReceivingSourceUseCase {
  public constructor(@Inject(RECEIVING_SOURCE_REPOSITORY) private readonly sources: ReceivingSourceRepository) {}

  public async execute(ownerId: string, storeId: string): Promise<ReceivingSource | null> {
    return this.sources.findByOwnerAndStore(ownerId, storeId);
  }
}

@Injectable()
export class SubmitTestProofUseCase {
  public constructor(
    @Inject(RECEIVING_SOURCE_REPOSITORY) private readonly sources: ReceivingSourceRepository,
    @Inject(TEST_PROOF_OCR) private readonly ocr: TestProofOcr,
    @Inject(RECEIVING_SOURCE_PROOF_STORAGE) private readonly storage: ReceivingSourceProofStorage,
  ) {}

  public async execute(input: { ownerId: string; sourceId: string; bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<ReceivingSource> {
    const source = await this.requireOwnedStored(input.sourceId, input.ownerId);
    this.requireWithinTestWindow(source);
    const extracted = await this.ocr.extract(input);
    const storageKey = `receiving-source-test-proofs/${source.id}/${randomUUID()}`;
    await this.storage.put({ key: storageKey, body: input.bytes, contentType: input.mediaType });
    source.testProof = {
      mediaType: input.mediaType,
      storageKey,
      amountMinor: extracted.amountMinor,
      recipientMatched: includesCanonicalIpa(extracted.text, source.expectedIpa),
      indicatesSuccess: extracted.indicatesSuccess,
      receivedAt: new Date(),
    };
    evaluateAllChannels(source);
    return this.sources.save(source);
  }

  private async requireOwnedStored(sourceId: string, ownerId: string): Promise<StoredReceivingSource> {
    const source = await this.sources.findStoredById(sourceId);
    if (!source || source.ownerId !== ownerId) throw new ReceivingSourceNotFoundError();
    return source;
  }

  private requireWithinTestWindow(source: StoredReceivingSource): void {
    if (source.testExpiresAt <= new Date()) throw new TestWindowExpiredError();
  }
}

@Injectable()
export class IngestDeviceTestAlertUseCase {
  public constructor(
    @Inject(RECEIVING_SOURCE_REPOSITORY) private readonly sources: ReceivingSourceRepository,
    @Inject(DEVICE_CREDENTIAL_ISSUER) private readonly credentials: DeviceCredentialIssuer,
  ) {}

  public async execute(input: { sourceId: string; credential: string | undefined; signature: string | undefined; signedPayload: string; alert: DeviceTestAlert }): Promise<ReceivingSource> {
    const source = await this.sources.findStoredById(input.sourceId);
    if (!source || !(await this.credentials.verify(source.deviceCredentialHash, input.credential ?? ""))) {
      throw new InvalidDeviceCredentialError();
    }
    if (!hasValidSignature(input.signedPayload, source.deviceSigningKey, input.signature)) throw new InvalidDeviceSignatureError();
    if (source.testExpiresAt <= new Date()) throw new TestWindowExpiredError();
    if (!source.selectedChannels.includes(input.alert.channel)) throw new InvalidDeviceSignatureError();
    const parsed = parseTestAlert(input.alert);
    source.pendingAlerts.push(parsed);
    source.pendingAlerts = source.pendingAlerts.slice(-10);
    evaluateAllChannels(source);
    return this.sources.recordTestAlert(source, parsed);
  }
}

@Injectable()
export class IngestDeviceAlertUseCase {
  public constructor(
    @Inject(RECEIVING_SOURCE_REPOSITORY) private readonly sources: ReceivingSourceRepository,
    @Inject(DEVICE_CREDENTIAL_ISSUER) private readonly credentials: DeviceCredentialIssuer,
    private readonly matchNewAlert: MatchNewAlertUseCase,
  ) {}

  public async execute(input: { sourceId: string; credential: string | undefined; signature: string | undefined; signedPayload: string; alert: DeviceTestAlert }): Promise<void> {
    const source = await this.sources.findStoredById(input.sourceId);
    if (!source || source.status !== "active" || !(await this.credentials.verify(source.deviceCredentialHash, input.credential ?? ""))) throw new InvalidDeviceCredentialError();
    if (!hasValidSignature(input.signedPayload, source.deviceSigningKey, input.signature)) throw new InvalidDeviceSignatureError();
    if (!source.selectedChannels.includes(input.alert.channel)) throw new InvalidDeviceSignatureError();
    const alertId = await this.sources.recordLiveAlert(source, parseTestAlert(input.alert));
    await this.matchNewAlert.execute(alertId);
  }
}

function evaluateAllChannels(source: StoredReceivingSource): void {
  for (const verification of source.channelVerification) {
    const matchingAlert = source.pendingAlerts.find((alert) => alert.channel === verification.channel && isMatch(source, alert));
    if (matchingAlert) {
      verification.status = "verified";
      verification.verifiedAt = new Date();
      verification.lastFailureCode = null;
    } else if (source.testProof && source.pendingAlerts.some((alert) => alert.channel === verification.channel)) {
      verification.status = "failed";
      verification.lastFailureCode = source.testProof.amountMinor === null || !source.testProof.indicatesSuccess || !source.testProof.recipientMatched
        ? "unreadable_proof" : "proof_alert_mismatch";
    }
  }
  if (source.channelVerification.some((verification) => verification.status === "verified")) source.status = "active";
}

function isMatch(source: StoredReceivingSource, alert: ReturnType<typeof parseTestAlert>): boolean {
  const proof = source.testProof;
  if (!proof || proof.amountMinor === null || !proof.indicatesSuccess || !proof.recipientMatched) return false;
  if (!alert.indicatesCredit || alert.amountMinor === null || alert.amountMinor !== proof.amountMinor) return false;
  return sameText(normalizeBankIdentity(alert.senderIdentity), normalizeBankIdentity(source.bankName));
}

function includesCanonicalIpa(text: string, ipa: string): boolean {
  return text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, "").includes(ipa.toLocaleLowerCase("en-US").replace(/\s+/gu, ""));
}

function sameText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export { ReceivingSourceAlreadyExistsError };
