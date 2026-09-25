# Automated InstaPay Checkout — Backend Technical Specification (MVP)

**Status:** implementation baseline  
**API version:** `v1`  
**Primary stack:** NestJS/Fastify, TypeScript (strict), PostgreSQL/Drizzle, Redis/BullMQ, S3-compatible private storage  
**Audience:** API, worker, Android/iOS automation, dashboard, checkout, and merchant-integration engineers

> **Database schema:** the concrete eight-table PostgreSQL DDL starts in [section 12.3](#database-ddl). It is the planned schema; no migration has been applied yet.

## 1. Scope and terminology

This specification defines the MVP backend for checkout and reconciliation software. It does **not** initiate a transfer, handle funds, access customer credentials, or provide official InstaPay/IPN settlement confirmation. Product-facing language is “automatically matched/approved,” never “bank confirmed,” “officially confirmed,” or “settled.”

There is one user role, `store_owner`, and one store and receiving source per owner in the MVP. The data model deliberately uses IDs rather than hard-coded singleton values so future multi-store support is additive, but the API and database enforce the MVP limits.

| Term | Meaning |
|---|---|
| Payment attempt | A server-created request to verify one merchant order for one exact EGP amount. |
| Screenshot proof | Private customer-uploaded image plus OCR/extraction evidence. Supporting evidence only. |
| Trusted alert event | A credit alert delivered by an active, verified owner-configured automation/device. |
| Decision | An immutable deterministic matching evaluation or an owner exception action. |
| Allocation | The one-to-one reservation between an alert event and an attempt. |
| Merchant | The owner’s website/server that creates attempts and receives webhooks. |

All timestamps are ISO 8601 UTC strings, such as `2026-09-24T09:13:52.104Z`. Monetary amounts are **integer EGP minor units** (`amountMinor`); EGP 125.50 is `12550`. No float is accepted or returned.

## 2. Architecture and trust boundaries

```text
Merchant server ── authenticated REST ──> API ──> PostgreSQL
Customer browser ─ public opaque token ────┘         │
    │ signed image PUT                               │ outbox
    v                                                v
Private object storage <── scanner/OCR worker <── BullMQ/Redis
                                                     │
Owner automation/device ─ device credential ─> alert gateway
                                                     │
                                                parser + matcher
                                                     │
                                      decision/audit + alert allocation
                                                     │
                                     signed webhook delivery worker ──> Merchant server
                                                     │
                         authenticated dashboard / public status stream <─┘
```

| Boundary | Authentication and rule |
|---|---|
| Owner browser ↔ API | Secure HTTP-only session cookie with CSRF protection for unsafe requests. Owner and store are derived from the session. |
| Merchant server ↔ API | Store-scoped API key, passed once as `Authorization: Bearer ipk_live_…`; the key is stored only as an Argon2id hash. |
| Platform connector ↔ platform API | Server-held OAuth/API credential for one linked merchant account; least-privilege scopes, encrypted at rest, never returned to a browser or written to logs. |
| Platform → integration webhook | Provider signature is verified against the exact raw request before JSON parsing; topic, shop/account identity, replay window, and linked connection are allowlisted. |
| Customer browser ↔ checkout | Opaque, high-entropy `checkoutToken`; it grants access to only one sanitized public attempt projection. It cannot choose amount, store, status, or decision. |
| Browser ↔ object storage | One short-lived, single-object signed PUT URL, created for a server-derived evidence key and attempt. The upload is not proof submission. |
| Automation/device ↔ alert gateway | Per-source/per-device credential plus signed request, fixed source binding, timestamp freshness, nonce replay prevention, event idempotency, and rate limits. |
| OCR/AI ↔ decision service | OCR/AI results are untrusted structured evidence. Only the deterministic matcher can automatically approve. |
| API ↔ merchant callback | HMAC-SHA-256 signed body with delivery ID and timestamp; every delivery is durable and retryable. |

## 3. Global API contract

### 3.1 Transport, headers, and versioning

All endpoints require HTTPS. JSON endpoints consume and return `application/json; charset=utf-8`; signed object uploads use an allowlisted image MIME type. Routes are prefixed with `/v1`.

| Header | Required on | Description |
|---|---|---|
| `Authorization: Bearer …` | merchant and device endpoints | Store integration secret or device credential, never a browser-supplied store ID. |
| `Cookie: ap_session=…` | owner endpoints | Secure, `HttpOnly`, `SameSite=Lax` session cookie. |
| `X-CSRF-Token` | unsafe owner cookie requests | Double-submit or synchronizer token; validated before application logic. |
| `Idempotency-Key` | create attempt and owner mutation endpoints | 16–128 visible ASCII chars; unique per authenticated actor and route for 24 hours. Same key with a different canonical body returns `409`. |
| `X-Request-Id` | optional all requests | Valid UUID supplied by caller or generated by API; returned on every response and log record. |
| `X-Device-Timestamp` / `X-Device-Nonce` / `X-Device-Signature` | device ingestion | Timestamp in UTC, unique nonce, and request HMAC described in section 8. |

Unknown JSON keys are rejected (`additionalProperties: false`). Inputs are normalized to Unicode NFC, trimmed, bounded, and validated with Zod before use. IDs use UUIDv7 internally except public IDs/tokens, which are opaque random values. API responses contain only the explicitly documented projection.

### 3.2 Envelope, pagination, and errors

Successful single-resource responses use:

```json
{ "data": { "...": "documented resource" }, "requestId": "7bb8f7a0-85b1-4e20-9cd3-5b0bffc3117c" }
```

List responses add cursor pagination:

```json
{
  "data": [{ "...": "resource" }],
  "page": { "nextCursor": "eyJjcmVhdGVkQXQiOiI…", "hasMore": true },
  "requestId": "7bb8f7a0-85b1-4e20-9cd3-5b0bffc3117c"
}
```

All failures use the following safe envelope. Diagnostics remain in redacted structured logs, not in `message`.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request could not be accepted.",
    "fields": [{ "path": "amountMinor", "code": "invalid_type" }]
  },
  "requestId": "7bb8f7a0-85b1-4e20-9cd3-5b0bffc3117c"
}
```

| Status | Code(s) | Meaning |
|---:|---|---|
| 400 | `VALIDATION_ERROR`, `MALFORMED_REQUEST` | Strict schema, canonical form, or business input check failed. |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIAL` | Missing, expired, revoked, or invalid credential. |
| 403 | `FORBIDDEN`, `CSRF_REJECTED` | Authenticated actor cannot perform the action. |
| 404 | `NOT_FOUND` | Resource is absent or not visible to this principal. |
| 409 | `IDEMPOTENCY_CONFLICT`, `INVALID_STATE`, `CONFLICT` | Re-used key with different body, invalid state transition, or competing mutation. |
| 410 | `CHECKOUT_EXPIRED`, `UPLOAD_SLOT_EXPIRED` | Public attempt/upload slot has expired. |
| 413 | `PAYLOAD_TOO_LARGE` | Body or declared object exceeds the applicable limit. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | MIME/signature does not match an allowlisted image. |
| 422 | `UNPROCESSABLE` | Valid shape but impossible in the current business state. |
| 429 | `RATE_LIMITED` | Limit response includes `Retry-After`. |
| 500 | `INTERNAL_ERROR` | Generic unexpected failure. |

### 3.3 Canonical resource shapes

`AttemptPublic` is intentionally limited and never reveals evidence, payer data, source details, or audit information.

```ts
type AttemptStatus =
  | 'awaiting_proof' | 'awaiting_bank_alert' | 'automatically_approved'
  | 'manual_verification_required' | 'ambiguous_match' | 'rejected' | 'expired';

type AttemptPublic = {
  id: string; orderReference: string; amountMinor: number; currency: 'EGP';
  status: AttemptStatus; expiresAt: string; proofUploaded: boolean;
  submittedAt: string | null; statusUpdatedAt: string;
  merchant: { displayName: string; ipa: string; accountHolderName: string; shareUrl: string; qrImageUrl: string | null };
};

type AttemptMerchant = {
  id: string; merchantOrderId: string; orderReference: string; amountMinor: number;
  currency: 'EGP'; status: AttemptStatus; checkoutUrl: string; createdAt: string;
  expiresAt: string; statusUpdatedAt: string; approvedAt: string | null;
};

type AttemptOwner = AttemptMerchant & {
  customerReference: string | null; proof: { id: string; state: string; uploadedAt: string; extracted: Record<string, unknown> | null } | null;
  exception: { reasonCode: string; openedAt: string; groupId: string | null } | null;
};
```

`status` is server-owned. The only automatic transition is performed in one transaction by the decision service:

```text
awaiting_proof → awaiting_bank_alert → automatically_approved
                         │                    (deterministic matcher only)
                         ├→ manual_verification_required
                         ├→ ambiguous_match
                         ├→ rejected                 (owner exception decision only)
                         └→ expired                  (no proof by checkout expiry)
```

An owner may resolve an exception to `automatically_approved` only as a **manual** outcome; this does not change the required automatic-transition authority. Replacing proof returns an unresolved exception or `awaiting_bank_alert` to `awaiting_proof` and revokes the prior proof from matching. A trusted alert may arrive before the customer submits proof, but the attempt remains `awaiting_proof` until a valid proof exists; an early alert is an unallocated candidate, not a payment decision.

## 4. Owner authentication and store configuration APIs

The owner flow is passwordless. Rate-limit OTP requests to 5 per IP per 15 minutes and 10 per canonical phone number per hour; rate-limit verification attempts separately and consume every successful challenge. Phone verification is required before store creation. The OTP provider owns delivery and code verification in production; the API stores only the resulting verified identity/session, never a password or OTP secret. During local development only, the development provider accepts the fixed code "0000"; it is guarded by NODE_ENV=development, retains challenges only in memory, and the server must refuse to boot with that adapter in any other environment.

The first development implementation uses in-memory owner and revocable-session repositories so it can be exercised before Neon is configured. It intentionally loses owners, challenges, and sessions when the process restarts. Before a shared environment, replace only those repository adapters with Drizzle/Neon and Redis-backed implementations; the controller, use cases, and OTP-provider port remain unchanged.

