// Transactional email. Uses the Resend HTTP API when RESEND_API_KEY and
// EMAIL_FROM are configured (no extra dependency). Without them, email is
// "not configured": callers must surface that honestly instead of pretending
// a message was sent. In development the message is printed to the server log.

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export type MailResult = { delivered: boolean; channel: "resend" | "dev-log" | "none" };

export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  if (isEmailConfigured()) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text }),
    });
    if (!res.ok) {
      console.error("[mailer] Resend responded", res.status);
      return { delivered: false, channel: "resend" };
    }
    return { delivered: true, channel: "resend" };
  }
  if (process.env.NODE_ENV !== "production") {
    console.info(`[mailer:dev] To: ${to}\nSubject: ${subject}\n\n${text}`);
    return { delivered: true, channel: "dev-log" };
  }
  return { delivered: false, channel: "none" };
}
