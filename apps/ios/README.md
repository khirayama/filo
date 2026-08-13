# Filo iOS

SwiftUI app with Clerk-based email/password authentication.

## Setup

1. Copy `LocalSecrets.template.plist` to `LocalSecrets.plist`.
2. Set `CLERK_PUBLISHABLE_KEY`.
3. Leave `API_BASE_URL` at `http://localhost:8787` for the simulator (it shares the
   host's network stack, and ATS allows loopback over http). On a physical device
   set it to the host's LAN IP instead.

For a production release build, copy `LocalSecrets.production.template.plist` to
`LocalSecrets.plist`, replace the placeholder with the production Clerk
`pk_live_...` key, and keep `API_BASE_URL` at `https://api.filoreader.app`.
`just build-release` validates both values before building.

## Commands

- `just build`
- `just build-release`
- `just run`
