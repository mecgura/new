"use client";

/**
 * Opens a payment provider's checkout for a session returned by the server. The browser never decides that a
 * payment succeeded: whatever the provider hands back is sent to the server, which verifies its signature.
 */
export type ClientSdkSession = { kind: "client_sdk"; gateway: string; reference: string; publicKey: string; amount: number; currency: string; name: string; description: string; prefill: { name: string; email: string }; mode: string; paymentId: string };
export type RedirectSession = { kind: "redirect"; gateway: string; reference: string; url: string; paymentId: string };
export type Checkout = ClientSdkSession | RedirectSession;

type RazorpayCtor = new (opts: Record<string, unknown>) => { open(): void; on(ev: string, cb: (r: { error?: { description?: string } }) => void): void };

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't load the payment window."));
    document.head.appendChild(s);
  });
}

/** Resolves with the provider's proof, or null if the person closed the window. */
export async function openCheckout(c: Checkout): Promise<Record<string, string> | null> {
  if (c.kind === "redirect") {
    window.location.href = c.url;
    return null;
  }
  if (c.gateway !== "razorpay") throw new Error("This payment provider isn't supported in the browser yet.");
  await loadScript("https://checkout.razorpay.com/v1/checkout.js");
  const Razorpay = (window as unknown as { Razorpay?: RazorpayCtor }).Razorpay;
  if (!Razorpay) throw new Error("Couldn't load the payment window.");
  return new Promise((resolve, reject) => {
    const rz = new Razorpay({
      key: c.publicKey,
      order_id: c.reference,
      amount: c.amount,
      currency: c.currency,
      name: c.name,
      description: c.description,
      prefill: c.prefill,
      handler: (r: Record<string, string>) => resolve(r),
      modal: { ondismiss: () => resolve(null) },
    });
    rz.on("payment.failed", (r) => reject(new Error(r.error?.description || "The payment didn't go through.")));
    rz.open();
  });
}
