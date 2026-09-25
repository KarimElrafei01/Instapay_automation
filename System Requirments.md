# Automated InstaPay Checkout — Requirements

## Product definition

Automated InstaPay Checkout lets a store owner accept InstaPay transfers through a website checkout, compare required customer screenshots with trusted bank alerts, and automatically mark matching orders as paid.

It is checkout and reconciliation software. It does not initiate transfers, hold money, access customer credentials, or claim official InstaPay/IPN API integration.

## MVP role

MVP has one role: **store owner**. The owner configures the store and receiving source, monitors outcomes, and resolves exception cases.

## Owner mobile application

The owner experience is available as a full iOS and Android mobile application alongside the web dashboard. It supports passwordless authentication, store and receiving-source setup, payment-attempt lists and details, manual-review handling, and dashboard analytics. The mobile app is a separate client from the hosted web checkout and shares only server contracts, never payment-decision logic or credentials.

Android may use a native alert-ingestion adapter for a registered receiving source. iOS uses its own supported automation path and must report source capability/reliability separately; the server must not assume that iOS can capture SMS or third-party notifications in the same way as Android.

## MVP — must-have requirements

### 1. Store and receiving source

1. The owner can register and sign in with a verified E.164 phone number using passwordless OTP, then create one store.
2. The owner configures store name, account-holder name, InstaPay IPA, and payment-expiry window.
3. The system validates the IPA format.
4. The owner configures one receiving source: bank, account label, optional masked suffix, and trusted sender/app identity.
5. The owner can disable the source and revoke connected-device/automation credentials immediately.

### 2. Web checkout and payment attempt

1. The merchant website creates a server-side payment attempt with an opaque attempt ID, merchant order ID, exact EGP amount, creation time, and expiry time.
2. The payment page shows exact amount, merchant IPA, account-holder name, copy IPA action, official merchant InstaPay share link/QR, order reference, and pending-verification instructions.
3. The share link/QR may preselect the merchant recipient only. The product must not claim InstaPay preloads the amount, note, order reference, or callback.
4. The customer pays in InstaPay and returns to submit proof.

### 3. Required screenshot proof

1. Screenshot upload is mandatory before a payment claim can be submitted.
2. The upload service validates type and size, malware-scans, and stores images privately.
3. OCR extracts, where visible: amount, successful/completed status, transfer date/time, recipient, payer name, and transaction reference. The service discards raw provider output and retains only the minimal encrypted matching facts needed while the proof is retained.
4. The payment attempt becomes **Proof submitted — awaiting automatic verification**.
5. The customer may replace unreadable proof before expiry.
6. The page tells customers to upload proof there, never by SMS, WhatsApp, or direct message.

### 4. Automatic alert ingestion — SMS and notifications

1. The system must support **store-owner-configured iOS Shortcuts automations** that forward eligible bank SMS or bank-app notification data to the transaction-event gateway.
2. The system must support **store-owner-configured Android automations** that forward eligible bank SMS or bank-app notification data to the same gateway.
3. The guided setup must let the owner choose the bank/app, select SMS or notification as the source, configure an approved sender/app filter, and send a real test alert.
4. A receiving source becomes active only after a test alert is parsed and confirmed against the configured source.
5. Each alert event is accepted only from a registered automation/device using a unique, revocable credential.
6. The gateway accepts only source ID, device ID, source sender/app identity, receipt timestamp, and alert text or normalized fields.
7. The gateway normalizes direction, EGP amount, timestamp, payer name, account suffix, transaction reference, and parser confidence where available.
8. It rejects malformed, unauthenticated, stale, duplicate, replayed, and rate-limited events.
9. Customer-sent messages, forwarded messages, copied alert text, and manually typed bank messages never become trusted transaction events.
10. Raw alert text is redacted from logs and deleted under a retention policy.

### 5. OCR/AI assistance

1. OCR supports Arabic and English screenshot text.
2. AI may extract fields, normalize Arabic/English names, parse difficult layouts, and flag inconsistent evidence.
3. AI outputs structured values and confidence scores only; it must never approve or reject a payment itself.
4. The system flags amount or recipient mismatch, missing successful status, reused screenshot/reference, late payment, alert/screenshot conflict, unrecognized source, and weak/duplicate payer-name match.

