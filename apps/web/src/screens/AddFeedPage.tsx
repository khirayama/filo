import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../api/useApi";
import type { Subscription } from "../api/types";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { Badge, Button, ErrorBox, IconButton, palette, sectionStyle } from "../components/ui";
import { errorMessage, initialFetchErrorMessage } from "../lib/messages";
import { trackEvent } from "../lib/analytics";

export function AddFeedPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { tags, refresh: refreshAppData, language, t } = useAppData();
  const [url, setUrl] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [newTagNames, setNewTagNames] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Subscription | null>(null);
  const [retrying, setRetrying] = useState(false);

  const submit = async () => {
    if (submitting || !url.trim()) return;
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
      const tagNames = newTagNames
        .split(/[,、]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const subscription = await api.createSubscription({
        feedUrl: url.trim(),
        tagIds: [...selectedTagIds],
        tagNames,
      });
      setCreated(subscription);
      trackEvent("add_feed", {
        has_custom_tags: tagNames.length > 0,
        tag_count: selectedTagIds.size + tagNames.length,
      });
      void refreshAppData();
    } catch (e) {
      setError(errorMessage(e, language));
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (!created || retrying) return;
    setRetrying(true);
    try {
      const updated = await api.retryInitialFetch(created.id);
      setCreated(updated);
      trackEvent("retry_feed_fetch");
    } catch (e) {
      setError(errorMessage(e, language));
    } finally {
      setRetrying(false);
    }
  };

  const toggleTag = (id: number) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          <h1 style={{ flex: 1, fontSize: "20px", margin: 0 }}>{t("フィードを追加")}</h1>
        </header>
        <section style={{ ...sectionStyle, border: "none", padding: "16px 0" }}>
          <label style={{ display: "block" }}>
            RSS/Atom URL または サイトURL
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/feed.xml"
              style={{
                border: `1px solid ${palette.border}`,
                borderRadius: "6px",
                display: "block",
                marginTop: "8px",
                padding: "10px",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </label>
          {tags.length > 0 ? (
            <div style={{ marginTop: "16px" }}>
              <p style={{ margin: "0 0 8px" }}>{t("タグ")}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {tags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    style={{
                      background: selectedTagIds.has(tag.id) ? palette.text : "transparent",
                      border: `1px solid ${palette.border}`,
                      borderRadius: "999px",
                      color: selectedTagIds.has(tag.id) ? palette.bg : "inherit",
                      cursor: "pointer",
                      padding: "4px 12px",
                    }}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label style={{ display: "block", marginTop: "16px" }}>
            新規タグ（カンマ区切り）
            <input
              type="text"
              value={newTagNames}
              onChange={(e) => setNewTagNames(e.target.value)}
              placeholder="AI, Engineering"
              style={{
                border: `1px solid ${palette.border}`,
                borderRadius: "6px",
                display: "block",
                marginTop: "8px",
                padding: "10px",
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </label>
          <div style={{ marginTop: "16px" }}>
            <Button kind="primary" onClick={() => void submit()} disabled={submitting || !url.trim()}>
              {submitting ? t("フィードを確認中…") : t("追加")}
            </Button>
          </div>
        </section>
        {error ? <ErrorBox message={error} /> : null}
        {created ? (
          <section style={sectionStyle}>
            <p style={{ marginTop: 0, fontWeight: 600 }}>{created.customTitle ?? created.feed.title}</p>
            {created.initialFetchStatus === "ready" ? (
              <>
                <Badge tone="ok">{t("追加完了")}</Badge>
                <p>{t("記事の取得が完了しています。")}</p>
              </>
            ) : created.initialFetchStatus === "fetching" ? (
              <>
                <Badge>{t("記事取得中")}</Badge>
                <p>{t("購読の追加は完了しました。記事を取得しています。")}</p>
              </>
            ) : (
              <>
                <Badge tone="danger">{t("初回取得失敗")}</Badge>
                <p>{t("購読は作成されましたが、")}{initialFetchErrorMessage(created.initialFetchErrorCode, language)}</p>
                <Button onClick={() => void retry()} disabled={retrying}>
                  {retrying ? "再試行中…" : "再試行"}
                </Button>
              </>
            )}
            <p>
              <Link to="/articles" style={{ color: "inherit" }}>
                記事一覧へ
              </Link>
            </p>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
