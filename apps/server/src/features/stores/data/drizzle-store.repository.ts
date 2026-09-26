import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATA_ENCRYPTOR, type DataEncryptor } from "../../../shared/crypto/data-encryptor.js";
import { DATABASE, type Database } from "../../../shared/database/database.module.js";
import { stores } from "../../../shared/database/schema.js";
import { IpaAlreadyRegisteredError, StoreAlreadyExistsError } from "../domain/errors.js";
import type { CreateStoreInput, Store, StoreRepository } from "../domain/ports.js";

@Injectable()
export class DrizzleStoreRepository implements StoreRepository {
  public constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DATA_ENCRYPTOR) private readonly encryptor: DataEncryptor,
  ) {}

  public async create(input: CreateStoreInput): Promise<Store> {
    try {
      const [store] = await this.database.insert(stores).values({
        id: randomUUID(),
        ...input,
        defaultWebhookUrlEncrypted: this.encryptor.encrypt(input.defaultWebhookUrl),
        webhookSecretEncrypted: this.encryptor.encrypt(input.webhookSecret),
      }).returning();
      if (!store) throw new Error("Store insert did not return a row.");
      return toStore(store, this.encryptor);
    } catch (error) {
      if (isUniqueViolation(error, "stores_owner_id_unique")) throw new StoreAlreadyExistsError();
      if (isUniqueViolation(error, "stores_ipa_unique")) throw new IpaAlreadyRegisteredError();
      throw error;
    }
  }

  public async findByOwnerId(ownerId: string): Promise<Store | null> {
    const [store] = await this.database.select().from(stores).where(eq(stores.ownerId, ownerId)).limit(1);
    return store ? toStore(store, this.encryptor) : null;
  }
}

function toStore(store: typeof stores.$inferSelect, encryptor: DataEncryptor): Store {
  return {
    id: store.id,
    ownerId: store.ownerId,
    displayName: store.displayName,
    accountHolderName: store.accountHolderName,
    ipa: store.ipa,
    matchingWindowMinutes: store.matchingWindowMinutes as Store["matchingWindowMinutes"],
    defaultWebhookUrl: encryptor.decrypt(store.defaultWebhookUrlEncrypted),
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

function isUniqueViolation(error: unknown, constraint: string): error is { code: string; constraint?: string } {
  return typeof error === "object" && error !== null && "code" in error && "constraint" in error
    && error.code === "23505" && error.constraint === constraint;
}
