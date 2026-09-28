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
  FilterChip,
  Spinner,
  Switch,
  palette,
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
    const previous = settings;
    if (previous) {
      // Update the local view first. Language changes must not wait for the
      // round trip to the API before the rest of the app is translated.
      setSettings({ ...previous, ...patch });
    }
    try {
      setSettings(await api.updateSettings(patch));
      for (const [setting, value] of Object.entries(patch)) {
        trackEvent("settings_change", {
          setting,
          value: Array.isArray(value) ? value.length : value,
        });
      }
    } catch (e) {
      if (previous) setSettings(previous);
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
    <AppShell title={t("設定")}>
      <main className="fl-page fl-page--narrow">
        <div className="fl-stack" style={{ gap: "28px" }}>
          {error ?? loadError ? <ErrorBox message={(error ?? loadError)!} onRetry={() => void refresh()} /> : null}
          {loading || !settings ? (
            <Spinner />
          ) : (
            <>
              <SettingSection title={t("表示設定")}>
                <SettingRow label={t("テーマ")} htmlFor="setting-theme">
                  <select
                    id="setting-theme"
                    className="fl-select"
                    value={settings.theme}
                    onChange={(e) => void update({ theme: e.target.value as Settings["theme"] })}
                    style={selectStyle}
                  >
                    <option value="system">{t("システムに合わせる")}</option>
                    <option value="light">{t("ライト")}</option>
                    <option value="dark">{t("ダーク")}</option>
                  </select>
                </SettingRow>
                <SettingRow label={t("言語")} hint={t("一覧の翻訳トグルは、タイトルをこの言語へ翻訳します。")} htmlFor="setting-language">
                  <select
                    id="setting-language"
                    className="fl-select"
                    value={settings.language}
                    onChange={(e) => void update({ language: e.target.value as Settings["language"] })}
                    style={selectStyle}
                  >
                    {SUPPORTED_LANGUAGES.map((code) => <option key={code} value={code}>{LANGUAGE_NAMES[code]}</option>)}
                  </select>
                </SettingRow>
                <SettingRow label={t("記事の並び順")} htmlFor="setting-article-sort">
                  <select
                    id="setting-article-sort"
                    className="fl-select"
                    value={settings.articleSortOrder}
                    onChange={(e) => void update({ articleSortOrder: e.target.value as Settings["articleSortOrder"] })}
                    style={selectStyle}
                  >
                    <option value="published_at_desc">{t("公開日時が新しい順")}</option>
                    <option value="fetched_at_desc">{t("取得日時が新しい順")}</option>
                  </select>
                </SettingRow>
                <SettingRow label={t("リンクを常にブラウザで開く")} htmlFor="setting-open-in-browser" inline>
                  <Switch
                    id="setting-open-in-browser"
                    checked={settings.openInBrowserByDefault}
                    onChange={(checked) => void update({ openInBrowserByDefault: checked })}
                  />
                </SettingRow>
              </SettingSection>

              <SettingSection title={t("翻訳")}>
                {translationSupported ? (
                  <SettingRow label={t("翻訳の準備")} inline>
                    <Button small onClick={() => setShowSetup(true)}>{t("言語を確認")}</Button>
                  </SettingRow>
                ) : null}
                <SettingRow label={t("原文のまま読む言語")}>
                  <div role="group" aria-label={t("原文のまま読む言語")} style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    {SUPPORTED_LANGUAGES.map((code) => {
                      const checked = settings.readableLanguages.includes(code);
                      return (
                        <FilterChip
                          key={code}
                          label={LANGUAGE_NAMES[code]}
                          active={checked}
                          onClick={() => {
                            const next = checked
                              ? settings.readableLanguages.filter((l) => l !== code)
                              : [...settings.readableLanguages, code];
                            void update({ readableLanguages: next });
                          }}
                        />
                      );
                    })}
                  </div>
                </SettingRow>
              </SettingSection>

              <SettingSection title="OPML">
                <div className="fl-card-row" style={{ justifyContent: "flex-start" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
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
                </div>
                {importJob ? (
                  <div className="fl-card-row" style={{ alignItems: "flex-start", flexDirection: "column", gap: "8px", justifyContent: "center" }}>
                    {importJob.status === "pending" || importJob.status === "running" ? (
                      <Badge>{t("インポート処理中…")}</Badge>
                    ) : importJob.status === "completed" ? (
                      <>
                        <Badge tone="ok">{t("インポート完了")}</Badge>
                        <p style={{ color: palette.muted, fontSize: "13px", margin: 0 }}>
                          {t("追加 {created} / スキップ {skipped} / 失敗 {failed}", { created: importJob.created ?? 0, skipped: importJob.skipped ?? 0, failed: importJob.failed ?? 0 })}
                        </p>
                        {importJob.failures && importJob.failures.length > 0 ? (
                          <ul style={{ color: palette.muted, fontSize: "12px", margin: 0, paddingLeft: "18px" }}>
                            {importJob.failures.slice(0, 5).map((f, i) => (
                              <li key={i}>{f.feedUrl}</li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : (
                      <Badge tone="danger">{t("インポート失敗")}</Badge>
                    )}
                  </div>
                ) : null}
              </SettingSection>

              <SettingSection title={t("既読履歴について")}>
                <p className="fl-card-row" style={{ color: palette.muted, fontSize: "13px", lineHeight: 1.6, margin: 0 }}>
                  {t("閲覧履歴は既読記事として扱われます。記事一覧の絞り込みから既読記事を確認できます。")}
                </p>
              </SettingSection>

              <SettingSection title={t("セッション")}>
                <div className="fl-card-row" style={{ justifyContent: "flex-start" }}>
                  <Button onClick={() => { void signOut().then(() => navigate("/sign-in")); }}>{t("サインアウト")}</Button>
                </div>
              </SettingSection>

              <SettingSection title={t("危険な操作")} danger>
                <div className="fl-card-row fl-card-row--stack">
                  <p style={{ color: palette.muted, fontSize: "13px", lineHeight: 1.6, margin: 0 }}>
                    {t("アカウントを削除すると購読・タグ・記事の状態がすべて削除され、再ログインしても復元されません。")}
                  </p>
                  <Button kind="danger" onClick={() => void deleteAccount()}>
                    {t("アカウント削除")}
                  </Button>
                </div>
              </SettingSection>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

const selectStyle = { minWidth: "200px" } as const;

function SettingSection({ title, danger, children }: { title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="fl-section-title" style={danger ? { color: palette.danger } : undefined}>{title}</h2>
      <div className="fl-card" style={danger ? { borderColor: "color-mix(in srgb, var(--fl-danger) 35%, transparent)" } : undefined}>
        {children}
      </div>
    </section>
  );
}

// `inline` keeps the control beside the label on every width (switches,
// small buttons); other rows stack under the label on narrow screens.
function SettingRow({ label, hint, htmlFor, inline, children }: { label: string; hint?: string; htmlFor?: string; inline?: boolean; children: React.ReactNode }) {
  return (
    <div className={`fl-card-row${inline ? "" : " fl-card-row--stack"}`}>
      <div className="fl-card-row-text">
        {htmlFor ? <label htmlFor={htmlFor} style={{ fontSize: "14px" }}>{label}</label> : <span style={{ fontSize: "14px" }}>{label}</span>}
        {hint ? <span className="fl-card-row-hint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
