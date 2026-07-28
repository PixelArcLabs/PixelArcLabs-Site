-- HoloDock purchases, licenses, download tokens
CREATE TABLE IF NOT EXISTS purchases (
  session_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  created INTEGER NOT NULL,
  livemode INTEGER NOT NULL DEFAULT 0,
  downloads_used INTEGER NOT NULL DEFAULT 0,
  bound_device_hash TEXT,
  activated_devices TEXT NOT NULL DEFAULT '[]',
  license_key_hash TEXT,
  license_key_last4 TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_purchases_email ON purchases(email_normalized);
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchases_license
  ON purchases(license_key_hash)
  WHERE license_key_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS download_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  device_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_session ON download_tokens(session_id);
