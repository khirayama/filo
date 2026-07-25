import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/chrome-extension";
import { App } from "./App";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
// Web アプリの origin。設定すると Web でのサインインセッションが拡張機能に同期され、
// 拡張機能内で別途サインインする必要がなくなる (Clerk Sync Host)。
const SYNC_HOST = import.meta.env.VITE_CLERK_SYNC_HOST as string | undefined;
const EXTENSION_URL = `chrome-extension://${chrome.runtime.id}/popup.html`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      syncHost={SYNC_HOST}
      afterSignOutUrl={EXTENSION_URL}
      signInFallbackRedirectUrl={EXTENSION_URL}
      signUpFallbackRedirectUrl={EXTENSION_URL}
      allowedRedirectOrigins={[`chrome-extension://${chrome.runtime.id}`]}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
);
