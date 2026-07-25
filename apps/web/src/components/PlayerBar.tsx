import { useState } from "react";
import { RATE_OPTIONS, defaultVoiceFor, usePlayer, voiceLangKey } from "./PlayerContext";
import { IconButton, palette } from "./ui";
import { useAppData } from "./AppDataContext";

export const PLAYER_BAR_HEIGHT = 56;

// 画面下部に常駐する読み上げプレイヤー。キューが空のときは表示しない。
export function PlayerBar() {
  const {
    queue,
    playState,
    currentArticleId,
    fraction,
    rate,
    error,
    play,
    pause,
    next,
    prev,
    setRate,
    voices,
    voicePrefs,
    speechLang,
    setVoice,
    removeFromQueue,
    moveInQueue,
    clearQueue,
  } = usePlayer();
  const [showQueue, setShowQueue] = useState(false);
  const { t } = useAppData();

  if (queue.length === 0) return null;

  const currentItem = queue.find((item) => item.articleId === currentArticleId) ?? null;
  const isPlaying = playState === "playing";
  const isLoading = playState === "loading";
  const currentIndex = currentItem ? queue.findIndex((item) => item.articleId === currentItem.articleId) : -1;

  // 音声設定は言語ごと。再生中(または直近)の言語を対象にし、初期状態は日本語。
  const voiceLang = voiceLangKey(speechLang ?? "ja");
  const voiceOptions = voices
    .filter((voice) => voice.lang.toLowerCase().startsWith(voiceLang))
    .sort((a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name));
  const defaultVoice = defaultVoiceFor(voices, voiceLang);

  return (
    <>
      {showQueue ? (
        <div
          style={{
            background: palette.surface,
            border: `1px solid ${palette.border}`,
            borderRadius: "8px",
            bottom: `${PLAYER_BAR_HEIGHT + 8}px`,
            boxShadow: `0 4px 16px ${palette.shadow}`,
            maxHeight: "50vh",
            maxWidth: "480px",
            overflowY: "auto",
            position: "fixed",
            right: "8px",
            width: "calc(100vw - 16px)",
            zIndex: 40,
          }}
        >
          <div
            style={{
              alignItems: "center",
              borderBottom: `1px solid ${palette.mutedBorder}`,
              display: "flex",
              gap: "8px",
              padding: "8px 12px",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 700 }}>{t("読み上げキュー")} ({queue.length})</span>
            <span style={{ flex: 1 }} />
            <IconButton icon="trash" label={t("キューを空にする")} size={16} onClick={() => void clearQueue()} />
            <IconButton icon="close" label={t("閉じる")} size={16} onClick={() => setShowQueue(false)} />
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: "4px 0" }}>
            {queue.map((item, index) => {
              const isCurrent = item.articleId === currentArticleId;
              return (
                <li
                  key={item.articleId}
                  style={{
                    alignItems: "center",
                    background: isCurrent ? palette.hover : "transparent",
                    display: "flex",
                    gap: "4px",
                    padding: "4px 8px",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => play(item.articleId)}
                    title={t("この記事から再生")}
                    style={{
                      background: "none",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      flex: 1,
                      minWidth: 0,
                      padding: 0,
                      textAlign: "left",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        fontSize: "13px",
                        fontWeight: isCurrent ? 700 : 400,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.article.title}
                    </span>
                    <span style={{ color: palette.muted, display: "block", fontSize: "11px" }}>
                      {item.article.feed.title}
                    </span>
                  </button>
                  <IconButton
                    icon="chevronUp"
                    label={t("上へ移動")}
                    size={14}
                    disabled={index === 0}
                    onClick={() => void moveInQueue(item.articleId, -1)}
                  />
                  <IconButton
                    icon="chevronDown"
                    label={t("下へ移動")}
                    size={14}
                    disabled={index === queue.length - 1}
                    onClick={() => void moveInQueue(item.articleId, 1)}
                  />
                  <IconButton
                    icon="close"
                    label={t("キューから削除")}
                    size={14}
                    onClick={() => void removeFromQueue(item.articleId)}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div
        style={{
          alignItems: "center",
          background: palette.surface,
          borderTop: `1px solid ${palette.border}`,
          bottom: 0,
          boxSizing: "border-box",
          display: "flex",
          gap: "8px",
          height: `${PLAYER_BAR_HEIGHT}px`,
          left: 0,
          padding: "0 12px",
          position: "fixed",
          right: 0,
          zIndex: 35,
        }}
      >
        <div
          style={{
            background: palette.accent,
            height: "2px",
            left: 0,
            opacity: currentItem ? 1 : 0,
            position: "absolute",
            top: 0,
            transition: "width 0.3s",
            width: `${Math.round(fraction * 100)}%`,
          }}
        />
        <IconButton icon="skipPrev" label={t("前の記事")} size={16} disabled={currentIndex <= 0} onClick={prev} />
        <IconButton
          icon={isPlaying || isLoading ? "pause" : "play"}
          label={isPlaying || isLoading ? t("一時停止") : t("再生")}
          size={20}
          onClick={() => (isPlaying || isLoading ? pause() : play())}
        />
        <IconButton
          icon="skipNext"
          label={t("次の記事")}
          size={16}
          disabled={currentIndex < 0 || currentIndex >= queue.length - 1}
          onClick={next}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          {error ? (
            <span style={{ color: palette.danger, fontSize: "12px" }}>{error}</span>
          ) : currentItem ? (
            <a
              href={currentItem.article.canonicalUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "inherit",
                display: "block",
                fontSize: "13px",
                overflow: "hidden",
                textDecoration: "none",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {isLoading ? `${t("読み込み中…")} ` : null}
              {currentItem.article.title}
            </a>
          ) : (
            <span style={{ color: palette.muted, fontSize: "13px" }}>{t("読み上げキュー")}: {queue.length}</span>
          )}
        </div>
        {voiceOptions.length > 0 ? (
          <select
            aria-label={`${t("読み上げ音声")} (${voiceLang})`}
            title={`${t("読み上げ音声")} (${voiceLang})`}
            value={voicePrefs[voiceLang] ?? ""}
            onChange={(e) => setVoice(voiceLang, e.target.value || null)}
            style={{
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              borderRadius: "6px",
              color: "inherit",
              fontSize: "12px",
              maxWidth: "140px",
              padding: "4px 6px",
            }}
          >
            <option value="">{t("自動")}{defaultVoice ? `（${defaultVoice.name}）` : ""}</option>
            {voiceOptions.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name}
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label={t("読み上げ速度")}
          value={String(rate)}
          onChange={(e) => setRate(Number(e.target.value))}
          style={{
            background: palette.surface,
            border: `1px solid ${palette.border}`,
            borderRadius: "6px",
            color: "inherit",
            fontSize: "12px",
            padding: "4px 6px",
          }}
        >
          {RATE_OPTIONS.map((option) => (
            <option key={option} value={String(option)}>
              {option}x
            </option>
          ))}
        </select>
        <IconButton
          icon="list"
          label={t("キューを表示")}
          active={showQueue}
          onClick={() => setShowQueue((v) => !v)}
        />
      </div>
      <div style={{ height: `${PLAYER_BAR_HEIGHT}px` }} />
    </>
  );
}