| Method and path | Auth | Request | Success response |
|---|---|---|---|
| `POST /v1/owner/auth/otp/request` | public | `{phoneNumber, purpose:"sign_up", displayName}` or `{phoneNumber, purpose:"sign_in"}` | `202 {data:{verificationId,expiresAt}}`; requests a single-use OTP. |
| `POST /v1/owner/auth/otp/verify` | public | `{verificationId, code}` | `200 {data:{owner}}` plus an HttpOnly session cookie. For `sign_up`, this creates the verified owner; for `sign_in`, it authenticates an existing verified owner. Returns generic `401` for an invalid/expired code or unavailable account. |
| `POST /v1/owner/auth/sign-out` | owner + CSRF | `{}` | `204`; revokes session. |
| `GET /v1/owner/me` | owner | none | `200 {data:{id,phoneNumber,displayName,phoneVerifiedAt,store}}`. |
| `POST /v1/owner/stores` | verified owner + CSRF | `CreateStoreRequest` | `201 {data:Store}`. A second store returns `409`. |
| `GET /v1/owner/store` | owner | none | `200 {data:Store}`. |
| `PATCH /v1/owner/store` | owner + CSRF | `UpdateStoreRequest` | `200 {data:Store}`. |
| `POST /v1/owner/store/integration-secret/rotate` | owner + CSRF | `{}` | `201 {data:{token,tokenPrefix,createdAt}}`; the single plaintext secret is returned once and any prior secret is revoked. |
| `POST /v1/owner/store/integration-secret/revoke` | owner + CSRF | `{}` | `204`; disables merchant-server API access until the owner rotates a new secret. |

```ts
type CreateStoreRequest = {
  displayName: string;                 // 1–120 Unicode scalar values
  accountHolderName: string;           // 2–160; normalized comparison value stored separately
  ipa: string;                         // canonical, allowlisted InstaPay IPA grammar
  matchingWindowMinutes?: 5 | 10 | 15 | 20 | 30; // default 15
  defaultWebhookUrl: string;           // HTTPS; no private/link-local/reserved target after DNS resolution
};
type UpdateStoreRequest = Partial<CreateStoreRequest>;
type Store = {
  id: string; displayName: string; accountHolderName: string; ipa: string;
  matchingWindowMinutes: number; defaultWebhookUrl: string;
  receivingSourceStatus: 'not_configured' | 'pending_verification' | 'active' | 'disabled';
  createdAt: string; updatedAt: string;
};
```

Changing IPA, account-holder name, matching window, or default webhook affects only newly created attempts. Each attempt snapshots the recipient and expiry parameters at creation. Changing the webhook URL rotates an encrypted signing secret and queues no replay automatically; an owner explicitly requests a replay.

## 5. Merchant integration APIs

These are called only from a merchant server. Browser code must never hold the store integration secret. The MVP supports one active, rotatable secret per store; it may create/read attempts only for its bound store.

| Method and path | Request | Success response | Rules |
|---|---|---|---|
| `POST /v1/merchant/payment-attempts` | `CreateAttemptRequest` | `201 {data:AttemptMerchant}` | Requires `Idempotency-Key`; server creates all public tokens and timestamps. |
| `GET /v1/merchant/payment-attempts/{attemptId}` | none | `200 {data:AttemptMerchant}` | Returns its bound store’s attempt only. |
| `GET /v1/merchant/payment-attempts` | `?merchantOrderId=&status=&limit=&cursor=` | paginated `AttemptMerchant[]` | `limit` 1–100, default 25. |
| `POST /v1/merchant/payment-attempts/{attemptId}/expire` | `{}` | `200 {data:AttemptMerchant}` | Only `awaiting_proof`; marks `expired`, audit records it. It cannot cancel submitted evidence. |
| `POST /v1/merchant/webhook-deliveries/{deliveryId}/replay` | `{}` | `202 {data:{deliveryId,status:'queued'}}` | Replays a prior event to the currently configured endpoint; rate limited. |

```json
// POST /v1/merchant/payment-attempts
{
  "merchantOrderId": "ORD-10492",
  "amountMinor": 12550,
  "currency": "EGP",
  "orderReference": "Order #10492",
  "customerReference": "optional checkout note",
  "webhookUrl": "https://merchant.example/payments/instapay-events",
  "expiresInMinutes": 15,
  "metadata": { "cartId": "cart_938" }
}
```

`merchantOrderId` is 1–128 characters and unique per store. `orderReference` is 1–100 printable characters and is displayed to the customer. `customerReference` is optional (max 160) and not considered payment proof. `amountMinor` is an integer 100–10,000,000. `currency` must be exactly `EGP`. `webhookUrl`, when present, overrides the snapshot default only after strict HTTPS URL/SSRF validation. `expiresInMinutes` is 5–30, defaulting to the store matching window; its value is saved to the attempt. `metadata` accepts at most 20 string values, keys 1–40 and values 1–200, for merchant correlation only; secrets and customer financial fields are rejected by allowlist.

```json
// 201
{
  "data": {
    "id": "pat_01J8Q6AZQ4R1KX2F5BFM6G7KTP",
    "merchantOrderId": "ORD-10492",
    "orderReference": "Order #10492",
    "amountMinor": 12550,
    "currency": "EGP",
    "status": "awaiting_proof",
    "checkoutUrl": "https://checkout.example/p/pct_…",
    "createdAt": "2026-09-24T09:13:52.104Z",
    "expiresAt": "2026-09-24T09:28:52.104Z",
    "statusUpdatedAt": "2026-09-24T09:13:52.104Z",
    "approvedAt": null
  },
  "requestId": "7bb8f7a0-85b1-4e20-9cd3-5b0bffc3117c"
}
```

If a matching `Idempotency-Key` and canonical body already exist, return the original `201` response with `Idempotency-Replayed: true`. Creation writes the attempt, audit record, and `payment_attempt.created` outbox event in one database transaction.

### 5.1 Platform-store integrations: Shopify first

Platform integrations are a first-class alternative to the direct merchant API, not a second payment processor. The platform owns checkout and creates an **unpaid/manual-payment** order. Our server creates the linked payment attempt, hosts the proof page, and asks the platform to mark its order paid **only after** this system records `automatically_approved`. It never initiates an InstaPay transfer, receives funds, or represents itself as an official InstaPay or platform payment gateway.

Shopify is the first connector. WooCommerce and similar stores follow the same connector contract, with a platform-specific adapter/plugin. The hosted checkout URL is exposed through a Shopify order-status/thank-you surface when supported; an order-confirmation email/SMS link is the required fallback. The flow must not depend on a customer having Shopify's newer customer-account experience.

```text
Shopify checkout creates unpaid order
  -> verified Shopify order webhook reaches the server
  -> Shopify connector creates one linked internal payment attempt
  -> customer opens this product's hosted verification page
  -> deterministic matching records automatically_approved
  -> platform-sync worker calls Shopify to mark that same external order paid
  -> retry-safe result is visible to the owner dashboard
```

| Method and path | Auth | Request / response | Rules |
|---|---|---|---|
| `POST /v1/owner/platform-connections/shopify/authorize` | owner + CSRF | `{}` → `201 {data:{authorizationUrl}}` | Creates a short-lived, single-use, owner-bound OAuth state. The browser may only navigate to the returned URL. |
| `GET /v1/integrations/shopify/oauth/callback` | OAuth callback | provider query parameters → redirect to owner UI | Validates provider signature, canonical shop domain, state/nonce, redirect binding, and granted scopes before encrypting the server-only credential. |
| `GET /v1/owner/platform-connections` | owner | none → `200 {data:PlatformConnection[]}` | Returns a safe projection: platform, shop domain/name, scopes, connection status, and timestamps. Never returns credentials or raw provider payloads. |
| `DELETE /v1/owner/platform-connections/{connectionId}` | owner + CSRF | `{}` → `204` | Revokes/disconnects the platform relationship, invalidates queued platform work, and retains existing attempt/audit history. |
| `POST /v1/integrations/shopify/webhooks/orders` | signed provider request | raw provider payload → `204` | Internal provider ingress only. It verifies the raw-body signature and deduplicates the external order before creating or updating a linked attempt. It does not accept browser traffic. |

The connector derives the store, amount, currency, and external order identity from the verified platform event/API response. No platform browser extension, customer request, or Shopify metadata may choose an attempt status, final amount, owner, recipient IPA, or decision. It uses a deterministic internal merchant order ID such as `shopify:{connectionId}:{externalOrderId}` and creates the core attempt through an application use case, not through the public merchant endpoint or a browser-held integration secret.

Each connector implements this server-only contract:

```ts
interface PlatformConnector {
  verifyInboundEvent(rawRequest: unknown): Promise<VerifiedPlatformOrderEvent>;
  getCustomerVerificationUrl(input: LinkedAttempt): Promise<string>;
  markOrderPaid(input: MarkPlatformOrderPaid): Promise<PlatformSyncResult>;
}
```

`markOrderPaid` is invoked by the `platform-sync` worker after an automatic approval and uses the external order link's stable idempotency key. It may retry transient provider failures, but it must never change a local attempt state, approve an attempt, or mark a platform order paid for an exception state. For Shopify, use the supported manual/offline order-paid operation with the minimally required order-write scope; validate the exact provider API version, scopes, and checkout-extension availability in a development store before release.

## 6. Public hosted-checkout and screenshot APIs

Public endpoints authenticate exclusively through the opaque checkout token embedded in the hosted URL. Tokens are 256-bit random, stored hashed, and never accepted in a request body. Public traffic is rate-limited per token and IP; API returns `404` for unknown tokens and `410` after expiry.

| Method and path | Request | Success response | Rules |
|---|---|---|---|
| `GET /v1/public/checkouts/{checkoutToken}` | none | `200 {data:AttemptPublic}` | Sanitized attempt projection; can be read after proof submission until expiry. |
| `POST /v1/public/checkouts/{checkoutToken}/upload-slots` | `{fileName, contentType, contentLength}` | `201 UploadSlot` | Creates a one-use staging upload authorization, maximum 2 MiB. |
| `POST /v1/public/checkouts/{checkoutToken}/proofs` | `{uploadSlotId}` | `202 {data:AttemptPublic}` | Verifies object/quarantine state and queues scanning/OCR; this submits proof. |
| `POST /v1/public/checkouts/{checkoutToken}/proofs/replace` | `{uploadSlotId, reason?}` | `202 {data:AttemptPublic}` | Allowed before expiry when current proof is unreadable or an owner requested replacement. |
| `GET /v1/public/checkouts/{checkoutToken}/events` | SSE, no body | `200 text/event-stream` | At most two concurrent streams/token; emits section 10 events. |

