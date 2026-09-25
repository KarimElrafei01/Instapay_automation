# Automated InstaPay Checkout

## Development environment

This workspace uses a managed Neon PostgreSQL database for development. It does **not** run PostgreSQL in Docker. Redis and the private S3-compatible bucket are also supplied through managed-service connection settings.

1. Install Node.js 22+ and pnpm 12+.
2. Copy `apps/server/.env.example` to `apps/server/.env` and paste the Neon **pooled** connection string into `DATABASE_URL`. Keep `sslmode=require`.
3. Copy `apps/client/.env.local.example` to `apps/client/.env.local`.
4. Install exact locked dependencies with `pnpm install`.
5. Run `pnpm typecheck` and `pnpm lint`.
6. Start the applications in separate terminals: `pnpm dev:server`, `pnpm dev:client`, and (after feature consumers are added) `pnpm dev:worker`.

The server health endpoint is available at `http://127.0.0.1:3001/health/live`. Database migrations are created and applied only through `pnpm db:generate` and `pnpm db:migrate`; both require `apps/server/.env`.

Never place Neon, Redis, S3, OCR, session, API-key, or device credentials in the client environment file or commit any `.env` file.
