export function Brand({ size = 28, showName = true }: { size?: number; showName?: boolean }) {
  return (
    <span style={{ alignItems: "center", display: "inline-flex", gap: "8px" }}>
      <img
        src="/logo.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        style={{ borderRadius: `${Math.round(size * 0.25)}px`, display: "block" }}
      />
      {showName ? <span>Filo</span> : null}
    </span>
  );
}
