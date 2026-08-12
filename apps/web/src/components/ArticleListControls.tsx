import { useState } from "react";
import type { ArticleReadOrder, ArticleSortOrder } from "../api/types";
import { useTitleTranslation } from "./TitleTranslationContext";
import { FilterChip, IconButton, MenuItem, menuStyle, palette } from "./ui";

type Translator = (source: string) => string;

export function ArticleListControls({
  read,
  sort,
  readOrder,
  defaultSort,
  setRead,
  setSort,
  setReadOrder,
  t,
}: {
  read: boolean | undefined;
  sort: ArticleSortOrder | undefined;
  readOrder: ArticleReadOrder | undefined;
  defaultSort: ArticleSortOrder;
  setRead: (value: boolean | undefined) => void;
  setSort: (value: ArticleSortOrder | undefined) => void;
  setReadOrder: (value: ArticleReadOrder | undefined) => void;
  t: Translator;
}) {
  const [open, setOpen] = useState(false);
  const effectiveSort = sort ?? defaultSort;
  const effectiveReadOrder = readOrder ?? "unread_first";
  const { supported, enabled, translating, toggle } = useTitleTranslation();
  const choose = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div style={{ position: "relative" }}>
      <IconButton icon="gear" label={t("表示設定")} active={open} onClick={() => setOpen((value) => !value)} />
      {open ? (
        <div role="dialog" aria-label={t("表示設定")} style={{ ...menuStyle, minWidth: "250px", padding: "10px" }}>
          {supported ? (
            <div style={{ borderBottom: `1px solid ${palette.mutedBorder}`, paddingBottom: "4px" }}>
              <MenuItem
                label={`${t("タイトルを翻訳")}${enabled ? " ✓" : ""}${translating ? ` (${t("翻訳中…")})` : ""}`}
                onClick={() => choose(toggle)}
              />
            </div>
          ) : null}
          <p style={{ color: palette.muted, fontSize: "12px", margin: "0 4px 6px" }}>{t("既読状態")}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            <FilterChip label={t("全ての記事")} active={read === undefined} onClick={() => choose(() => setRead(undefined))} />
            <FilterChip label={t("未読")} active={read === false} onClick={() => choose(() => setRead(false))} />
            <FilterChip label={t("既読")} active={read === true} onClick={() => choose(() => setRead(true))} />
          </div>
          <p style={{ color: palette.muted, fontSize: "12px", margin: "12px 4px 6px" }}>{t("並び順")}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            <FilterChip label={t("公開日時が新しい順")} active={effectiveSort === "published_at_desc"} onClick={() => choose(() => setSort("published_at_desc"))} />
            <FilterChip label={t("取得日時が新しい順")} active={effectiveSort === "fetched_at_desc"} onClick={() => choose(() => setSort("fetched_at_desc"))} />
          </div>
          <p style={{ color: palette.muted, fontSize: "12px", margin: "12px 4px 6px" }}>{t("既読の扱い")}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            <FilterChip label={t("既読で並び替えない")} active={effectiveReadOrder === "none"} onClick={() => choose(() => setReadOrder("none"))} />
            <FilterChip label={t("既読は下")} active={effectiveReadOrder === "unread_first"} onClick={() => choose(() => setReadOrder("unread_first"))} />
            <FilterChip label={t("既読は上")} active={effectiveReadOrder === "read_first"} onClick={() => choose(() => setReadOrder("read_first"))} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
