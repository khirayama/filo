export type ArticleShortcut = "next" | "previous" | "open" | "external" | "read" | "list" | "bookmark" | "refresh" | "markAll" | "help";

export function articleShortcut(event: Pick<KeyboardEvent, "key" | "repeat" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">): ArticleShortcut | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const key = event.key.toLowerCase();
  if (event.shiftKey && key === "a") return event.repeat ? null : "markAll";
  if (event.key === "?" && !event.repeat) return "help";
  if (event.shiftKey) return null;
  if (key === "j" || event.key === "ArrowDown") return "next";
  if (key === "k" || event.key === "ArrowUp") return "previous";
  if (event.repeat) return null;
  switch (key) {
    case "enter": case "o": return "open";
    case "v": return "external";
    case "m": return "read";
    case "s": return "list";
    case "b": return "bookmark";
    case "r": return "refresh";
    default: return null;
  }
}
