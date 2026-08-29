-- Rename the application identity columns after the Better Auth cutover.
-- Keep the old Clerk value as a recovery/mapping key. A Clerk id is not a
-- Better Auth id: Better Auth generates a new id when a user signs up. The
-- staged backfill below only adopts an unambiguous Better Auth email match;
-- operators must populate auth_migrations.better_auth_user_id for legacy
-- users whose email was not stored in D1 before applying this migration.
ALTER TABLE users RENAME COLUMN clerk_user_id TO auth_user_id;
ALTER TABLE users ADD COLUMN legacy_clerk_user_id TEXT;
UPDATE users SET legacy_clerk_user_id = auth_user_id WHERE legacy_clerk_user_id IS NULL;
ALTER TABLE deleted_user_tombstones RENAME COLUMN clerk_user_id TO auth_user_id;
ALTER TABLE deleted_user_tombstones ADD COLUMN legacy_clerk_user_id TEXT;
UPDATE deleted_user_tombstones SET legacy_clerk_user_id = auth_user_id WHERE legacy_clerk_user_id IS NULL;
ALTER TABLE account_deletion_jobs RENAME COLUMN clerk_user_id TO auth_user_id;
ALTER TABLE account_deletion_jobs ADD COLUMN legacy_clerk_user_id TEXT;
UPDATE account_deletion_jobs SET legacy_clerk_user_id = auth_user_id WHERE legacy_clerk_user_id IS NULL;
ALTER TABLE auth_migrations RENAME COLUMN clerk_user_id TO auth_user_id;

-- Ensure every pre-cutover application row has a durable mapping record. The
-- auth_user_id column remains the legacy value until a Better Auth id is
-- known, so applying this migration never loses the old identity.
INSERT INTO auth_migrations (user_id, auth_user_id, better_auth_user_id, status, created_at, updated_at)
SELECT id, legacy_clerk_user_id, better_auth_user_id,
       CASE WHEN better_auth_user_id IS NULL THEN 'pending' ELSE 'completed' END,
       created_at, updated_at
FROM users
WHERE legacy_clerk_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM auth_migrations m WHERE m.user_id = users.id);

-- 0006 allowed an operator/import job to stage the target id directly on
-- users. Promote that value into the durable mapping table before any email
-- inference, including when a pending auth_migrations row already exists.
UPDATE auth_migrations
SET better_auth_user_id = (SELECT u.better_auth_user_id FROM users u WHERE u.id = auth_migrations.user_id),
    status = 'completed',
    updated_at = CURRENT_TIMESTAMP
WHERE better_auth_user_id IS NULL
  AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth_migrations.user_id
      AND u.better_auth_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM auth_migrations other
        WHERE other.better_auth_user_id = u.better_auth_user_id
          AND other.user_id <> u.id
      )
  );

-- A staged target id is already sufficient to complete the mapping. Normalize
-- old pending/email_sent statuses as long as the target is not claimed by a
-- different mapping, so the runtime cutover barrier cannot remain stuck.
UPDATE auth_migrations
SET status = 'completed', updated_at = CURRENT_TIMESTAMP
WHERE better_auth_user_id IS NOT NULL
  AND status <> 'completed'
  AND NOT EXISTS (
    SELECT 1 FROM auth_migrations other
    WHERE other.better_auth_user_id = auth_migrations.better_auth_user_id
      AND other.user_id <> auth_migrations.user_id
  );

-- Automatically complete only one-to-one email matches. Do not guess when
-- an email is absent or duplicated; those rows remain pending for an explicit
-- Clerk-id -> Better-Auth-id backfill before clients are cut over.
INSERT INTO auth_migrations (user_id, auth_user_id, better_auth_user_id, status, created_at, updated_at)
SELECT u.id, u.legacy_clerk_user_id, a.id, 'completed', u.created_at, u.updated_at
FROM users u
JOIN user a ON lower(a.email) = lower(u.email)
WHERE u.email IS NOT NULL AND trim(u.email) <> ''
  AND (SELECT COUNT(*) FROM users u2 WHERE lower(u2.email) = lower(u.email)) = 1
  AND (SELECT COUNT(*) FROM user a2 WHERE lower(a2.email) = lower(u.email)) = 1
  AND NOT EXISTS (
    SELECT 1 FROM auth_migrations m2
    WHERE m2.better_auth_user_id = a.id AND m2.user_id <> u.id
  )
  AND NOT EXISTS (SELECT 1 FROM auth_migrations m WHERE m.user_id = u.id AND m.better_auth_user_id IS NOT NULL)
ON CONFLICT (user_id) DO UPDATE SET
  better_auth_user_id = excluded.better_auth_user_id,
  status = 'completed',
  updated_at = excluded.updated_at
WHERE auth_migrations.better_auth_user_id IS NULL;

-- Apply completed mappings to the application and deletion records. Existing
-- rows with no mapping retain their legacy identity and are never silently
-- copied into a new numeric user row by the runtime bridge.
UPDATE users
SET auth_user_id = (SELECT m.better_auth_user_id FROM auth_migrations m WHERE m.user_id = users.id),
    better_auth_user_id = (SELECT m.better_auth_user_id FROM auth_migrations m WHERE m.user_id = users.id),
    updated_at = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM auth_migrations m WHERE m.user_id = users.id AND m.better_auth_user_id IS NOT NULL AND m.status = 'completed')
  AND NOT EXISTS (
    SELECT 1 FROM users other
    WHERE other.auth_user_id = (SELECT m.better_auth_user_id FROM auth_migrations m WHERE m.user_id = users.id)
      AND other.id <> users.id
  );

UPDATE deleted_user_tombstones
SET auth_user_id = (
  SELECT u.auth_user_id FROM users u
  WHERE u.legacy_clerk_user_id = deleted_user_tombstones.legacy_clerk_user_id
    AND u.better_auth_user_id IS NOT NULL
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM users u
  WHERE u.legacy_clerk_user_id = deleted_user_tombstones.legacy_clerk_user_id
    AND u.better_auth_user_id IS NOT NULL
);

UPDATE account_deletion_jobs
SET auth_user_id = (
  SELECT u.auth_user_id FROM users u
  WHERE u.legacy_clerk_user_id = account_deletion_jobs.legacy_clerk_user_id
    AND u.better_auth_user_id IS NOT NULL
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM users u
  WHERE u.legacy_clerk_user_id = account_deletion_jobs.legacy_clerk_user_id
    AND u.better_auth_user_id IS NOT NULL
);

DROP INDEX IF EXISTS idx_account_deletion_jobs_clerk_user_id;
CREATE INDEX IF NOT EXISTS idx_account_deletion_jobs_auth_user_id
  ON account_deletion_jobs(auth_user_id);
