import { readFileSync } from "node:fs";

const configPath = new URL("../wrangler.jsonc", import.meta.url);
const config = readFileSync(configPath, "utf8");

const placeholderId = "00000000-0000-0000-0000-000000000000";
const databaseIdMatches = [...config.matchAll(/"database_id"\s*:\s*"([^"]+)"/g)];
const databaseIdMatch = databaseIdMatches.at(-1);

if (!databaseIdMatch) {
  console.error("wrangler.jsonc is missing the production d1 database_id");
  process.exit(1);
}

const [, databaseId] = databaseIdMatch;

if (databaseId === placeholderId) {
  console.error(
    [
      "Remote D1 migration is not configured.",
      `the production environment still uses the placeholder database_id: ${placeholderId}`,
      "",
      "Fix:",
      "1. Run `wrangler d1 create filo-db` or `wrangler d1 list`.",
      "2. Copy the real database_id into env.production.d1_databases in wrangler.jsonc.",
      "3. Re-run `npm run db:migrate:remote`.",
    ].join("\n"),
  );
  process.exit(1);
}
