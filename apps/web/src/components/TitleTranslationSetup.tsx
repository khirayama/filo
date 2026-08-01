import { useEffect } from "react";
import { useAppData } from "./AppDataContext";
import { useTitleTranslation } from "./TitleTranslationContext";
import { Button, Spinner, palette } from "./ui";

// 翻訳の準備（オンボーディング）。
//
// 端末内翻訳は言語モデルの取得が要る。取得を一覧のスクロール中に暗黙で走らせると、
// ブラウザの取得が不意に始まるうえ、失敗しても理由が分からない。ここで言語ごとの
// 状態を見せ、明示的に取得させる。
//
// iOS の TitleTranslationSetupView / Android の TitleTranslationSetupScreen と
// 同じ役割。片方だけ直すとプラットフォーム間で挙動がずれるので、必ず全部を更新する。
export function TitleTranslationSetup() {
  const { language, t } = useAppData();
  const {
    supported,
    showSetup,
    setShowSetup,
    languages,
    checkedLanguages,
    preparing,
    refreshLanguages,
    prepare,
  } = useTitleTranslation();

  useEffect(() => {
    if (showSetup) void refreshLanguages();
  }, [showSetup, refreshLanguages]);

  if (!supported || !showSetup) return null;

  const displayName = (code: string) => {
    try {
      return new Intl.DisplayNames([language], { type: "language" }).of(code) ?? code;
    } catch {
      return code;
    }
  };

  return (
    <div
      role="dialog"
      aria-label={t("翻訳の準備")}
      onClick={() => setShowSetup(false)}
      style={{
        alignItems: "center",
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: "16px",
        position: "fixed",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          borderRadius: "12px",
          maxHeight: "80vh",
          maxWidth: "420px",
          overflowY: "auto",
          padding: "20px",
          width: "100%",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: "8px", marginBottom: "12px" }}>
          <h2 style={{ flex: 1, fontSize: "16px", margin: 0 }}>{t("翻訳の準備")}</h2>
          <Button onClick={() => setShowSetup(false)}>{t("閉じる")}</Button>
        </div>

        <p style={{ color: palette.muted, fontSize: "13px", margin: "0 0 16px" }}>
          {t("タイトルの翻訳はこの端末の中で行います。はじめに、翻訳したい言語をダウンロードしてください。")}
        </p>

        {!checkedLanguages ? (
          <Spinner label={t("確認しています…")} />
        ) : languages.length === 0 ? (
          <p style={{ color: palette.muted, fontSize: "13px", margin: 0 }}>
            {t("購読しているフィードに、翻訳が必要な言語はありません。")}
          </p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {languages.map((entry) => (
              <li
                key={entry.code}
                style={{
                  alignItems: "center",
                  borderBottom: `1px solid ${palette.mutedBorder}`,
                  display: "flex",
                  gap: "12px",
                  justifyContent: "space-between",
                  padding: "10px 0",
                }}
              >
                <span>{displayName(entry.code)}</span>
                {entry.status === "installed" ? (
                  <span style={{ color: palette.muted, fontSize: "13px" }}>{t("準備済み")}</span>
                ) : entry.status === "downloadable" ? (
                  <Button disabled={preparing != null} onClick={() => void prepare(entry.code)}>
                    {preparing === entry.code ? t("ダウンロード中…") : t("ダウンロード")}
                  </Button>
                ) : (
                  <span style={{ color: palette.muted, fontSize: "13px" }}>
                    {t("このブラウザでは非対応")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        <p style={{ color: palette.muted, fontSize: "12px", margin: "16px 0 0" }}>
          {t("ここに無い言語の記事は、翻訳せず原文のまま表示します。")}
        </p>
      </div>
    </div>
  );
}
