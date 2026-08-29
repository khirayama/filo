-- Better Auth 1.7 scopes account identities by issuer.
ALTER TABLE account ADD COLUMN issuer TEXT NOT NULL DEFAULT 'local:credential';
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_issuer_account_id
  ON account(issuer, account_id);
