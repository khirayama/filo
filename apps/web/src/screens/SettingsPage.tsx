import { useEffect, useRef, useState } from "react";
import { authClient } from "../auth-client";
import { useNavigate } from "react-router-dom";
import { useApi } from "../api/useApi";
import type { OpmlImportJob, Settings } from "../api/types";
import { AppShell } from "../components/AppShell";
import { useAppData } from "../components/AppDataContext";
import { useTitleTranslation } from "../components/TitleTranslationContext";
import {
  Badge,
  Button,
  ErrorBox,
  IconButton,
  InlineButton,
  Spinner,
  palette,
  sectionStyle,
} from "../components/ui";
import { errorMessage, LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from "../lib/messages";
import { trackEvent } from "../lib/analytics";

export function SettingsPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { settings, loading, error: loadError, refresh, setSettings, language, t } = useAppData();
  const { supported: translationSupported, setShowSetup } = useTitleTranslation();
  const [error, setError] = useState<string | null>(null);
  const [importJob, setImportJob] = useState<OpmlImportJob | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollRef = useRef<number | null>(null);
  const signOut = () => authClient.signOut();

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const update = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    try {
      setSettings(await api.updateSettings(patch));
      for (const [setting, value] of Object.entries(patch)) {
        trackEvent("settings_change", {
          setting,
          value: Array.isArray(value) ? value.length : value,
        });
      }
    } catch (e) {
      setError(errorMessage(e, language));
    }
  };

  const pollImport = (jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = window.setInterval(async () => {
      try {
        const job = await api.getOpmlImport(jobId);
        setImportJob(job);
        if (job.status === "completed" || job.status === "failed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
          if (job.status === "completed") void refresh();
        }
      } catch {
        // keep polling
      }
    }, 3000);
  };

  const importOpml = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      const job = await api.importOpml(file);
      trackEvent("import_opml", { file_type: file.name.toLowerCase().endsWith(".xml") ? "xml" : "opml" });
      setImportJob(job);
      pollImport(job.jobId);
    } catch (e) {
      setError(errorMessage(e, language));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const exportOpml = async () => {
    try {
      const blob = await api.exportOpml();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "filo-subscriptions.opml";
      a.click();
      URL.revokeObjectURL(url);
      trackEvent("export_opml");
    } catch (e) {
      setError(errorMessage(e, language));
    }
  };

  const deleteAccount = async () => {
    if (!window.confirm(t("アカウントを削除しますか？この操作は取り消せません。"))) return;
    try {
      const accepted = await api.deleteAccount();
      sessionStorage.setItem("filo:deletionToken", accepted.deletionToken);
      navigate("/settings/account-deletion");
    } catch (e) {
      setError(errorMessage(e, language));
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
          <h1 style={{ flex: 1, fontSize: "20px", margin: 0 }}>{t("設定")}</h1>
        </header>
        {error ?? loadError ? <ErrorBox message={(error ?? loadError)!} onRetry={() => void refresh()} /> : null}
        {loading || !settings ? (
          <Spinner />
        ) : (
          <>
            <section style={sectionStyle}>
              <SettingRow label={t("テーマ")} htmlFor="setting-theme">
                <select
                  id="setting-theme"
                  value={settings.theme}
                  onChange={(e) => void update({ theme: e.target.value as Settings["theme"] })}
                  style={selectStyle}
                >
                  <option value="system">{t("システムに合わせる")}</option>
                  <option value="light">{t("ライト")}</option>
                  <option value="dark">{t("ダーク")}</option>
                </select>
              </SettingRow>
              <SettingRow label={t("言語")} htmlFor="setting-language">
                <select
                  id="setting-language"
                  value={settings.language}
                  onChange={(e) => void update({ language: e.target.value as Settings["language"] })}
                  style={selectStyle}
                >
                  {SUPPORTED_LANGUAGES.map((code) => <option key={code} value={code}>{LANGUAGE_NAMES[code]}</option>)}
                </select>
              </SettingRow>
              <p style={{ color: palette.muted, fontSize: "13px", margin: "0 0 8px" }}>
                {t("一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。")}
              </p>
              {translationSupported ? (
                <SettingRow label={t("翻訳の準備")}>
                  <InlineButton onClick={() => setShowSetup(true)}>{t("言語を確認")}</InlineButton>
                </SettingRow>
              ) : null}
              <SettingRow label={t("原文のまま読む言語")}>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  {SUPPORTED_LANGUAGES.map((code) => (
                    <label key={code} style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={settings.readableLanguages.includes(code)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...settings.readableLanguages, code]
                            : settings.readableLanguages.filter((l) => l !== code);
                          void update({ readableLanguages: next });
                        }}
                      />
                      {LANGUAGE_NAMES[code]}
                    </label>
                  ))}
                </div>
              </SettingRow>
              <SettingRow label={t("記事の並び順")} htmlFor="setting-article-sort">
                <select
                  id="setting-article-sort"
                  value={settings.articleSortOrder}
                  onChange={(e) => void update({ articleSortOrder: e.target.value as Settings["articleSortOrder"] })}
                  style={selectStyle}
                >
                  <option value="published_at_desc">{t("公開日時が新しい順")}</option>
                  <option value="fetched_at_desc">{t("取得日時が新しい順")}</option>
                </select>
              </SettingRow>
              <SettingRow label={t("リンクを常にブラウザで開く")} htmlFor="setting-open-in-browser">
                <input
                  id="setting-open-in-browser"
                  type="checkbox"
                  checked={settings.openInBrowserByDefault}
                  onChange={(e) => void update({ openInBrowserByDefault: e.target.checked })}
                />
              </SettingRow>
            </section>

            <section style={sectionStyle}>
              <p role="heading" aria-level={2} style={{ marginTop: 0, fontWeight: 600 }}>OPML</p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <Button onClick={() => fileInputRef.current?.click()} disabled={importing}>
                  {importing ? t("アップロード中…") : t("インポート")}
                </Button>
                <Button onClick={() => void exportOpml()}>{t("エクスポート")}</Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  aria-label={t("OPMLファイル")}
                  accept=".opml,.xml,text/xml,text/x-opml"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importOpml(file);
                  }}
                />
              </div>
              {importJob ? (
                <div style={{ marginTop: "12px" }}>
                  {importJob.status === "pending" || importJob.status === "running" ? (
                    <Badge>{t("インポート処理中…")}</Badge>
                  ) : importJob.status === "completed" ? (
                    <div>
                      <Badge tone="ok">{t("インポート完了")}</Badge>
                      <p style={{ color: palette.muted, fontSize: "13px" }}>
                        追加 {importJob.created ?? 0} / スキップ {importJob.skipped ?? 0} / 失敗 {importJob.failed ?? 0}
                      </p>
                      {importJob.failures && importJob.failures.length > 0 ? (
                        <ul style={{ color: palette.muted, fontSize: "12px" }}>
                          {importJob.failures.slice(0, 5).map((f, i) => (
                            <li key={i}>{f.feedUrl}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : (
                    <Badge tone="danger">{t("インポート失敗")}</Badge>
                  )}
                </div>
              ) : null}
            </section>

            <section style={sectionStyle}>
              <p role="heading" aria-level={2} style={{ marginTop: 0, fontWeight: 600 }}>{t("既読履歴について")}</p>
              <p style={{ color: palette.muted, fontSize: "13px" }}>
                閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。
              </p>
            </section>

            <section style={sectionStyle}>
              <p role="heading" aria-level={2} style={{ marginTop: 0, fontWeight: 600 }}>{t("セッション")}</p>
              <Button onClick={() => { void signOut().then(() => navigate("/sign-in")); }}>{t("サインアウト")}</Button>
            </section>

            <section style={{ ...sectionStyle, borderColor: palette.danger }}>
              <p role="heading" aria-level={2} style={{ marginTop: 0, fontWeight: 600, color: palette.danger }}>{t("危険な操作")}</p>
              <p style={{ color: palette.muted, fontSize: "13px" }}>
                アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。
              </p>
              <Button kind="danger" onClick={() => void deleteAccount()}>
                {t("アカウント削除")}
              </Button>
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}

const selectStyle = {
  border: `1px solid ${palette.border}`,
  borderRadius: "6px",
  padding: "8px",
} as const;

function SettingRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        alignItems: "center",
        borderBottom: `1px solid ${palette.mutedBorder}`,
        display: "flex",
        justifyContent: "space-between",
        gap: "12px",
        padding: "12px 0",
      }}
    >
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      {children}
    </div>
  );
}
