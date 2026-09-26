# Automated InstaPay Checkout — Codex Reference

## Mission

Build a web-first checkout and reconciliation product for Egyptian merchants who receive InstaPay transfers. The product automatically marks an order paid only after it matches required customer proof with a trusted merchant bank-alert event.

This product is **not** an official InstaPay/IPN integration, payment processor, bank, wallet, or custodian. Never initiate a transfer, request customer bank credentials, PINs, OTPs, or claim official settlement confirmation.

## MVP scope

There is one role: **store owner**.

The MVP contains:

1. Store owner authentication, store profile, IPA configuration, and one verified receiving bank-alert source.
2. Server-side payment-attempt creation from a merchant website.
3. Hosted payment page with merchant IPA/share link/QR, exact amount, and required screenshot upload.
4. Trusted bank SMS/alert ingestion from a registered merchant device.
5. OCR/AI field extraction for Arabic and English screenshots.
6. Deterministic matching and automatic approval.
7. Signed, timestamped, idempotent webhook to mark the merchant's local order paid.
8. Owner dashboard for payment status and exception handling.

Do not add Shopify, WooCommerce, multiple stores/accounts, staff roles, native notification listeners, iOS extensions, exports, or advanced fraud scoring unless explicitly requested. They are Iteration 2.

## Recommended stack

- Monorepo: `pnpm` workspaces + Turborepo.
- Web/dashboard and hosted checkout: Next.js + TypeScript + React.
- API: NestJS on Fastify + TypeScript, REST API, OpenAPI contract.
- Database: PostgreSQL with Drizzle ORM and explicit migrations.
- Async work: Redis + BullMQ workers for OCR, parsing, matching, callbacks, and retries.
- Object storage: S3-compatible private bucket with short-lived signed upload/download URLs and lifecycle deletion.
- Android alert bridge: native Kotlin. Keep SMS/device ingestion isolated from the web app.
- OCR: Azure AI Vision Read for baseline Arabic/English text extraction. Escalate uncertain images to a vision model only when needed.
- Validation: Zod at HTTP boundaries and shared typed API contracts.
- Tests: Vitest for unit/integration tests; Playwright for payment-page journeys.
- Observability: Pino structured logs, Sentry error reporting, OpenTelemetry-compatible tracing.

Prefer managed PostgreSQL, Redis, and object storage during the pilot. Keep interfaces provider-neutral.

## Core payment flow

```text
Merchant server creates unpaid local order
→ Merchant server creates payment attempt through API
→ Customer redirects to hosted payment page
→ Customer pays in InstaPay and uploads screenshot
→ Registered device forwards eligible bank credit alert
→ OCR/parser extracts evidence
→ Deterministic matching engine evaluates one-to-one match
→ Automatically approve only when all required rules pass
→ Send signed webhook to merchant server
→ Merchant server marks local order paid idempotently
```

## Non-negotiable matching rules

Automatic approval is the default product promise. Manual review is an exception path.

Auto-approve only when all applicable checks pass:

- Screenshot is present, readable, and indicates a successful transfer.
- Screenshot amount exactly equals the server-owned order amount.
- Screenshot recipient matches configured merchant IPA/account-holder name.
- Trusted alert is a credit event from an active verified source.
- Trusted alert amount exactly equals the order amount.
- Alert falls inside the configured matching window.
- Alert has not been allocated to another order.
- Exactly one payment attempt is eligible.
- Payer name or transaction reference agrees across screenshot and alert when available.
- No blocking risk flag exists.

Never let OCR/AI directly approve a payment. It produces evidence, extracted fields, and confidence; deterministic code owns state transitions.

## Important edge cases

- SMS can be delayed by one or two minutes. Use `awaiting_bank_alert`; do not fail immediately.
- Default matching window is 15 minutes. Store screenshot claimed time and SMS receipt time separately.
- If no trusted alert arrives by expiry, set `manual_verification_required`, not `failed`.
- Two same-amount orders can arrive concurrently. Do not guess; auto-match only if names/references uniquely distinguish them, otherwise group as `ambiguous_match`.
- One trusted alert may be allocated to one order only.
- Customer-sent, copied, forwarded, or manually typed "bank SMS" is never trusted evidence.
- Unrecognized sender IDs and unparseable alerts are exceptions, never automatic matches.
- Screenshot proof is required but is supporting evidence, not proof by itself.

## Required state model

Use explicit states and server-enforced transitions:

`awaiting_proof` → `awaiting_bank_alert` → `automatically_approved`

Exception states: `manual_verification_required`, `ambiguous_match`, `rejected`, `expired`.

Only matching/decision services may transition an attempt to `automatically_approved`. Never trust a browser request, device request, OCR output, or merchant callback to set payment status directly.

## Security and privacy rules

- Treat screenshots, raw SMS, device events, OCR output, and webhooks as untrusted inputs.
- Validate, canonicalize, and allowlist every HTTP field. Reject extra sensitive fields rather than silently accepting them.
- Browser clients never choose store ID, final amount, payment status, decision, or owner identity. Derive server-owned state from authenticated records.
- Use opaque, unguessable payment-attempt IDs.
- Signed screenshot uploads must be scoped to one attempt, short-lived, type/size constrained, malware scanned, and private.
- Issue a unique, revocable device credential per receiving source. Apply timestamp freshness, replay protection, event idempotency, and rate limits.
- Sign webhook payloads. Include timestamp and delivery ID. Merchant callback retries must be safe and idempotent.
- Encrypt evidence and credentials at rest; use TLS in transit.
- Do not log raw SMS text, screenshots, access tokens, API keys, or full customer financial data.
- Keep append-only audit records of source, evidence IDs, evaluated rules, state transition, timestamp, and outcome.
- Do not call anything "bank confirmed", "official InstaPay confirmation", or "settled" without an official authorized integration.

## Coding standards

- Use TypeScript strict mode. No `any` across trust boundaries.
- Define shared DTOs/schemas; validate requests with Zod before application logic.
- Keep matching, authorization, parsing, OCR, and webhook verification as separate services/modules.
- Make background jobs idempotent and retry-safe. Use deterministic idempotency keys.
- Use parameterized database queries and explicit transactions around event allocation and payment approval.
- Return generic public errors; retain detailed diagnostic context only in secure structured logs.
- Add tests before changing matching rules. Cover same-amount concurrency, duplicate alerts, late alerts, and mismatching screenshot/SMS evidence.
- Preserve existing user work. Never hard-reset, discard changes, or expose secrets.

## Branch and merge policy

- Create every feature or change on a separate branch; never develop directly on `main`.
- Do not merge any branch into `main` unless the user explicitly authorizes that merge.

## Success metrics for the pilot

- Automatic approval rate.
- False-match rate (target: zero tolerance; investigate every occurrence).
- Median and p95 bank-alert delay.
- OCR field-extraction accuracy by bank/layout.
- Exception rate and exception reason.
- Callback delivery success rate.
- Cost per automatically approved payment.
