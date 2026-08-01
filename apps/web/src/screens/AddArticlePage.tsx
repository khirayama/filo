import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../api/useApi";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { Button, ErrorBox, palette } from "../components/ui";

export function AddArticlePage() {
  const api = useApi();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useAppData();
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
      navigate("/articles?readingList=1", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell>
      <main style={{ maxWidth: "720px", padding: "24px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "20px", marginTop: 0 }}>{t("記事を追加")}</h1>
        <p style={{ color: palette.muted }}>{t("URLをリーディングリストに保存します。")}</p>
        <form onSubmit={submit} style={{ display: "grid", gap: "12px" }}>
          <input
            autoFocus
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/article"
            aria-label={t("記事URL")}
            style={{ background: palette.surface, border: `1px solid ${palette.border}`, borderRadius: "6px", color: palette.text, font: "inherit", padding: "10px 12px" }}
          />
          <div style={{ display: "flex", gap: "8px" }}>
            <Button type="submit" kind="primary" disabled={isSubmitting || !url.trim()}>
              {isSubmitting ? t("保存中…") : t("追加")}
            </Button>
            <Button onClick={() => navigate(-1)} disabled={isSubmitting}>{t("戻る")}</Button>
          </div>
        </form>
        {error ? <ErrorBox message={error} /> : null}
      </main>
    </AppShell>
  );
}
