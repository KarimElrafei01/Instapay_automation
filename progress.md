# Progress

Last updated: 2026-09-26

## Completed

- Bootstrapped the pnpm/Turborepo workspace with Next.js client and NestJS/Fastify server shells.
- Added the initial PostgreSQL/Drizzle schema and migrations for owners, stores, payment attempts, receiving sources, alerts, and audits.
- Implemented development-only passwordless owner authentication with the fixed local OTP (`0000`), signed-in owner sessions, sign-out, and session renewal on `GET /v1/owner/auth/me`.
- Added the repository branch policy: develop each feature on its own branch and merge into `main` only with explicit user approval.
- Implemented authenticated store creation on `POST /v1/owner/stores`: canonical store/account-holder/IPA inputs, one-store-per-owner and IPA uniqueness, public-only HTTPS webhook validation, and one-time merchant integration-secret issuance.

## In Progress

- Branch: `feat/store-creation`
- Feature branch is ready for review; no merge into `main` is authorized.

## Verification

- Owner-auth/session changes: typecheck, Vitest suite, build, and whitespace checks passed before starting store creation.
- Store creation: server typecheck, Vitest suite (11 tests), production build, and whitespace checks passed.

## Pending

- Persist owner, session, and store data through the configured PostgreSQL/Drizzle adapters rather than development in-memory repositories.
- Add CSRF middleware and a CSRF-token delivery endpoint before the browser dashboard is connected.
- Configure an approved database and encryption-key source for a shared or production environment.
- Iteration 2: support multiple stores sharing an IPA through a shared receiving-source model and cross-store, uniqueness-only matching.
