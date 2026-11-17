import { useEffect, useState } from "react";
import { authClient } from "../auth-client";
import { useNavigate } from "react-router-dom";
import { useApi } from "../api/useApi";
import type { DeletionStatus } from "../api/types";
import { Badge, Button, Spinner, palette } from "../components/ui";
import { Brand } from "../components/Brand";
import { useAppData } from "../components/AppDataContext";

const DELETION_TOKEN_KEY = "filo:deletionToken";
const POLL_INTERVAL_MS = 4000;

function readDeletionToken(): string | undefined {
  try {
    return sessionStorage.getItem(DELETION_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function clearDeletionToken(): void {
  try {
    sessionStorage.removeItem(DELETION_TOKEN_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

export function AccountDeletionPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { t } = useAppData();
  const [status, setStatus] = useState<DeletionStatus | null>(null);

  // Polls until the job settles. Signing out at the end changes `api`, so the
  // loop keeps its own token and stops itself instead of restarting.
  useEffect(() => {
    const token = readDeletionToken();
    let disposed = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const result = await api.getDeletionStatus(token);
        if (disposed) return;
        setStatus(result);
        if (result.status === "completed") {
          clearDeletionToken();
          await authClient.signOut().catch(() => undefined);
          return;
        }
        if (result.status === "none") return;
      } catch {
        // Keep polling; the session may already be gone.
      }
      if (!disposed) timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
    // Started once per visit: a sign-out mid-poll must not restart the loop.
  }, []);

  return (
    <main style={{ padding: "48px var(--fl-page-gutter)" }}>
      <section style={{ display: "grid", gap: "20px", margin: "0 auto", maxWidth: "560px" }}>
        <Brand size={28} />
        <h1 style={{ fontSize: "22px", margin: 0 }}>{t("アカウント削除")}</h1>
        <section className="fl-card" style={{ display: "grid", gap: "12px", justifyItems: "start", lineHeight: 1.6, padding: "20px" }}>
          {!status ? (
            <Spinner label={t("状態を確認しています…")} />
          ) : status.status === "completed" ? (
            <>
              <Badge tone="ok">{t("削除完了")}</Badge>
              <p style={{ margin: 0 }}>{t("アカウントの削除が完了しました。ご利用ありがとうございました。")}</p>
              <p style={{ color: palette.muted, fontSize: "13px", margin: 0 }}>
                {t("再ログインしてもデータは復元されません。")}
              </p>
            </>
          ) : status.status === "failed" ? (
            <>
              <Badge tone="danger">{t("削除処理に失敗しました")}</Badge>
              <p style={{ margin: 0 }}>{t("削除処理は自動的に再試行されます。時間をおいてもこの状態が続く場合はお問い合わせください。")}</p>
            </>
          ) : status.status === "none" ? (
            <>
              <p style={{ margin: 0 }}>{t("進行中の削除処理はありません。")}</p>
              <Button small onClick={() => navigate("/settings")}>{t("設定へ戻る")}</Button>
            </>
          ) : (
            <>
              <Badge>{t("削除処理中（{status}）…", { status: t(status.status === "pending" ? "待機中" : "実行中") })}</Badge>
              <p style={{ margin: 0 }}>{t("アカウントとデータを削除しています。このまましばらくお待ちください。")}</p>
              <p style={{ color: palette.muted, fontSize: "13px", margin: 0 }}>
                {t("この画面を閉じても削除処理は継続されます。再ログインでデータが復活することはありません。")}
              </p>
            </>
          )}
        </section>
      </section>
    </main>
  );
}
