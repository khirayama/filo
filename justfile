set shell := ["zsh", "-cu"]

default:
  @just --list

android:
  cd apps/android && just build && just run

android-release:
  cd apps/android && just build-release

emulator target='Pixel_9_API_35':
  cd apps/android && just emulator "{{target}}"

ios:
  cd apps/ios && just build && just run

ios-release:
  cd apps/ios && just build-release

simulator target='DEACF1DB-C035-439D-BB01-D07B25C7B8A7':
  cd apps/ios && just simulator "{{target}}"

native:
  just android
  just ios

native-release:
  just android-release
  just ios-release

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
