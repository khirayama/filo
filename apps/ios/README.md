# Filo iOS

SwiftUI app with Clerk-based email/password authentication.

## Setup

1. Copy `LocalSecrets.template.plist` to `LocalSecrets.plist`.
2. Set `CLERK_PUBLISHABLE_KEY`.
3. Leave `API_BASE_URL` at `http://localhost:8787` for the simulator (it shares the
   host's network stack, and ATS allows loopback over http). On a physical device
   set it to the host's LAN IP instead.

## Commands

- `just build`
- `just run`
