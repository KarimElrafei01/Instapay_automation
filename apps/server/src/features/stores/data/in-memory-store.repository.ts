import { randomUUID } from "node:crypto";
import { IpaAlreadyRegisteredError, StoreAlreadyExistsError } from "../domain/errors.js";
import type { CreateStoreInput, Store, StoreRepository, StoredStore } from "../domain/ports.js";

export class InMemoryStoreRepository implements StoreRepository {
  private readonly storesByOwnerId = new Map<string, StoredStore>();
  private readonly storeOwnerIdByIpa = new Map<string, string>();

  public async create(input: CreateStoreInput): Promise<Store> {
    if (this.storesByOwnerId.has(input.ownerId)) {
      throw new StoreAlreadyExistsError();
    }
    if (this.storeOwnerIdByIpa.has(input.ipa)) {
      throw new IpaAlreadyRegisteredError();
    }

    const createdAt = new Date();
    const store: StoredStore = { id: randomUUID(), ...input, createdAt, updatedAt: createdAt };
    this.storesByOwnerId.set(store.ownerId, store);
    this.storeOwnerIdByIpa.set(store.ipa, store.ownerId);
    return toStore(store);
  }

  public async findByOwnerId(ownerId: string): Promise<Store | null> {
    const store = this.storesByOwnerId.get(ownerId);
    return store ? toStore(store) : null;
  }
}

function toStore(store: StoredStore): Store {
  const {
    webhookSecret: _webhookSecret,
    integrationSecretHash: _integrationSecretHash,
    integrationSecretPrefix: _integrationSecretPrefix,
    ...publicStore
  } = store;
  return publicStore;
}
