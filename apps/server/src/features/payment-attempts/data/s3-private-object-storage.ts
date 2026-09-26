import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { type ImageMediaType, type PrivateObjectStorage } from "../domain/ports.js";
export class S3PrivateObjectStorage implements PrivateObjectStorage {
  private readonly client: S3Client;
  public constructor(private readonly bucket = process.env.OBJECT_STORAGE_BUCKET, endpoint = process.env.OBJECT_STORAGE_ENDPOINT) { const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID; const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY; this.client = new S3Client({ region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1", forcePathStyle: Boolean(endpoint), ...(endpoint ? { endpoint } : {}), ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}) }); }
  public async put(input: { key: string; body: Uint8Array; contentType: ImageMediaType }): Promise<void> { if (!this.bucket) throw new ObjectStorageUnavailableError(); try { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: input.key, Body: input.body, ContentType: input.contentType, ServerSideEncryption: "AES256" })); } catch { throw new ObjectStorageUnavailableError(); } }
  public async delete(key: string): Promise<void> { if (!this.bucket) return; try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); } catch { /* lifecycle policy removes any remaining orphan */ } }
}
export class ObjectStorageUnavailableError extends Error {}
