import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../api/useApi";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { Button, ErrorBox } from "../components/ui";
import { trackEvent } from "../lib/analytics";
import { useBackOr } from "../lib/navigation";

export function AddArticlePage() {
  const api = useApi();
  const navigate = useNavigate();
  const goBack = useBackOr("/articles");
  const [searchParams] = useSearchParams();
  const { refreshUnreadCounts, t } = useAppData();
  const [url, setUrl] = useState(() => searchParams.get("url") ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = searchParams.get("url");
    if (next) setUrl(next);
  }, [searchParams]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await api.importArticle({ url: url.trim() });
      trackEvent("add_to_reading_list", { source: "manual_url" });
      await refreshUnreadCounts({ force: true });
      navigate("/articles?readingList=1", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell title={t("記事を追加")} onBack={goBack}>
      <main className="fl-page fl-page--narrow">
        <div className="fl-stack">
          <form onSubmit={submit} className="fl-stack" style={{ gap: "20px" }}>
            <label htmlFor="article-url" className="fl-field">
              <span className="fl-field-label">{t("記事URL")}</span>
              <input
                id="article-url"
                autoFocus
                type="url"
                className="fl-input"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/article"
                aria-describedby="article-url-help"
              />
              <span id="article-url-help" className="fl-field-hint">{t("URLをリーディングリストに保存します。")}</span>
            </label>
            <div>
              <Button type="submit" kind="primary" icon="plus" disabled={isSubmitting || !url.trim()} ariaBusy={isSubmitting}>
                {isSubmitting ? t("保存中…") : t("追加")}
              </Button>
            </div>
          </form>
          {error ? <ErrorBox message={error} /> : null}
        </div>
      </main>
    </AppShell>
  );
}
