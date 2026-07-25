-- Unify manual feed operations (fetch / title translation) into one job table
-- so the status page can show real queue state for both kinds.
CREATE TABLE feed_jobs (
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('fetch', 'translate')),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feed_id, kind),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE INDEX idx_feed_jobs_user_status ON feed_jobs(user_id, status, updated_at);
CREATE INDEX idx_feed_jobs_feed_kind ON feed_jobs(feed_id, kind, status);

INSERT INTO feed_jobs (user_id, feed_id, kind, status, requested_at, started_at, finished_at, last_error, updated_at)
SELECT user_id, feed_id, 'translate', status, requested_at, started_at, finished_at, last_error, updated_at
FROM feed_translation_jobs;

DROP TABLE feed_translation_jobs;