```json
// POST …/upload-slots
{ "fileName": "instapay-receipt.png", "contentType": "image/png", "contentLength": 734012 }

// 201
{
  "data": {
    "uploadSlotId": "upl_01J8Q6…",
    "uploadUrl": "https://private-bucket.example/…signed…",
    "objectKey": "not-for-client-use",
    "requiredHeaders": { "Content-Type": "image/png", "x-amz-server-side-encryption": "aws:kms" },
    "expiresAt": "2026-09-24T09:18:52.104Z",
    "maxBytes": 2097152
  },
  "requestId": "…"
}
```

The browser first resizes and compresses a screenshot locally, then PUTs those bytes directly to `uploadUrl`; this lowers mobile data use and the short-lived staging footprint. Client processing is an optimization only: the server never trusts it for validation. Object storage enforces the exact staging key, a `1..2 MiB` content-length range, JPEG/PNG allowlist, server-side encryption, and five-minute expiry. The staging object is private, cannot be listed or downloaded, and is deleted within one hour whether processing succeeds or fails. It is not a persisted proof: `payment_attempts` receives no proof object link or OCR data until server validation succeeds.

The server scanner verifies magic bytes and safely decodes dimensions (maximum 8,000×8,000) before marking the slot `clean`; declared MIME type alone is never trusted. A clean upload is passed to the canonicalization worker before it becomes retained evidence. The worker applies EXIF orientation, strips metadata, converts to RGB, scales the longest edge to at most 1,920 px without upscaling, and emits a progressive JPEG at quality 85. It rejects a result below the configured OCR readability threshold rather than silently degrading proof. The canonical JPEG is the only long-lived screenshot object; dimensions, input bytes, and pre-canonical metadata are not retained. The system retains only input/canonical hashes for duplicate-proof protection and audit, not a second original image. Malicious, corrupt, oversized, or unreadable files are deleted/quarantined and produce a generic public `UNPROCESSABLE` result.

Proof submission permits only `awaiting_proof` and explicit replacement paths. It transitions the attempt to `awaiting_bank_alert`, records the separate submission timestamp, schedules OCR, schedules a matcher evaluation, and emits status only after commit. If an eligible parsed alert already exists, that same evaluation may immediately allocate it and transition to `automatically_approved`; the browser must never make that decision. An upload may not select recipient, amount, status, or extracted fields.

### 6.1 Evidence storage optimization and retention policy

Evidence is supporting proof, not the trusted transaction record; the trusted configured bank alert and deterministic decision remain necessary for automatic approval. Storage policy therefore retains only what is needed to operate, resolve exceptions, and audit the decision.

| Evidence category | Retained object | Retention | Rationale |
|---|---|---:|---|
| Staging upload | Client-compressed input in isolated private staging key | At most 1 hour | Required only for scan/canonicalization; always deleted after processing. |
| Malicious/corrupt/unreadable upload | None; minimal redacted outcome/audit only | Delete immediately after incident processing | It is neither valid proof nor useful retained evidence. |
| Replaced/superseded proof | Canonical JPEG only | 7 days | Short support window without retaining multiple full-size images. |
| Automatically approved proof | Canonical JPEG only | 30 days after approval | Supports ordinary owner questions while preventing indefinite growth. |
| Rejected, ambiguous, or manual-review proof | Canonical JPEG only | 90 days after final exception decision | Higher likelihood of a legitimate review need. |
| Minimal proof match facts, object hashes, rule results, alert allocation, decision, audit | Encrypted/minimized structured data; no image required | Configured decision/audit retention period | Retains only the facts required to repeat deterministic matching after image deletion; raw OCR/provider output is discarded. |

Retention dates are calculated on the server when evidence/decision state changes; users cannot extend them through the browser. A retention worker deletes the canonical object, verifies deletion, marks the evidence `deleted`, and writes an append-only audit record. A legal hold, if introduced later, can pause this worker only through a restricted owner/support control and must itself be audited.

Metrics track `staging_bytes`, `canonical_evidence_bytes`, `compression_ratio`, `proofs_by_retention_tier`, deletion-job failures, owner-download egress, and storage bytes per store. Alert at 80% of the assigned pilot quota and flag unusually frequent proof replacement; neither condition automatically rejects a valid payment.

## 7. Receiving-source and automation device setup APIs

The system supports owner-configured Android and iOS Shortcut automations in MVP. A source is trusted only after a successfully parsed, owner-confirmed test event. Device credentials cannot call owner, merchant, proof, decision, or webhook endpoints.

| Method and path | Auth | Request | Success response |
|---|---|---|---|
| `POST /v1/owner/receiving-source` | owner + CSRF | `CreateSourceRequest` | `201 {data:ReceivingSource}`; creates `pending_verification`. A second source returns `409`. |
| `GET /v1/owner/receiving-source` | owner | none | `200 {data:ReceivingSource}`. |
| `PATCH /v1/owner/receiving-source` | owner + CSRF | `{bankCode,accountLabel,maskedAccountSuffix?,inputKind,allowedIdentity}` | `200 {data:ReceivingSource}`; changing filter returns source to `pending_verification`. |
| `POST /v1/owner/receiving-source/devices` | owner + CSRF | `{platform,displayName}` | `201 {data:DeviceProvisioning}`; credential shown once. |
| `POST /v1/owner/receiving-source/test-events` | owner + CSRF | `{deviceId}` | `201 {data:{testEventId,expiresAt}}`; opens one 10-minute test window. |
| `POST /v1/owner/receiving-source/test-events/{testEventId}/confirm` | owner + CSRF | `{}` | `200 {data:ReceivingSource}`; activates only a parsed eligible test. |
| `POST /v1/owner/receiving-source/devices/{deviceId}/revoke` | owner + CSRF | `{}` | `204`; invalidates device credential/replay state immediately. |
| `POST /v1/owner/receiving-source/disable` | owner + CSRF | `{}` | `204`; disables source and revokes every device. |

```ts
type CreateSourceRequest = {
  bankCode: 'CIB' | 'NBE' | 'BANQUE_MISR' | 'QNB' | 'OTHER_SUPPORTED';
  accountLabel: string;                    // 1–80, owner-facing only
  maskedAccountSuffix?: string;            // exactly 2–4 ASCII digits, never full number
  inputKind: 'sms' | 'notification';
  allowedIdentity: string;                 // sender ID or package name, compared canonically
};
type ReceivingSource = {
  id: string; bankCode: string; accountLabel: string; maskedAccountSuffix: string | null;
  inputKind: 'sms' | 'notification'; allowedIdentity: string;
  status: 'pending_verification' | 'active' | 'disabled'; verifiedAt: string | null;
  createdAt: string; updatedAt: string;
};
type DeviceProvisioning = {
  id: string; platform: 'android_automation' | 'ios_shortcuts'; displayName: string;
  credential: string; credentialPrefix: string; signingKey: string; issuedAt: string;
  gatewayUrl: 'https://api.example/v1/device/alert-events';
};
```

`credential` and `signingKey` are shown once. The credential identifies the device; the signing key is used only to calculate the per-request HMAC and is stored encrypted/hashed according to its use. Setup guidance instructs the owner to automate only their configured sender/app and to forward events directly, never copied or manually typed messages. The `OTHER_SUPPORTED` option is acceptable only when a parser template exists; arbitrary templates are Iteration 2.

## 8. Device alert-ingestion API

`POST /v1/device/alert-events` accepts a device-originated bank alert. Request body max is 16 KiB. Limit is 30/minute/device, 120/hour/source, with a stricter burst bucket. It must receive an immutable automation-generated event payload; this API never accepts an owner/browser “bank SMS” submission.

```http
POST /v1/device/alert-events
Authorization: Bearer idc_live_…
X-Device-Timestamp: 2026-09-24T09:15:04Z
X-Device-Nonce: 1d2a4f81-60f3-4b7a-96b0-e94ae7fc5bbf
X-Device-Signature: v1=base64url(HMAC-SHA-256(signingKey, timestamp + "\n" + nonce + "\n" + SHA-256(rawBody)))
Content-Type: application/json
```

```json
{
  "eventId": "7f2dc149-2713-4df9-ae12-3666edaf93fb",
  "sourceId": "src_01J8Q5…",
  "deviceId": "dev_01J8Q5…",
  "inputKind": "sms",
  "senderOrAppIdentity": "CIB",
  "receivedAt": "2026-09-24T09:14:37Z",
  "rawAlertText": "…original alert text…"
}
```

For a platform able to supply trustworthy normalized fields, it may send **either** `rawAlertText` or `normalized` (not both):

```json
{
  "eventId": "7f2dc149-2713-4df9-ae12-3666edaf93fb",
  "sourceId": "src_01J8Q5…",
  "deviceId": "dev_01J8Q5…",
  "inputKind": "notification",
  "senderOrAppIdentity": "com.bank.example",
  "receivedAt": "2026-09-24T09:14:37Z",
  "normalized": {
    "direction": "credit",
    "amountMinor": 12550,
    "currency": "EGP",
    "alertOccurredAt": "2026-09-24T09:14:31Z",
    "payerName": "Ahmed Ali",
    "accountSuffix": "1234",
    "transactionReference": "TXN-123"
  }
}
```

The source and device IDs must exactly match the authenticated credential’s active source/device binding. `senderOrAppIdentity` must equal the configured canonical identity. `receivedAt` must be within five minutes of server receipt; a future time beyond 60 seconds is rejected. `alertOccurredAt`, when supplied, must be within 24 hours of receipt. The event ID is an UUID and unique for the device; nonce is stored for ten minutes. The raw body hash is stored for idempotency, not logged.

| Result | Response |
|---|---|
| Newly accepted | `202 {data:{eventId,accepted:true,processingState:'queued'}}` |
| Exact idempotent replay | `200 {data:{eventId,accepted:true,processingState:'queued'|'parsed'|'exception'}}` with `Idempotency-Replayed: true` |
| Same event ID/different hash, stale, wrong source/device/identity, invalid signature/nonce, or revoked credential | generic `401`, `403`, `409`, or `422` as applicable; audit/log reason but do not disclose source configuration. |

The gateway encrypts raw alert text at rest, creates `alert_event.received`, and queues parsing in one transaction/outbox write. It logs only event/source/device IDs, payload byte count, parser outcome, and correlation IDs. Retain raw text for 30 days by default, then cryptographically delete it; retain a minimal redacted evidence digest and audit trail as configured.

