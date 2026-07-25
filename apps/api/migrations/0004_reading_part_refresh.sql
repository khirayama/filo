-- Body translation is no longer provided by the app (delegated to platform /
-- browser translation), listing translations are title-only, and playback
-- state no longer tracks a content type.

DROP TABLE IF EXISTS article_content_translations;

ALTER TABLE article_listing_translations DROP COLUMN preview_text;

ALTER TABLE playback_states DROP COLUMN content_type;
