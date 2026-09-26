import { randomUUID } from "node:crypto";
import { ReceivingSourceAlreadyExistsError } from "../domain/errors.js";
import type {
  CreateReceivingSourceInput,
  ReceivingSource,
  ReceivingSourceRepository,
  StoredReceivingSource,
} from "../domain/ports.js";

export class InMemoryReceivingSourceRepository implements ReceivingSourceRepository {
  private readonly sources = new Map<string, StoredReceivingSource>();
  private readonly sourceIdByStoreId = new Map<string, string>();

  public async create(input: CreateReceivingSourceInput): Promise<ReceivingSource> {
    if (this.sourceIdByStoreId.has(input.storeId)) throw new ReceivingSourceAlreadyExistsError();
    const now = new Date();
    const source: StoredReceivingSource = {
      id: randomUUID(),
      ...input,
      channelVerification: input.selectedChannels.map((channel) => ({
        channel, status: "awaiting_test", verifiedAt: null, lastFailureCode: null,
      })),
      status: "pending_verification",
      deviceId: randomUUID(),
      testProof: null,
      pendingAlerts: [],
      processedEventIds: new Set(),
      createdAt: now,
      updatedAt: now,
    };
    this.sources.set(source.id, cloneStored(source));
    this.sourceIdByStoreId.set(source.storeId, source.id);
    return toPublic(source);
  }

  public async findByOwnerAndStore(ownerId: string, storeId: string): Promise<ReceivingSource | null> {
    const sourceId = this.sourceIdByStoreId.get(storeId);
    const source = sourceId ? this.sources.get(sourceId) : undefined;
    return source && source.ownerId === ownerId ? toPublic(source) : null;
  }

  public async findByIdForOwner(id: string, ownerId: string): Promise<ReceivingSource | null> {
    const source = this.sources.get(id);
    return source && source.ownerId === ownerId ? toPublic(source) : null;
  }

  public async findStoredById(id: string): Promise<StoredReceivingSource | null> {
    const source = this.sources.get(id);
    return source ? cloneStored(source) : null;
  }

  public async save(source: StoredReceivingSource): Promise<ReceivingSource> {
    const current = this.sources.get(source.id);
    if (!current) throw new Error("Receiving source no longer exists.");
    const stored = cloneStored({ ...source, updatedAt: new Date() });
    this.sources.set(stored.id, stored);
    return toPublic(stored);
  }
}

function toPublic(source: StoredReceivingSource): ReceivingSource {
  const { deviceCredentialHash: _credentialHash, deviceCredentialPrefix: _credentialPrefix, deviceSigningKey: _signingKey, processedEventIds: _eventIds, ...publicSource } = source;
  return clonePublic(publicSource);
}

function clonePublic(source: ReceivingSource): ReceivingSource {
  return {
    ...source,
    selectedChannels: [...source.selectedChannels],
    channelVerification: source.channelVerification.map((item) => ({ ...item })),
    testProof: source.testProof ? { ...source.testProof, bytes: new Uint8Array(source.testProof.bytes) } : null,
    pendingAlerts: source.pendingAlerts.map((alert) => ({ ...alert })),
  };
}

function cloneStored(source: StoredReceivingSource): StoredReceivingSource {
  return { ...clonePublic(source), deviceCredentialHash: source.deviceCredentialHash, deviceCredentialPrefix: source.deviceCredentialPrefix, deviceSigningKey: source.deviceSigningKey, processedEventIds: new Set(source.processedEventIds) };
}
