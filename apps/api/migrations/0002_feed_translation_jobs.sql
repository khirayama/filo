CREATE TABLE feed_translation_jobs (
  user_id INTEGER NOT NULL,
  feed_id INTEGER NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  force INTEGER NOT NULL DEFAULT 0
    CHECK (force IN (0, 1)),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feed_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

CREATE INDEX idx_feed_translation_jobs_status ON feed_translation_jobs(user_id, status, updated_at);
