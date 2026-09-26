import { Inject, Injectable } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import {
  DEVICE_CREDENTIAL_ISSUER,
  RECEIVING_SOURCE_REPOSITORY,
  TEST_PROOF_OCR,
  type DeviceCredentialIssuer,
  type DeviceTestAlert,
  type ReceivingChannel,
  type ReceivingSource,
  type ReceivingSourceRepository,
  type StoredReceivingSource,
  type TestProofOcr,
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
  ) {}

  public async execute(input: { ownerId: string; sourceId: string; bytes: Uint8Array; mediaType: "image/jpeg" | "image/png" | "image/webp" }): Promise<ReceivingSource> {
    const source = await this.requireOwnedStored(input.sourceId, input.ownerId);
    this.requireWithinTestWindow(source);
    const extracted = await this.ocr.extract(input);
    source.testProof = {
      mediaType: input.mediaType,
      bytes: input.bytes,
      extractedText: extracted.text,
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
    if (source.processedEventIds.has(input.alert.eventId)) throw new DuplicateDeviceEventError();
    source.processedEventIds.add(input.alert.eventId);
    source.pendingAlerts.push(parseTestAlert(input.alert));
    source.pendingAlerts = source.pendingAlerts.slice(-10);
    evaluateAllChannels(source);
    return this.sources.save(source);
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
