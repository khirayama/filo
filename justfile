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

reextract:
  cd apps/api && npx wrangler d1 execute filo-db --local --command "DELETE FROM article_contents"

refresh-feeds:
  cd apps/api && npx wrangler d1 execute filo-db --local --command "UPDATE feed_fetch_states SET next_fetch_after = datetime('now')"
