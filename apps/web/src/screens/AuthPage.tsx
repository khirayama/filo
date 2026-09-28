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
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-heading">
        <h1>{mode === "sign-in" ? t("サインイン") : t("アカウント作成")}</h1>
        <p>{t("URLをリーディングリストに保存します。")}</p>
      </div>
      <div className="auth-fields">
        <label className="auth-field" htmlFor="auth-email">
          <span>{t("メールアドレス")}</span>
          <input id="auth-email" required autoComplete="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="auth-field" htmlFor="auth-password">
          <span>{t("パスワード")}</span>
          <input id="auth-password" required minLength={8} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <small>{t("8文字以上のパスワード")}</small>
        </label>
      </div>
      {error && <p className="auth-alert" role="alert">{error}</p>}
      <button className="auth-primary-button" type="submit" disabled={busy}>
        <span>{busy ? t("処理中…") : mode === "sign-in" ? t("サインイン") : t("アカウント作成")}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <div className="auth-links">
        {mode === "sign-in" && <a href="/forgot-password">{t("パスワードをお忘れですか？")}</a>}
        <a href={mode === "sign-in" ? "/sign-up" : "/sign-in"}>{mode === "sign-in" ? t("アカウントを作成") : t("サインインへ戻る")}</a>
      </div>
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
      <section className="auth-form auth-form-status">
        <div className="auth-heading">
          <h1>{t("メールを確認してください")}</h1>
        </div>
        <p className="auth-status" role="status">{t("パスワードリセット用のメールを送信しました。メール内のリンクを開いて新しいパスワードを設定してください。")}</p>
        <a className="auth-secondary-link" href="/sign-in">{t("サインインへ戻る")}</a>
      </section>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-heading">
        <h1>{t("パスワードをリセット")}</h1>
        <p>{t("登録済みのメールアドレスにパスワードリセット用のリンクを送信します。")}</p>
      </div>
      <label className="auth-field" htmlFor="reset-email">
        <span>{t("メールアドレス")}</span>
        <input id="reset-email" required autoComplete="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
      </label>
      {error && <p className="auth-alert" role="alert">{error}</p>}
      <button className="auth-primary-button" type="submit" disabled={busy}>
        <span>{busy ? t("送信中…") : t("リセットメールを送信")}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <a className="auth-secondary-link" href="/sign-in">{t("サインインへ戻る")}</a>
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
      <section className="auth-form auth-form-status">
        <div className="auth-heading">
          <p className="auth-kicker">{t("パスワードを変更")}</p>
          <h1>{t("変更が完了しました")}</h1>
        </div>
        <p className="auth-status" role="status">{t("パスワードを変更しました。新しいパスワードでサインインしてください。")}</p>
        <a className="auth-secondary-link" href="/sign-in">{t("サインインへ進む")}</a>
      </section>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <div className="auth-heading">
        <p className="auth-kicker">{t("パスワードを変更")}</p>
        <h1>{t("新しいパスワード")}</h1>
        <p>{t("新しいパスワードを入力してください。")}</p>
      </div>
      <div className="auth-fields">
        <label className="auth-field" htmlFor="new-password">
          <span>{t("新しいパスワード")}</span>
          <input id="new-password" required minLength={8} autoComplete="new-password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        </label>
        <label className="auth-field" htmlFor="confirm-password">
          <span>{t("新しいパスワード（確認）")}</span>
          <input id="confirm-password" required minLength={8} autoComplete="new-password" type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} />
        </label>
      </div>
      {error && <p className="auth-alert" role="alert">{error}</p>}
      <button className="auth-primary-button" type="submit" disabled={busy || !token}>
        <span>{busy ? t("変更中…") : t("パスワードを変更")}</span>
        <span aria-hidden="true">↗</span>
      </button>
      <a className="auth-secondary-link" href="/sign-in">{t("サインインへ戻る")}</a>
    </form>
  );
}
