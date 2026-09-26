import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { randomBytes } from "node:crypto";
import type { DeviceCredentialIssuer, IssuedDeviceCredential } from "../domain/ports.js";

@Injectable()
export class Argon2DeviceCredentialIssuer implements DeviceCredentialIssuer {
  public async issue(): Promise<IssuedDeviceCredential> {
    const credential = `dvc_live_${randomBytes(32).toString("base64url")}`;
    return {
      credential,
      credentialPrefix: credential.slice(0, 17),
      credentialHash: await argon2.hash(credential, { type: argon2.argon2id }),
      signingKey: randomBytes(32).toString("base64url"),
    };
  }

  public async verify(hash: string, credential: string): Promise<boolean> {
    return argon2.verify(hash, credential);
  }
}
