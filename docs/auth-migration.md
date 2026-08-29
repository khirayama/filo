# Better Auth authentication

## Decision

Filo uses Better Auth for email/password authentication and Resend for
transactional email. OAuth is intentionally out of scope. Web uses the
Better Auth cookie session; the Chrome Extension, iOS, and Android clients
use bearer tokens stored in their platform secure storage.

The API keeps the numeric `users.id` as the application identity and stores
the provider-neutral Better Auth id in `users.auth_user_id`. The final clean
schema is applied by `0009_destructive_auth_cutover.sql`.

## Clean cutover (required)

Backward compatibility and existing data are intentionally out of scope. The
Clerk identity store, old sessions, credentials, and application data are not
backfilled. Migration `0009_destructive_auth_cutover.sql` explicitly clears
those identities and user-owned rows, removes the temporary bridge tables, and
retains only shared feeds/articles before the Better Auth clients are enabled.

```bash
cd apps/api
npm run db:migrate:remote
npm run deploy:production
```

Every user must register again with Better Auth. Do not run a Clerk export,
backfill generator, or mapping preflight; there is no legacy identity mapping
to preserve. Verify only that the Better Auth schema is applied successfully
and that a new sign-up, sign-in, and password reset work
against the target database.

## Email flows

- Sign-up does not send or require an email verification message.
- Password reset sends a link whose callback is `filo://auth/reset`. iOS and
  Android receive the token and immediately show the new-password screen.
- Resend is used only for password reset delivery.

## Session policy

```ts
session: {
  expiresIn: 60 * 60 * 24 * 30,
  updateAge: 60 * 60 * 24,
}
```

Reset tokens are managed by Better Auth. `BETTER_AUTH_SECRET`
is a production-only Worker secret and is never committed or embedded in a
client. `RESEND_API_KEY` is also a Worker secret; the existing key is retained
and is intentionally not rotated in this release.

## Local development

Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`, set the local
Better Auth secret and Resend values, then apply the local D1 migrations:

```bash
npm run db:migrate:local
npm run dev
```

The mobile deep-link scheme is `filo://auth`. iOS declares it in the generated
Info.plist and Android declares it in `AndroidManifest.xml`.
