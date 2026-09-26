// The browser a build targets. Chrome is first-party; Firefox and Safari differ
// only in their manifest, while the code picks its APIs at runtime.
export type BrowserTarget = "chrome" | "firefox" | "safari";

export function browserTarget(): BrowserTarget {
  const value = process.env.FILO_BROWSER ?? "chrome";
  if (value !== "chrome" && value !== "firefox" && value !== "safari") {
    throw new Error(`Unknown FILO_BROWSER: ${value}`);
  }
  return value;
}

export function outDir(target: BrowserTarget): string {
  return target === "chrome" ? "dist" : `dist-${target}`;
}

interface Manifest {
  permissions?: string[];
  background?: Record<string, unknown>;
  content_scripts?: { matches: string[] }[];
  [key: string]: unknown;
}

// Firefox and Safari run the background as an event page rather than a service
// worker (the Web Speech fallback needs its window), and have no tts API.
export function manifestFor(target: BrowserTarget, manifest: Manifest): Manifest {
  if (target === "chrome") return manifest;
  const eventPage = { ...manifest, permissions: manifest.permissions?.filter((permission) => permission !== "tts") };
  if (target === "firefox") {
    return {
      ...eventPage,
      background: { scripts: ["background.js"], type: "module" },
      browser_specific_settings: { gecko: { id: "reader@filoreader.app", strict_min_version: "128.0" } },
    };
  }
  return { ...eventPage, background: { scripts: ["background.js"], type: "module", persistent: false } };
}
