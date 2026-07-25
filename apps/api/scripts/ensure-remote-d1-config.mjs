import { readFileSync } from "node:fs";

const configPath = new URL("../wrangler.jsonc", import.meta.url);
const config = readFileSync(configPath, "utf8");

const placeholderId = "00000000-0000-0000-0000-000000000000";
const databaseIdMatch = config.match(/"database_id"\s*:\s*"([^"]+)"/);

if (!databaseIdMatch) {
  console.error("wrangler.jsonc is missing d1_databases[0].database_id");
  process.exit(1);
}

const [, databaseId] = databaseIdMatch;

if (databaseId === placeholderId) {
  console.error(
    [
      "Remote D1 migration is not configured.",
      `wrangler.jsonc still uses the placeholder database_id: ${placeholderId}`,
      "",
      "Fix:",
      "1. Run `wrangler d1 create filo-db` or `wrangler d1 list`.",
      "2. Copy the real database_id into wrangler.jsonc.",
      "3. Re-run `npm run db:migrate:remote`.",
    ].join("\n"),
  );
  process.exit(1);
}
