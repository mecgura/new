"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";

const QUICK = [
  { label: "Book a demo", text: "Hi MECGURA, I would like a demo of the platform." },
  { label: "Plans and pricing", text: "Hi MECGURA, please share your plans and pricing." },
  { label: "Help setting up", text: "Hi MECGURA, I need help setting up WhatsApp for my business." },
];

/** Floating WhatsApp window: tapping a choice opens WhatsApp with the message ready to send. */
export function FloatingChat({ digits }: { digits: string }) {
  const [open, setOpen] = useState(false);
  const link = (text: string) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open ? (
        <div role="dialog" aria-label="Chat with MECGURA" className="wa-card w-[min(20rem,calc(100vw-2rem))] overflow-hidden shadow-xl">
          <div className="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
            <span className="grid size-9 place-items-center rounded-full bg-white/15 font-bold">M</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight">MECGURA</p>
              <p className="text-xs text-white/80">We reply on WhatsApp</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="rounded-full p-1.5 hover:bg-white/15">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
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
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={open ? "Close chat" : "Chat with us on WhatsApp"}
        className="wa-fab grid size-14 place-items-center rounded-full bg-[#25d366] text-white shadow-lg hover:brightness-95"
      >
        {open ? <X className="size-6" aria-hidden="true" /> : <MessageCircle className="size-7" aria-hidden="true" />}
      </button>
    </div>
  );
}
