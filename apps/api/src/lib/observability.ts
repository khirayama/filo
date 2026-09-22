/**
 * D1 exposes rows_read / rows_written on statements that return metadata.
 * Keep the telemetry out of D1 itself: Workers Logs is the sink so measuring
 * a query never creates another database write.
 */
export function recordD1Meta(
  queryId: string,
  meta: { rows_read?: number; rows_written?: number; duration?: number } | undefined,
  fields: Record<string, unknown> = {},
): void {
  if (!meta) return;
  const rowsRead = Number(meta.rows_read ?? 0);
  const rowsWritten = Number(meta.rows_written ?? 0);
  // Keep normal low-cost queries quiet. The threshold is intentionally low
  // enough to catch regressions in the article and feed paths.
  if (rowsRead < 500 && rowsWritten < 100) return;
  console.log({
    event: "d1_query_cost",
    query_id: queryId,
    rows_read: rowsRead,
    rows_written: rowsWritten,
    duration_ms: Number(meta.duration ?? 0),
    ...fields,
  });
}

export function recordD1BatchMeta(
  queryId: string,
  results: Array<{ meta?: { rows_read?: number; rows_written?: number; duration?: number } }>,
  fields: Record<string, unknown> = {},
): void {
  let rowsRead = 0;
  let rowsWritten = 0;
  let duration = 0;
  for (const result of results) {
    rowsRead += Number(result.meta?.rows_read ?? 0);
    rowsWritten += Number(result.meta?.rows_written ?? 0);
    duration += Number(result.meta?.duration ?? 0);
  }
  recordD1Meta(queryId, { rows_read: rowsRead, rows_written: rowsWritten, duration }, {
    statements: results.length,
    ...fields,
  });
}
