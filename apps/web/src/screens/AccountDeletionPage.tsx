import { useEffect, useRef, useState } from "react";
import { authClient } from "../auth-client";
import { useNavigate } from "react-router-dom";
import { useApi } from "../api/useApi";
import type { DeletionStatus } from "../api/types";
import { Badge, Button, Spinner, palette } from "../components/ui";
import { Brand } from "../components/Brand";
import { useAppData } from "../components/AppDataContext";

export function AccountDeletionPage() {
  const api = useApi();
  const navigate = useNavigate();
  const signOut = () => authClient.signOut();
  const { t } = useAppData();
  const [status, setStatus] = useState<DeletionStatus | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem("filo:deletionToken") ?? undefined;

    const poll = async () => {
      try {
        const result = await api.getDeletionStatus(token);
        setStatus(result);
        if (result.status === "completed") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          // Deletion done: force logout and show the completion state
          await signOut().catch(() => undefined);
        }
      } catch {
        // keep polling; the session may already be gone
      }
    };

    void poll();
    pollRef.current = window.setInterval(() => void poll(), 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [api, signOut]);

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
