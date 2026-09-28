export const RECEIVING_SOURCE_REPOSITORY = Symbol("RECEIVING_SOURCE_REPOSITORY");
export const DEVICE_CREDENTIAL_ISSUER = Symbol("DEVICE_CREDENTIAL_ISSUER");
export const TEST_PROOF_OCR = Symbol("TEST_PROOF_OCR");
export const RECEIVING_SOURCE_PROOF_STORAGE = Symbol("RECEIVING_SOURCE_PROOF_STORAGE");

export type ReceivingChannel = "sms" | "notification";
export type ChannelVerificationStatus = "awaiting_test" | "verified" | "failed";
export type ReceivingSourceStatus = "pending_verification" | "active" | "disabled";

export type ChannelVerification = {
  channel: ReceivingChannel;
  status: ChannelVerificationStatus;
  verifiedAt: Date | null;
  lastFailureCode: "proof_alert_mismatch" | "unreadable_proof" | "expired" | null;
};

export type TestProof = {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  storageKey: string;
  amountMinor: number | null;
  recipientMatched: boolean;
  indicatesSuccess: boolean;
  receivedAt: Date;
};

export type DeviceTestAlert = {
  eventId: string;
  channel: ReceivingChannel;
  senderIdentity: string;
  rawText: string;
  receivedAt: Date;
};

export type ParsedTestAlert = DeviceTestAlert & {
  amountMinor: number | null;
  indicatesCredit: boolean;
  payerNameNormalized: string | null;
  transactionReferenceNormalized: string | null;
};

export type ReceivingSource = {
  id: string;
  ownerId: string;
  storeId: string;
  bankName: string;
  expectedIpa: string;
  selectedChannels: ReceivingChannel[];
  channelVerification: ChannelVerification[];
  status: ReceivingSourceStatus;
  deviceId: string;
  devicePlatform: "android" | "ios";
  testExpiresAt: Date;
  testProof: TestProof | null;
  pendingAlerts: ParsedTestAlert[];
  createdAt: Date;
  updatedAt: Date;
};

export type StoredReceivingSource = ReceivingSource & {
  deviceCredentialHash: string;
  deviceCredentialPrefix: string;
  deviceSigningKey: string;
};

export type CreateReceivingSourceInput = {
  ownerId: string;
  storeId: string;
  bankName: string;
  expectedIpa: string;
  selectedChannels: ReceivingChannel[];
  devicePlatform: "android" | "ios";
  deviceCredentialHash: string;
  deviceCredentialPrefix: string;
  deviceSigningKey: string;
  testExpiresAt: Date;
};

export type IssuedDeviceCredential = {
  credential: string;
  credentialPrefix: string;
  credentialHash: string;
  signingKey: string;
};

export type OcrTestProofResult = {
  text: string;
  amountMinor: number | null;
  indicatesSuccess: boolean;
};

export interface ReceivingSourceRepository {
  create(input: CreateReceivingSourceInput): Promise<ReceivingSource>;
  findByOwnerAndStore(ownerId: string, storeId: string): Promise<ReceivingSource | null>;
  findByIdForOwner(id: string, ownerId: string): Promise<ReceivingSource | null>;
  findStoredById(id: string): Promise<StoredReceivingSource | null>;
  save(source: StoredReceivingSource): Promise<ReceivingSource>;
  recordTestAlert(source: StoredReceivingSource, alert: ParsedTestAlert): Promise<ReceivingSource>;
  recordLiveAlert(source: StoredReceivingSource, alert: ParsedTestAlert): Promise<string>;
}

export interface DeviceCredentialIssuer {
  issue(): Promise<IssuedDeviceCredential>;
  verify(hash: string, credential: string): Promise<boolean>;
}

export interface TestProofOcr {
  extract(input: { bytes: Uint8Array; mediaType: TestProof["mediaType"] }): Promise<OcrTestProofResult>;
}

export interface ReceivingSourceProofStorage {
  put(input: { key: string; body: Uint8Array; contentType: TestProof["mediaType"] }): Promise<void>;
}
