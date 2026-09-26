import { useEffect, useRef, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppDataProvider, useAppData } from "./components/AppDataContext";
import { TitleTranslationProvider } from "./components/TitleTranslationContext";
import { TitleTranslationSetup } from "./components/TitleTranslationSetup";
import { AccountDeletionPage } from "./screens/AccountDeletionPage";
import { AddFeedPage } from "./screens/AddFeedPage";
import { ArticlesPage } from "./screens/ArticlesPage";
import { AddArticlePage } from "./screens/AddArticlePage";
import { SettingsPage } from "./screens/SettingsPage";
import { StatusPage } from "./screens/StatusPage";
import { SubscriptionDetailPage } from "./screens/SubscriptionDetailPage";
import { SubscriptionsPage } from "./screens/SubscriptionsPage";
import { TagsPage } from "./screens/TagsPage";
import { trackPageView } from "./lib/analytics";
import { authClient } from "./auth-client";
import { AuthPage, ForgotPasswordPage, ResetPasswordPage } from "./screens/AuthPage";
import { Brand } from "./components/Brand";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  if (!session) return <Navigate replace to="/sign-in" />;
  return children;
}

function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useAppData();

  return (
    <main className="auth-page">
      <section className="auth-layout">
        <aside className="auth-story" aria-label="Filo">
          <div className="auth-story-topline">
            <Brand size={42} />
            <span className="auth-story-status">FILO READER</span>
          </div>
          <div className="auth-story-copy">
            <h2>{t("リーディングリスト")}</h2>
            <p className="auth-story-description">
              {t("URLをリーディングリストに保存します。")}
            </p>
          </div>
          <div className="auth-story-pills" aria-hidden="true">
            <span>RSS</span>
            <span>{t("読み上げ")}</span>
            <span>{t("翻訳")}</span>
          </div>
          <div className="auth-story-orbit auth-story-orbit-one" />
          <div className="auth-story-orbit auth-story-orbit-two" />
        </aside>
        <section className="auth-panel">
          <div className="auth-mobile-brand"><Brand size={40} /></div>
          {children}
        </section>
      </section>
    </main>
  );
}

function RootRedirect() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  return <Navigate replace to={session ? "/articles" : "/sign-in"} />;
}

function SignOutPage() {
  const { data: session, isPending } = authClient.useSession();
  const { t } = useAppData();

  useEffect(() => {
    if (isPending) return;
    void (async () => {
      try {
        if (session) await authClient.signOut();
      } finally {
        window.location.replace("/sign-in");
      }
    })();
  }, [isPending, session]);

  return <AuthLayout><p style={{ textAlign: "center" }}>{t("サインアウト中…")}</p></AuthLayout>;
}

function AnalyticsPageView() {
  const location = useLocation();

  useEffect(() => {
    trackPageView(location.pathname, location.search);
  }, [location.pathname, location.search]);

  return null;
}

function RouteScrollManager() {
  const location = useLocation();
  const previousRoute = useRef<string | null>(null);

  useEffect(() => {
    const route = `${location.pathname}${location.search}`;
    if (previousRoute.current === null) {
      previousRoute.current = route;
      return;
    }
    if (previousRoute.current === route) return;
    previousRoute.current = route;

    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.querySelector<HTMLElement>("[data-filo-scroll-container]")?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.search]);

  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <AnalyticsPageView />
      <RouteScrollManager />
      <AppDataProvider>
      <TitleTranslationProvider>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route
          path="/sign-in/*"
          element={
            <AuthLayout>
              <AuthPage mode="sign-in" />
            </AuthLayout>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <AuthLayout>
              <AuthPage mode="sign-up" />
            </AuthLayout>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <AuthLayout>
              <ForgotPasswordPage />
            </AuthLayout>
          }
        />
        <Route
          path="/reset-password"
          element={
            <AuthLayout>
              <ResetPasswordPage />
            </AuthLayout>
          }
        />
        <Route path="/sign-out" element={<SignOutPage />} />
        {/* Web は記事詳細画面を持たない。一覧から元記事を開くか Extension に引き継ぐ (SPEC/SCREENS.md) */}
        <Route path="/articles" element={<ProtectedRoute><ArticlesPage /></ProtectedRoute>} />
        <Route path="/articles/new" element={<ProtectedRoute><AddArticlePage /></ProtectedRoute>} />
        <Route path="/subscriptions" element={<ProtectedRoute><SubscriptionsPage /></ProtectedRoute>} />
        <Route path="/subscriptions/:subscriptionId" element={<ProtectedRoute><SubscriptionDetailPage /></ProtectedRoute>} />
        <Route path="/feeds/new" element={<ProtectedRoute><AddFeedPage /></ProtectedRoute>} />
        <Route path="/tags" element={<ProtectedRoute><TagsPage /></ProtectedRoute>} />
        <Route path="/status" element={<ProtectedRoute><StatusPage /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
        <Route path="/settings/account-deletion" element={<AccountDeletionPage />} />
        <Route path="*" element={<RootRedirect />} />
      </Routes>
      {/* 翻訳の準備はアプリ全体で 1 箇所。どのトグルからでも開ける */}
      <TitleTranslationSetup />
      </TitleTranslationProvider>
      </AppDataProvider>
    </BrowserRouter>
  );
}