## 9. Owner dashboard, exception, and audit APIs

| Method and path | Request | Success response | Rules |
|---|---|---|---|
| `GET /v1/owner/payment-attempts` | `?status=&from=&to=&limit=&cursor=` | paginated `AttemptOwner[]` | All rows store-scoped from session. |
| `GET /v1/owner/payment-attempts/{attemptId}` | none | `200 {data:AttemptOwner}` | Includes sanitized evidence/exception summary. |
| `GET /v1/owner/payment-attempts/{attemptId}/proof/download-url` | none | `200 {data:{url,expiresAt}}` | 60-second signed **GET**, owner/audit logged; only the attempt's active proof is accessible. |
| `POST /v1/owner/payment-attempts/{attemptId}/actions` | `OwnerActionRequest` | `200 {data:AttemptOwner}` | Resolves an exception in a serialized transaction. |
| `GET /v1/owner/payment-attempts/{attemptId}/audit` | `?limit=&cursor=` | paginated `AuditRecord[]` | Append-only projection; raw SMS/screenshots absent. |
| `GET /v1/owner/dashboard/metrics` | `?from=&to=` | `200 {data:DashboardMetrics}` | Pilot metrics and alert-delay percentiles. |
| `GET /v1/owner/events` | SSE, no body | `200 text/event-stream` | Owner-store dashboard updates; see section 10. |

```ts
type OwnerActionRequest =
  | { action: 'approve'; reasonCode: 'OWNER_VERIFIED'; note?: string }
  | { action: 'reject'; reasonCode: 'PROOF_INVALID' | 'PAYMENT_NOT_FOUND' | 'DUPLICATE_PROOF' | 'OTHER'; note?: string }
  | { action: 'request_proof_replacement'; reasonCode: 'UNREADABLE' | 'MISMATCH' | 'INCOMPLETE'; note?: string }
  | { action: 'reopen'; reasonCode: 'NEW_EVIDENCE'; note?: string };
```

`note` is 1–500 characters, encrypted at rest, never included in merchant/public projections, and redacted from standard logs. Valid action/state combinations are:

| Current state | Allowed owner actions | Result |
|---|---|---|
| `manual_verification_required`, `ambiguous_match` | `approve`, `reject`, `request_proof_replacement` | manual approved, rejected, or awaiting proof. |
| `rejected` | `reopen` | `awaiting_bank_alert` if valid proof exists, otherwise `awaiting_proof`. |
| `expired` | `reopen` | a **new** attempt should normally be created; re-open only within retention policy and with a new controlled expiry. |
| `automatically_approved` | none | Immutable financial outcome; contact support/incident workflow outside MVP for correction. |

Every owner action locks the attempt row (`SELECT … FOR UPDATE`), validates the transition, writes a decision and audit record, emits the outbox event, then commits. Manual approval allocates no alert unless the owner explicitly selects one in an internal support-only workflow (not MVP). It still sends `payment_attempt.approved` with `approvalMode: "manual"` so a merchant treats it as a deliberate business decision.

## 10. Real-time events and delivery contracts

Real-time updates are emitted only after the producing PostgreSQL transaction commits. An outbox relay publishes them to Redis and SSE fan-out; loss of a browser connection never changes payment processing. Clients use `Last-Event-ID` for up to 10 minutes of replay, then refetch REST state. SSE heartbeats are comments every 20 seconds.

### 10.1 SSE envelope and public events

```text
id: evt_01J8Q…
event: checkout.status_changed
data: {"eventId":"evt_01J8Q…","occurredAt":"2026-09-24T09:16:02.000Z","data":{"attemptId":"pat_…","status":"awaiting_bank_alert","statusUpdatedAt":"…"}}

```

| SSE endpoint | Event name | `data` payload | Emitted when |
|---|---|---|---|
| public checkout | `checkout.status_changed` | `{attemptId,status,statusUpdatedAt,expiresAt}` | attempt state changes. |
| public checkout | `checkout.proof_processing` | `{attemptId,state:'uploaded'|'scanning'|'extracting'|'needs_replacement'}` | upload pipeline visibly advances. |
| public checkout | `checkout.expires_soon` | `{attemptId,expiresAt}` | 2 minutes before expiry if still unresolved. |
| public checkout | `checkout.closed` | `{attemptId,status}` | final/exception state becomes public. |
| owner dashboard | `attempt.created` | `{attemptId,status,amountMinor,createdAt}` | merchant creates attempt. |
| owner dashboard | `attempt.updated` | `{attemptId,status,statusUpdatedAt,reasonCode?}` | any state/evidence/exception update. |
| owner dashboard | `source.updated` | `{sourceId,status,updatedAt}` | source/device status changes. |
| owner dashboard | `webhook.delivery_updated` | `{deliveryId,attemptId,status,attemptCount,nextAttemptAt?}` | merchant callback delivery changes. |
| owner dashboard | `platform_order.sync_updated` | `{attemptId,platform,externalOrderReference?,status,attemptCount,nextAttemptAt?}` | a linked platform order is queued, marked paid, or needs attention. |

SSE does not expose screenshot URLs, raw OCR text, raw alert text, credentials, payer name, transaction reference, or internal rule diagnostics. The dashboard retrieves permitted detail through authenticated REST endpoints.

### 10.2 Internal durable domain events

All rows below are stored in `outbox_events` before publish. Consumers deduplicate by `eventId` and record their own processed-event marker in the same transaction as their side effect.

| Event | Producer | Consumers | Required payload |
|---|---|---|---|
| `payment_attempt.created` | attempt service | dashboard fan-out, expiry scheduler | `attemptId,storeId,expiresAt` |
| `proof.uploaded` | proof service | scanner | `attemptId,proofRevision,stagingObjectKey` |
| `proof.scanned` | scanner | canonicalization queue or exception service | `attemptId,proofRevision,scanState` |
| `proof.canonicalized` | canonicalization worker | OCR queue, storage metrics | `attemptId,proofRevision,canonicalObjectKey,transformVersion,compressionRatio` |
| `proof.extracted` | OCR/extraction worker | matcher | `attemptId,proofRevision,extractionVersion` |
| `alert_event.received` | device gateway | parser | `alertEventId,sourceId,isTest` |
| `alert_event.parsed` | parser | matcher/source verifier | `alertEventId,parseState,direction,amountMinor` |
| `matching.requested` | proof/parser/expiry services | matcher | `attemptId? ,alertEventId? ,reason` |
| `decision.recorded` | decision service | dashboard/webhook/metrics | `decisionId,attemptId,outcome,approvalMode` |
| `payment_attempt.status_changed` | state-transition service | SSE, webhook, metrics | `attemptId,previousStatus,status,reasonCode` |
| `platform_order.sync_requested` | decision service | platform-sync worker | `platformOrderLinkId,attemptId` |
| `platform_order.sync_updated` | platform-sync worker | owner SSE, metrics | `platformOrderLinkId,attemptId,status,attemptCount` |
| `webhook.delivery_requested` | decision service | delivery worker | `deliveryId,attemptId,eventType` |
| `webhook.delivery_updated` | delivery worker | owner SSE, metrics | `deliveryId,status,attemptCount` |
| `attempt.expired` | expiry scheduler | decision/owner SSE | `attemptId` |

### 10.3 Merchant webhook

The merchant configures one HTTPS endpoint per attempt snapshot. Before accepting a URL, DNS is resolved and each connection redirect is prohibited; private, loopback, link-local, multicast, and reserved address ranges are blocked. The worker uses a pinned DNS result per delivery, connection/read timeouts (3s/10s), response body cap 16 KiB, and no redirect following.

```http
POST https://merchant.example/payments/instapay-events
Content-Type: application/json
User-Agent: Automated-InstaPay-Checkout/1.0
X-Checkout-Delivery-Id: whd_01J8Q…
X-Checkout-Timestamp: 2026-09-24T09:16:02Z
X-Checkout-Signature: v1=base64url(HMAC-SHA-256(webhookSecret, timestamp + "." + rawBody))
```

```json
{
  "id": "whd_01J8Q…",
  "type": "payment_attempt.approved",
  "occurredAt": "2026-09-24T09:16:02Z",
  "data": {
    "paymentAttemptId": "pat_01J8Q6AZQ4R1KX2F5BFM6G7KTP",
    "merchantOrderId": "ORD-10492",
    "amountMinor": 12550,
    "currency": "EGP",
    "status": "automatically_approved",
    "approvalMode": "automatic",
    "approvedAt": "2026-09-24T09:16:02Z"
  }
}
```

| Webhook type | Condition | `data` additions |
|---|---|---|
| `payment_attempt.approved` | automatic or manual approval | `approvalMode: 'automatic'|'manual'`, `approvedAt`. |
| `payment_attempt.manual_verification_required` | matching window expires without a usable trusted alert | `reasonCode`. |
| `payment_attempt.ambiguous_match` | candidates cannot be uniquely distinguished | `reasonCode: 'MULTIPLE_ELIGIBLE_ATTEMPTS'`. |
| `payment_attempt.rejected` | owner rejects exception | `reasonCode`, never owner note/evidence. |
| `payment_attempt.expired` | no proof by expiry or merchant early-expiry | `reasonCode`. |

The delivery ID is the merchant’s idempotency key. Recipients must reject stale timestamps (recommended ±5 minutes) and verify the raw body signature before JSON parsing. A `2xx` ends delivery. Network errors, `408`, `429`, and `5xx` retry with jittered exponential backoff at approximately 1 min, 5 min, 15 min, 1 h, 6 h, 24 h, and 48 h; then the delivery is `failed` and the owner sees it. Other `4xx` are terminal failures except `429`. Each attempt has a durable immutable body snapshot; retries do not regenerate payloads.

## 11. Deterministic matching and state ownership

No API, browser, OCR provider, device request, or merchant webhook can set a payment state directly. Workers invoke a private `MatchingDecisionService.evaluate(candidate)` only after evidence parsing; it is not exposed over HTTP.

### 11.1 Event-order independent flow

Screenshot proof and trusted bank alerts are independent, asynchronous inputs. The system does not require either input to arrive first.

```text
Alert first: alert received -> parsed -> unallocated candidate -> proof validated -> matcher evaluates both
Proof first: proof validated -> awaiting_bank_alert -> alert received/parsed -> matcher evaluates both
```

