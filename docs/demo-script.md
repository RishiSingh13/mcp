# Demo script (2–3 minutes)

1. Show `/health` and `tripsync://capabilities`.
2. Search booking confirmation candidates, emphasizing the result cap and untrusted snippet notice. Select only a candidate the user recognizes.
3. Create an itinerary with explicit-offset timestamps and IANA time zones.
4. Analyze it. Show overlap findings and a clearly labeled live, simulated, or unavailable ground route.
5. Compare against Calendar if authorized.
6. Generate a preview and inspect proposed events and duplicates.
7. Ask for explicit approval, then call `commit_calendar_sync` with `confirm: true`.

The server never books travel, sends mail, deletes events, or estimates flight time from a road route.
