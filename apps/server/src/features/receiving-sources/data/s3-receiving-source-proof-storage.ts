import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ReceivingSourceProofStorage, TestProof } from "../domain/ports.js";

export class S3ReceivingSourceProofStorage implements ReceivingSourceProofStorage {
  private readonly client: S3Client;
  public constructor(private readonly bucket = process.env.OBJECT_STORAGE_BUCKET, endpoint = process.env.OBJECT_STORAGE_ENDPOINT) {
    const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY;
    this.client = new S3Client({ region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1", forcePathStyle: Boolean(endpoint), ...(endpoint ? { endpoint } : {}), ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}) });
  }
  public async put(input: { key: string; body: Uint8Array; contentType: TestProof["mediaType"] }): Promise<void> {
    if (!this.bucket) throw new ReceivingSourceProofStorageUnavailableError();
    try { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: input.key, Body: input.body, ContentType: input.contentType, ServerSideEncryption: "AES256" })); }
    catch { throw new ReceivingSourceProofStorageUnavailableError(); }
  }
}
export class ReceivingSourceProofStorageUnavailableError extends Error {}