- Alert ingestion always persists and parses an eligible trusted alert immediately. If no active, valid proof can yet qualify, `alert_events.matched_attempt_id` remains `NULL`; it is not reserved merely because another open attempt has the same amount.
- A valid proof always triggers matching against previously parsed, still-unallocated alerts. A newly parsed alert always triggers matching against submitted-proof attempts. Both paths call the same private matching use case.
- An alert is eligible only when it occurred/was received after the server-created attempt and inside that attempt's immutable matching window. Screenshot submission time is recorded separately and is never used to reject an otherwise in-window alert.
- When two or more attempts could use an early same-amount alert, do not allocate it. Wait for proof facts that uniquely distinguish a pair; if ambiguity remains once evidence is available, transition the competing attempts to `ambiguous_match`.
- At checkout expiry, an attempt without proof becomes `expired` even if an unallocated alert exists. A submitted valid proof without a qualifying alert becomes `manual_verification_required` at matching-window expiry.

### 11.2 Evaluation sequence

1. Lock the candidate alert and eligible attempts using transaction-level row locks and an advisory lock keyed by source plus amount plus matching time bucket.
2. Discard expired, allocated, non-credit, unparseable, wrong-source, wrong-amount, and non-window candidates.
3. Require the active screenshot evidence to be scan-clean, readable, success-indicating, exact-amount matching, and recipient matching the immutable attempt recipient snapshot.
4. Require alert exact amount, active verified source, and `receivedAt` inside the attempt’s immutable matching window. Persist screenshot claimed time and alert receipt/occurred time independently; do not overwrite either.
5. Where present on both sides, require normalized payer-name agreement and/or transaction-reference agreement. A conflict is blocking; missing optional values do not invent agreement.
6. Evaluate candidates. If exactly one qualifying attempt exists, atomically set the attempt/alert cross-references, record the immutable rule evaluation in `audit_records`, and transition status to `automatically_approved`. Add an outbox row once asynchronous workers are introduced.
7. If more than one qualifying attempt remains, set the competing attempts to `ambiguous_match`, record the candidate IDs/rule results in `audit_records`, and do not allocate the alert.
8. If an alert is absent at matching-window expiry, transition submitted proof to `manual_verification_required`. If proof was never submitted by checkout expiry, transition to `expired`.

The allocation table has a unique `alert_event_id`; this database constraint, rather than best-effort application code, prevents one alert approving two orders. A unique automatic decision constraint per attempt prevents duplicate workers from approving it twice. Any unique-conflict is treated as a retry/read-state condition, never as an alternate allocation.

### 11.3 Rule result vocabulary

Each decision stores every evaluated rule with `pass`, `fail`, `not_applicable`, or `not_available`; an automatic approval requires zero `fail` values and no configured blocking risk flag.

| Rule code | Automatic decision condition |
|---|---|
| `proof.present` | One active proof exists. |
| `proof.scan_clean` | Malware/content validation completed cleanly. |
| `proof.readable` | OCR/extraction reaches configured readable threshold or manual parser confirms structure. |
| `proof.transfer_success` | Screenshot shows a completed/successful transfer. |
| `proof.amount_exact` | Extracted screenshot amount equals server-owned `amountMinor`. |
| `proof.recipient_match` | Recipient IPA/account-holder match meets deterministic normalized comparison policy. |
| `alert.source_active` | Alert source was active and verified when received. |
| `alert.credit` | Parsed direction is credit. |
| `alert.amount_exact` | Parsed trusted-event amount equals `amountMinor`. |
| `alert.within_window` | Alert receipt time is inside attempt window. |
| `alert.unallocated` | Alert has no allocation. |
| `candidate.unique` | Exactly one eligible attempt remains. |
| `identity.consistent` | Shared payer name/reference agrees when available; conflict fails. |
| `risk.no_blocking_flag` | No flagged reuse, conflict, source, timing, or integrity condition blocks approval. |

## 12. PostgreSQL schema

Use PostgreSQL 16+, UTC `timestamptz`, `uuid`, `citext` only where appropriate, and `jsonb` only for versioned extraction/rule detail—not for relational ownership or allocations. All tables have `created_at timestamptz not null default now()` unless stated. Drizzle migrations must explicitly create every constraint, index, enum, and trigger listed here.

### 12.1 Enums

```sql
create type attempt_status as enum (
  'awaiting_proof','awaiting_bank_alert','automatically_approved',
  'manual_verification_required','ambiguous_match','rejected','expired'
);
create type source_status as enum ('pending_verification','active','disabled');
create type device_platform as enum ('android_automation','ios_shortcuts');
create type evidence_state as enum ('upload_pending','uploaded','scanning','clean','canonicalizing','malicious','corrupt','extracting','extracted','unreadable','superseded','deleted');
create type alert_parse_state as enum ('queued','parsed','unparseable','rejected');
create type platform_kind as enum ('shopify','woocommerce');
create type platform_connection_status as enum ('active','disconnected','revoked','scope_invalid');
create type platform_order_sync_status as enum ('pending','syncing','marked_paid','retry_scheduled','failed','not_eligible');
```

### 12.2 Lean MVP schema

Do not create the earlier long table list up front. The MVP begins with eight tables: six core reconciliation tables plus two required platform-integration tables. The screenshot is one group of fields on `payment_attempts`, not a separate entity; the direct-merchant credential is one field on `stores`, not a multi-key table; the active source has one registered automation/device; and audit records contain the deterministic decision rather than requiring a separate decision, allocation, or ambiguity table.

| Table | Essential columns | Essential constraints |
|---|---|---|
| `owners` | `id`; `phone_e164`; `display_name`; `phone_verified_at`; `created_at` | unique canonical E.164 phone number. Passwords and OTP codes are not stored. A signed secure cookie is sufficient for the first owner session implementation; add a session table only when per-session revocation is needed. |
| `stores` | `id`; `owner_id`; canonical public `account_holder_name` and `ipa`; `matching_window_minutes`; webhook URL/secret; `integration_secret_hash`; `integration_secret_prefix`; `integration_secret_rotated_at`; `integration_secret_last_used_at` | unique `owner_id` (one store) and `ipa`. Recipient details are displayed on the hosted payment page, so they are canonical plain values, not hashes or encrypted duplicates. The one active direct-merchant secret is stored only as a hash. |
| `platform_connections` | `id`; `store_id`; `platform`; canonical external account/shop identity; encrypted server-only credential; granted scopes; provider API version; connection state/timestamps | unique `(store_id, platform)` and `(platform, external_account_id)`. The one encrypted credential is necessary to call the platform API; it is never a customer-facing payment credential. |
| `payment_attempts` | `id`; `store_id`; `merchant_order_id`; `order_reference`; `amount_minor`; `currency`; `status`; `checkout_token_hash`; canonical recipient/webhook snapshots; one proof object key/revision/hash/state/minimal encrypted match facts/retention date; `expires_at`; `proof_submitted_at`; `approved_at`; `version` | unique `(store_id, merchant_order_id)`, `checkout_token_hash`, active canonical proof object key, and canonical proof hash. Replacement overwrites the proof fields only after server validation and writes an audit record. Raw OCR output, image dimensions, and confidence payloads are not persisted. |
| `platform_order_links` | `id`; `platform_connection_id`; `payment_attempt_id`; external order ID/reference; platform-sync state; stable idempotency key; retry/result timestamps | unique external order per connection and one link per attempt. It makes mark-paid retries durable without putting a Shopify-specific column in the core attempt table. |
| `receiving_sources` | `id`; `store_id`; bank/filter configuration; source status; one `device_id`; device credential hash/prefix; encrypted signing key; verification/test timestamps; `last_seen_at`; `revoked_at` | unique `store_id` (one source); source and its one registered automation are enabled/revoked together. |
| `alert_events` | `id`; `source_id`; `external_event_id`; source identity; receipt/occurred timestamps; encrypted raw text; parsed direction/amount/payer/reference; parse state; `matched_attempt_id null`; raw deletion date | unique `(source_id, external_event_id)` and unique non-null `matched_attempt_id`; this is both replay/idempotency protection and the one-alert/one-attempt allocation constraint. |
| `audit_records` | `id`; `store_id`; `attempt_id null`; `alert_event_id null`; actor type/ID; action; outcome; reason code; evaluated rules JSON; proof revision/hash; request ID; created time | append-only; no raw proof/SMS or credential values. It is the immutable automatic/manual decision history required from the first match. |

Objects remain in private storage, not PostgreSQL. At store configuration time, the server canonicalizes `account_holder_name` and `ipa` once and stores those public recipient values directly because the hosted checkout displays them. It never logs them in full. `payment_attempts` snapshots those same canonical values and stores only an encrypted, compact proof-match subset (`successful`, amount, recipient match value, claimed time, and payer/reference when available) needed by the deterministic matcher; raw OCR provider output, layout data, confidence payloads, dimensions, and image metadata are discarded. `alert_events` holds raw text encrypted only for its short retention period; it is never logged.

<a id="database-ddl"></a>

### 12.3 Concrete PostgreSQL DDL — MVP migrations

This is the concrete target DDL for the eight MVP tables. Deliver it as four small Drizzle migrations—identity/store, platform connections, attempts/source/alert, then audit—not as one unreviewable migration. `bytea` columns hold application-encrypted values; object bytes remain in private object storage.