### 6. Automatic matching and approval

1. Automatic approval is the core default workflow; manual review is an exception path.
2. The engine continuously compares original order data, screenshot fields, and trusted alert events.
3. The engine auto-approves only when all applicable checks pass:
   - screenshot is readable and shows successful transfer;
   - screenshot amount equals order amount;
   - screenshot recipient matches merchant IPA or account-holder name;
   - trusted event is a credit event from an active source;
   - trusted event amount equals order amount;
   - event falls within the allowed time window;
   - event has not already been used;
   - exactly one attempt is eligible;
   - payer name/reference agrees when available;
   - no blocking risk flag exists.
4. The decision records evaluated rules and evidence IDs in an immutable audit record.
5. On approval, the attempt becomes **Automatically approved** and an authenticated, idempotent callback marks the merchant order paid.

### 7. Delays, ambiguity, and exceptions

1. A submitted proof initially shows **Awaiting bank alert**. A one-to-two-minute alert delay is normal.
2. Default matching window is 15 minutes; screenshot claimed time and alert receipt time are stored separately.
3. If no trusted alert arrives at expiry, status becomes **Manual verification required**, not failed.
4. If same-amount payments compete, the system must not guess. It may auto-match only if payer names/references uniquely distinguish both screenshot/alert pairs.
5. Otherwise, the payments enter an **Ambiguous match** group.
6. One alert event can be allocated to one order only.
7. The owner can approve, reject, request replacement proof, or reverse an exception decision. Every decision is audited.
8. Screenshot proof and trusted alert events may arrive in either order. An alert received before proof is stored as an unallocated candidate; it must not be reserved or allocated by amount alone.
9. A valid proof triggers evaluation against earlier unallocated alerts, and a newly parsed alert triggers evaluation against submitted proofs. Both paths use the same deterministic matching rules.
10. An alert must be after attempt creation and within the matching window. Screenshot submission time is recorded separately and does not invalidate an otherwise eligible earlier alert.

### 8. Dashboard, privacy, and security

1. Dashboard statuses: Awaiting proof, Awaiting bank alert, Automatically approved, Manual verification required, Rejected, Expired, and Ambiguous.
2. All transport uses TLS; evidence and credentials are encrypted at rest.
3. Screenshot objects use private storage and short-lived scoped URLs.
4. Device credentials are limited to one store/source and cannot change store settings or order state.
5. Uploads, alert events, and callbacks use size/rate limits plus replay and deduplication controls.
6. Product copy says **Automatically matched/approved**, never official InstaPay/IPN settlement confirmation.

### 9. Platform-store integrations

1. Shopify is a supported first-class integration alongside the direct merchant API. The platform creates an unpaid/manual-payment order; this product creates the linked verification attempt and supplies the customer with its hosted verification URL.
2. The owner connects a Shopify shop through a server-side OAuth flow. Platform credentials are encrypted at rest, never sent to the browser, and use only the scopes needed to read/link an order and mark that linked order paid.
3. The connector verifies the provider signature on the raw webhook request, canonicalizes the shop identity, rejects replayed or duplicate external orders, and derives the store/order/amount from verified platform data. It never trusts browser extension data or customer metadata for payment state or amount.
4. The customer handoff uses an order-status/thank-you surface where available, with an order-confirmation email/SMS link fallback. The verification flow must not depend on a specific Shopify customer-account experience.
5. After and only after deterministic automatic approval, a retry-safe worker marks the single linked Shopify order paid. A platform failure is visible to the owner but never reverses or alters the local payment decision. Exception/manual states do not automatically mark a platform order paid.
6. The integration is not an official InstaPay integration or a payment processor/gateway. It must never initiate transfers, hold funds, or represent a screenshot/alert as official settlement confirmation.

## Iteration 2 — nice-to-have

- Native iOS Message Filter extension, where Apple permits it.
- Native Android notification-listener companion app.
- WooCommerce plugin.
- Theme-aware embedded checkout component.
- Multiple stores and multiple bank accounts per owner.
- Bank-parser catalog and custom template workflow.
- Arabic/English customer pages and status notifications.
- Reconciliation exports, staff roles, dispute flow, retention controls, high-value thresholds, and advanced screenshot-tampering/risk detection.
- Official bank/PSP/IPN integration through an authorized partnership.

