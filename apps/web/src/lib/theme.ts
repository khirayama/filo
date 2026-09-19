export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "filo:theme";

// Mirrors settings.theme onto <html data-theme=…> so the CSS variables in
// global.css switch palettes. "system" removes the attribute and lets the
// prefers-color-scheme media query decide.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  const themeColor = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ? "#16181c"
    : "#ffffff";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // private mode etc.; theme still applies for this session
  }
}

// Applies the last known theme before settings load, to avoid a flash.
export function applyStoredTheme(): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (stored === "light" || stored === "dark" || stored === "system") applyTheme(stored);
}
