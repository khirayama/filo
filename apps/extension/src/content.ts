import { Readability } from "@mozilla/readability";

const WEB_SOURCE = "filo-web";
const EXTENSION_SOURCE = "filo-extension";
const CONTROL_ID = "filo-reader-controls";

interface ReaderViewState {
  index: number;
  count: number;
  title: string;
  playing: boolean;
  rate: number;
  voiceName: string | null;
  sourceLanguage: string | null;
  targetLanguage: string;
  appUrl: string;
  positionPercent: number;
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== WEB_SOURCE) return;
  if (event.data.type === "ping") {
    window.postMessage({ source: EXTENSION_SOURCE, type: "ready" }, "*");
  } else if (event.data.type === "start") {
    const requestId = event.data.requestId;
    try {
      chrome.runtime.sendMessage({
        type: "filoStart",
        session: event.data.session,
        autoplay: event.data.autoplay,
        targetLanguage: event.data.targetLanguage,
        appUrl: event.data.appUrl,
      }).then((response) => {
        window.postMessage({
          source: EXTENSION_SOURCE,
          type: "startResult",
          requestId,
          ok: response?.ok === true,
          error: response?.error,
        }, "*");
      }).catch((error: unknown) => {
        window.postMessage({
          source: EXTENSION_SOURCE,
          type: "startResult",
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }, "*");
      });
    } catch (error) {
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: "startResult",
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }, "*");
    }
  }
});

function extract() {
  const article = new Readability(document.cloneNode(true) as Document, { charThreshold: 100 }).parse();
  const text = article?.textContent?.trim() ?? "";
  return text.length >= 100
    ? { text, lang: article?.lang ?? document.documentElement.lang ?? null }
    : null;
}

function button(label: string, action: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = label;
  element.type = "button";
  element.addEventListener("click", () => chrome.runtime.sendMessage({ type: "filoControl", action }));
  return element;
}

async function renderControls(state: ReaderViewState): Promise<void> {
  document.getElementById(CONTROL_ID)?.remove();
  const host = document.createElement("div");
  host.id = CONTROL_ID;
  host.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    .bar{font:13px system-ui;background:#111827;color:white;padding:7px 12px;box-shadow:0 -2px 12px #0005}
    .row{display:flex;align-items:center;justify-content:center;gap:8px}.row+.row{margin-top:6px}
    button,select,input{font:inherit}button,a{background:#374151;color:white;border:1px solid #6b7280;border-radius:6px;padding:5px 10px;text-decoration:none;cursor:pointer}
    .title{min-width:0;max-width:36vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.progress{color:#d1d5db}
    label{display:flex;align-items:center;gap:4px}select{max-width:180px}
  </style>`;
  const bar = document.createElement("div");
  bar.className = "bar";
  const first = document.createElement("div");
  first.className = "row";
  const previous = button("前へ", "previous");
  previous.disabled = state.index <= 0;
  first.append(previous, button(state.playing ? "一時停止" : "読み上げ", state.playing ? "pause" : "play"));
  const next = button("次へ", "next");
  next.disabled = state.index >= state.count - 1;
  first.append(next);
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = state.title;
  first.append(title);
  const progress = document.createElement("span");
  progress.className = "progress";
  progress.textContent = `${state.index + 1}/${state.count} · ${Math.round(state.positionPercent * 100)}%`;
  first.append(progress);

  const second = document.createElement("div");
  second.className = "row";
  const link = document.createElement("a");
  link.href = state.appUrl;
  link.target = "_blank";
  link.textContent = "リーディングリスト";
  second.append(link);

  const language = document.createElement("select");
  for (const code of ["ja", "en", "zh", "ko", "es"]) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = code;
    option.selected = code === state.targetLanguage;
    language.append(option);
  }
  language.addEventListener("change", () => chrome.runtime.sendMessage({
    type: "filoControl", action: "settings", targetLanguage: language.value,
  }));
  const languageLabel = document.createElement("label");
  languageLabel.append("言語", language);
  second.append(languageLabel);

  const rate = document.createElement("select");
  for (const value of [0.75, 1, 1.25, 1.5, 2, 3]) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value}x`;
    option.selected = value === state.rate;
    rate.append(option);
  }
  rate.addEventListener("change", () => chrome.runtime.sendMessage({
    type: "filoControl", action: "settings", rate: Number(rate.value),
  }));
  const rateLabel = document.createElement("label");
  rateLabel.append("速度", rate);
  second.append(rateLabel);

  const voiceResponse = await chrome.runtime.sendMessage({ type: "filoGetVoices" }).catch(() => null) as
    | { data?: Array<{ name: string; lang?: string }> }
    | null;
  const voices = voiceResponse?.data ?? [];
  const voice = document.createElement("select");
  const automatic = document.createElement("option");
  automatic.value = "";
  automatic.textContent = "自動";
  voice.append(automatic);
  for (const item of voices.filter((item) => !state.targetLanguage || item.lang?.startsWith(state.targetLanguage))) {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    option.selected = item.name === state.voiceName;
    voice.append(option);
  }
  voice.addEventListener("change", () => chrome.runtime.sendMessage({
    type: "filoControl", action: "settings", voiceName: voice.value || null,
  }));
  const voiceLabel = document.createElement("label");
  voiceLabel.append("声", voice);
  second.append(voiceLabel);
  bar.append(first, second);
  root.append(bar);
  document.documentElement.append(host);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "filoExtract") {
    sendResponse(extract());
    return false;
  }
  if (message?.type === "filoReaderState") {
    void renderControls(message.state as ReaderViewState);
    return false;
  }
  if (message?.type === "filoWebEvent") {
    window.postMessage({ source: EXTENSION_SOURCE, type: "event", event: message.event }, "*");
    return false;
  }
  return false;
});

chrome.runtime.sendMessage({ type: "filoPageReady" }).catch(() => undefined);
