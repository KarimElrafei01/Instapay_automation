# Android receiving-source bridge

This native Android module is the trusted-device side of receiving-source verification. It is intentionally isolated from the web app: it forwards only selected bank credit alerts and never reads or uploads customer messages, screenshots, OTPs, PINs, or credentials.

During pairing, store the one-time `deviceProvisioning` values returned by the owner API in Android encrypted storage. Configure the exact bank name supplied by the owner and only the selected `sms` and/or `notification` channel. The bridge sends test alerts to `POST /v1/device/receiving-sources/{sourceId}/test-alert`.

Each request contains an opaque base64url-encoded JSON payload. `X-Device-Signature` is HMAC-SHA-256 over that payload, and `Authorization` carries the device credential. The server verifies the credential, signature, 15-minute test window, channel selection, and event idempotency before using any event.

The app must request `RECEIVE_SMS` only when SMS is selected and notification-listener access only when notifications are selected. Android runtime permission and user-enabled listener state must be reported to the owner UI before the real transfer test begins.
