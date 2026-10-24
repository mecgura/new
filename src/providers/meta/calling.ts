import { graph } from "@/providers/meta/graph";

/**
 * WhatsApp Business Calling API (Cloud API). Only signalling goes through Meta's Graph API; the audio itself is a
 * WebRTC session between the agent's browser and Meta, described by the SDP offer/answer passed through here.
 */
type CallResponse = { success?: boolean; calls?: { id?: string }[] };

/** Turns calling on or off for a phone number (and shows the call icon in the customer's chat). */
export function setCallingSettings(phoneNumberId: string, token: string, enabled: boolean) {
  return graph<{ success?: boolean }>(`${phoneNumberId}/settings`, {
    token,
    method: "POST",
    body: { calling: { status: enabled ? "ENABLED" : "DISABLED", call_icon_visibility: "DEFAULT", callback_permission_status: "ENABLED" } },
  });
}

function callAction(phoneNumberId: string, token: string, body: Record<string, unknown>) {
  return graph<CallResponse>(`${phoneNumberId}/calls`, { token, method: "POST", body: { messaging_product: "whatsapp", ...body } });
}

/** Business-initiated call: sends our SDP offer; Meta answers through the "calls" webhook. Returns Meta's call id. */
export async function startCall(phoneNumberId: string, token: string, to: string, offerSdp: string): Promise<string> {
  const r = await callAction(phoneNumberId, token, { to: to.replace(/\D/g, ""), action: "connect", session: { sdp_type: "offer", sdp: offerSdp } });
  const id = r.calls?.[0]?.id;
  if (!id) throw new Error("Meta did not return a call id.");
  return id;
}

/** Answers a customer's call: pre-accept (sets up media early) then accept, both with our SDP answer. */
export async function answerCall(phoneNumberId: string, token: string, callId: string, answerSdp: string) {
  const session = { sdp_type: "answer", sdp: answerSdp };
  await callAction(phoneNumberId, token, { call_id: callId, action: "pre_accept", session });
  await callAction(phoneNumberId, token, { call_id: callId, action: "accept", session });
}

export function rejectCall(phoneNumberId: string, token: string, callId: string) {
  return callAction(phoneNumberId, token, { call_id: callId, action: "reject" });
}

export function terminateCall(phoneNumberId: string, token: string, callId: string) {
  return callAction(phoneNumberId, token, { call_id: callId, action: "terminate" });
}

/** Asks the customer for permission to call them (needed before a business-initiated call). */
export async function sendCallPermissionRequest(phoneNumberId: string, token: string, to: string, text: string): Promise<string> {
  const r = await graph<{ messages?: { id?: string }[] }>(`${phoneNumberId}/messages`, {
    token,
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/\D/g, ""),
      type: "interactive",
      interactive: { type: "call_permission_request", action: { name: "call_permission_request" }, body: { text } },
    },
  });
  return r.messages?.[0]?.id ?? "";
}
