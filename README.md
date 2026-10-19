# TripSync

TripSync is an MCP server for saving reviewed travel confirmations as itineraries, checking overlaps and ground transfers, comparing a trip with Google Calendar, and previewing calendar changes before a separately confirmed commit. It does not book travel, send email, or delete calendar events.

## Architecture and tools

The TypeScript application uses Zod-validated MCP tools, deterministic itinerary analysis, Google adapters, and an interchangeable repository. Local tests and demo mode use in-memory storage. Setting `DATABASE_URL` selects the PostgreSQL repository; production startup requires it and will not silently fall back to memory. Versioned SQL migrations live in `migrations/`.

Available tools:

- `create_itinerary` and `get_itinerary`
- `search_booking_emails` (bounded Gmail message retrieval and conservative booking-field extraction; all email-derived content is untrusted)
- `search_travel_web` (public Brave Search results with source URLs; indexed text is untrusted)
- `get_calendar_events` (bounded date range)
- `estimate_transfer` (Google Routes API or an explicitly labeled simulated/unavailable result)
- `analyze_itinerary` (deterministic overlaps and transfer checks)
- `preview_calendar_sync` followed by `commit_calendar_sync` with `confirm: true`

The server supports stdio (`node dist/index.js --stdio`) and stateless Streamable HTTP (`POST /mcp`). HTTP also exposes `/health` and the Google OAuth routes. Stdio protocol output is on stdout; structured logs go to stderr.

## Local development

Requires Node.js 20.19–24 and npm.

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

By default, the server uses in-memory storage. For a deterministic demo set `DEMO_MODE=true`; Gmail and Calendar fixture responses and simulated route/sync results are labeled as simulated. With `DEMO_MODE=false`, missing Google credentials produce safe unavailable results and no fabricated provider data. Brave Search has no fixture fallback: without its API key it returns `unavailable` in either mode.

Environment variables are documented by name in [.env.example](.env.example):

- `NODE_ENV`, `PORT`, `LOG_LEVEL`, and `DEFAULT_TRANSFER_BUFFER_MINUTES` configure the local server and analysis defaults. `APP_BASE_URL` is validated but is not currently used to bind the listener or construct OAuth URLs.
- `DEMO_MODE` is exactly `true` or `false`.
- `MCP_AUTH_TOKEN` enables the HTTP bearer-token gate. It is required in production and whenever Google OAuth is configured.
- `DATABASE_URL` selects PostgreSQL. It is mandatory in production.
- `TOKEN_ENCRYPTION_KEY` is canonical base64 encoding of 32 random bytes. It is mandatory when PostgreSQL and Google OAuth are both configured. Generate a local key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`; store the result outside source control.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` configure the OAuth web client. The client ID and secret must be set together. `GOOGLE_ALLOWED_EMAIL` restricts the single connected account and is required for production OAuth.
- `GOOGLE_MAPS_API_KEY` enables live Routes API estimates.
- `TAVILY_API_KEY` enables Tavily public web search and is preferred when configured; `BRAVE_SEARCH_API_KEY` remains a fallback. Search sends a basic request with at most five results and omits answers and raw page content.
- `BRAVE_SEARCH_API_KEY` enables live public web results from the Brave Search API. The key is sent only in the provider authorization header and is never included in tool results or logs.

Run `npm run integrations:check` for safe local setup diagnostics. See [live integrations checklist](docs/live-integrations-checklist.md) for account setup and bounded provider checks. The diagnostic uses read-only requests, does not inspect email contents, and never calls Calendar tools.

## PostgreSQL

Install and start a local PostgreSQL server, then create an application database (for example, `createdb tripsync`). Put its connection string in the local `.env` as `DATABASE_URL`, then run:

```powershell
npm run db:migrate
npm run dev
```

The migration runner applies each numbered SQL migration once. The schema stores account-scoped itineraries, previews, OAuth state hashes, encrypted OAuth credentials, and per-event synchronization progress. The OAuth credential JSON, including access/refresh tokens and expiry, is encrypted with AES-256-GCM before it reaches the database. Itinerary, preview, and event records are not encrypted by this application; secure the database and its backups accordingly.

To clear TripSync application data in a local non-production database, set the explicit confirmation variable and run `npm run db:reset`:

