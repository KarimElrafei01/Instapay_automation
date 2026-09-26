import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../shared/database/database.module.js";
import { ownerSessions } from "../../../shared/database/schema.js";
import type { OwnerSession, OwnerSessionRepository } from "../domain/ports.js";

const SESSION_LIFETIME_MS = 72 * 60 * 60 * 1_000;

@Injectable()
export class DrizzleOwnerSessionRepository implements OwnerSessionRepository {
  public constructor(@Inject(DATABASE) private readonly database: Database) {}

  public async create(ownerId: string): Promise<OwnerSession> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = expiryFromNow();
    const [session] = await this.database.insert(ownerSessions).values({
      id: randomUUID(), ownerId, tokenHash: hashToken(token), expiresAt,
    }).returning();
    if (!session) throw new Error("Session insert did not return a row.");
    return { token, ownerId: session.ownerId, expiresAt: session.expiresAt };
  }

  public async findByToken(token: string): Promise<OwnerSession | null> {
    const [session] = await this.database.select({ ownerId: ownerSessions.ownerId, expiresAt: ownerSessions.expiresAt })
      .from(ownerSessions)
      .where(and(eq(ownerSessions.tokenHash, hashToken(token)), isNull(ownerSessions.revokedAt), gt(ownerSessions.expiresAt, new Date())))
      .limit(1);
    return session ? { token, ownerId: session.ownerId, expiresAt: session.expiresAt } : null;
  }

  public async renew(token: string): Promise<OwnerSession | null> {
    const [session] = await this.database.update(ownerSessions)
      .set({ expiresAt: expiryFromNow(), lastUsedAt: sql`now()` })
      .where(and(eq(ownerSessions.tokenHash, hashToken(token)), isNull(ownerSessions.revokedAt), gt(ownerSessions.expiresAt, new Date())))
      .returning({ ownerId: ownerSessions.ownerId, expiresAt: ownerSessions.expiresAt });
    return session ? { token, ownerId: session.ownerId, expiresAt: session.expiresAt } : null;
  }

  public async revoke(token: string): Promise<void> {
    await this.database.update(ownerSessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(ownerSessions.tokenHash, hashToken(token)), isNull(ownerSessions.revokedAt)));
  }
}

function expiryFromNow(): Date {
  return new Date(Date.now() + SESSION_LIFETIME_MS);
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}
