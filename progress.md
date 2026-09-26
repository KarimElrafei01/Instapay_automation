# Progress

Last updated: 2026-09-26

## Completed

- Bootstrapped the pnpm/Turborepo workspace with Next.js client and NestJS/Fastify server shells.
- Added the initial PostgreSQL/Drizzle schema and migrations for owners, stores, payment attempts, receiving sources, alerts, and audits.
- Implemented development-only passwordless owner authentication with the fixed local OTP (`0000`), signed-in owner sessions, sign-out, and session renewal on `GET /v1/owner/auth/me`.
- Added the repository branch policy: develop each feature on its own branch and merge into `main` only with explicit user approval.
- Implemented authenticated store creation on `POST /v1/owner/stores`: canonical store/account-holder/IPA inputs, one-store-per-owner and IPA uniqueness, public-only HTTPS webhook validation, and one-time merchant integration-secret issuance.
- Implemented receiving-source setup and verification: owner bank-name and SMS/notification selection, one-time device credential provisioning, signed/replay-safe Android test-alert ingestion, Azure Vision screenshot OCR, and a source becoming active after either selected channel verifies while the other remains independently visible.
- Added the native Android bridge foundation with isolated SMS and notification-listener services, exact-bank filtering, channel gating, and HMAC-signed event delivery. Added iPhone automation guidance to the owner provisioning response.
- Added the receiving-source database migration for bank names, multi-channel selection, per-channel verification state, and private test-proof metadata.
- Replaced development in-memory owner, session, and store adapters with PostgreSQL/Drizzle repositories. Owner sessions are hashed, revocable, and expiry-checked; store webhook values are encrypted before persistence. Added the `owner_sessions` migration.
- Added global and sensitive-route HTTP rate limits, CSRF-token issuance and enforcement for browser state changes, and structured platform-event/request lifecycle logging with sensitive-value minimization.

## In Progress

- Branch: `feat/hosted-checkout-proof-submission`
- Hosted checkout and proof submission are in progress: a merchant-authenticated API creates a durable checkout session, while the customer screenshot submission is the only operation that creates a payment attempt. No merge into `main` is authorized.

## Verification

- Owner-auth/session changes: typecheck, Vitest suite, build, and whitespace checks passed before starting store creation.
- Store creation: server typecheck, Vitest suite (11 tests), production build, and whitespace checks passed.
- Receiving-source verification: server typecheck, Vitest suite (14 tests), production build, and whitespace checks passed.
- PostgreSQL persistence: server typecheck, Vitest suite (16 tests), production build, whitespace checks, and a temporary server health smoke test passed. Database migration remains unapplied because no approved database environment is configured locally.
- HTTP security and observability: server typecheck, Vitest suite (19 tests), production build, whitespace checks, and a temporary smoke test passed (CSRF rejection, token-authorized request, and OTP rate limit).

## Pending

- Configure an approved database and encryption-key source for a shared or production environment.
- Wire the existing in-memory receiving-source adapter to PostgreSQL/S3/BullMQ before deployment; live test screenshots require `AZURE_VISION_ENDPOINT` and `AZURE_VISION_KEY`.
- Configure the private S3-compatible bucket, its server-side encryption and lifecycle policy, and `HOSTED_CHECKOUT_ORIGIN` before accepting live checkout proofs.
- Iteration 2: support multiple stores sharing an IPA through a shared receiving-source model and cross-store, uniqueness-only matching.
