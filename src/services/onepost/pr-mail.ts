/**
 * Press emails go out through the same email service as the rest of the platform (Resend, RESEND_API_KEY + EMAIL_FROM), but with an HTML part
 * (for the open pixel) and a one-click unsubscribe header. Without those settings nothing is sent and the caller says so.
 */
export const isPrMailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendPrMail(m: { to: string; subject: string; text: string; html: string; replyTo?: string; unsubscribeUrl: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html, ...(m.replyTo ? { reply_to: m.replyTo } : {}), headers: { "List-Unsubscribe": `<${m.unsubscribeUrl}>` } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, error: `Email service refused it (${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: "The email service did not respond." };
  }
}
