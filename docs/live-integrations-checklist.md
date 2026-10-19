# Live integrations setup and preflight

This guide uses the current TripSync source configuration. It does not deploy the app or modify Calendar events. Ordinary unit tests remain offline and do not need provider credentials.

## Current local settings

- The HTTP server listens on `PORT`, default `3000`. `npm run dev` starts it from TypeScript; `npm run build` followed by `npm run start` runs the compiled `dist/index.js` entrypoint.
- The OAuth start route is `GET /auth/google`. Open `http://localhost:3000/auth/google` with the default port. The callback route is `GET /auth/google/callback`; the default `GOOGLE_REDIRECT_URI` is `http://localhost:3000/auth/google/callback`. If you change `PORT`, set `GOOGLE_REDIRECT_URI` to the matching local callback URL. The app validates that the configured URI uses the implemented callback path.
- The project also supports stdio with `node dist/index.js --stdio` and Streamable HTTP MCP at `POST /mcp`. The local HTTP MCP endpoint is `http://localhost:3000/mcp` by default.
- `DATABASE_URL` is optional for local development and required by production configuration. PostgreSQL-backed use requires migrations (`npm run db:migrate`) and `TOKEN_ENCRYPTION_KEY` when Google OAuth is configured. The key must be canonical base64 for 32 random bytes. Without PostgreSQL, OAuth credentials live only in the app process and disappear when it restarts; a separately launched preflight process cannot reload those in-memory credentials.
- `MCP_AUTH_TOKEN` is required whenever Google OAuth is configured. HTTP clients send it as `Authorization: Bearer <token>`; never put its value in a report or screenshot.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` must be configured together. `GOOGLE_ALLOWED_EMAIL` restricts the account and is required for production OAuth.
- `GOOGLE_MAPS_API_KEY` enables live Routes API requests. `TAVILY_API_KEY` enables Tavily and is preferred for web search; `BRAVE_SEARCH_API_KEY` remains a fallback.
- `DEMO_MODE=true` permits labeled Gmail/Calendar fixtures and simulated routes when their live integrations are not connected. Tavily and Brave have no fixture fallback. A preflight result marked `simulated` is not a live-provider check.
- `APP_BASE_URL` is validated by configuration but the current source does not use it to bind the HTTP listener or construct OAuth URLs. The listener uses `PORT`; the OAuth redirect uses `GOOGLE_REDIRECT_URI`.

The OAuth flow requests `https://www.googleapis.com/auth/gmail.readonly` and the existing `https://www.googleapis.com/auth/calendar.events.owned` scope. OpenID/email are requested only when `GOOGLE_ALLOWED_EMAIL` is configured. This setup adds no Google scopes. Calendar access remains part of the existing application; the preflight below does not call Calendar tools or change events.

## Google Cloud setup

These account-owned pages require you to sign in to the Google Cloud project:

