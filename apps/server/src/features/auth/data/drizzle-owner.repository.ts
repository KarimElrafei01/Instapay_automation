import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../shared/database/database.module.js";
import { owners } from "../../../shared/database/schema.js";
import { OwnerAlreadyExistsError } from "../domain/errors.js";
import type { Owner, OwnerRepository } from "../domain/ports.js";

@Injectable()
export class DrizzleOwnerRepository implements OwnerRepository {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public async findByPhoneE164(phoneE164: string): Promise<Owner | null> {
    const [owner] = await this.database.select().from(owners).where(eq(owners.phoneE164, phoneE164)).limit(1);
    return owner ? toOwner(owner) : null;
  }

  public async findById(id: string): Promise<Owner | null> {
    const [owner] = await this.database.select().from(owners).where(eq(owners.id, id)).limit(1);
    return owner ? toOwner(owner) : null;
  }

  public async create(input: { phoneE164: string; displayName: string; phoneVerifiedAt: Date }): Promise<Owner> {
    try {
      const [owner] = await this.database.insert(owners).values({ id: randomUUID(), ...input }).returning();
      if (!owner) throw new Error("Owner insert did not return a row.");
      return toOwner(owner);
    } catch (error) {
      if (isUniqueViolation(error)) throw new OwnerAlreadyExistsError();
      throw error;
    }
  }
}

function toOwner(owner: typeof owners.$inferSelect): Owner {
  if (!owner.phoneVerifiedAt) throw new Error("Persisted owner is missing phone verification.");
  return {
    id: owner.id,
    phoneE164: owner.phoneE164,
    displayName: owner.displayName,
    phoneVerifiedAt: owner.phoneVerifiedAt,
    disabledAt: owner.disabledAt,
    createdAt: owner.createdAt,
  };
}

function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