```sql
create extension if not exists citext;

create table owners (
  id uuid primary key,
  phone_e164 varchar(16) not null unique check (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  display_name varchar(120) not null,
  phone_verified_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table stores (
  id uuid primary key,
  owner_id uuid not null unique references owners(id) on delete restrict,
  display_name varchar(120) not null,
  account_holder_name varchar(160) not null,
  ipa varchar(160) not null unique,
  matching_window_minutes smallint not null default 15
    check (matching_window_minutes in (5, 10, 15, 20, 30)),
  default_webhook_url_encrypted bytea not null,
  webhook_secret_encrypted bytea not null,
  integration_secret_hash text not null,
  integration_secret_prefix varchar(18) not null unique,
  integration_secret_rotated_at timestamptz not null default now(),
  integration_secret_last_used_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform_connections (
  id uuid primary key,
  store_id uuid not null references stores(id) on delete restrict,
  platform platform_kind not null,
  external_account_id varchar(255) not null,
  external_account_domain citext,
  credential_encrypted bytea not null,
  granted_scopes text[] not null default '{}',
  provider_api_version varchar(40) not null,
  status platform_connection_status not null default 'active',
  credential_expires_at timestamptz,
  credentials_updated_at timestamptz not null default now(),
  disconnected_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, platform),
  unique (platform, external_account_id)
);
create unique index platform_connections_shopify_domain_idx
  on platform_connections (external_account_domain)
  where platform = 'shopify' and external_account_domain is not null;

create table payment_attempts (
  id uuid primary key,
  public_id varchar(40) not null unique,
  store_id uuid not null references stores(id) on delete restrict,
  merchant_order_id varchar(128) not null,
  order_reference varchar(100) not null,
  customer_reference_encrypted bytea,
  amount_minor integer not null check (amount_minor between 100 and 10000000),
  currency char(3) not null default 'EGP' check (currency = 'EGP'),
  status attempt_status not null default 'awaiting_proof',
  checkout_token_hash bytea not null unique,
  recipient_ipa_snapshot varchar(160) not null,
  account_holder_name_snapshot varchar(160) not null,
  webhook_url_snapshot_encrypted bytea not null,
  matching_window_minutes_snapshot smallint not null,
  proof_submitted_at timestamptz,
  proof_revision uuid,
  proof_storage_key varchar(512) unique,
  proof_input_sha256 bytea,
  proof_canonical_sha256 bytea unique,
  proof_state evidence_state not null default 'upload_pending',
  proof_match_facts_encrypted bytea,
  proof_retention_delete_at timestamptz,
  expires_at timestamptz not null,
  status_updated_at timestamptz not null default now(),
  approved_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, merchant_order_id),
  check (expires_at > created_at)
);
create index payment_attempts_store_status_created_idx
  on payment_attempts (store_id, status, created_at desc);
create index payment_attempts_match_candidates_idx
  on payment_attempts (store_id, amount_minor, status, expires_at);
create index payment_attempts_proof_retention_delete_idx
  on payment_attempts (proof_retention_delete_at)
  where proof_state <> 'deleted' and proof_retention_delete_at is not null;

create table platform_order_links (
  id uuid primary key,
  platform_connection_id uuid not null references platform_connections(id) on delete restrict,
  payment_attempt_id uuid not null unique references payment_attempts(id) on delete restrict,
  external_order_id varchar(255) not null,
  external_order_reference varchar(255),
  sync_status platform_order_sync_status not null default 'pending',
  mark_paid_idempotency_key uuid not null unique,
  sync_attempt_count smallint not null default 0 check (sync_attempt_count >= 0),
  last_error_code varchar(80),
  last_sync_attempt_at timestamptz,
  marked_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_connection_id, external_order_id)
);
create index platform_order_links_pending_sync_idx
  on platform_order_links (sync_status, created_at)
  where sync_status in ('pending', 'retry_scheduled');

create table receiving_sources (
  id uuid primary key,
  store_id uuid not null unique references stores(id) on delete restrict,
  bank_code varchar(40) not null,
  account_label_encrypted bytea not null,
  masked_account_suffix_encrypted bytea,
  input_kind varchar(20) not null check (input_kind in ('sms', 'notification')),
  allowed_identity_normalized varchar(200) not null,
  status source_status not null default 'pending_verification',
  device_id uuid not null unique,
  device_platform device_platform not null,
  device_credential_hash text not null,
  device_credential_prefix varchar(18) not null unique,
  device_signing_key_encrypted bytea not null,
  test_expires_at timestamptz,
  test_alert_event_id uuid,
  verified_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table alert_events (
  id uuid primary key,
  source_id uuid not null references receiving_sources(id) on delete restrict,
  external_event_id uuid not null,
  sender_or_app_identity_normalized varchar(200) not null,
  received_at timestamptz not null,
  alert_occurred_at timestamptz,
  raw_text_encrypted bytea,
  payload_hash bytea not null,
  parse_state alert_parse_state not null default 'queued',
  direction varchar(10),
  amount_minor integer,
  currency char(3) check (currency is null or currency = 'EGP'),
  payer_name_encrypted bytea,
  payer_name_normalized varchar(200),
  account_suffix_encrypted bytea,
  transaction_reference_encrypted bytea,
  transaction_reference_normalized varchar(200),
  parser_name varchar(80),
  parser_version varchar(40),
  parser_confidence numeric(5,4),
  is_test boolean not null default false,
  matched_attempt_id uuid references payment_attempts(id) on delete restrict,
  raw_delete_at timestamptz not null,
  parsed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source_id, external_event_id)
);
create unique index alert_events_one_attempt_allocation_idx
  on alert_events (matched_attempt_id) where matched_attempt_id is not null;
create index alert_events_match_candidates_idx
  on alert_events (source_id, amount_minor, received_at desc)
  where parse_state = 'parsed';

create table audit_records (
  id bigint generated always as identity primary key,
  store_id uuid not null references stores(id) on delete restrict,
  attempt_id uuid references payment_attempts(id) on delete restrict,
  alert_event_id uuid references alert_events(id) on delete restrict,
  actor_type varchar(20) not null check (actor_type in ('system', 'owner', 'merchant', 'device', 'platform')),
  actor_owner_id uuid references owners(id) on delete restrict,
  action varchar(80) not null,
  outcome varchar(80) not null,
  reason_code varchar(80),
  rule_results jsonb not null default '{}'::jsonb,
  proof_revision uuid,
  proof_canonical_sha256 bytea,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_records_attempt_created_idx on audit_records (attempt_id, created_at);
create index audit_records_store_created_idx on audit_records (store_id, created_at);
```

### 12.4 Add only when the feature needs it

| Later feature | Add one focused table | Why it cannot safely be an in-memory field |
|---|---|---|
| First signed merchant callback | `webhook_deliveries` | Callback retries and delivery IDs must survive process restarts. |
| First background proof/parser/matching worker | `outbox_events` | A committed approval must not lose its queued work if Redis/BullMQ is unavailable at commit time. |
| Multiple active devices, sessions, or integration secrets | `source_devices`, `owner_sessions`, or `integration_secrets` | Split only when the MVP’s one-device/one-secret assumptions no longer hold. |
| Ambiguity-review grouping or historical OCR versions | dedicated group/extraction tables | Add when the owner UI or data-retention policy truly needs those independent records. |

### 12.5 Non-negotiable invariants

- Generate UUIDv7 IDs in the application; use `timestamptz` in UTC and integer EGP minor units. Store normalized comparison values separately from encrypted display/original values only where matching requires it.
- The automatic-match transaction locks the candidate attempt/alert rows, sets `alert_events.matched_attempt_id`, moves that attempt to `automatically_approved`, and writes one immutable `audit_records` row. Once background jobs are introduced, it writes the outbox row in that same transaction. The unique partial index prevents one alert from being allocated to more than one attempt and one attempt from being allocated to more than one alert.
- A parsed alert without a qualifying proof remains unallocated (`matched_attempt_id is NULL`) and may be evaluated again when proof arrives. No worker may reserve or consume an alert on amount alone.
- When an approved attempt has a `platform_order_links` row, the same transaction writes `platform_order.sync_requested`. The platform-sync worker may mark only that linked external order paid after re-reading `automatically_approved`; its provider result updates the link row and audit trail, never the payment attempt decision.
- A state-transition service validates all status changes and increments `payment_attempts.version`; no controller, OCR parser, device request, or repository method may directly approve an attempt.
- The evidence pipeline keeps browser bytes only in short-lived staging, then retains the canonical compressed image according to section 6.1. Each retention deletion writes an `audit_records` row.

## 13. Jobs, retries, and operational interfaces

| Queue/job | Idempotency key | Retry policy | Result |
|---|---|---|---|
| `scan-evidence` | `attemptId:proofRevision:scan-v1` | 3 attempts, exponential 30s–10m | clean, malicious/corrupt exception, or retry. |
| `canonicalize-evidence` | `attemptId:proofRevision:canonical-v1` | 3 attempts; bounded decode/encode time | metadata-stripped, 1,920px-or-less canonical JPEG and staging deletion, or unreadable exception. |
| `extract-proof` | `attemptId:proofRevision:extractorVersion` | 3 attempts; OCR timeout 20s | minimal encrypted match facts from canonical evidence, never state approval. |
| `parse-alert` | `alertEventId:parserVersion` | 3 attempts | parsed trusted candidate or `unparseable` exception. |
| `evaluate-match` | `attemptId:currentEvidenceId:alertEventId?` | 5 contention-safe retries | decision or no-op; transaction protects allocations. |
| `expire-attempt` | `attemptId:expiresAt` | retries until confirmed | `expired` or `manual_verification_required` according to proof state. |
| `sync-platform-order` | `platformOrderLinkId:markPaidIdempotencyKey` | provider-specific retry with short timeouts and bounded backoff | marks the linked external order paid after local automatic approval, or records retry/attention without changing local approval. |
| `deliver-webhook` | `deliveryId` | section 10.3 schedule | durable delivery state. |
| `delete-expired-evidence` | `attemptId:proofRetentionDeleteAt` | daily until confirmed | object/raw-text removal and audit. |
| `publish-outbox` | `outboxEventId` | forever with alerting after threshold | at-least-once domain event. |

Workers use bounded concurrency, per-provider rate limits, explicit connection/read timeouts, dead-letter queues, structured logs, OpenTelemetry spans, and Sentry error reporting. Health endpoints are private/infrastructure-only:

| Path | Response | Rule |
|---|---|---|
| `GET /health/live` | `200 {status:'ok'}` | Process liveness only; no dependencies or secrets. |
| `GET /health/ready` | `200` or `503 {status:'not_ready'}` | Checks DB/Redis/object-storage configured dependency reachability with short timeouts; infrastructure authenticated. |
| `GET /metrics` | Prometheus/OpenTelemetry metrics | Internal network plus service authentication only. |

Required metrics include attempts by final state, automatic approval rate, false-match incident count, alert receipt-to-occurrence delay histogram (median/p95), OCR field accuracy by parser/layout, exception counts by reason, webhook success/retry/failure counts, queue age, and cost per automatic approval. Logs include `requestId`, `traceId`, store/attempt/event/delivery IDs, action, outcome, and reason code—never screenshot bytes, raw SMS, API tokens, webhook secret, full IPA, full account details, payer names, or transaction references.

## 14. Implementation modules and test gates

