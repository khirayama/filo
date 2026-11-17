import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyStoredTheme } from "./lib/theme";
import { initAnalytics } from "./lib/analytics";
import "./global.css";

initAnalytics();
applyStoredTheme();

const container = document.getElementById("root");

if (container === null) {
  throw new Error("Root container not found.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
