import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/chrome-extension";
import { App } from "./App";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "./config";

if (!CLERK_PUBLISHABLE_KEY) throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set.");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkProvider
      __experimental_syncHostListener
      publishableKey={CLERK_PUBLISHABLE_KEY}
      syncHost={CLERK_SYNC_HOST}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
);
