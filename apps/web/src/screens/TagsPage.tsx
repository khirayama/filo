import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
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
    if (!window.confirm(`${t("タグ")}「${tag.name}」${t("を削除しますか？購読は削除されません。")}`)) return;
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
    <AppShell>
      <main style={{ padding: "16px 24px 48px" }}>
        <header
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${palette.mutedBorder}`,
            display: "flex",
            gap: "8px",
            padding: "8px 0",
          }}
        >
          <IconButton icon="back" label={t("戻る")} onClick={() => navigate(-1)} />
          <h1 style={{ flex: 1, fontSize: "20px", margin: 0 }}>{t("タグ管理")}</h1>
        </header>
        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("新しいタグ名")}
            style={{
              border: `1px solid ${palette.border}`,
              borderRadius: "6px",
              flex: 1,
              padding: "10px",
            }}
          />
          <Button kind="primary" onClick={() => void create()} disabled={creating || !newName.trim()}>
            {t("追加")}
          </Button>
        </div>
        {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}
        {loading ? (
          <Spinner />
        ) : tags.length === 0 ? (
          <EmptyState>{t("タグがありません。上の入力欄から作成できます。")}</EmptyState>
        ) : (
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
            {tags.map((tag) => (
              <li
                key={tag.id}
                style={{
                  borderBottom: `1px solid ${palette.mutedBorder}`,
                  padding: "8px 4px",
                }}
              >
                {editingTag?.id === tag.id ? (
                  <div style={{ display: "grid", gap: "8px" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        style={{
                          border: `1px solid ${palette.border}`,
                          borderRadius: "6px",
                          flex: 1,
                          padding: "8px",
                        }}
                      />
                      <label style={{ alignItems: "center", display: "flex", gap: "4px", fontSize: "13px" }}>
                        色
                        <input
                          type="color"
                          value={editColor || "#3B82F6"}
                          onChange={(e) => setEditColor(e.target.value)}
                          style={{ border: "none", cursor: "pointer", height: "28px", padding: 0, width: "28px" }}
                        />
                        {editColor ? (
                          <button
                            type="button"
                            onClick={() => setEditColor("")}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: palette.muted,
                              cursor: "pointer",
                              fontSize: "12px",
                              padding: "2px 4px",
                            }}
                          >
                            解除
                          </button>
                        ) : null}
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <Button small kind="primary" onClick={() => void saveEdit()}>
                        保存
                      </Button>
                      <Button small onClick={cancelEdit}>
                        キャンセル
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div style={{ alignItems: "center", display: "flex", gap: "8px", justifyContent: "space-between" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: "8px", minWidth: 0 }}>
                      {tag.color ? (
                        <span
                          style={{
                            background: tag.color,
                            borderRadius: "50%",
                            display: "inline-block",
                            flexShrink: 0,
                            height: "12px",
                            width: "12px",
                          }}
                        />
                      ) : null}
                      <span style={{ fontWeight: 600 }}>{tag.name}</span>
                      <span style={{ color: palette.muted, fontSize: "13px" }}>
                        {tag.subscriptionCount}件の購読
                      </span>
                    </div>
                    <div style={{ alignItems: "center", display: "flex", gap: "2px" }}>
                      <IconButton icon="chevronUp" label="上へ" size={14} onClick={() => void move(tag.id, -1)} />
                      <IconButton icon="chevronDown" label="下へ" size={14} onClick={() => void move(tag.id, 1)} />
                      <Button small onClick={() => startEdit(tag)}>
                        編集
                      </Button>
                      <Button small kind="danger" onClick={() => void remove(tag)}>
                        削除
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
