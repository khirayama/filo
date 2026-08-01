import { useEffect } from "react";

export function App() {
  useEffect(() => {
    document.title = "Filo RSS Reader";
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "20px", width: "280px" }}>
      <h1 style={{ fontSize: "20px", margin: "0 0 8px" }}>Filo</h1>
      <p style={{ color: "#666", fontSize: "13px", lineHeight: 1.5 }}>
        翻訳付きRSSリーダーはWebアプリで利用できます。
      </p>
      <a
        href="http://localhost:5173/articles"
        target="_blank"
        rel="noreferrer"
        style={{ color: "#2563eb", fontSize: "13px" }}
      >
        RSSリーダーを開く
      </a>
    </main>
  );
}
