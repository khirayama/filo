import { FormEvent, useState } from "react";
import { authClient } from "../auth-client";
import { useAppData } from "../components/AppDataContext";

export function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useAppData();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            email,
            password,
            name: email.split("@")[0] ?? "Filo user",
          });
      if (result.error) {
        setError(t("認証に失敗しました。メールアドレスとパスワードを確認してください。"));
        return;
      }
      window.location.replace("/articles");
    } catch {
      setError(t("認証に失敗しました。しばらくしてからもう一度お試しください。"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, minWidth: 280 }}>
      <label>{t("メールアドレス")}<input required type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>{t("パスワード")}<input required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>{busy ? t("処理中…") : mode === "sign-in" ? t("サインイン") : t("アカウント作成")}</button>
      {mode === "sign-in" && <a href="/forgot-password">{t("パスワードをお忘れですか？")}</a>}
      <a href={mode === "sign-in" ? "/sign-up" : "/sign-in"}>{mode === "sign-in" ? t("アカウントを作成") : t("サインインへ戻る")}</a>
    </form>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useAppData();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (result.error) {
        setError(t("リセットメールを送信できませんでした。メールアドレスを確認してください。"));
        return;
      }
      setSent(true);
    } catch {
      setError(t("リセットメールを送信できませんでした。しばらくしてからもう一度お試しください。"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section style={{ display: "grid", gap: 12, minWidth: 280 }}>
        <p role="status">{t("パスワードリセット用のメールを送信しました。メール内のリンクを開いて新しいパスワードを設定してください。")}</p>
        <a href="/sign-in">{t("サインインへ戻る")}</a>
      </section>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, minWidth: 280 }}>
      <p>{t("登録済みのメールアドレスにパスワードリセット用のリンクを送信します。")}</p>
      <label>{t("メールアドレス")}<input required type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>{busy ? t("送信中…") : t("リセットメールを送信")}</button>
      <a href="/sign-in">{t("サインインへ戻る")}</a>
    </form>
  );
}

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const { t } = useAppData();
  const [error, setError] = useState<string | null>(token ? null : t("このリセットリンクは無効です。もう一度リセットをリクエストしてください。"));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return;
    if (password !== confirmation) {
      setError(t("パスワードが一致しません。"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(t("パスワードを変更できませんでした。リンクの有効期限が切れている可能性があります。"));
        return;
      }
      setCompleted(true);
    } catch {
      setError(t("パスワードを変更できませんでした。しばらくしてからもう一度お試しください。"));
    } finally {
      setBusy(false);
    }
  }

  if (completed) {
    return (
      <section style={{ display: "grid", gap: 12, minWidth: 280 }}>
        <p role="status">{t("パスワードを変更しました。新しいパスワードでサインインしてください。")}</p>
        <a href="/sign-in">{t("サインインへ進む")}</a>
      </section>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, minWidth: 280 }}>
      <label>{t("新しいパスワード")}<input required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label>{t("新しいパスワード（確認）")}<input required minLength={8} type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !token}>{busy ? t("変更中…") : t("パスワードを変更")}</button>
      <a href="/sign-in">{t("サインインへ戻る")}</a>
    </form>
  );
}
