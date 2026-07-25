-- The old trigram-based detector (franc) systematically mislabeled short
-- Latin-script text: plain English articles were stored with codes like 'sco'
-- or 'fr', which made the translation queue ask the model to "translate" them
-- and then reject the echoed output. Clear every detected code outside the
-- script-verifiable set so the reworked detector re-runs on the next refresh;
-- the translation queue self-heals from the corrected values (stale pairs are
-- deleted, error rows are re-enqueued).
UPDATE articles
SET source_language = NULL
WHERE source_language IS NOT NULL
  AND source_language NOT IN ('ja', 'en', 'zh', 'ko');

UPDATE feeds
SET language = NULL
WHERE language IS NOT NULL
  AND language NOT IN ('ja', 'en', 'zh', 'ko');