## Back-of-the-envelope calculations

Planning assumptions: 50 active stores, 10 InstaPay orders/store/day, 30 days/month, 100% screenshot upload, 0.8 MB average compressed screenshot, and 80% automatic approval target.

| Measure | Estimate |
|---|---:|
| Monthly attempts | `50 × 10 × 30 = 15,000` |
| Screenshot storage/month | `15,000 × 0.8 MB ≈ 12 GB` |
| Automatic approvals/month at 80% | 12,000 |
| Exceptions/month at 20% | 3,000 (~100/day) |

| Scale | 500 stores | 1,000 stores |
|---|---:|---:|
| Monthly attempts | 150,000 | 300,000 |
| Screenshot storage/month | ~120 GB | ~240 GB |
| Exceptions at 20% | 30,000 | 60,000 |

At an assumed blended fee of EGP 3 per payment attempt, indicative gross monthly revenue is EGP 45,000 at 15,000 attempts, EGP 450,000 at 150,000, and EGP 900,000 at 300,000. Measure cost per automatically approved payment: storage, OCR/AI escalation, event processing, and exception-support cost.

## Suggested MVP system design

```text
Customer browser                   Store-owner automation/device
      |                                      |
      | create payment attempt                | bank SMS / app notification
      v                                      v
Merchant site/API or Shopify connector ---> Checkout service <--- Alert event gateway
      |                    |                        |
      v                    v                        v
Screenshot upload ---> Private object store ---> Parser/normalizer
      |                    |                        |
      v                    v                        v
OCR/extraction --------------------------> Matching engine
                                                  |
                                                  v
                                      Decision + append-only audit
                                                  |
                                                  v
                         Signed merchant callback / platform mark-paid sync
                                                  |
                                                  v
                                     Merchant site marks order paid
```

### Components

1. Direct merchant integration creates server-side payment attempts and receives signed, idempotent status callbacks.
2. Checkout service displays IPA/share-link instructions and enforces lifecycle.
3. Upload service issues short-lived upload URLs, validates/scans files, and queues OCR.
4. OCR/extraction produces typed fields and confidence values for the current decision; it retains only the minimal encrypted matching facts, not the raw provider payload or image dimensions.
5. Alert event gateway validates automation/device credential, schema, source identity, freshness, uniqueness, and rate limits.
6. Parser/normalizer uses known bank/app templates first; unknown formats become exceptions.
7. Matching engine applies deterministic one-to-one approval rules.
8. PostgreSQL stores owners, attempts, events, decisions, and audit records; private object storage holds encrypted screenshots with lifecycle deletion.
9. Queue workers run OCR, parsing, matching retries, callback retries, and notifications.
10. The Shopify connector validates OAuth and provider webhooks, links verified platform orders to attempts, and marks a linked order paid only after automatic approval.

### Boundary controls

- Browser clients cannot choose store ID, amount, approval state, or result; server state owns them.
- Attempt IDs are opaque; upload authorization is attempt-scoped and short-lived.
- Alert events require per-device credentials, strict schemas, timestamp/replay checks, and rate limits.
- OCR/AI output is evidence only; deterministic rules own payment state changes.
- Platform credentials remain server-only; provider signatures, shop identity, order identity, and OAuth state are verified before an external order can be linked.
- A platform sync worker can mark only its linked external order paid after local automatic approval; it cannot modify the local decision.
- Callbacks are signed, timestamped, retried with backoff, and idempotent.
- Audit records preserve source/evidence IDs, rules, timestamps, and outcomes without raw sensitive payloads.

## Securability notes

- **SSEM attributes enforced**: authenticity, integrity, confidentiality, accountability, and observability.
- **Trust boundaries**: screenshot upload, SMS/notification automation event, OCR/AI output, and merchant callback are independently validated.
- **Trade-off**: Shortcuts/Android automation delivers an MVP cross-platform capture route without native distribution, while native SMS-filter/listener apps remain later reliability and onboarding enhancements.
