"use client";

import * as React from "react";
import { Mic, MicOff, Phone, PhoneIncoming, PhoneOff } from "lucide-react";
import { useToast } from "@/components/ds";
import { apiFetch } from "@/lib/client-api";

type Call = { id: string; direction: "inbound" | "outbound"; status: string; peerPhone: string; peerName: string; offerSdp: string; answerSdp: string; answeredAt: string | null };
type Session = { callId: string | null; name: string; direction: "inbound" | "outbound"; status: "starting" | "connecting" | "ringing" | "active"; answeredAt: number | null; pc: RTCPeerConnection; stream: MediaStream };

/** Event other parts of the app fire to place a WhatsApp call from a chat. */
export const START_CALL_EVENT = "mgc:wa-call";
export type StartCallDetail = { conversationId: string; name: string };

const ICE = [{ urls: "stun:stun.l.google.com:19302" }];
const ENDED = ["ended", "missed", "rejected", "failed"];

/** Resolves when ICE gathering finishes (or after `ms`), so the SDP we send to Meta carries our candidates. */
function iceDone(pc: RTCPeerConnection, ms = 2500) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const t = window.setTimeout(resolve, ms);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        window.clearTimeout(t);
        resolve();
      }
    });
  });
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * WhatsApp calls in the browser: rings for incoming customer calls, places calls started from a chat, and shows
 * the call bar (timer, mute, hang up). Audio goes straight between this browser and Meta over WebRTC.
 */
