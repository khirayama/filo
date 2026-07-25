-- Keep a user-selected feed language from being replaced by feed refreshes.
ALTER TABLE feeds ADD COLUMN language_override TEXT;
