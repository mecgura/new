import { Badge } from "@/components/ds";
import { QUALITY_LABELS, WHATSAPP_STATUS_LABELS } from "@/lib/catalog";

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "connected" ? "success" : status === "demo" ? "info" : status === "pending" ? "warning" : "neutral";
  return (
    <Badge tone={tone} dot>
      {WHATSAPP_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

/** Meta quality rating — label always shown alongside the colour. */
export function QualityBadge({ quality }: { quality: string }) {
  const tone = quality === "GREEN" ? "success" : quality === "YELLOW" ? "warning" : quality === "RED" ? "danger" : "neutral";
  return (
    <Badge tone={tone} dot>
      {QUALITY_LABELS[quality] ?? quality}
    </Badge>
  );
}
