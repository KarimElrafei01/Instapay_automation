import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import type { IssuedIntegrationSecret, StoreCredentialIssuer } from "../domain/ports.js";

export class Argon2StoreCredentialIssuer implements StoreCredentialIssuer {
  public async issue(): Promise<IssuedIntegrationSecret> {
    const token = `ipk_live_${randomBytes(32).toString("base64url")}`;
    return {
      token,
      tokenPrefix: token.slice(0, 18),
      tokenHash: await argon2.hash(token, { type: argon2.argon2id }),
      createdAt: new Date(),
    };
  }
}
