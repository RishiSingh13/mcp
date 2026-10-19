CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS itineraries (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS itineraries_updated_at_idx ON itineraries(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS calendar_previews (
  account_id text NOT NULL,
  id uuid NOT NULL,
  itinerary_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, id),
  FOREIGN KEY (account_id, itinerary_id) REFERENCES itineraries(account_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS calendar_previews_expiry_idx ON calendar_previews(account_id, expires_at);

CREATE TABLE IF NOT EXISTS calendar_syncs (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  preview_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'complete')),
  event_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (account_id, idempotency_key),
  FOREIGN KEY (account_id, preview_id) REFERENCES calendar_previews(account_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS calendar_syncs_status_idx ON calendar_syncs(account_id, status, updated_at);

CREATE TABLE IF NOT EXISTS oauth_credentials (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  ciphertext text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  state_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, state_hash)
);
CREATE INDEX IF NOT EXISTS oauth_states_expiry_idx ON oauth_states(expires_at);
