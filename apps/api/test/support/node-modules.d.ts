// Minimal declarations for the Node built-ins the D1 test harness uses. The
// project compiles against Workers types only, so @types/node is not loaded.

declare module "node:sqlite" {
  type SQLValue = null | number | bigint | string | Uint8Array;

  export class StatementSync {
    all(...params: SQLValue[]): Record<string, unknown>[];
    run(...params: SQLValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    columns(): unknown[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module "node:fs" {
  export function readdirSync(path: URL): string[];
  export function readFileSync(path: URL, encoding: "utf8"): string;
}

// Vitest runs the harness as an ES module in Node, where import.meta.url is set.
interface ImportMeta {
  readonly url: string;
}
