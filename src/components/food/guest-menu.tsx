"use client";

import * as React from "react";

type Item = { id: string; category: string; name: string; description: string; pricePaise: number; imageUrl: string; veg: boolean };
type Menu = { venue: string; spot: { label: string; code: string }; open: boolean; welcomeNote: string; taxPercent: number; paymentModes: ("pay_now" | "room_bill" | "counter")[]; items: Item[] };
const PAY: Record<string, { label: string; hint: string }> = {
  pay_now: { label: "Pay now", hint: "UPI / card link on WhatsApp" },
  room_bill: { label: "Add to room bill", hint: "Pay at checkout" },
  counter: { label: "Pay at counter", hint: "Cash / UPI when served" },
};
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Mobile menu: pick dishes, then confirm the order from WhatsApp (sends a 6-character code). */
export function GuestMenu({ org, menu }: { org: string; menu: Menu }) {
  const cats = [...new Set(menu.items.map((i) => i.category))];
  const [cat, setCat] = React.useState(cats[0] ?? "");
  const [cart, setCart] = React.useState<Record<string, number>>({});
  const [sheet, setSheet] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [name, setName] = React.useState("");
  const [pay, setPay] = React.useState(menu.paymentModes[0] ?? "counter");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [done, setDone] = React.useState<{ code: string; url: string } | null>(null);
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const lines = Object.entries(cart).filter(([, q]) => q > 0).map(([id, qty]) => ({ item: byId.get(id)!, qty })).filter((l) => l.item);
  const count = lines.reduce((a, l) => a + l.qty, 0);
  const subtotal = lines.reduce((a, l) => a + l.qty * l.item.pricePaise, 0);
  const tax = Math.round((subtotal * menu.taxPercent) / 100);
  const add = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(20, (c[id] ?? 0) + d)) }));

  async function order() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/food-menu/${encodeURIComponent(org)}/${encodeURIComponent(menu.spot.code)}/order`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: lines.map((l) => ({ itemId: l.item.id, qty: l.qty })), note, paymentMode: pay, guestName: name }) });
      const d = (await res.json().catch(() => ({}))) as { code?: string; whatsappUrl?: string; error?: string };
      if (!res.ok || !d.code || !d.whatsappUrl) return setError(d.error ?? "Couldn't place the order. Please try again.");
      setDone({ code: d.code, url: d.whatsappUrl });
      window.location.href = d.whatsappUrl;
    } catch {
      setError("No internet connection. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-[#f7f5f0] pb-28 text-[#1c1b19]">
      <header className="sticky top-0 z-20 border-b border-black/5 bg-white/90 px-4 py-3 backdrop-blur">
        <p className="text-lg font-bold leading-tight">{menu.venue}</p>
        <p className="text-sm text-[#6b6860]">Ordering for <strong className="text-[#1c1b19]">{menu.spot.label}</strong></p>
        <nav className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Menu sections">
          {cats.map((c) => (
            <button key={c} type="button" onClick={() => { setCat(c); document.getElementById(`cat-${c}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${cat === c ? "bg-[#1c1b19] text-white" : "bg-black/5 text-[#3d3b36]"}`}>{c}</button>
          ))}
        </nav>
      </header>

      {!menu.open ? <p className="m-4 rounded-xl bg-amber-100 p-3 text-sm text-amber-900">The kitchen isn&apos;t taking orders right now. Please check back soon.</p> : null}
      {menu.welcomeNote ? <p className="mx-4 mt-4 rounded-xl bg-white p-3 text-sm text-[#3d3b36] shadow-sm">{menu.welcomeNote}</p> : null}
      {!menu.items.length ? <p className="m-4 text-sm text-[#6b6860]">The menu is being updated. Please ask the staff.</p> : null}

      <main className="mx-auto max-w-xl px-4">
        {cats.map((c) => (
          <section key={c} id={`cat-${c}`} className="scroll-mt-32 pt-5">
            <h2 className="mb-2 text-[16px] font-bold">{c}</h2>
            <ul className="space-y-3">
              {menu.items.filter((i) => i.category === c).map((i) => (
                <li key={i.id} className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm">
                  {i.imageUrl ? <img src={i.imageUrl} alt="" className="size-20 shrink-0 rounded-xl object-cover" loading="lazy" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-semibold leading-snug">
                      <span className={`grid size-3.5 shrink-0 place-items-center rounded-sm border ${i.veg ? "border-green-700" : "border-red-700"}`} aria-label={i.veg ? "Veg" : "Non-veg"}><span className={`size-1.5 rounded-full ${i.veg ? "bg-green-700" : "bg-red-700"}`} /></span>
                      {i.name}
                    </p>
                    {i.description ? <p className="mt-0.5 line-clamp-2 text-sm text-[#6b6860]">{i.description}</p> : null}
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-semibold">{inr(i.pricePaise)}</span>
                      {cart[i.id] ? (
                        <span className="flex items-center gap-3 rounded-full bg-[#128c7e] px-1 text-white">
                          <button type="button" onClick={() => add(i.id, -1)} className="grid size-8 place-items-center text-lg" aria-label={`One less ${i.name}`}>−</button>
                          <span className="min-w-4 text-center font-semibold" aria-live="polite">{cart[i.id]}</span>
                          <button type="button" onClick={() => add(i.id, 1)} className="grid size-8 place-items-center text-lg" aria-label={`One more ${i.name}`}>+</button>
                        </span>
                      ) : (
                        <button type="button" disabled={!menu.open} onClick={() => add(i.id, 1)} className="rounded-full border border-[#128c7e] px-4 py-1.5 text-sm font-semibold text-[#128c7e] disabled:opacity-40">Add</button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>

      {count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3">
          <button type="button" onClick={() => setSheet(true)} className="mx-auto flex w-full max-w-xl items-center justify-between rounded-2xl bg-[#128c7e] px-5 py-4 font-semibold text-white shadow-lg">
            <span>{count} item{count === 1 ? "" : "s"} · {inr(subtotal + tax)}</span>
            <span>Review order →</span>
          </button>
        </div>
      ) : null}

      {sheet ? (
        <div className="fixed inset-0 z-40 flex items-end bg-black/40" role="dialog" aria-modal="true" aria-label="Your order" onClick={() => setSheet(false)}>
          <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto max-w-xl">
              <div className="mb-3 flex items-center justify-between"><p className="text-lg font-bold">Your order · {menu.spot.label}</p><button type="button" onClick={() => setSheet(false)} className="text-sm text-[#6b6860]">Close</button></div>
              <ul className="divide-y divide-black/5">
                {lines.map((l) => (
                  <li key={l.item.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{l.qty} × {l.item.name}</span><span className="font-medium">{inr(l.qty * l.item.pricePaise)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 space-y-1 border-t border-black/10 pt-2 text-sm">
                {tax ? <p className="flex justify-between text-[#6b6860]"><span>Tax ({menu.taxPercent}%)</span><span>{inr(tax)}</span></p> : null}
                <p className="flex justify-between text-[16px] font-bold"><span>Total</span><span>{inr(subtotal + tax)}</span></p>
              </div>
              <label className="mt-4 block text-sm font-medium">Your name (optional)<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="mt-1 w-full rounded-xl border border-black/15 px-3 py-2.5" /></label>
              <label className="mt-3 block text-sm font-medium">Note for the kitchen (optional)<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder="Less spicy, no onion…" className="mt-1 w-full rounded-xl border border-black/15 px-3 py-2.5" /></label>
              <fieldset className="mt-3">
                <legend className="text-sm font-medium">Payment</legend>
                <div className="mt-1 grid gap-2">
                  {menu.paymentModes.map((m) => (
                    <label key={m} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 ${pay === m ? "border-[#128c7e] bg-[#128c7e]/5" : "border-black/15"}`}>
                      <input type="radio" name="pay" checked={pay === m} onChange={() => setPay(m)} className="accent-[#128c7e]" />
                      <span><span className="block text-sm font-semibold">{PAY[m].label}</span><span className="text-xs text-[#6b6860]">{PAY[m].hint}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {error ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
              {done ? (
                <p className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-800">WhatsApp should open now. If it didn&apos;t, <a href={done.url} className="font-semibold underline">tap here</a> and send the message (code <strong>{done.code}</strong>) to confirm your order.</p>
              ) : null}
              <button type="button" disabled={busy || !menu.open} onClick={() => void order()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#25d366] px-5 py-4 text-[16px] font-bold text-[#06301e] disabled:opacity-50">
                {busy ? "Placing…" : "Order on WhatsApp"}
              </button>
              <p className="mt-2 text-center text-xs text-[#6b6860]">WhatsApp opens with your order code — just press send to confirm. Updates come on WhatsApp.</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
