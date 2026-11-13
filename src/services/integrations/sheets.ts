import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";

/**
 * Google Sheets link: every new contact is added as a row in the client's own sheet. The client pastes a small
 * Apps Script into their sheet and gives us its web-app URL. Only Google's Apps Script address is accepted.
 */
const SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;

export const SHEETS_SCRIPT = `function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(["Date", "Name", "Phone", "Email", "Source", "Status"]);
  sheet.appendRow([d.date, d.name, d.phone, d.email, d.source, d.status]);
  return ContentService.createTextOutput("ok");
}`;

export async function getSheetsLink(organizationId: string) {
  const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { sheetsWebhookUrl: true } });
  return { url: s?.sheetsWebhookUrl ?? "", script: SHEETS_SCRIPT };
}

export async function setSheetsLink(organizationId: string, url: string) {
  const v = url.trim();
  if (v && !SCRIPT_URL.test(v)) throw new ApiError("VALIDATION_ERROR", "Paste the web app URL from Apps Script. It starts with https://script.google.com/macros/s/ and ends with /exec.", { details: { url: ["Not an Apps Script web app URL"] } });
  await db.organizationSettings.upsert({ where: { organizationId }, update: { sheetsWebhookUrl: v }, create: { organizationId, sheetsWebhookUrl: v } });
  return { url: v };
}

type Row = { date: string; name: string; phone: string; email: string; source: string; status: string };

async function post(url: string, row: Row) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Google answered ${res.status}`);
}

/** Adds one new contact to the sheet. Never throws: a sheet problem must not stop the lead from being saved. */
export async function pushContactToSheet(organizationId: string, contactId: string) {
  try {
    const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { sheetsWebhookUrl: true } });
    if (!s?.sheetsWebhookUrl || !SCRIPT_URL.test(s.sheetsWebhookUrl)) return false;
    const c = await db.contact.findFirst({ where: { id: contactId, organizationId } });
    if (!c || c.source === "import") return false; // bulk imports would flood the sheet
    await post(s.sheetsWebhookUrl, { date: c.createdAt.toISOString().slice(0, 16).replace("T", " "), name: c.name, phone: c.phone, email: c.email, source: c.source, status: c.leadStatus });
    return true;
  } catch (e) {
    console.error("[sheets] adding the row failed:", e);
    return false;
  }
}

export async function sendTestRow(organizationId: string) {
  const s = await db.organizationSettings.findUnique({ where: { organizationId }, select: { sheetsWebhookUrl: true } });
  if (!s?.sheetsWebhookUrl) throw new ApiError("CONFLICT", "Save the Apps Script URL first.");
  try {
    await post(s.sheetsWebhookUrl, { date: new Date().toISOString().slice(0, 16).replace("T", " "), name: "Test lead (MECGURA)", phone: "+910000000000", email: "", source: "test", status: "new" });
  } catch {
    throw new ApiError("CONFLICT", "Google did not accept the row. In Apps Script choose Deploy → New deployment → Web app, and set “Who has access” to Anyone.");
  }
  return { sent: true };
}
