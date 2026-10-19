import { z } from "zod";
import { getSetting, setSetting } from "@/lib/settings";

/**
 * Public home page content the Super Admin edits from /admin/site: team, services
 * and integrations. Stored as one JSON SiteSetting row. Photos are small data URLs
 * (the browser shrinks them before upload) so no file storage is needed.
 */
const KEY = "home:content";

const state = z.enum(["live", "soon"]);
const photo = z
  .string()
  .max(160_000)
  .refine((v) => v === "" || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v), "Photo must be a JPEG, PNG or WebP image.");

export const homeContentSchema = z.object({
  team: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(80),
        role: z.string().trim().max(80).default(""),
        bio: z.string().trim().max(200).default(""),
        photo: photo.default(""),
      })
    )
    .max(12),
  services: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        title: z.string().trim().min(1).max(60),
        text: z.string().trim().max(200).default(""),
        state: state.default("live"),
      })
    )
    .max(16),
  integrations: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(40),
        name: z.string().trim().min(1).max(60),
        note: z.string().trim().max(100).default(""),
        state: state.default("live"),
      })
    )
    .max(20),
});
export type HomeContent = z.infer<typeof homeContentSchema>;

export const DEFAULT_HOME_CONTENT: HomeContent = {
  team: [],
  services: [
    { id: "inbox", title: "WhatsApp shared inbox", text: "Every customer chat in one place. Assign, tag, add private notes and reply as a team.", state: "live" },
    { id: "campaigns", title: "Safe campaigns", text: "Approved templates to opted-in contacts only, with a compliance check before every send.", state: "live" },
    { id: "automations", title: "Automations and AI agent", text: "Welcome messages, lead capture and an AI agent that hands over to your team when needed.", state: "live" },
    { id: "ads", title: "Click-to-WhatsApp ads", text: "Create ads that open a WhatsApp chat and see cost per chat.", state: "live" },
    { id: "sms", title: "SMS", text: "OTP, offers and reminders by SMS.", state: "soon" },
    { id: "rcs", title: "RCS messaging", text: "Rich messages with images and buttons on Android.", state: "soon" },
  ],
  integrations: [
    { id: "wa", name: "WhatsApp Business Platform", note: "Official Cloud API", state: "live" },
    { id: "ig", name: "Instagram", note: "Direct messages", state: "live" },
    { id: "fb", name: "Facebook Messenger", note: "Page chats and lead ads", state: "live" },
    { id: "mail", name: "Email", note: "Shared mailbox", state: "live" },
    { id: "cal", name: "Calendar", note: "Booking links", state: "soon" },
    { id: "sms", name: "SMS", note: "DLT-ready", state: "soon" },
  ],
};

export async function getHomeContent(): Promise<HomeContent> {
  const raw = await getSetting(KEY, "");
  if (!raw) return DEFAULT_HOME_CONTENT;
  try {
    const parsed = homeContentSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_HOME_CONTENT;
  } catch {
    return DEFAULT_HOME_CONTENT;
  }
}

export async function saveHomeContent(input: HomeContent): Promise<HomeContent> {
  await setSetting(KEY, JSON.stringify(input));
  return input;
}
