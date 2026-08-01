-- 削除した翻訳 drain が付けた articles.source_language は信用できない。
-- 日本語の記事に 'zh' が付いている例が実データで確認された（LLM の自己申告値）。
-- 一度すべて捨て、fetch 時の判定(lib/languageDetect.ts)で埋め直す。
UPDATE articles SET source_language = NULL;
