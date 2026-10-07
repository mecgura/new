"use client";

// Last-resort boundary: replaces the root layout when it crashes, so it must render its own <html>/<body>.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#0C160D", color: "#f4f4f6" }}>
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Something went wrong</h1>
          <p style={{ maxWidth: 420, opacity: 0.8 }}>An unexpected error occurred. Please try again.</p>
          <button type="button" onClick={reset} style={{ marginTop: 16, height: 44, padding: "0 24px", borderRadius: 8, border: 0, background: "#2dd4bf", color: "#062026", fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
