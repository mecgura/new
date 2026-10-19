// Resend transport for the email channel. Only called when RESEND_API_KEY and EMAIL_FROM are set;
// demo inboxes never reach this file.
export type EmailSendResult = { ok: true; id: string } | { ok: false; error: string; retryable: boolean };

export async function sendCustomerEmail(input: { fromName: string; fromAddress: string; to: string; subject: string; text: string; inReplyTo?: string }): Promise<EmailSendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "Email sending isn't configured.", retryable: false };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: input.fromName ? `${input.fromName.replace(/[<>"\r\n]/g, "")} <${input.fromAddress}>` : input.fromAddress,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.inReplyTo ? { headers: { "In-Reply-To": input.inReplyTo, References: input.inReplyTo } } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.ok && data.id) return { ok: true, id: data.id };
    return { ok: false, error: (data.message ?? `Email provider returned ${res.status}`).slice(0, 300), retryable: res.status === 429 || res.status >= 500 };
  } catch {
    return { ok: false, error: "Could not reach the email provider.", retryable: true };
  }
}
