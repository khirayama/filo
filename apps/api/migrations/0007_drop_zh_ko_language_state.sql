-- Drop legacy zh/ko settings and normalize persisted language state to the
-- current ja/en-only model.
PRAGMA defer_foreign_keys = on;

CREATE TABLE user_settings_new (
  user_id INTEGER PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'system'
    CHECK (theme IN ('light', 'dark', 'system')),
  language TEXT NOT NULL DEFAULT 'ja'
    CHECK (language IN ('ja', 'en')),
  readable_languages TEXT NOT NULL DEFAULT '["ja"]',
  article_sort_order TEXT NOT NULL DEFAULT 'published_at_desc'
    CHECK (article_sort_order IN ('published_at_desc', 'fetched_at_desc')),
  open_in_browser_by_default INTEGER NOT NULL DEFAULT 0
    CHECK (open_in_browser_by_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO user_settings_new (
  user_id, theme, language, readable_languages, article_sort_order,
  open_in_browser_by_default, created_at, updated_at
)
SELECT
  user_id,
  theme,
  CASE
    WHEN LOWER(language) = 'en' OR LOWER(language) = 'eng' OR LOWER(language) LIKE 'en-%' THEN 'en'
    ELSE 'ja'
  END AS language,
  CASE
    WHEN readable_languages IS NULL THEN '["ja"]'
    ELSE json_array(
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM json_each(readable_languages)
          WHERE LOWER(value) = 'ja' OR LOWER(value) = 'jpn' OR LOWER(value) LIKE 'ja-%'
        ) THEN 'ja'
      END,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM json_each(readable_languages)
          WHERE LOWER(value) = 'en' OR LOWER(value) = 'eng' OR LOWER(value) LIKE 'en-%'
        ) THEN 'en'
      END
    )
  END AS readable_languages,
  article_sort_order,
  open_in_browser_by_default,
  created_at,
  updated_at
FROM user_settings;

UPDATE user_settings_new
SET readable_languages = COALESCE(
  (
    SELECT json_group_array(value)
    FROM json_each(user_settings_new.readable_languages)
    WHERE value IS NOT NULL
  ),
  '["ja"]'
);

DROP TABLE user_settings;
ALTER TABLE user_settings_new RENAME TO user_settings;

UPDATE feeds
SET language = CASE
  WHEN language IS NULL THEN NULL
  WHEN LOWER(language) = 'ja' OR LOWER(language) = 'jpn' OR LOWER(language) LIKE 'ja-%' THEN 'ja'
  WHEN LOWER(language) = 'en' OR LOWER(language) = 'eng' OR LOWER(language) LIKE 'en-%' THEN 'en'
  ELSE NULL
END
WHERE language IS NOT NULL;

UPDATE articles
SET source_language = CASE
  WHEN source_language IS NULL THEN NULL
  WHEN LOWER(source_language) = 'ja' OR LOWER(source_language) = 'jpn' OR LOWER(source_language) LIKE 'ja-%' THEN 'ja'
  WHEN LOWER(source_language) = 'en' OR LOWER(source_language) = 'eng' OR LOWER(source_language) LIKE 'en-%' THEN 'en'
  ELSE NULL
END
WHERE source_language IS NOT NULL;
