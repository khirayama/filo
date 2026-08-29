# Filo Android

Jetpack Compose app with Better Auth email/password authentication.

## Setup

1. Copy `local.properties.example` to `local.properties` if needed.
2. Set `sdk.dir` to your Android SDK path.
3. Set `apiBaseUrl`.
4. Leave `apiBaseUrl` at `http://10.0.2.2:8787` for the emulator (that address is
   the host's loopback, where `just api` listens). On a physical device set it to
   the host's LAN IP instead.

For a production release build, set `productionApiBaseUrl` to
`https://api.filoreader.app` in `local.properties`. `just build-release` rejects
development API URL and local authentication settings.

## Commands

- `just build`
- `just build-release`
- `just run`

## Emulator can't reach the local API

`just emulator` cold boots on purpose: a quick-booted snapshot sometimes comes back
with an empty routing table on the virtual Wi-Fi network, and every request then
fails with `network_error` while the emulator otherwise looks online. If you hit
this on an already-running emulator, `adb shell svc wifi disable` falls back to the
working cellular interface; a cold boot fixes it properly.