| Module | Responsibility | Must not do |
|---|---|---|
| `auth` | owner session, CSRF, phone verification | infer store ownership from client input. |
| `merchant-api` | API key auth, attempt creation/query | expose keys to browser code. |
| `checkout` | sanitized projection, proof-slot issue/submission | set payment outcome. |
| `evidence` | object validation, scan/OCR orchestration, encrypted evidence | directly approve/reject. |
| `device-gateway` | credential/signature/freshness/replay validation | accept browser/owner-submitted bank text. |
| `alert-parser` | known template parsing/normalization | mark attempts paid. |
| `matching` | deterministic rules, allocation, transition | call external OCR/HTTP in its transaction. |
| `decisions-audit` | immutable decisions/audits/state transition | overwrite history. |
| `webhooks` | signed durable delivery/retries | make merchant callback a source of truth. |

Tests are required before changing matching rules. At minimum, Vitest unit/integration coverage must prove: exact EGP minor-unit matching; Arabic/English normalization fixtures; unreadable/malicious proof; missing success status; recipient mismatch; delayed alert remains awaiting; alert after matching expiry; duplicate event/nonce and replay; wrong source identity; one alert cannot allocate twice; two concurrent same-amount attempts become ambiguous unless distinct payer/reference values uniquely pair them; transaction conflict retry; webhooks preserve delivery ID/body across retry; callbacks are signed and timestamped; owner action authorization/state transitions; Shopify OAuth state/signature/shop binding validation; platform-webhook replay/duplicate-order safety; platform credentials never appear in projections/logs; an exception state never queues mark-paid; and a platform mark-paid retry can affect only its linked external order. Client compression is never trusted; canonicalization strips metadata, preserves required OCR legibility, limits dimensions, and deletes staging/original bytes; tiered retention deletes the correct canonical object without removing decision/audit evidence; no raw sensitive material reaches logs. Playwright covers hosted payment page upload, status streaming/reconnect, proof replacement, expiry, safe public error states, and the Shopify handoff/fallback journey.

## 15. Feature-first client/server architecture and separation of concerns

The repository has three clearly separate applications: `apps/client` for the Next.js hosted checkout/web dashboard, `apps/mobile` for the full iOS/Android owner application, and `apps/server` for the NestJS API and workers. Each application organizes code **by feature first**, not by a global technical layer. Every feature owns its presentation, data, and domain files, so a payment-attempt change is found in one place instead of spread across application-wide `controllers`, `repositories`, and `services` directories.

```text
apps/
  client/                           Next.js: hosted checkout and owner dashboard only
    src/features/
      checkout/                     public payment-page feature
      auth/                          owner authentication feature
      payment-attempts/              owner attempt-list/detail feature
      receiving-source/              device/source setup feature
      platform-connections/          owner Shopify connection/status feature
      dashboard/                     owner metrics/exception feature
    src/app/                         thin Next.js route/layout boundary only
    src/shared/                      design system, HTTP client, config, safe common utilities

  mobile/                           React Native owner app for iOS and Android
    .gitkeep                         intentional placeholder; no implementation yet
    src/features/                    future auth, stores, receiving-sources, attempts, reviews, dashboard
    src/platform/                    thin native Android/iOS adapters only

  server/                           NestJS/Fastify API plus worker bootstrap
    src/features/
      auth/
      stores/
      payment-attempts/
      checkout/
      evidence/
      receiving-sources/
      alert-events/
      matching/
      decisions-audit/
      webhooks/
      platform-integrations/
        presentation/shopify/         OAuth callback and signed webhook controllers
        application/                  connect, link-order, and sync-order use cases
        domain/                       provider-neutral connector port and link policy
        data/shopify/                 OAuth/Admin API client and connection repository
      dashboard/
    src/shared/                      database client, queue client, config, crypto, logging, errors
    src/bootstrap/                   API and worker composition roots only

packages/
  contracts/                         versioned Zod HTTP/SSE/webhook/event contracts shared by client/server
  test-fixtures/                     sanitized screenshots, OCR, and bank-parser fixtures
```

`apps/mobile` will be the complete owner client: passwordless auth, create/configure a store, register and inspect a trusted receiving source, payment-attempt list/detail, manual-review actions, and analytics. It is not a browser wrapper and it is not only an alert bridge. React Native owns the shared UI/data/domain feature layers; platform-specific adapter code stays thin under `src/platform`. Android owns its native notification/SMS ingestion adapter. iOS owns its supported Shortcut/native automation integration and must expose its capability state to the owner; it cannot be assumed to have the same background SMS/third-party-notification access or delivery reliability as Android. Both adapters send only device-authenticated, replay-protected events to the same server API.

Do not place a Shopify embedded app or checkout extension inside `apps/client`. If/when a Shopify order-status/thank-you extension is shipped, add a separate `apps/shopify` deployment/package that contains only Shopify manifest, extension UI, and its thin calls to the server; it owns no matching logic, database access, platform credential, or payment decision.

`platform-integrations/domain` defines the provider-neutral connector port. Shopify-specific OAuth, signature verification, and Admin API code stays in `data/shopify`; presentation code is limited to authenticated owner routes and raw-body provider ingress. The application use cases link an already verified external order to a core attempt and request synchronization after automatic approval. They do not contain matching rules or direct SQL outside their injected repositories.

### 15.1 Client feature template

Each `apps/client/src/features/<feature>/` folder follows this exact pattern. Next.js route files in `src/app` are deliberately thin adapters that import a feature page/screen; they hold no feature logic themselves.

```text
features/checkout/
  presentation/
    pages/checkout-page.tsx          feature screen assembled from UI components
    components/checkout-status-card.tsx
    hooks/use-checkout-events.ts     SSE/query state only; never determines payment status
    view-models/checkout.view-model.ts
  data/
    datasources/checkout-api.datasource.ts  raw REST/SSE calls and Zod boundary parsing
    repositories/checkout.repository.impl.ts  maps DTOs to domain models
    dtos/checkout.dto.ts              client-only transport mapping when needed
  domain/
    entities/checkout.ts              UI-safe feature model
    repositories/checkout.repository.ts  interface used by hooks/use cases
    use-cases/get-public-checkout.ts
    use-cases/submit-proof.ts
  index.ts                            intentional public feature exports
```

| Client folder | Responsibility | Must not do |
|---|---|---|
| `presentation` | UI, accessibility, forms, loading/error states, hooks, SSE rendering | Call `fetch` directly, know endpoint response quirks, store secrets, or decide payment status. |
| `data/datasources` | Invoke REST/SSE endpoints; validate every response with shared Zod contracts; map transport errors | Contain UI state, business decisions, or a browser-visible API key/device credential. |
| `data/repositories` | Convert validated API DTOs to feature domain entities; select/inject data source | Render React or duplicate server matching rules. |
| `domain` | Client-side entities, repository interfaces, and UI use cases such as load/submit/refresh | Access network/framework APIs directly or treat client data as authoritative payment evidence. |

For example, `CheckoutPage` calls the `GetPublicCheckout` use case through a repository; the repository delegates to `CheckoutApiDataSource`; the data source calls `GET /v1/public/checkouts/{token}` and Zod-parses the response. `useCheckoutEvents` can refresh that use case when a permitted SSE event arrives. It can only display the server-provided status—there is no client-side “approve payment” path.

### 15.2 Server feature template

Each `apps/server/src/features/<feature>/` folder follows this pattern. A feature may omit a folder it does not need, but it may not move its business flow into a global catch-all service folder.

```text
features/payment-attempts/
  presentation/
    http/payment-attempts.controller.ts       Nest controller; parses/contracts/maps only
    http/schemas/create-payment-attempt.schema.ts
    jobs/expire-payment-attempt.job.ts        BullMQ adapter, when applicable
  application/
    use-cases/create-payment-attempt.use-case.ts
    use-cases/expire-payment-attempt.use-case.ts
    commands/create-payment-attempt.command.ts
  domain/
    entities/payment-attempt.ts
    value-objects/money.ts
    repositories/payment-attempt.repository.ts  interface/port
    services/attempt-state-machine.ts
  data/
    datasources/payment-attempt.drizzle-datasource.ts  parameterized Drizzle queries only
    repositories/drizzle-payment-attempt.repository.ts  implements domain repository port
    mappers/payment-attempt.mapper.ts
  payment-attempts.module.ts                  feature-level Nest dependency wiring
```

| Server folder | Responsibility | Must not do |
|---|---|---|
| `presentation/http` | Controllers, guards, size limits, Zod validation, HTTP/SSE serialization | Query Drizzle, invoke OCR/S3, or change status outside a use case. |
| `presentation/jobs` | Deserialize a trusted queue payload and invoke one use case | Reimplement matching or bypass idempotency/transaction behavior. |
| `application/use-cases` | Orchestrate one business action, authorize server-derived actors, open transaction, call repositories/domain services, emit outbox intent | Depend on Fastify/Nest request objects, Drizzle tables, or provider SDK response types. |
| `domain` | Pure entities, state machine, deterministic matching rules, value objects, repository interfaces | Perform I/O, read environment, import Nest/Drizzle/BullMQ/provider SDKs. |
| `data/datasources` | Narrow parameterized database/object-storage/provider operations | Return HTTP DTOs or determine an approval/rejection. |
| `data/repositories` | Implement a feature’s repository interface and map persistence rows to domain entities | Leak ORM rows across the feature boundary. |

The matching feature follows the same layout. Its domain service accepts already-normalized screenshot/alert facts and returns typed rule results only. Its `EvaluateMatchUseCase` is the sole orchestration point that locks candidates and atomically records allocation, decision, audit, transition, and outbox work. OCR and alert-parser features can create evidence facts, but neither feature can import a matching repository or set `automatically_approved`.

### 15.3 Workers: separate process, feature-owned job handlers

Workers are not a third product application and they are not a global `jobs` folder. They are a separately deployed **server process** started from `apps/server`, using a Nest application context with no HTTP listener. It loads the same feature modules and dependency wiring as the API process, but starts only the queue consumers, outbox relay, and scheduled jobs.

```text
apps/server/src/
  bootstrap/
    http.bootstrap.ts                 starts the Nest/Fastify API process
    worker.bootstrap.ts               starts the Nest application-context worker process
  features/
    evidence/presentation/jobs/
      scan-evidence.job.ts
      canonicalize-evidence.job.ts
      extract-proof.job.ts
    alert-events/presentation/jobs/
      parse-alert.job.ts
    matching/presentation/jobs/
      evaluate-match.job.ts
    payment-attempts/presentation/jobs/
      expire-payment-attempt.job.ts
    webhooks/presentation/jobs/
      deliver-webhook.job.ts
```

