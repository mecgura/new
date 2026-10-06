"use client";

// Last-resort boundary (root layout failed). Must render its own <html>; uses inline styles because CSS may not have loaded.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100dvh", alignItems: "center", justifyContent: "center", margin: 0, padding: 24, textAlign: "center" }}>
        <div role="alert">
          <h1 style={{ fontSize: 22 }}>Something went wrong</h1>
          <p style={{ color: "#566677" }}>This is on our side, not yours. Please try again.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: "10px 18px", fontSize: 16, borderRadius: 8, border: 0, background: "#14529e", color: "#fff", cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
