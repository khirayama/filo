import { useCallback, useEffect, useState } from "react";
import type { ArticleListItem } from "../api/types";
import { articleShortcut, isShortcutIgnoredFor } from "../lib/articleShortcuts";
import { useAppData } from "./AppDataContext";
import { IconButton, useDialogFocus } from "./ui";

type ArticlePatch = { isRead: boolean } | { inReadingList: boolean } | { isBookmarked: boolean };

function isRowVisible(articleId: number | undefined): boolean {
  const row = articleId === undefined ? null : document.getElementById(`filo-article-${articleId}`);
  if (!row) return false;
  const headerBottom = document.querySelector<HTMLElement>("[data-filo-page-header]")?.getBoundingClientRect().bottom ?? 0;
  const rect = row.getBoundingClientRect();
  return rect.bottom > headerBottom && rect.top < window.innerHeight;
}

// The article list keyboard (SPEC/SHORTCUTS.md), shared by every list screen.
export function useArticleShortcuts({
  articles,
  onUpdateState,
  onRefresh,
  onMarkAll,
}: {
  articles: ArticleListItem[];
  onUpdateState: (articleId: number, patch: ArticlePatch) => void;
  onRefresh?: () => void;
  // Absent where the list has no bulk action (reading list, bookmarks).
  onMarkAll?: () => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const closeHelp = useCallback(() => setHelpOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A modal dialog owns the keyboard until it closes.
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      if (isShortcutIgnoredFor(event.target as Element | null, event.key)) return;
      const action = articleShortcut(event);
      if (!action) return;
      event.preventDefault();
      if (action === "next" || action === "previous") {
        if (articles.length === 0) return;
        const step = action === "next" ? 1 : -1;
        setActiveIndex((current) => {
          if (current != null && isRowVisible(articles[current]?.id)) {
            return Math.max(0, Math.min(articles.length - 1, current + step));
          }
          const firstVisible = articles.findIndex((article) => isRowVisible(article.id));
          return firstVisible < 0 ? 0 : firstVisible;
        });
      } else if (action === "open" || action === "external" || action === "read" || action === "list" || action === "bookmark") {
        const index = activeIndex ?? 0;
        const article = articles[index];
        if (!article) return;
        setActiveIndex(index);
        if (action === "open" || action === "external") {
          if (article.canonicalUrl) window.open(article.canonicalUrl, "_blank", "noopener,noreferrer");
        } else {
          onUpdateState(article.id, action === "read"
            ? { isRead: !article.userState.isRead }
            : action === "list"
              ? { inReadingList: !article.userState.inReadingList }
              : { isBookmarked: !article.userState.isBookmarked });
        }
      } else if (action === "refresh") {
        onRefresh?.();
      } else if (action === "markAll") {
        onMarkAll?.();
      } else if (action === "help") {
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    setActiveIndex((index) => index == null || articles.length === 0 ? null : Math.min(index, articles.length - 1));
  }, [articles.length]);

  const activeArticleId = activeIndex == null ? undefined : articles[activeIndex]?.id;
  useEffect(() => {
    if (activeArticleId !== undefined) document.getElementById(`filo-article-${activeArticleId}`)?.scrollIntoView({ block: "center" });
  }, [activeArticleId]);

  const clearSelection = useCallback(() => setActiveIndex(null), []);
  return { activeArticleId, clearSelection, helpOpen, closeHelp };
}

export function ShortcutHelpDialog({ onClose }: { onClose: () => void }) {
  const { t } = useAppData();
  useDialogFocus(true, "filo-shortcut-help", onClose);
  return (
    <div role="dialog" id="filo-shortcut-help" aria-modal="true" aria-labelledby="filo-shortcut-help-title" onClick={onClose} className="fl-dialog-scrim">
      <section onClick={(event) => event.stopPropagation()} className="fl-dialog" style={{ maxWidth: "360px" }}>
        <div className="fl-dialog-header">
          <h2 id="filo-shortcut-help-title">{t("ショートカット")}</h2>
          <IconButton icon="close" label={t("閉じる")} onClick={onClose} />
        </div>
        <pre style={{ fontFamily: "inherit", fontSize: "14px", lineHeight: 1.8, margin: 0, whiteSpace: "pre-wrap" }}>{t("ショートカットヘルプ")}</pre>
      </section>
    </div>
  );
}
