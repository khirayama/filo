-- Track which pending translation pairs are currently in flight to the model.
-- NULL = queued (waiting in line); a timestamp = the drain has picked the pair
-- up and is awaiting the model's response. This lets the status screen tell
-- 順番待ち (queued) apart from 翻訳中 (processing / LLM応答待ち) and surface the
-- title currently being translated.
ALTER TABLE article_listing_translations ADD COLUMN processing_at TEXT;
