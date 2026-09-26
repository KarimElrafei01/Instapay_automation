import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = 1;
const INITIALIZATION_VECTOR_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;
const ENCRYPTION_KEY_BYTES = 32;

export interface DataEncryptor {
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

export const DATA_ENCRYPTOR = Symbol("DATA_ENCRYPTOR");

export class EnvironmentAesGcmDataEncryptor implements DataEncryptor {
  private readonly key: Buffer;

  public constructor(encodedKey = process.env.DATA_ENCRYPTION_KEY_BASE64) {
    if (!encodedKey) {
      throw new Error("DATA_ENCRYPTION_KEY_BASE64 is required to start the server.");
    }

    this.key = Buffer.from(encodedKey, "base64");
    if (this.key.length !== ENCRYPTION_KEY_BYTES) {
      throw new Error("DATA_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes.");
    }
  }

  public encrypt(plaintext: string): Buffer {
    const initializationVector = randomBytes(INITIALIZATION_VECTOR_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, initializationVector);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([
      Buffer.from([ENCRYPTION_VERSION]),
      initializationVector,
      cipher.getAuthTag(),
      encrypted,
    ]);
  }

  public decrypt(ciphertext: Buffer): string {
    const minimumLength = 1 + INITIALIZATION_VECTOR_BYTES + AUTHENTICATION_TAG_BYTES;
    if (ciphertext.length < minimumLength || ciphertext[0] !== ENCRYPTION_VERSION) {
      throw new Error("Encrypted database value has an unsupported format.");
    }

    const initializationVector = ciphertext.subarray(1, 1 + INITIALIZATION_VECTOR_BYTES);
    const authenticationTag = ciphertext.subarray(1 + INITIALIZATION_VECTOR_BYTES, minimumLength);
    const encrypted = ciphertext.subarray(minimumLength);
    const decipher = createDecipheriv("aes-256-gcm", this.key, initializationVector);
    decipher.setAuthTag(authenticationTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }
}
