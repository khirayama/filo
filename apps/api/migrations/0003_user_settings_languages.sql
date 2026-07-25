-- 0001 restricted user_settings.language to ja/en, but the app accepts every
-- supported language (ja/en/zh/ko), so PATCH /settings with zh/ko failed at
-- the DB layer with a CHECK violation. Rebuild the table with the full list.
PRAGMA defer_foreign_keys = on;

CREATE TABLE user_settings_new (
  user_id INTEGER PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'system'
    CHECK (theme IN ('light', 'dark', 'system')),
  language TEXT NOT NULL DEFAULT 'ja'
    CHECK (language IN ('ja', 'en', 'zh', 'ko')),
  readable_languages TEXT NOT NULL DEFAULT '["ja"]',
  article_sort_order TEXT NOT NULL DEFAULT 'published_at_desc'
    CHECK (article_sort_order IN ('published_at_desc', 'fetched_at_desc')),
  open_in_browser_by_default INTEGER NOT NULL DEFAULT 0
    CHECK (open_in_browser_by_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO user_settings_new
  SELECT user_id, theme, language, readable_languages, article_sort_order,
         open_in_browser_by_default, created_at, updated_at
  FROM user_settings;

DROP TABLE user_settings;
ALTER TABLE user_settings_new RENAME TO user_settings;
