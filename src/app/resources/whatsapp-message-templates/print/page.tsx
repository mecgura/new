import type { Metadata } from "next";
import { PACK_RULES, TEMPLATE_PACK } from "@/config/template-pack";

export const metadata: Metadata = { title: "Template pack (print)", robots: { index: false, follow: false } };

/** Plain, printable version of the template pack. The downloadable PDF is made from this page. */
export default function Print() {
  return (
    <main style={{ fontFamily: "Inter, Arial, sans-serif", color: "#0b1f1a", maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>22 WhatsApp Business message templates</h1>
      <p style={{ color: "#4b6b61" }}>by MECGURA · mecgura.tech</p>
      <h2 style={{ fontSize: 18 }}>Rules to follow</h2>
      <ul>{PACK_RULES.map((r) => <li key={r} style={{ marginBottom: 6 }}>{r}</li>)}</ul>
      <h2 style={{ fontSize: 18, marginTop: 20 }}>Templates</h2>
      {TEMPLATE_PACK.map((t) => (
        <div key={t.id} style={{ breakInside: "avoid", border: "1px solid #d7e3de", borderRadius: 10, padding: 12, margin: "10px 0" }}>
          <strong>{t.name}</strong> <span style={{ fontSize: 12, color: "#075e54" }}>({t.category.toLowerCase()})</span>
          <div style={{ fontSize: 12, color: "#4b6b61" }}>{t.use}</div>
          <div style={{ marginTop: 6, background: "#f4f7f6", padding: 8, borderRadius: 6, whiteSpace: "pre-line" }}>{t.body}</div>
        </div>
      ))}
      <p style={{ marginTop: 20, fontSize: 12, color: "#4b6b61" }}>Templates must be approved by Meta before sending. Send marketing messages only to customers who opted in.</p>
    </main>
  );
}