```powershell
$env:RESET_DATABASE_CONFIRM = 'tripsync'
npm run db:reset
Remove-Item Env:RESET_DATABASE_CONFIRM
```

This clears TripSync itineraries, previews, OAuth state and credentials, and sync history. The command refuses to run in production and requires the confirmation value.

## Google integrations

Configure a Google OAuth Web client with a redirect URI exactly matching `GOOGLE_REDIRECT_URI`; its default is `http://localhost:3000/auth/google/callback`. `/auth/google` requests only `https://www.googleapis.com/auth/gmail.readonly` (plus `openid email` when an allow-listed account is configured). Calendar access is disabled by default; set `GOOGLE_CALENDAR_ENABLED=true` and use `/auth/google/calendar` to request `https://www.googleapis.com/auth/calendar.events.owned` separately. Gmail retrieves a bounded number of matching messages and does not send, modify, label, or delete mail. OAuth state is unpredictable, short-lived, single-use, and stored as a hash. Refreshed credentials are retained and persisted encrypted when PostgreSQL is enabled. `/auth/status` reports connection and storage mode without returning token values.

Set `GOOGLE_MAPS_API_KEY` only after enabling Routes API. Route inputs and returned duration/distance are validated; unavailable routes are not replaced with made-up live values. Set `TAVILY_API_KEY` to use Tavily public web search; it takes priority over the optional `BRAVE_SEARCH_API_KEY` fallback. A query can include `officialDomain` to scope the search; TripSync labels matching hosts but does not certify domain ownership. Search snippets and email-derived values are untrusted and cannot authorize actions. Live provider behavior is not claimed until tested against that provider.

## Run and verify

```powershell
npm run typecheck
npm run build
npm test
npm audit
```

PostgreSQL integration tests are optional and skipped unless `TEST_DATABASE_URL` points to a disposable test database. The standard test suite uses mocks and does not require PostgreSQL or live Google credentials.

To run stdio after building:

```powershell
node dist/index.js --stdio
```

For manual protocol checks, the official MCP Inspector CLI can initialize/list tools over stdio:

```powershell
npx --yes @modelcontextprotocol/inspector@2.11.0 --cli node dist/index.js --stdio --method initialize
npx --yes @modelcontextprotocol/inspector@2.11.0 --cli node dist/index.js --stdio --method tools/list
```

For Streamable HTTP, start the server with `npm run start`, then connect the Inspector to `http://localhost:3000/mcp`. Set `Authorization: Bearer <MCP_AUTH_TOKEN>` in the Inspector when a token is configured.

## Safety and limitations

Gmail candidates include source message/thread IDs, subject and received-date metadata, a sender domain when available, and conservative extracted fields. They never include the complete message body or the booking reference itself; `referenceAvailable` only indicates that one was found. Plain text is preferred and HTML-only content is reduced to text after scripts/styles are removed. Date/time phrases are preserved as received and never assigned a guessed timezone; `timezoneStatus` and per-field `timeZoneByField` identify explicit, ambiguous, and missing timezone data. Email and Brave text are marked untrusted and cannot authorize calendar writes. A successful empty live Gmail search remains an empty `live` result; missing credentials or provider errors are `unavailable`; demo fixtures are `simulated`.

Calendar preview is read-only. Commit requires the separate `confirm: true` tool call, validates the saved preview and unchanged itinerary, records per-event progress, and uses a deterministic Google event ID plus a content fingerprint so retries can recover after an ambiguous insert response. This reduces duplicate risk but is not an exactly-once guarantee: Google documents that global distribution can prevent ID collisions from being detected at insertion time. TripSync never updates or deletes an existing event during recovery, and rejects an existing event whose stored content fingerprint does not match the preview.

This application currently supports one configured account per server instance; it does not provide per-caller multi-user identity. The MCP host must ensure that `confirm: true` follows explicit human approval of the preview, because a tool argument alone cannot prove who authorized it. Google account allow-listing and the HTTP bearer token are required controls for production OAuth use.

The in-memory repository is intended for tests and local demos; its data disappears on restart. For PostgreSQL, run migrations before starting the server. Brave results are search-index results, not proof of current availability, a live price, or a reservation. Prefer a provider's official API for transactional inventory, booking, or authoritative schedule data. Live Gmail, Calendar, Routes, Brave, and PostgreSQL behavior remains unverified in any environment where credentials or a database are unavailable.
