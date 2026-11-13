import { graph } from "@/providers/meta/graph";

/** Gets (or creates) the dataset Meta uses to receive conversion events for a WhatsApp Business Account. */
export async function ensureWabaDataset(wabaId: string, token: string): Promise<string> {
  const r = await graph<{ id?: string }>(`${wabaId}/dataset`, { method: "POST", token });
  if (!r.id) throw new Error("Meta did not return a dataset.");
  return r.id;
}

export type ConversionEvent = { name: "LeadSubmitted" | "Purchase"; at: Date; ctwaClid: string; wabaId: string; value?: number; currency?: string };

/** Reports one click-to-WhatsApp conversion to Meta (Conversions API for business messaging). */
export async function sendConversion(datasetId: string, token: string, ev: ConversionEvent): Promise<void> {
  await graph(`${datasetId}/events`, {
    method: "POST",
    token,
    body: {
      data: [
        {
          event_name: ev.name,
          event_time: Math.floor(ev.at.getTime() / 1000),
          action_source: "business_messaging",
          messaging_channel: "whatsapp",
          user_data: { whatsapp_business_account_id: ev.wabaId, ctwa_clid: ev.ctwaClid },
          ...(ev.name === "Purchase" ? { custom_data: { currency: ev.currency ?? "INR", value: ev.value ?? 0 } } : {}),
        },
      ],
      partner_agent: "mecgura",
    },
  });
}
