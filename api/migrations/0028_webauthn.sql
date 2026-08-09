-- Passkey (WebAuthn) support: registered credentials + short-lived ceremony challenges.

CREATE TABLE webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Credential ID as base64url — what the authenticator sends back on assertion.
  credential_id TEXT NOT NULL UNIQUE,
  -- Public key stored as a JWK JSON string (P-256 EC for ES256, RSA for RS256).
  public_key TEXT NOT NULL,
  -- COSE algorithm identifier: -7 = ES256, -257 = RS256.
  algorithm INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  -- JSON array of transport hints from registration (e.g. ["internal","hybrid"]).
  transports TEXT,
  nickname TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX idx_webauthn_credentials_user ON webauthn_credentials(user_id);

-- Single-use ceremony challenges (5-minute TTL). user_id is NULL for
-- authentication ceremonies (discoverable credentials identify the user).
CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('registration', 'authentication')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_webauthn_challenges_expires ON webauthn_challenges(expires_at);