export function CallDock({ orgId }: { orgId: string }) {
  const toast = useToast();
  const base = `/api/organizations/${orgId}/calls`;
  const [ringing, setRinging] = React.useState<Call | null>(null);
  const [session, setSession] = React.useState<Session | null>(null);
  const [muted, setMuted] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());
  const dismissed = React.useRef(new Set<string>());
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const sessionRef = React.useRef<Session | null>(null);
  React.useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const cleanup = React.useCallback((s: Session | null) => {
    if (!s) return;
    s.stream.getTracks().forEach((t) => t.stop());
    s.pc.close();
    setSession(null);
    setMuted(false);
  }, []);

  const newPeer = React.useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const pc = new RTCPeerConnection({ iceServers: ICE });
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.ontrack = (e) => {
      if (audioRef.current) {
        audioRef.current.srcObject = e.streams[0];
        void audioRef.current.play().catch(() => undefined);
      }
    };
    return { pc, stream };
  }, []);

  // Poll for ringing customer calls, and keep our own call in sync with what Meta reports.
  React.useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await apiFetch<{ calls: Call[] }>(base);
      if (!alive || !r.ok) return;
      const s = sessionRef.current;
      const incoming = r.data.calls.find((c) => c.direction === "inbound" && c.status === "ringing" && c.offerSdp && !dismissed.current.has(c.id));
      setRinging(s ? null : incoming ?? null);
      if (s?.callId) {
        const mine = r.data.calls.find((c) => c.id === s.callId);
        if (!mine) {
          const one = await apiFetch<{ call: Call }>(`${base}/${s.callId}`);
          if (one.ok && ENDED.includes(one.data.call.status)) {
            toast(one.data.call.status === "ended" ? "Call ended" : one.data.call.status === "missed" ? "Missed call" : "Call not answered", "info");
            cleanup(s);
          }
        } else if (s.direction === "outbound" && mine.answerSdp && s.pc.signalingState === "have-local-offer") {
          await s.pc.setRemoteDescription({ type: "answer", sdp: mine.answerSdp });
          setSession({ ...s, status: "active", answeredAt: Date.now() });
        } else if (mine.status === "ringing" && s.status === "connecting") {
          setSession({ ...s, status: "ringing" });
        }
      }
    };
    void tick();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" || sessionRef.current) void tick();
    }, sessionRef.current ? 1500 : 3000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [base, cleanup, toast, session?.callId]);

  // Timer for the call bar.
  React.useEffect(() => {
    if (session?.status !== "active") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session?.status]);

  // Simple ring tone while a customer is calling.
  React.useEffect(() => {
    if (!ringing) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const beep = () => {
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.35);
    };
    beep();
    const id = window.setInterval(beep, 1800);
    return () => {
      window.clearInterval(id);
      void ctx?.close();
    };
  }, [ringing]);

  async function accept(c: Call) {
    setRinging(null);
    dismissed.current.add(c.id);
    let peer: { pc: RTCPeerConnection; stream: MediaStream };
    try {
      peer = await newPeer();
    } catch {
      toast("Allow microphone access to answer calls.", "error");
      return;
    }
    const s: Session = { callId: c.id, name: c.peerName || c.peerPhone, direction: "inbound", status: "connecting", answeredAt: null, ...peer };
    setSession(s);
    try {
      await peer.pc.setRemoteDescription({ type: "offer", sdp: c.offerSdp });
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      await iceDone(peer.pc);
      const r = await apiFetch<{ call: Call }>(`${base}/${c.id}/answer`, { method: "POST", body: { sdp: peer.pc.localDescription?.sdp ?? "" } });
      if (!r.ok) throw new Error(r.error);
      setSession({ ...s, status: "active", answeredAt: Date.now() });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not answer the call.", "error");
      cleanup(s);
    }
  }

  async function decline(c: Call) {
    setRinging(null);
    dismissed.current.add(c.id);
    await apiFetch(`${base}/${c.id}/end`, { method: "POST" });
  }

  const place = React.useCallback(
    async (d: StartCallDetail) => {
      if (sessionRef.current) return toast("You are already on a call.", "error");
      let peer: { pc: RTCPeerConnection; stream: MediaStream };
      try {
        peer = await newPeer();
      } catch {
        return toast("Allow microphone access to make calls.", "error");
      }
      const s: Session = { callId: null, name: d.name, direction: "outbound", status: "starting", answeredAt: null, ...peer };
      setSession(s);
      try {
        await peer.pc.setLocalDescription(await peer.pc.createOffer({ offerToReceiveAudio: true }));
        await iceDone(peer.pc);
        const r = await apiFetch<{ call: Call }>(base, { method: "POST", body: { conversationId: d.conversationId, sdp: peer.pc.localDescription?.sdp ?? "" } });
        if (!r.ok) throw new Error(r.error);
        setSession({ ...s, callId: r.data.call.id, status: "connecting" });
      } catch (e) {
        toast(e instanceof Error ? e.message : "Could not place the call.", "error");
        cleanup(s);
      }
    },
    [base, cleanup, newPeer, toast]
  );

  React.useEffect(() => {
    const onStart = (e: Event) => void place((e as CustomEvent<StartCallDetail>).detail);
    window.addEventListener(START_CALL_EVENT, onStart);
    return () => window.removeEventListener(START_CALL_EVENT, onStart);
  }, [place]);

  async function hangUp() {
    const s = sessionRef.current;
    if (!s) return;
    if (s.callId) await apiFetch(`${base}/${s.callId}/end`, { method: "POST" });
    cleanup(s);
  }

  function toggleMute() {
    const s = sessionRef.current;
    if (!s) return;
    const next = !muted;
    s.stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }

  return (
    <>
      <audio ref={audioRef} autoPlay className="hidden" />
      {ringing && !session ? (
        <div role="alertdialog" aria-label={`Incoming WhatsApp call from ${ringing.peerName || ringing.peerPhone}`} className="glass fixed bottom-4 right-4 z-[70] w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-4 shadow-2xl">
          <div className="flex items-center gap-3">
            <span className="grid size-11 animate-pulse place-items-center rounded-full bg-[#25d366] text-[#06281a]"><PhoneIncoming className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-caption text-app-muted">Incoming WhatsApp call</p>
              <p className="truncate font-semibold text-app-text">{ringing.peerName || ringing.peerPhone}</p>
              {ringing.peerName ? <p className="text-caption text-app-subtle">{ringing.peerPhone}</p> : null}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => void decline(ringing)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-red-500/90 font-semibold text-white hover:bg-red-500">
              <PhoneOff className="size-4" aria-hidden="true" /> Decline
            </button>
            <button type="button" onClick={() => void accept(ringing)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-[#25d366] font-semibold text-[#06281a] hover:brightness-95">
              <Phone className="size-4" aria-hidden="true" /> Answer
            </button>
          </div>
        </div>
      ) : null}
      {session ? (
        <div role="region" aria-label="Call in progress" className="glass fixed bottom-4 left-1/2 z-[70] flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2.5 shadow-2xl">
          <span className="grid size-9 place-items-center rounded-full bg-[#25d366] text-[#06281a]"><Phone className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-small font-semibold text-app-text">{session.name}</p>
            <p className="text-caption text-app-muted" aria-live="polite">
              {session.status === "active" && session.answeredAt ? mmss(Math.max(0, Math.round((now - session.answeredAt) / 1000))) : session.status === "ringing" ? "Ringing…" : session.status === "starting" ? "Starting…" : "Connecting…"}
            </p>
          </div>
          <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute" : "Mute"} className="grid size-10 place-items-center rounded-full border border-app-border text-app-text hover:bg-app-hover">
            {muted ? <MicOff className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => void hangUp()} aria-label="Hang up" className="grid size-10 place-items-center rounded-full bg-red-500 text-white hover:bg-red-600">
            <PhoneOff className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  );
}
