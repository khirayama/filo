import type { Tag } from "../api/types";
import { useAppData } from "./AppDataContext";
import { Button, IconButton, usePopover } from "./ui";

// Checklist popover for assigning tags to one subscription. Rendered as an
// icon button in dense lists and as a labelled button on the detail screen.
export function TagPicker({
  id,
  tags,
  selectedIds,
  onToggle,
  variant = "icon",
}: {
  id: string;
  tags: Tag[];
  selectedIds: number[];
  onToggle: (tagId: number) => void;
  variant?: "icon" | "button";
}) {
  const { t } = useAppData();
  const { open, setOpen, ref } = usePopover();
  if (tags.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {variant === "icon" ? (
        <IconButton
          icon="tag"
          label={t("タグを編集")}
          size={16}
          ariaExpanded={open}
          ariaHaspopup="dialog"
          ariaControls={id}
          onClick={() => setOpen((v) => !v)}
        />
      ) : (
        <Button small icon="tag" onClick={() => setOpen((v) => !v)}>
          {t("タグを編集")}
        </Button>
      )}
      {open ? (
        <div
          id={id}
          role="dialog"
          aria-label={t("タグを編集")}
          className={`fl-menu${variant === "button" ? " fl-menu--start" : ""}`}
          style={{ maxHeight: "320px", overflowY: "auto", width: "220px" }}
        >
          {tags.map((tag) => (
            <label key={tag.id} className="fl-menu-item" style={{ gap: "8px" }}>
              <input
                type="checkbox"
                checked={selectedIds.includes(tag.id)}
                onChange={() => onToggle(tag.id)}
                style={{ accentColor: "var(--fl-primary)", margin: 0 }}
              />
              {tag.color ? (
                <span style={{ background: tag.color, borderRadius: "50%", flexShrink: 0, height: "8px", width: "8px" }} />
              ) : null}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag.name}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
