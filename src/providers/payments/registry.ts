import type { PaymentGateway } from "@/providers/payments/types";
import { razorpayGateway } from "@/providers/payments/razorpay";

const gateways = new Map<string, PaymentGateway>([[razorpayGateway.id, razorpayGateway]]);

/** Connect another provider by implementing PaymentGateway and registering it here (or at startup). */
export function registerGateway(g: PaymentGateway) {
  gateways.set(g.id, g);
}
export function unregisterGateway(id: string) {
  gateways.delete(id);
}
export const getGateway = (id: string) => gateways.get(id) ?? null;

export async function availableGateways(): Promise<{ id: string; label: string }[]> {
  const out: { id: string; label: string }[] = [];
  for (const g of gateways.values()) if (await g.isConfigured()) out.push({ id: g.id, label: g.label });
  return out;
}
export const allGateways = () => [...gateways.values()].map((g) => ({ id: g.id, label: g.label }));
