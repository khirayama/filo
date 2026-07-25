import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { App } from "./App";
import { applyStoredTheme } from "./lib/theme";
import "./global.css";

applyStoredTheme();

const container = document.getElementById("root");
const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (container === null) {
  throw new Error("Root container not found.");
}

if (!clerkPublishableKey) {
  throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set.");
}

createRoot(container).render(
  <StrictMode>
    <ClerkProvider
      afterSignOutUrl="/sign-in"
      publishableKey={clerkPublishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
);
