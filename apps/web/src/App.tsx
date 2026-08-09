import type { ReactNode } from "react";
import { SignIn, SignUp, useAuth } from "@clerk/clerk-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppDataProvider } from "./components/AppDataContext";
import { TitleTranslationProvider } from "./components/TitleTranslationContext";
import { TitleTranslationSetup } from "./components/TitleTranslationSetup";
import { pageStyle, sectionStyle, shellStyle } from "./components/ui";
import { AccountDeletionPage } from "./screens/AccountDeletionPage";
import { AddFeedPage } from "./screens/AddFeedPage";
import { ArticlesPage } from "./screens/ArticlesPage";
import { AddArticlePage } from "./screens/AddArticlePage";
import { SettingsPage } from "./screens/SettingsPage";
import { StatusPage } from "./screens/StatusPage";
import { SubscriptionDetailPage } from "./screens/SubscriptionDetailPage";
import { SubscriptionsPage } from "./screens/SubscriptionsPage";
import { TagsPage } from "./screens/TagsPage";

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLoaded, userId } = useAuth();
  if (!isLoaded) return null;
  if (!userId) return <Navigate replace to="/sign-in" />;
  return children;
}

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main style={pageStyle}>
      <section style={{ ...shellStyle, ...sectionStyle, display: "grid", justifyContent: "center" }}>
        <h1 style={{ textAlign: "center" }}>Filo</h1>
        {children}
      </section>
    </main>
  );
}

function RootRedirect() {
  const { isLoaded, userId } = useAuth();
  if (!isLoaded) return null;
  return <Navigate replace to={userId ? "/articles" : "/sign-in"} />;
}

export function App() {
  return (
    <BrowserRouter>
      <AppDataProvider>
      <TitleTranslationProvider>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route
          path="/sign-in/*"
          element={
            <AuthLayout>
              <SignIn forceRedirectUrl="/articles" path="/sign-in" routing="path" signUpUrl="/sign-up" />
            </AuthLayout>
          }
        />
        <Route
          path="/sign-up/*"
          element={
            <AuthLayout>
              <SignUp forceRedirectUrl="/articles" path="/sign-up" routing="path" signInUrl="/sign-in" />
            </AuthLayout>
          }
        />
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