Every job handler is a delivery adapter: it validates a minimal job payload, starts a trace, calls exactly one feature use case, and reports a typed success/retry/failure outcome. It does not query tables directly or contain matching, parsing, or webhook policy. For example, `EvaluateMatchJob` calls `EvaluateMatchUseCase`; that use case owns the transaction and delegates rule evaluation to the matching domain service.

The queue payload contains IDs and a schema version, never raw screenshot bytes, raw SMS text, access tokens, or full persistence records. Each worker use case has a deterministic idempotency key and uses database uniqueness constraints in the same transaction as its side effect; add a `processed_events` marker only if a later consumer cannot be made idempotent from its feature record. Retries are safe because they re-read current state; they never assume an earlier attempt completed. Queue names and consumers remain feature-namespaced, for example `evidence.scan`, `alert-events.parse`, `matching.evaluate`, and `webhooks.deliver`.

### 15.4 Real-time events: durable first, feature-safe projection second

Real-time events are produced by server features, not by client hooks and not directly by a database trigger. A use case first writes its state change, audit record, and durable `outbox_events` row in one PostgreSQL transaction. The outbox relay then publishes the committed event to the queue/Redis event bus. This prevents a browser or webhook from seeing an approval that the database failed to commit.

```text
Feature use case transaction
  → attempt/decision/audit update + outbox row
  → outbox relay publishes committed internal event
  → feature event projector creates a safe public/owner projection
  → shared SSE broker fans out to authenticated scoped connections
  → client hook receives event and refreshes its feature use case/repository
```

The `checkout` and `dashboard` features own their own presentation projection and SSE endpoint; the shared real-time service only manages connection lifecycle, Redis fan-out, heartbeat, replay cursor, and back-pressure.

```text
features/checkout/
  application/event-projectors/project-checkout-status-event.ts
  presentation/realtime/public-checkout-events.controller.ts
  presentation/realtime/checkout-event.presenter.ts

features/dashboard/
  application/event-projectors/project-owner-attempt-event.ts
  presentation/realtime/owner-events.controller.ts
  presentation/realtime/owner-event.presenter.ts

shared/realtime/
  realtime-bus.ts                     publish/subscribe interface
  redis-realtime-bus.ts               Redis adapter
  sse-connection-registry.ts          scoped connection and back-pressure control
```

Projectors explicitly allowlist payload fields. Public checkout projections may include only attempt ID, status, expiry, proof-processing state, and timestamps. Owner projections may include permitted attempt/delivery summaries. They never include raw evidence, raw alert text, credentials, payer data, transaction reference, audit diagnostics, or another store’s events. The public SSE endpoint validates the checkout token and binds the connection to one attempt; owner SSE derives the store from the authenticated session. Both use the reconnection and `Last-Event-ID` behavior specified in section 10; after a replay window expires, the client refetches REST state rather than trusting a gap.

Webhooks are deliberately distinct from browser real-time events. The `webhooks` feature converts approved/exception outcomes into durable `webhook_deliveries`, and its worker signs/retries them. SSE delivery is best-effort UI freshness; it can never be used as merchant payment confirmation or a state-transition input.

### 15.5 Dependency and cross-feature rules

```text
Client: presentation → domain use case → repository interface ← repository implementation ← data source
Server: controller/job → use case → domain + repository interface ← repository implementation ← data source
```

- Dependencies point toward a feature’s `domain`; `domain` has zero framework/provider imports. Feature-specific data implementations are wired in that feature’s module/composition root.
- A server controller calls exactly one primary use case. A use case owns its transaction and receives repository interfaces, clock, event publisher, and external-provider interfaces through dependency injection.
- Features communicate through typed application interfaces or durable domain events, never by importing another feature’s `data` folder or querying its tables directly. For example, `evidence` emits `proof.extracted`; `matching` consumes it through its job/use case.
- `packages/contracts` contains only explicit external contracts. Database rows, client models, server domain entities, OCR provider responses, and HTTP DTOs are separate types with explicit mappers.
- Shared code is limited to true cross-cutting utilities: config parsing, logging/redaction, crypto primitives, database/queue connection factories, error translation, and design-system components. Do not put feature services, repository implementations, or generic `utils` business logic into `shared`.
- TypeScript path aliases plus ESLint `no-restricted-imports` enforce the boundaries in CI. No `any` crosses an HTTP, queue, provider, database, or client/server boundary.

### 15.6 Cross-cutting rules

- Configuration is parsed once at each application bootstrap with a strict schema and injected; feature modules do not read `process.env` directly.
- Authentication, authorization, rate limits, idempotency, encryption, logging redaction, tracing, and error translation are reusable boundary services—not controller copy-paste.
- Use cases own transactions. Repositories accept an injected transaction/session so a single approval cannot partially write an allocation, decision, audit entry, status update, and outbox event.
- Domain tests run without PostgreSQL, Redis, object storage, network, or clocks. Data-source integration tests use disposable real PostgreSQL/Redis/object storage. Controller tests prove contract/auth behavior; end-to-end tests compose real feature modules without mocking matching policy.
- Provider interfaces are versioned inside the owning feature. Adding a bank parser, OCR vendor, or storage provider means adding an adapter plus contract tests to that feature—not adding branches in controllers or matching rules.

## 16. Recommended project start and delivery plan

Start with the smallest production-shaped vertical slice: one store, one known source/parser, one exact-amount payment attempt, one screenshot, one trusted alert, one deterministic approval, and one signed webhook. Do not begin with a broad dashboard, multiple bank formats, or AI escalation; those are integrations around the core decision rather than the core decision itself.

| Phase | Deliverable | Exit criteria |
|---:|---|---|
| 0. Decisions and bootstrap | ADRs for money representation, evidence retention, recipient normalization, and the exact first supported bank/source; pnpm/Turborepo workspace with separate `apps/client` and `apps/server`; a Neon development branch for PostgreSQL, managed Redis, and a private S3-compatible development bucket configured through uncommitted environment variables; CI formatting, typecheck, tests, migrations, feature-boundary linting, and secret scan. | A new developer can start the client/server shells and run a passing empty server/worker test suite with no real credentials; database work uses a dedicated Neon branch, never a local Docker PostgreSQL instance. |
| 1. Domain first | The `matching` feature’s `domain` and `application` folders for attempt state transitions, rule-result types, one-to-one allocation policy, clocks, IDs, and audit/outbox commands. | Unit tests cover state transitions, duplicate alert prevention, late alert, exact minor-unit matching, and same-amount ambiguity before any controller is written. |
| 2. Owner/store and merchant attempt slice | Owner auth/session, one-store creation, IPA validation, API-key issuance, migrations, `CreatePaymentAttempt`, merchant attempt read, and hosted public attempt projection. | A merchant server can idempotently create an EGP attempt and open a hosted URL; browser cannot alter amount/store/status. |
| 3. Evidence slice | Staging signed upload, malware/content checks, canonical compression, retention scheduler, OCR port with a deterministic fixture adapter, and proof submission. | A valid image moves an attempt to `awaiting_bank_alert`; corrupt/unreadable images are safe exceptions; canonical/staging deletion tests pass. |
| 4. Receiving-source slice | Source setup, device provisioning/revocation, test-event verification, signed device gateway, replay/idempotency checks, and one production-quality parser for the chosen first bank/app format. | An active verified device can deliver one well-formed credit event; copied/wrong/stale/duplicate events cannot become trusted alerts. |
| 5. Match and callback slice | Transactional matcher integration, allocation/decision/audit/outbox, expiry scheduler, signed webhook delivery and retry worker. | The full happy path automatically approves exactly once and delivers an idempotent signed callback; competing same-amount attempts become ambiguous rather than guessed. |
| 6. Shopify connector slice | Shopify OAuth install/disconnect, verified provider webhook ingress, external-order linking, hosted-verification handoff with a tested fallback, and retry-safe mark-paid synchronization after automatic approval. | A development-store order maps to exactly one attempt; invalid/replayed provider events do nothing; an automatically approved attempt marks only its linked order paid exactly once. |
| 7. Operations and owner experience | Dashboard queries, exception actions, SSE, platform-sync visibility, metrics, alerts, error reporting, production deployment/runbooks, backups, and retention verification. | An owner can see and resolve every exception or platform-sync failure; operators can measure approval, alert delay, failures, storage, platform sync, and callback health. |
| 8. Pilot hardening | Playwright journeys, load/rate-limit tests, recovery drills, first-bank fixture expansion, Shopify development-store contract tests, threat-model review, and controlled pilot onboarding. | The team has evidence for the pilot success metrics and a documented incident/reversal process. |

The first implementation pull request should create `apps/client` and `apps/server`, feature-folder templates, strict TypeScript/ESLint import boundaries, configuration schema, the matching feature’s value objects, initial Drizzle migration, health checks, and matching-rule tests. The first deployable demo should use a test device automation and synthetic/sanitized bank-alert fixtures—not customer financial data—to demonstrate one successful end-to-end match.

Maintain an ADR for every policy that can change matching outcomes or data retention. Each ADR records the decision, owner, date, alternatives, migration/rollback path, affected rule codes, test fixtures, and whether existing attempts are grandfathered. This avoids silently changing the meaning of an automatic approval after launch.

## 17. Securability Notes

- **SSEM attributes applied:** integrity and authenticity through server-owned state, strict boundary schemas, signed device/platform/webhook traffic, database-enforced allocation, and external-order uniqueness; accountability and observability through immutable audits, outbox events, redacted structured logs, trace IDs, and platform-sync state; confidentiality through encrypted/private evidence and server-only encrypted platform credentials; availability through bounded uploads, provider timeouts, rate limits, and retry-safe jobs.
- **Trust boundaries:** owner/merchant/public/device/OCR/platform/webhook inputs are independently authenticated, canonicalized, schema-validated, authorized, rate limited, and audited before entering business logic.
- **Key trade-off:** owner-configured iOS/Android automation is the supported pilot ingestion path; it gives no cryptographic proof that an originating OS notification was unmodified. The system reduces this risk with registered-device credentials, verified source identity, freshness, parser allowlists, deterministic matching, one-to-one allocation, and exceptions rather than guesses. Native platform listeners and official authorized integrations remain later work.