1. Enable [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com). The current app also requests Calendar access, so enable [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) for that existing integration.
2. Configure Google Auth Platform consent at [OAuth overview](https://console.cloud.google.com/auth/overview). Set the app name and support/contact fields. For an External testing app, add the Google account you intend to authorize under **Audience → Test users**. In **Data Access**, ensure the current scopes are allowed: Gmail read-only and Calendar owned-events. Google may require additional consent-screen review depending on the audience and scope use; follow the status shown in your project.
3. At [Credentials](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** with application type **Web application**. Add the exact authorized redirect URI `http://localhost:3000/auth/google/callback` for the default port. If you changed `PORT`, use the matching `GOOGLE_REDIRECT_URI` instead. Do not use `/auth/google` as the redirect: that path only starts authorization.
4. Put the client ID and secret in the existing `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set `MCP_AUTH_TOKEN` too, because the app requires it when Google OAuth is configured. If using PostgreSQL, also configure `DATABASE_URL` and `TOKEN_ENCRYPTION_KEY`, then run `npm run db:migrate`.
5. Enable [Google Maps Routes API](https://console.cloud.google.com/apis/library/routes.googleapis.com) only if live route estimates are needed. Routes API requires a billing-enabled Google Cloud project and an API key; restrict the key to Routes API and set quotas/budget alerts. Store the key in `GOOGLE_MAPS_API_KEY`.

Google sign-in, consent, project ownership, test-user approval, and any billing approval require your participation. After the local app starts, visit `http://localhost:3000/auth/google`, sign into the intended account, and approve the displayed scopes. On success, the browser says TripSync is connected. `/auth/status` reports connection/storage state without token values.

## Tavily web search setup

1. Create a Tavily account and copy an API key from the [Tavily dashboard](https://app.tavily.com/home). Tavily currently advertises a free tier with 1,000 API credits per month and no credit card required; check your dashboard for current limits and usage ([Tavily pricing](https://www.tavily.com/pricing)). See the [Tavily Search API docs](https://docs.tavily.com/welcome) for request details.
2. Add the key to `.env` as `TAVILY_API_KEY`. Keep it private. TripSync sends it only in the `Authorization: Bearer` header and never returns or logs it.
3. Restart TripSync. `search_travel_web` prefers Tavily when configured, sends `search_depth=basic`, caps results at five, and disables answers and raw page content. It returns unavailable results on provider errors and does not substitute fixtures.

If Tavily is not configured, TripSync uses Brave when `BRAVE_SEARCH_API_KEY` is set. To create a Brave key, visit the [Brave Search API dashboard](https://api-dashboard.search.brave.com/app/keys); the adapter sends it in the `X-Subscription-Token` header.

The preflight makes one bounded request to the selected provider and prints only status, not result titles or snippets. The request consumes provider quota/credits.

## Preserve the existing `.env`

Do not overwrite an existing `.env`. If it does not exist, create it from the placeholder template:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` locally and set only the values for integrations you intend to use. `.env.example` contains placeholders only. Do not paste keys, OAuth secrets, database credentials, access tokens, or the contents of `.env` into chat, tickets, or command output. `DEMO_MODE=false` is appropriate when you want results that can only be live or unavailable; missing keys never create live results.

## Read-only preflight

Run the diagnostic from the project directory:

```powershell
npm run integrations:check
```

It validates application configuration, checks PostgreSQL connectivity and required schema tables using read-only SQL, checks Gmail authorization through `users.getProfile` without searching messages, performs one bounded request to the selected web-search provider when configured, and reports whether Maps is configured. It never retrieves email bodies or calls Calendar tools. It does not run migrations.

To test Maps live availability, supply the real route endpoints you want checked:

```powershell
npm run integrations:check -- --maps-origin "YOUR_ORIGIN" --maps-destination "YOUR_DESTINATION"
```

Replace both placeholders with the locations you intend to test. This issues one Google Routes API request and may consume billable quota. If either endpoint is omitted, the Maps status is only `configured`; the command does not invent a route.

Use `--require` to make selected checks affect the process exit code. Optional providers are not required by default:

```powershell
npm run integrations:check -- --require postgres,gmail,tavily,maps --maps-origin "YOUR_ORIGIN" --maps-destination "YOUR_DESTINATION"
```

Use `npm run integrations:check -- --require tavily` (or `npm run integrations -- --require tavily`) to require a successful Tavily request. `--require brave` selects and checks Brave explicitly. Otherwise, Tavily is selected when configured, then Brave.

Successful statuses are `connected` for PostgreSQL/Gmail and `available` for Brave/Maps. Other statuses identify missing configuration, missing migrations, missing Gmail consent, provider denial, rate limiting, or a route that still needs explicit endpoints. The JSON report includes configured booleans only; it does not include secret values, Gmail identity, email content, route details, or raw provider responses. A production configuration automatically treats PostgreSQL as required.

## Provider tests through MCP

1. Set `DEMO_MODE=false` for the live-only behavior you want to verify. Configure the credentials above, then start the HTTP server in one terminal:

   ```powershell
   npm run dev
   ```

   Or run `npm run build` and `npm run start`. Open the authorization start URL `http://localhost:3000/auth/google` in a browser and complete Google consent. Do not open the callback URL directly; Google redirects there with the one-use authorization response.

2. In another terminal, start the official Inspector web UI with `npx --yes @modelcontextprotocol/inspector`. Open the UI URL it prints, select **Streamable HTTP**, and connect to `http://localhost:3000/mcp`. The Inspector's documented launch command is `npx @modelcontextprotocol/inspector`; `--yes` accepts npm's one-time package-install prompt. If `MCP_AUTH_TOKEN` is set, configure the Inspector's HTTP authorization header as `Authorization: Bearer <your token>` locally.
3. Call `search_booking_emails` with a narrow search and a small result bound, for example:

   ```json
   { "searchTerms": "your airline, hotel, train operator, city, or booking phrase", "maxResults": 3 }
   ```

   The tool returns `live` only after successful Gmail API retrieval, `simulated` for clearly marked fixtures, and `unavailable` when Google access fails. An empty successful Gmail result remains an empty live result. Returned email-derived content is untrusted and does not authorize Calendar actions.
4. Call `search_travel_web` with one public travel query:

   ```json
   { "query": "official airport train timetable Tokyo", "country": "JP", "language": "en", "count": 3 }
   ```

   Results include returned source URLs and untrusted snippets. Search snippets do not prove a live price, inventory, or booking. You can supply `officialDomain` to scope to a domain and check whether result hosts match it; TripSync does not certify domain ownership.
5. Call `estimate_transfer` with the actual origin and destination you want to check:

   ```json
   { "origin": "<your origin>", "destination": "<your destination>", "travelMode": "DRIVE" }
   ```

   A configured key and successful provider response produce `live`; demo fallback is `simulated`; missing credentials or API failures are `unavailable`. Do not use invented addresses as evidence of a real route.

Do not call `preview_calendar_sync` or `commit_calendar_sync` as part of this setup check. Automated tests use mocked providers, do not access personal email, and do not need credentials. PostgreSQL integration tests run only when `TEST_DATABASE_URL` points to a disposable database.

## Troubleshooting

- **`not_configured`**: set the named variable in `.env`, restart the process, and rerun preflight. The report never prints the configured value.
- **Gmail `not_connected`**: confirm the Web OAuth client ID/secret, redirect URI, API enablement, test-user membership, and account consent. If PostgreSQL is used, apply migrations and confirm `TOKEN_ENCRYPTION_KEY` matches the key that encrypted the stored token. Without PostgreSQL, the app's in-memory OAuth session is not available to a separate CLI process.
- **Gmail `unauthorized`**: confirm the Gmail API is enabled, the intended account granted Gmail read-only consent, and the OAuth app permits that test account. Reauthorize through `/auth/google` if consent was revoked or missing.
- **Tavily `unauthorized`/`rate_limited`/`unavailable`**: verify `TAVILY_API_KEY` in the Tavily dashboard, free-tier usage, and network access. Do not include the key in a report. The integration does not substitute demo data.
- **Brave `unauthorized`/`rate_limited`/`unavailable`**: verify the API key in Brave's dashboard, plan status, quota, and network access. Do not include the key in a report. The integration does not substitute demo data.
- **Maps `unauthorized`**: verify Routes API is enabled, the key's API restrictions allow Routes API, the project has billing enabled, and quotas are available. A `configured` result without supplied endpoints means no live route call was made.
- **`migration_required`**: verify the intended local PostgreSQL database, then run `npm run db:migrate`. This migration step changes database schema; preflight itself does not.
- **Network errors or timeouts**: check local connectivity and provider status, then retry. The diagnostic does not print raw provider errors or response bodies.

The provider check behavior is consistent with Google's [Gmail server-side OAuth guidance](https://developers.google.com/workspace/gmail/api/auth/web-server), [OAuth consent setup](https://developers.google.com/workspace/guides/configure-oauth-consent), and [Routes API setup and billing requirements](https://developers.google.com/maps/documentation/routes/get-api-key), plus Brave's [API key guide](https://api-dashboard.search.brave.com/documentation/guides/authentication).
