import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api/useApi";
import type { Subscription } from "../api/types";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { Badge, Button, ErrorBox, FilterChip, palette } from "../components/ui";
import { errorMessage, initialFetchErrorMessage } from "../lib/messages";
import { trackEvent } from "../lib/analytics";
import { useBackOr } from "../lib/navigation";

export function AddFeedPage() {
  const api = useApi();
  const goBack = useBackOr("/subscriptions");
  const { tags, refresh: refreshAppData, language, t } = useAppData();
  const [url, setUrl] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [newTagNames, setNewTagNames] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Subscription | null>(null);
  const [retrying, setRetrying] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    <AppShell title={t("フィードを追加")} onBack={goBack}>
      <main className="fl-page fl-page--narrow">
        <div className="fl-stack">
          <form onSubmit={(event) => void submit(event)} className="fl-stack" style={{ gap: "20px" }}>
            <label htmlFor="feed-url" className="fl-field">
              <span className="fl-field-label">{t("RSS/Atom URL または サイトURL")}</span>
              <input
                id="feed-url"
                type="url"
                className="fl-input"
                required
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/feed.xml"
              />
            </label>
            {tags.length > 0 ? (
              <div className="fl-field">
                <span id="feed-tags-label" className="fl-field-label">{t("タグ")}</span>
                <div role="group" aria-labelledby="feed-tags-label" style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {tags.map((tag) => (
                    <FilterChip key={tag.id} label={tag.name} active={selectedTagIds.has(tag.id)} onClick={() => toggleTag(tag.id)} />
                  ))}
                </div>
              </div>
            ) : null}
            <label htmlFor="new-feed-tags" className="fl-field">
              <span className="fl-field-label">{t("新規タグ（カンマ区切り）")}</span>
              <input
                id="new-feed-tags"
                type="text"
                className="fl-input"
                value={newTagNames}
                onChange={(e) => setNewTagNames(e.target.value)}
                placeholder="AI, Engineering"
              />
            </label>
            <div>
              <Button type="submit" kind="primary" icon="plus" disabled={submitting || !url.trim()} ariaBusy={submitting}>
                {submitting ? t("フィードを確認中…") : t("追加")}
              </Button>
            </div>
          </form>
          {error ? <ErrorBox message={error} /> : null}
          {created ? (
            <section className="fl-card" style={{ display: "grid", gap: "12px", padding: "16px" }}>
              <div style={{ alignItems: "center", display: "flex", gap: "10px", minWidth: 0 }}>
                <p style={{ flex: 1, fontWeight: 600, margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {created.customTitle ?? created.feed.title}
                </p>
                {created.initialFetchStatus === "ready" ? (
                  <Badge tone="ok">{t("追加完了")}</Badge>
                ) : created.initialFetchStatus === "fetching" ? (
                  <Badge>{t("記事取得中")}</Badge>
                ) : (
                  <Badge tone="danger">{t("初回取得失敗")}</Badge>
                )}
              </div>
              <p style={{ color: palette.muted, fontSize: "13px", lineHeight: 1.6, margin: 0 }}>
                {created.initialFetchStatus === "ready"
                  ? t("記事の取得が完了しています。")
                  : created.initialFetchStatus === "fetching"
                    ? t("購読の追加は完了しました。記事を取得しています。")
                    : t("購読は作成されましたが、{message}", { message: initialFetchErrorMessage(created.initialFetchErrorCode, language) })}
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {created.initialFetchStatus === "failed" ? (
                  <Button onClick={() => void retry()} disabled={retrying}>
                    {retrying ? t("再試行中…") : t("再試行")}
                  </Button>
                ) : null}
                <Link to="/articles" className="fl-btn fl-btn--secondary">
                  {t("記事一覧へ")}
                </Link>
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}
