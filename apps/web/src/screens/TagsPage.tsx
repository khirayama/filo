import { useEffect, useState } from "react";
import { useApi } from "../api/useApi";
import type { Tag } from "../api/types";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import {
  Button,
  EmptyState,
  ErrorBox,
  IconButton,
  Spinner,
  palette,
} from "../components/ui";
import { errorMessage } from "../lib/messages";
import { moveItem } from "../lib/reorder";

export function TagsPage() {
  const api = useApi();
  const appData = useAppData();
  const { t, language } = appData;
  // Local copy allows optimistic reordering; refreshed from context after
  // every successful mutation.
  const [tags, setTags] = useState<Tag[]>(appData.tags);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const loading = appData.loading;
  const load = appData.refresh;

  useEffect(() => {
    setTags(appData.tags);
  }, [appData.tags]);

  const create = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      await api.createTag(newName.trim());
      setNewName("");
      await load();
    } catch (e) {
      setError(errorMessage(e, language));
    } finally {
      setCreating(false);
    }
  };

  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const startEdit = (tag: Tag) => {
    setEditingTag(tag);
    setEditName(tag.name);
    setEditColor(tag.color ?? "");
  };

  const cancelEdit = () => {
    setEditingTag(null);
  };

  const saveEdit = async () => {
    if (!editingTag || !editName.trim()) return;
    const patch: { name?: string; color?: string | null } = {};
    if (editName.trim() !== editingTag.name) patch.name = editName.trim();
    const newColor = editColor.trim() || null;
    if (newColor !== editingTag.color) patch.color = newColor;
    if (Object.keys(patch).length === 0) {
      cancelEdit();
      return;
    }
    try {
      await api.updateTag(editingTag.id, patch);
      setEditingTag(null);
      await load();
    } catch (e) {
      setError(errorMessage(e, language));
    }
  };

  const remove = async (tag: Tag) => {
    if (!window.confirm(t("タグ「{name}」を削除しますか？購読は削除されません。", { name: tag.name }))) return;
    try {
      await api.deleteTag(tag.id);
      await load();
    } catch (e) {
      setError(errorMessage(e, language));
    }
  };

  const move = async (tagId: number, direction: -1 | 1) => {
    const next = moveItem(tags, tagId, direction, (t) => t.id);
    if (!next) return;
    setTags(next);
    try {
      await api.reorderTags(next.map((t) => t.id));
      void load();
    } catch (e) {
      setError(errorMessage(e, language));
      await load();
    }
  };

  return (
    <AppShell title={t("タグ管理")}>
      <main className="fl-page fl-page--narrow">
        <div className="fl-stack" style={{ gap: "16px" }}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
            style={{ display: "flex", gap: "8px" }}
          >
            <input
              id="new-tag-name"
              type="text"
              className="fl-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("新しいタグ名")}
              aria-label={t("新しいタグ名")}
              required
              style={{ flex: 1 }}
            />
            <Button type="submit" kind="primary" icon="plus" disabled={creating || !newName.trim()} ariaBusy={creating}>
              {t("追加")}
            </Button>
          </form>
          {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
          {loading ? (
            <Spinner />
          ) : tags.length === 0 ? (
            <EmptyState icon="tag">{t("タグがありません。上の入力欄から作成できます。")}</EmptyState>
          ) : (
            <ul className="fl-list" style={{ borderTop: `1px solid ${palette.mutedBorder}` }}>
              {tags.map((tag) => (
                <li key={tag.id} className="fl-list-row fl-reveal-host" style={{ padding: "8px 0 8px 4px" }}>
                  {editingTag?.id === tag.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveEdit();
                      }}
                      style={{ alignItems: "center", display: "flex", flex: 1, flexWrap: "wrap", gap: "8px" }}
                    >
                      <input
                        id={`edit-tag-color-${tag.id}`}
                        type="color"
                        aria-label={t("色")}
                        value={editColor || "#3B82F6"}
                        onChange={(e) => setEditColor(e.target.value)}
                        style={{ background: "transparent", border: `1px solid ${palette.border}`, borderRadius: "var(--fl-radius)", cursor: "pointer", flexShrink: 0, height: "36px", padding: "4px", width: "36px" }}
                      />
                      <input
                        id={`edit-tag-name-${tag.id}`}
                        type="text"
                        className="fl-input"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label={`${tag.name}の名前`}
                        required
                        autoFocus
                        style={{ flex: "1 1 160px" }}
                      />
                      <div style={{ display: "flex", gap: "6px" }}>
                        {editColor ? (
                          <Button kind="ghost" onClick={() => setEditColor("")}>
                            {t("色を解除")}
                          </Button>
                        ) : null}
                        <Button onClick={cancelEdit}>{t("キャンセル")}</Button>
                        <Button type="submit" kind="primary">{t("保存")}</Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span
                        aria-hidden="true"
                        style={{ background: tag.color ?? palette.border, borderRadius: "50%", flexShrink: 0, height: "10px", width: "10px" }}
                      />
                      <div style={{ display: "grid", flex: 1, gap: "2px", minWidth: 0 }}>
                        <span style={{ fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tag.name}</span>
                        <span style={{ color: palette.muted, fontSize: "12px" }}>
                          {t("{count}件の購読", { count: tag.subscriptionCount })}
                        </span>
                      </div>
                      <div className="fl-reveal" style={{ alignItems: "center", display: "flex", gap: "2px" }}>
                        <IconButton icon="chevronUp" label={t("上へ")} size={16} onClick={() => void move(tag.id, -1)} />
                        <IconButton icon="chevronDown" label={t("下へ")} size={16} onClick={() => void move(tag.id, 1)} />
                        <IconButton icon="pencil" label={t("編集")} size={16} onClick={() => startEdit(tag)} />
                        <IconButton icon="trash" label={t("削除")} size={16} danger onClick={() => void remove(tag)} />
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </AppShell>
  );
}
