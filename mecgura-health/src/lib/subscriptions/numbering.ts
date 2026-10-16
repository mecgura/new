/** MEC-INV-2026-000001 · MEC-REC-2026-000001 · MEC-RFD-2026-000001 — platform-wide sequence per kind and year. */
export const formatNumber = (kind: "INV" | "REC" | "RFD", year: number, seq: number) => `MEC-${kind}-${year}-${String(seq).padStart(6, "0")}`;
