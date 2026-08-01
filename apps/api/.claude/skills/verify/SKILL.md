---
name: verify
description: Verify apps/api job/fetch changes by driving the real job code against the local D1 state via the verification worker.
---

# Verify apps/api changes

## Surface

The verification worker at `.wrangler/verify/worker.ts` exposes the real job
function `runFetchFeed` over HTTP against the local D1 state. It compiles fresh
from `src/` at startup and hot-reloads on save,
same as the main `wrangler dev` on port 8787 (both run current working-tree
code; check the wrangler terminal for the Reloading line if unsure).

## Launch

```bash
cd apps/api
npx wrangler dev --config .wrangler/verify/wrangler.jsonc --persist-to .wrangler/state --port 8788
```

`--persist-to .wrangler/state` is required: it points the worker at the same
local D1 the main dev server uses. Sharing the sqlite with a running dev
server on 8787 works fine.

## Drive

```bash
curl http://127.0.0.1:8788/fetch/<feedId>     # run runFetchFeed for one feed
```

The endpoint returns `{"ok":true,...}` even when the fetch job itself settled
as failed — observe outcomes in the DB, not the HTTP response.

## Observe

Local D1 sqlite (inspect directly with sqlite3):

```
.wrangler/state/v3/d1/miniflare-D1DatabaseObject/9ba2b04bf514d9facfd57ed57d849e77241a7adc99d1c1545d06688b43d84248.sqlite
```

Useful tables: `feeds` (feed_url/status), `feed_fetch_states`
(last_result/last_error/etag), `subscriptions`, `feed_read_cursors`,
`feed_fetch_logs`.

## Gotchas

- Back up the sqlite to the scratchpad before mutating scenarios; seed
  synthetic rows (subscriptions, cursors, feeds) directly with sqlite3 and
  clean them up after.
- `runFetchFeed(env, id, "refresh")` skips paused feeds silently (fast ~2ms
  response is the tell). Reactivate with
  `UPDATE feeds SET status='active' WHERE id=?` first.
- safeFetch blocks localhost/private IPs (SSRF guard) — redirect/fetch
  scenarios need real external URLs. Known live fixtures:
  `http://memo.goodpatch.co/feed` → 301 → `https://goodpatch.com/blog/feed`;
  `http://hnrss.org/frontpage` → 301 → https (honors ETag → 304 on re-fetch).
- 3 consecutive failures auto-pause a feed.
- Raw sqlite3 sessions do NOT enforce foreign keys (PRAGMA foreign_keys
  defaults off) — a seeded row can silently reference a deleted user. Check
  `users` first: the app under test may have recreated the account (new user
  id, old rows cascade-deleted) between your snapshots.
- Known live fixture for the https-dead/http-301 downgrade path:
  `https://memo.goodpatch.co/feed/` (https times out at TLS; http side 301s
  to the feed's new home).
