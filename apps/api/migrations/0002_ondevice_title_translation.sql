-- Title translation moved on-device (iOS: Translation framework, Android: ML Kit,
-- Web: Translator API). The server neither generates nor stores listing
-- translations any more, so the work ledger goes away entirely.
DROP TABLE IF EXISTS article_listing_translations;

-- The feed's declared language (RSS <language> / Atom xml:lang). It is the only
-- language signal the server keeps: new articles inherit it as their
-- `source_language` hint, which read-aloud uses to pick a voice. Clients that
-- translate on-device run their own detection and ignore this value.
ALTER TABLE feeds ADD COLUMN language TEXT;
