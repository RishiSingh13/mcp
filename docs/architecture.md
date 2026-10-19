# Architecture

```text
MCP host -> Streamable HTTP or stdio -> MCP tool handlers
                                      |-> Zod/domain validation
                                      |-> deterministic conflict engine
                                      |-> Google adapters (Gmail, Calendar, Routes)
                                      `-> repository interface
                                           |-> in-memory tests/local demo
                                           `-> PostgreSQL persistence
```

The app uses `@modelcontextprotocol/sdk` v1.32.1 and Zod 3.25. Both supported transports use the same server and tool handlers. Domain comparisons use parsed instants; itinerary timestamps require offsets whose local date/time is consistent with the supplied IANA time zone, including DST boundaries. The conflict engine makes no LLM calls.

PostgreSQL is selected when `DATABASE_URL` is present. Numbered SQL migrations persist account-scoped itineraries, five-minute previews, hashed OAuth state, encrypted OAuth credentials, and per-event sync progress. Production requires PostgreSQL and will fail startup rather than silently use memory. OAuth credentials are encrypted with AES-256-GCM using a separately configured 32-byte key; itinerary and event JSON is not encrypted by the application.

Calendar preview does not write. Commit validates the active account, itinerary snapshot, preview expiry, and explicit confirmation. Sync state is transactionally claimed and saved per event. TripSync derives a stable Google Calendar event ID from the itinerary event UUID and records a content fingerprint. If an insert response is lost, a retry reads that ID and only recovers it when the TripSync event ID and fingerprint match. A mismatch is rejected; existing entries are never updated or deleted.
