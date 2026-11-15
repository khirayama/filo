# Filo iOS

SwiftUI app with Better Auth email/password authentication.

## Setup

1. Copy `LocalSecrets.template.plist` to `LocalSecrets.plist`.
2. Set `API_BASE_URL` to the API origin and `WEB_BASE_URL` to the Web app origin.
   Authentication and password reset use Better Auth email/password.
3. Leave `API_BASE_URL` at `http://localhost:8787` for the simulator (it shares the
   host's network stack, and ATS allows loopback over http). On a physical device
   set it to the host's LAN IP instead.

For a production release build, copy `LocalSecrets.production.template.plist` to
`LocalSecrets.plist`, keep `API_BASE_URL` at `https://api.filoreader.app`, and
set `WEB_BASE_URL` to `https://filoreader.app`. `just build-release` validates
the API and Web URLs before building.

## Commands

- `just build`
- `just build-release`
- `just run`
