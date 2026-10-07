export type Tag = { id: string; name: string; color: string };

export type Conversation = {
  id: string;
  status: "open" | "closed";
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string;
  lastInboundAt: string | null;
  windowOpen: boolean;
  windowExpiresAt: string | null;
  isDemo: boolean;
  contact: { id: string; name: string; phone: string; optInStatus: string; tags: Tag[] };
  assignedTo: { id: string; name: string } | null;
  account: { id: string; displayName: string; phoneNumber: string; status: string; isDemo: boolean };
};

export type Attachment = { id: string; kind: string; mimeType: string; filename: string; sizeBytes: number; caption: string; url: string | null; downloadable: boolean };

export type Message = {
  id: string;
  direction: "inbound" | "outbound" | "internal";
  type: string;
  body: string;
  payload: Record<string, unknown>;
  status: string;
  error: string;
  isDemo: boolean;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  sender: { id: string; name: string } | null;
  replyTo: { id: string; body: string; type: string; direction: string } | null;
  attachments: Attachment[];
};

export type TeamMember = { userId: string; name: string; email: string; role: string; agentStatus: string; openChats: number };

export type Account = { id: string; displayName: string; phoneNumber: string; status: string; isDemo: boolean };

export const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });
export const dayFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

export function shortTime(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? timeFmt.format(d) : dayFmt.format(d);
}
