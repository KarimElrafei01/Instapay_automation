import { randomBytes } from "node:crypto";
import type { OwnerSession, OwnerSessionRepository } from "../domain/ports.js";

export class InMemoryOwnerSessionRepository implements OwnerSessionRepository {
  private readonly sessions = new Map<string, OwnerSession>();
  private readonly expiresInMs = 24 * 60 * 60 * 1_000;

  public async create(ownerId: string): Promise<OwnerSession> {
    const session: OwnerSession = {
      token: randomBytes(32).toString("base64url"),
      ownerId,
      expiresAt: new Date(Date.now() + this.expiresInMs),
    };
    this.sessions.set(session.token, session);
    return session;
  }

  public async findByToken(token: string): Promise<OwnerSession | null> {
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }
    if (session.expiresAt <= new Date()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  public async revoke(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}
