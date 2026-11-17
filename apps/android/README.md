# Filo Android

Jetpack Compose app with Better Auth email/password authentication.

## Setup

1. Copy `local.properties.example` to `local.properties` if needed.
2. Set `sdk.dir` to your Android SDK path.
3. Set `apiBaseUrl`.
4. Leave `apiBaseUrl` at `http://10.0.2.2:8787` for the emulator (that address is
   the host's loopback, where `just api` listens). On a physical device set it to
   the host's LAN IP instead.
5. `webBaseUrl` (default `http://localhost:5173`) is where password reset emails
   send you. The link opens in the host's browser, so it stays on localhost even
   for the emulator, and it must be listed in the API's `BETTER_AUTH_TRUSTED_ORIGINS`.

For a production release build, set `productionApiBaseUrl` to
`https://api.filoreader.app` and keep `productionWebBaseUrl` at
`https://filoreader.app` in `local.properties`. `just build-release` rejects a
development URL and requires the release signing configuration.

## Commands

- `just build`
- `just build-release` (universal APK, about 70 MB with ML Kit native libraries for every ABI)
- `just bundle-release` (App Bundle for Play; each device downloads only its ABI)
- `just run`

## Emulator can't reach the local API

`just emulator` cold boots on purpose: a quick-booted snapshot sometimes comes back
with an empty routing table on the virtual Wi-Fi network, and every request then
fails with `network_error` while the emulator otherwise looks online. If you hit
this on an already-running emulator, `adb shell svc wifi disable` falls back to the
working cellular interface; a cold boot fixes it properly.
