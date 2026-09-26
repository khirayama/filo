import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// A D1Database backed by an in-memory SQLite with every migration applied,
// so route and job code can be exercised against the real schema, indexes,
// and triggers. A batch runs in one transaction, as it does on D1.

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

type Row = Record<string, unknown>;

function toSqlValue(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string" || typeof value === "bigint") return value;
  throw new Error(`unsupported bind value: ${String(value)}`);
}

class TestStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): TestStatement {
    return new TestStatement(this.sqlite, this.sql, values);
  }

  execute(): { results: Row[]; changes: number; lastRowId: number } {
    const statement = this.sqlite.prepare(this.sql);
    const params = this.params.map(toSqlValue);
    if (statement.columns().length > 0) {
      const results = statement.all(...params).map((row) => ({ ...row }));
      const { changes } = this.sqlite.prepare("SELECT changes() AS changes").all()[0] as { changes: number };
      return { results, changes, lastRowId: 0 };
    }
    const run = statement.run(...params);
    return { results: [], changes: Number(run.changes), lastRowId: Number(run.lastInsertRowid) };
  }

  toResult(): D1Result<Row> {
    const { results, changes, lastRowId } = this.execute();
    return {
      results,
      success: true,
      meta: { changes, last_row_id: lastRowId, rows_read: 0, rows_written: 0, duration: 0 },
    } as unknown as D1Result<Row>;
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.execute().results[0];
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T>(): Promise<D1Result<T>> {
    return this.toResult() as unknown as D1Result<T>;
  }

  async run(): Promise<D1Result> {
    return this.toResult();
  }
}

export interface TestD1 {
  db: D1Database;
  sqlite: DatabaseSync;
  rows<T = Row>(sql: string, ...params: unknown[]): T[];
  exec(sql: string, ...params: unknown[]): void;
}

export function createTestD1(): TestD1 {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  for (const name of migrations) sqlite.exec(readFileSync(new URL(name, MIGRATIONS_DIR), "utf8"));
  sqlite.exec("PRAGMA foreign_keys = ON");

  const db = {
    prepare: (sql: string) => new TestStatement(sqlite, sql),
    batch: async (statements: TestStatement[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.toResult());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;

  return {
    db,
    sqlite,
    rows: <T = Row>(sql: string, ...params: unknown[]) =>
      sqlite.prepare(sql).all(...params.map(toSqlValue)).map((row) => ({ ...row }) as T),
    exec: (sql: string, ...params: unknown[]) => {
      sqlite.prepare(sql).run(...params.map(toSqlValue));
    },
  };
}
