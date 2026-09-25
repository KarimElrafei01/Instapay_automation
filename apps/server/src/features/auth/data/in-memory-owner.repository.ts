import { randomUUID } from "node:crypto";
import type { Owner, OwnerRepository } from "../domain/ports.js";

export class InMemoryOwnerRepository implements OwnerRepository {
  private readonly ownersById = new Map<string, Owner>();
  private readonly ownerIdByPhone = new Map<string, string>();

  public async findByPhoneE164(phoneE164: string): Promise<Owner | null> {
    const ownerId = this.ownerIdByPhone.get(phoneE164);
    return ownerId ? this.ownersById.get(ownerId) ?? null : null;
  }

  public async findById(id: string): Promise<Owner | null> {
    return this.ownersById.get(id) ?? null;
  }

  public async create(input: {
    phoneE164: string;
    displayName: string;
    phoneVerifiedAt: Date;
  }): Promise<Owner> {
    const owner: Owner = {
      id: randomUUID(),
      phoneE164: input.phoneE164,
      displayName: input.displayName,
      phoneVerifiedAt: input.phoneVerifiedAt,
      disabledAt: null,
      createdAt: new Date(),
    };
    this.ownersById.set(owner.id, owner);
    this.ownerIdByPhone.set(owner.phoneE164, owner.id);
    return owner;
  }
}
