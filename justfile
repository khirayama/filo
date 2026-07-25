set shell := ["zsh", "-cu"]

default:
  @just --list

android:
  cd apps/android && just build && just run

ios:
  cd apps/ios && just build && just run

native:
  just android
  just ios

web:
  cd apps/web && npm run dev

run-all:
  just android
  just ios
  just web

api:
  cd apps/api && npm run dev

lm-studio:
  curl --fail --silent --show-error http://localhost:1234/v1/models >/dev/null 2>&1 || lms server start --port 1234
  lms load google/gemma-4-12b-qat --identifier google/gemma-4-12b-qat --gpu max --context-length 32768 --parallel 1 --yes

reextract:
  cd apps/api && npx wrangler d1 execute filo-db --local --command "DELETE FROM article_contents"

refresh-feeds:
  cd apps/api && npx wrangler d1 execute filo-db --local --command "UPDATE feed_fetch_states SET next_fetch_after = datetime('now')"
