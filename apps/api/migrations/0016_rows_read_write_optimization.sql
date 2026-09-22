-- The status screen asks for the newest logs for one feed. Without this
-- index SQLite scans the entire operational log table for every request.
CREATE INDEX IF NOT EXISTS idx_feed_fetch_logs_feed_id_id
  ON feed_fetch_logs(feed_id, id DESC);

-- Scheduled retention removes old operational logs by time in bounded
-- batches. Keep that cleanup indexed as well so it does not scan the table.
CREATE INDEX IF NOT EXISTS idx_feed_fetch_logs_started_at
  ON feed_fetch_logs(started_at);
