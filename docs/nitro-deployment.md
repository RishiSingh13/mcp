# Nitro deployment verification checklist

No Nitro Cloud/Nitro Desk deployment settings were supplied. No platform-specific manifest, endpoint, command, or auth convention is assumed here. Before deployment, check the official event documentation for:

- Runtime/version, build command, entrypoint, port binding, and secret injection.
- Required MCP protocol version, transport, and endpoint path.
- Whether the host can send `Authorization: Bearer` and how credentials are configured.
- Health-check behavior and any required deployment manifest.
- Public URL and exact Google OAuth callback URI.

This app currently supports Node HTTP on `0.0.0.0:$PORT`, POST Streamable HTTP at `/mcp`, bearer authentication when `MCP_AUTH_TOKEN` is set, and `/health`. Do not connect personal Google data to a public endpoint unless the documented host auth works and durable token/security requirements are addressed. This checklist is informational; platform adaptation is intentionally deferred until official requirements are provided.
