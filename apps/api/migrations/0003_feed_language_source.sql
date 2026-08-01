-- 言語判定を fetch 時に行うようにしたので、feeds.language が発行者の申告なのか
-- こちらの判定結果なのかを区別する。申告があるフィードでは、後から判定結果で
-- 上書きしないための情報。
ALTER TABLE feeds ADD COLUMN language_source TEXT
  CHECK (language_source IS NULL OR language_source IN ('declared', 'detected'));
