-- Source language is determined by the translation AI and stored with the
-- extracted article content. Feed/article language metadata is no longer
-- persisted.
ALTER TABLE feeds DROP COLUMN language;
ALTER TABLE feeds DROP COLUMN language_override;
ALTER TABLE feeds DROP COLUMN detected_language;
ALTER TABLE articles DROP COLUMN source_language;
