-- Preserve the latest automatically detected language separately from a
-- user-selected feed language override.
ALTER TABLE feeds ADD COLUMN detected_language TEXT;

UPDATE feeds
SET detected_language = language
WHERE detected_language IS NULL;
