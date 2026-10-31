const iconPaths = {
  externalLink: (
    <>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </>
  ),
  play: <polygon points="6 4 20 12 6 20 6 4" />,
  pause: (
    <>
      <path d="M6 4h4v16H6z" />
      <path d="M14 4h4v16h-4z" />
    </>
  ),
  queueAdd: (
    <>
      <path d="M3 6h13" />
      <path d="M3 12h13" />
      <path d="M3 18h9" />
      <path d="M18 15v6" />
      <path d="M15 18h6" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </>
  ),
} as const;

export type IconName = keyof typeof iconPaths;

export function Icon({ name, size = 18, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      {iconPaths[name]}
    </svg>
  );
}
