const MEASUREMENT_ID = "G-DDB2609MRP";
const CLIENT_ID_KEY = "filo:analyticsClientId";
const SESSION_ID_KEY = "filo:analyticsSessionId";
const SESSION_ACTIVE_AT_KEY = "filo:analyticsSessionActiveAt";
const SESSION_COUNT_KEY = "filo:analyticsSessionCount";

async function clientId(): Promise<string> {
  const stored = await chrome.storage.local.get(CLIENT_ID_KEY);
  if (typeof stored[CLIENT_ID_KEY] === "string") return stored[CLIENT_ID_KEY];
  const value = `${crypto.randomUUID()}.${Math.floor(Date.now() / 1000)}`;
  await chrome.storage.local.set({ [CLIENT_ID_KEY]: value });
  return value;
}

async function session(): Promise<{ id: string; count: number }> {
  const stored = await chrome.storage.local.get([SESSION_ID_KEY, SESSION_ACTIVE_AT_KEY, SESSION_COUNT_KEY]);
  const current = Date.now();
  const previousId = String(stored[SESSION_ID_KEY] ?? "");
  const previousActiveAt = Number(stored[SESSION_ACTIVE_AT_KEY] ?? 0);
  const isNew = !previousId || current - previousActiveAt > 30 * 60 * 1000;
  const id = isNew ? String(Math.floor(current / 1000)) : previousId;
  const count = Number(stored[SESSION_COUNT_KEY] ?? 0) + (isNew ? 1 : 0);
  await chrome.storage.local.set({ [SESSION_ID_KEY]: id, [SESSION_ACTIVE_AT_KEY]: current, [SESSION_COUNT_KEY]: count });
  return { id, count };
}

export function trackEvent(name: string, parameters: Record<string, string | number | boolean> = {}): void {
  void (async () => {
    const [cid, currentSession] = await Promise.all([clientId(), session()]);
    const query = new URLSearchParams({
      v: "2", tid: MEASUREMENT_ID, cid, _p: String(Date.now()), en: name,
      sid: currentSession.id, sct: String(currentSession.count), seg: "0", "ep.platform": "extension",
    });
    for (const [key, value] of Object.entries(parameters)) query.set(`ep.${key}`, String(value));
    await fetch(`https://www.google-analytics.com/g/collect?${query.toString()}`, { method: "GET", mode: "no-cors", keepalive: true });
  })().catch(() => undefined);
}
