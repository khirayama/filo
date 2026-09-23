-- Pending-job recovery and seven-day cache retention both filter by status
-- and age. Keep those scheduled maintenance queries bounded as the cache grows.
UPDATE article_contents
SET created_at = CASE WHEN instr(created_at, 'T') = 0 THEN replace(created_at, ' ', 'T') || 'Z' ELSE created_at END,
    updated_at = CASE WHEN instr(updated_at, 'T') = 0 THEN replace(updated_at, ' ', 'T') || 'Z' ELSE updated_at END
WHERE instr(created_at, 'T') = 0 OR instr(updated_at, 'T') = 0;

CREATE INDEX IF NOT EXISTS idx_article_contents_status_updated_at
  ON article_contents(status, updated_at);
