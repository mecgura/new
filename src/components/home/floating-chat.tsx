"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MessageCircle, Send, X } from "lucide-react";

const QUICK = [
  { label: "Book a demo", text: "Hi MECGURA, I would like a demo of the platform." },
  { label: "Plans and pricing", text: "Hi MECGURA, please share your plans and pricing." },
  { label: "Help setting up", text: "Hi MECGURA, I need help setting up WhatsApp for my business." },
];

type Config = { enabled: true; key: string; greeting: string } | { enabled: false };
type Msg = { id: string; from: "me" | "them"; text: string };

const store = {
  get: (k: string) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* private mode: stays in memory */
    }
  },
};

function visitorId() {
  let id = store.get("mgc_site_visitor");
  if (!id || !/^[A-Za-z0-9_-]{24,64}$/.test(id)) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    store.set("mgc_site_visitor", id);
  }
  return id;
}

/**
 * Floating chat. When the admin has switched the chatbot on, visitors leave a name and number (they
 * become a lead) and chat with the assistant. Otherwise it offers quick WhatsApp links.
 */
function ChatWidget({ digits }: { digits: string }) {
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState<Config>({ enabled: false });
  const [vid, setVid] = useState("");
  const [known, setKnown] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seen = useRef(new Set<string>());
  const since = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const link = (t: string) => `https://wa.me/${digits}?text=${encodeURIComponent(t)}`;

  useEffect(() => {
    fetch("/api/site-chat")
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((c: Config) => {
        setCfg(c);
        if (c.enabled) {
          setVid(visitorId());
          setKnown(store.get("mgc_site_lead") === "1");
        }
      })
      .catch(() => setCfg({ enabled: false }));
  }, []);

  const add = useCallback((m: Msg) => {
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    setMsgs((x) => [...x, m]);
  }, []);

  // Replies from the team (and the assistant) arrive by polling while the window is open.
  useEffect(() => {
    if (!open || !known || !cfg.enabled || !vid) return;
    const poll = async () => {
      try {
        const q = new URLSearchParams({ visitorId: vid, ...(since.current ? { since: since.current } : {}) });
        const r = await fetch(`/api/webchat/${cfg.key}?${q}`);
        if (!r.ok) return;
        const data = (await r.json()) as { messages?: { id: string; text: string; at: string }[] };
        for (const m of data.messages ?? []) {
          add({ id: m.id, from: "them", text: m.text });
          if (!since.current || m.at > since.current) since.current = m.at;
        }
      } catch {
        /* try again next time */
      }
    };
    void poll();
    const t = setInterval(poll, 6000);
    return () => clearInterval(t);
  }, [open, known, cfg, vid, add]);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [msgs]);

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/site-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitorId: vid, ...body }) });
    const data = (await r.json().catch(() => ({}))) as { error?: string; greeting?: { id: string; text: string; at: string } | null; reply?: { id: string; text: string; at: string } | null };
    if (!r.ok) throw new Error(data.error ?? "Something went wrong. Please try again.");
    return data;
  }

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await post({ action: "lead", name, phone });
      store.set("mgc_site_lead", "1");
      setKnown(true);
      if (d.greeting) {
        add({ id: d.greeting.id, from: "them", text: d.greeting.text });
        since.current = d.greeting.at;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the chat.");
    } finally {
      setBusy(false);
    }
  }

  async function submitMessage(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    setBusy(true);
    setError("");
    add({ id: `me-${Date.now()}`, from: "me", text: t });
    try {
      const d = await post({ action: "message", text: t });
      if (d.reply) {
        add({ id: d.reply.id, from: "them", text: d.reply.text });
        if (!since.current || d.reply.at > since.current) since.current = d.reply.at;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message not sent.");
    } finally {
      setBusy(false);
    }
  }

  const chatMode = cfg.enabled;
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open ? (
        <div role="dialog" aria-label="Chat with MECGURA" translate="no" className="wa-card w-[min(21rem,calc(100vw-2rem))] overflow-hidden shadow-xl">
          <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
            <span className="grid size-9 place-items-center rounded-full bg-white/15 font-bold">M</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight">MECGURA</p>
              <p className="text-xs text-white/80">{chatMode ? "Assistant · team replies here" : "We reply on WhatsApp"}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="rounded-full p-1.5 hover:bg-white/15">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          {chatMode && !known ? (
            <form onSubmit={submitLead} className="wa-chat-bg space-y-3 p-4">
              <p className="wa-bubble wa-in">Hi! 👋 Share your name and WhatsApp number and we will chat right here.</p>
              <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Your name" aria-label="Your name" autoComplete="name" className="w-full rounded-lg border border-[var(--wa-line)] bg-white px-3 py-2.5 text-sm" />
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" placeholder="WhatsApp number" aria-label="WhatsApp number" autoComplete="tel" className="w-full rounded-lg border border-[var(--wa-line)] bg-white px-3 py-2.5 text-sm" />
              {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
              <button type="submit" disabled={busy} className="wa-btn w-full !min-h-11 text-sm disabled:opacity-60">{busy ? "Starting…" : "Start chat"}</button>
              <p className="text-center text-[11px] text-[#667781]">We use your number only to reply to you.</p>
            </form>
          ) : chatMode ? (
            <div>
              <div className="wa-chat-bg flex h-72 flex-col gap-2 overflow-y-auto p-3" aria-live="polite">
                {msgs.map((m) => (
                  <p key={m.id} className={`wa-bubble ${m.from === "me" ? "wa-out" : "wa-in"}`}>{m.text}</p>
                ))}
                <div ref={bottom} />
              </div>
              {error ? <p role="alert" className="bg-white px-3 pt-2 text-sm text-red-700">{error}</p> : null}
              <form onSubmit={submitMessage} className="flex gap-2 border-t border-[var(--wa-line)] bg-white p-2.5">
                <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Type a message" aria-label="Message" className="min-w-0 flex-1 rounded-full border border-[var(--wa-line)] px-4 py-2 text-sm" />
                <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="grid size-10 shrink-0 place-items-center rounded-full bg-[#128c7e] text-white disabled:opacity-50">
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </form>
              <a href={link("Hi MECGURA, I was chatting on your website.")} target="_blank" rel="noreferrer" className="block bg-[#f0f2f5] px-4 py-2 text-center text-xs font-semibold text-[#075e54] hover:underline">
                Continue on WhatsApp
              </a>
            </div>
          ) : (
            <div className="wa-chat-bg space-y-3 p-4">
              <p className="wa-bubble wa-in">Hi! 👋 How can we help you today?</p>
              <div className="flex flex-col gap-2">
                {QUICK.map((q) => (
                  <a key={q.label} href={link(q.text)} target="_blank" rel="noreferrer" className="rounded-full border border-[#128c7e]/40 bg-white px-4 py-2 text-center text-sm font-semibold text-[#075e54] hover:bg-[#e7f7ee]">
                    {q.label}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close chat" : "Chat with us"}
        className="wa-fab grid size-14 place-items-center rounded-full bg-[#25d366] text-white shadow-lg hover:brightness-95"
      >
        {open ? <X className="size-6" aria-hidden="true" /> : <MessageCircle className="size-7" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** A problem inside the chat must never blank the whole home page: fall back to a plain WhatsApp button. */
class ChatBoundary extends Component<{ digits: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("[chat] widget crashed:", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <a
        href={`https://wa.me/${this.props.digits}?text=${encodeURIComponent("Hi MECGURA, I would like to know more about the platform.")}`}
        target="_blank"
        rel="noreferrer"
        aria-label="Chat with us on WhatsApp"
        className="fixed bottom-4 right-4 z-40 grid size-14 place-items-center rounded-full bg-[#25d366] text-white shadow-lg sm:bottom-6 sm:right-6"
      >
        <MessageCircle className="size-7" aria-hidden="true" />
      </a>
    );
  }
}

export function FloatingChat({ digits }: { digits: string }) {
  return (
    <ChatBoundary digits={digits}>
      <ChatWidget digits={digits} />
    </ChatBoundary>
  );
}
