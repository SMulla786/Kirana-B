# Kirana-B: KiranaOS backend API

Node 24 · Express 5 · TypeScript · Prisma 5 · PostgreSQL. Project memory and decisions are in
[`CLAUDE.md`](CLAUDE.md) and [`docs/`](docs/).

## Setup

1. Install dependencies:

    ```sh
    npm install
    ```

    `.npmrc` allows Prisma's install scripts. Lockfile and migrations are gitignored for now (DECISIONS P-006).

2. Create your config:

    ```sh
    cp .env.example .env
    ```

    Then fill in `DATABASE_URL`, `JWT_SECRET` (≥32 random characters in production), the SMTP settings and
    `APP_URL` (the web admin URL used in email links). Never commit `.env`.

3. Create the schema:

    ```sh
    npx prisma migrate deploy   # if you have the migrations folder
    npx prisma db push          # otherwise, on a fresh dev database
    ```

4. Start the dev server:

    ```sh
    npm run dev
    ```

    It runs at `http://localhost:$PORT`. Check `GET /health`.

5. Optional: create a platform admin with `npm run build && npm run registerAdmin`.

## Checks

| Command                                       | What it does                                        |
| --------------------------------------------- | --------------------------------------------------- |
| `npx tsc --noEmit`                            | Typecheck `src`                                     |
| `npx tsc --noEmit -p tsconfig.test.json`      | Typecheck `src` and `tests`                         |
| `npm run lint`                                | ESLint + Prettier                                   |
| `npm test`                                    | Vitest + supertest against a real Postgres test DB  |
| `npm run build`                               | Compile to `dist/`                                  |

### How tests pick their database

- If `TEST_DATABASE_URL` is set (CI does this), tests use it.
- Otherwise they take `.env`'s `DATABASE_URL` and swap the database name for `kirana_test`. They refuse
  to run unless the name ends in `_test`.
- Global setup runs `prisma db push` on that database.
- Tests never wipe data; they use unique names instead.

CI is defined in `.github/workflows/ci.yml` (Postgres 16 service, typecheck, lint, tests).

## API conventions

- **Base path:** `/api/v1`.
- **Envelope:** every response is `{statusCode, status, message, data, errors?}`.
  - Validation errors are 400 `Validation failed`, with `errors: [{field, message}]`.
  - 5xx bodies never include internal details; the cause is logged with the request id.
- **Request ids:** `X-Request-Id` is accepted if it is safe (`[A-Za-z0-9_-]{1,64}`), otherwise generated.
  It is echoed on every response and appears in log lines.
- **Auth:**
  - A short-lived JWT access token (≤60 min, default 15), plus an opaque refresh token bound to a
    per-device `Session` row (stored hashed, rotated on every refresh; reuse revokes the session).
  - Web clients get httpOnly `SameSite=Strict` cookies. Desktop and Android clients use the tokens from
    the response body and `Authorization: Bearer`.
- **Tenancy:**
  - The business (`kiranaId`) and store come from the session, never from the request.
  - Business-owned queries filter by `{id, kiranaId}`.
  - Request bodies are `.strict()`, so a `kiranaId` field is rejected.
- **Authorization:**
  - `requirePermission('<action>')` per route, backed by the role → permission map in
    `src/config/permissions.ts`.
  - Roles: OWNER, MANAGER, CASHIER, INVENTORY_MANAGER, ACCOUNTANT, STAFF.
  - The platform `ADMIN` stays on `User.role`.
- **Docs:** `/api-docs` (Swagger UI) and `/api-docs/openapi.json`, generated from zod (A-025). After
  changing routes run `npm run openapi:export` and commit `openapi.json`.

## Routes (Phases 1A and 2)

| Area           | Endpoints                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| Auth (public)  | `POST /auth/register` `/verify-code` `/resend-code` `/login` `/refresh` `/logout` `/password/forgot` `/password/reset` |
| Auth (session) | `GET/PATCH /auth/me` · `POST /auth/password/change` `/logout-all` · `GET /auth/sessions` · `DELETE /auth/sessions/:id` |
| Business       | `GET/PATCH /business` · `GET/POST /business/members` · `PATCH /business/members/:id`                      |
| Catalogue      | `GET/POST /catalog/categories` · `GET/PATCH/DELETE /catalog/categories/:id` · `GET/POST /catalog/brands` · `PATCH/DELETE /catalog/brands/:id` |
| Products       | `GET/POST /catalog/products` (search, filters, pages) · `GET/PATCH /catalog/products/:id` (archive via `status`) · `GET /catalog/products/:id/prices` · `GET /catalog/lookup?code=` · `POST /catalog/import` (dry run / commit) |
| Stock          | `GET/POST /stock/movements` (append-only ledger; balances update in the same transaction) |
| Platform admin | `GET /admin` · `POST /admin/businesses`                                                                   |
| Ops            | `GET /health` (outside `/api/v1`)                                                                         |
