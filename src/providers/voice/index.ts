/**
 * Voice provider seam. A live provider (a telephony + speech service that can place an AI-driven outbound call)
 * plugs in here by returning an object from `liveVoiceProvider()`. None is connected today, so every call is a
 * labelled simulation and nothing is ever dialled.
 */
export type VoiceStartInput = { to: string; goal: string; script: string; language: string; callId: string };
export type VoiceProvider = { name: string; startCall(input: VoiceStartInput): Promise<{ providerCallId: string }> };

export function liveVoiceProvider(): VoiceProvider | null {
  return null;
}

export function voiceStatus() {
  const provider = liveVoiceProvider();
  return provider
    ? { live: true as const, provider: provider.name, note: "" }
    : { live: false as const, provider: "", note: "No voice provider is connected. Calls are simulated practice calls: nobody is phoned." };
}

export type SimTurn = { role: "agent" | "customer"; text: string };
export type SimResult = { transcript: SimTurn[]; summary: string; outcome: "interested" | "callback" | "not_interested" | "no_answer"; durationSec: number; status: "completed" | "no_answer" };

/** Deterministic practice conversation. It is NOT AI output: it only shows what a call record looks like. */
export function simulateCall(input: { contactName: string; goal: string; script: string; language: string; seed: string }): SimResult {
  let h = 0;
  for (const ch of input.seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const name = input.contactName.trim() || "there";
  const pick = h % 4;
  const opening = input.script.trim() || `Hello ${name}, this is a call from the business about: ${input.goal}.`;
  if (pick === 0) {
    return { transcript: [], summary: "Simulated: the call was not answered. (Practice call — nobody was phoned.)", outcome: "no_answer", durationSec: 0, status: "no_answer" };
  }
  const agent = (text: string): SimTurn => ({ role: "agent", text });
  const cust = (text: string): SimTurn => ({ role: "customer", text });
  const bodies: Record<number, { turns: SimTurn[]; outcome: SimResult["outcome"]; line: string }> = {
    1: { turns: [cust("Yes, tell me more."), agent("Great. Would you like us to send details on WhatsApp?"), cust("Yes please, that works."), agent("Done, thank you for your time.")], outcome: "interested", line: "The customer was interested and agreed to receive details on WhatsApp." },
    2: { turns: [cust("I'm busy right now."), agent("No problem. When is a better time to call?"), cust("Tomorrow evening."), agent("Noted. We'll call tomorrow evening.")], outcome: "callback", line: "The customer asked for a callback tomorrow evening." },
    3: { turns: [cust("I'm not interested."), agent("Understood, thank you. We won't call again about this.")], outcome: "not_interested", line: "The customer was not interested." },
  };
  const b = bodies[pick];
  return {
    transcript: [agent(opening), ...b.turns],
    summary: `Simulated: ${b.line} Goal: ${input.goal}. (Practice call — nobody was phoned.)`,
    outcome: b.outcome,
    durationSec: 30 + (h % 90),
    status: "completed",
  };
}
