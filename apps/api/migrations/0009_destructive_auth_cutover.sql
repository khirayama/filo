-- Final, destructive Better Auth cutover.
--
-- The earlier 0006-0008 migrations were deployed with a temporary Clerk
-- bridge.  That bridge is intentionally removed here: this application does
-- not preserve legacy identities or user-owned data.  Shared feeds/articles
-- remain in place, while deleting users cascades all user-owned rows.  Auth
-- identities are also reset; everyone must register again after the cutover.
PRAGMA foreign_keys = ON;

-- Remove the temporary Better Auth bridge and its mapping ledger.  The
-- singular Better Auth tables (user/session/account/verification) are the
-- canonical auth store and are deliberately retained.
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_accounts;
DROP TABLE IF EXISTS auth_verifications;
DROP TABLE IF EXISTS auth_migrations;
DROP TABLE IF EXISTS auth_users;

-- Better Auth identities are disposable during this cutover as well.  Delete
-- dependent rows first so this remains valid with foreign_keys enabled.
DELETE FROM session;
DELETE FROM account;
DELETE FROM verification;
DELETE FROM user;

-- Deletion records contain only the old identity at this point, so recreate
-- them below with the canonical Better Auth identity.  Dropping jobs first
-- also removes all indexes from the old schema, including the Clerk index.
DROP TABLE IF EXISTS account_deletion_jobs;
DROP TABLE IF EXISTS deleted_user_tombstones;

-- Existing application identities and all rows that reference them are
-- disposable for this cutover.  With foreign_keys enabled this cascades the
-- user-owned rows while leaving shared feeds and articles intact.
DELETE FROM users;
DROP TABLE users;

-- The application projection of an authenticated Better Auth user.  The
-- numeric id remains the FK target used by user-owned application tables;
-- auth_user_id is the sole external identity.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_user_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE deleted_user_tombstones (
  auth_user_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cleanup_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (cleanup_status IN ('pending', 'running', 'completed', 'failed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account_deletion_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  auth_user_id TEXT NOT NULL,
  deletion_token TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_account_deletion_jobs_status_updated_at
  ON account_deletion_jobs(status, updated_at);
CREATE INDEX idx_account_deletion_jobs_auth_user_id
  ON account_deletion_jobs(auth_user_id);

-- Foreign-key and token cleanup paths used by Better Auth/account deletion.
CREATE INDEX idx_session_user_id ON session(user_id);
CREATE INDEX idx_account_user_id ON account(user_id);
CREATE INDEX idx_verification_identifier_value ON verification(identifier, value);
