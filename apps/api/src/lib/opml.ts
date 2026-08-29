import { XMLParser } from "fast-xml-parser";

export interface OpmlOutline {
  feedUrl: string;
  siteUrl: string | null;
  title: string | null;
  tagNames: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  // XXE safety: fast-xml-parser does not resolve external entities by design.
  trimValues: true,
});

export function parseOpml(xml: string, maxOutlines = 2000): { outlines: OpmlOutline[]; total: number } {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const opml = doc["opml"] as Record<string, unknown> | undefined;
  const body = opml?.["body"] as Record<string, unknown> | undefined;
  if (!body) throw new Error("not an OPML document");

  const outlines: OpmlOutline[] = [];
  let total = 0;

  const walk = (node: unknown, folders: string[], depth: number) => {
    if (depth > 10) return;
    const list = Array.isArray(node) ? node : node ? [node] : [];
    for (const raw of list) {
      if (total >= maxOutlines) return;
      const outline = raw as Record<string, unknown>;
      const xmlUrl = outline["@_xmlUrl"] as string | undefined;
      const siteUrl = outline["@_htmlUrl"] as string | undefined;
      const titleAttr = (outline["@_title"] as string | undefined) ?? (outline["@_text"] as string | undefined);
      if (xmlUrl) {
        total++;
        outlines.push({ feedUrl: xmlUrl, siteUrl: siteUrl ?? null, title: titleAttr ?? null, tagNames: [...folders] });
      }
      const children = outline["outline"];
      if (children) {
        const folderName = !xmlUrl && titleAttr ? [...folders, titleAttr] : folders;
        walk(children, folderName, depth + 1);
      }
    }
  };

  walk(body["outline"], [], 0);
  return { outlines, total };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface OpmlExportEntry {
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  tagNames: string[];
}

export function buildOpml(entries: OpmlExportEntry[]): string {
  const byTag = new Map<string, OpmlExportEntry[]>();
  const untagged: OpmlExportEntry[] = [];
  for (const entry of entries) {
    if (entry.tagNames.length === 0) {
      untagged.push(entry);
      continue;
    }
    for (const tag of entry.tagNames) {
      const list = byTag.get(tag) ?? [];
      list.push(entry);
      byTag.set(tag, list);
    }
  }

  const outline = (entry: OpmlExportEntry, indent: string) =>
    `${indent}<outline type="rss" text="${escapeXml(entry.title)}" title="${escapeXml(entry.title)}" xmlUrl="${escapeXml(entry.feedUrl)}"${entry.siteUrl ? ` htmlUrl="${escapeXml(entry.siteUrl)}"` : ""}/>`;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    "    <title>filo subscriptions</title>",
    "  </head>",
    "  <body>",
  ];
  for (const [tag, list] of [...byTag.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`    <outline text="${escapeXml(tag)}" title="${escapeXml(tag)}">`);
    for (const entry of list) lines.push(outline(entry, "      "));
    lines.push("    </outline>");
  }
  for (const entry of untagged) lines.push(outline(entry, "    "));
  lines.push("  </body>", "</opml>", "");
  return lines.join("\n");
}
