/**
 * Medicine data sources. NONE is configured: there is no built-in or seeded medicine database, and none is invented.
 * To connect a real source (a licensed drug database or API), implement `MedicineSource` and set `externalMedicineSource`.
 * Until then search uses only the clinic's own imported list (MedicineReference), which starts empty.
 */
export interface MedicineHit { name: string; genericName?: string | null; brandName?: string | null; strength?: string | null; form?: string | null }
export interface MedicineSource { name: string; search(query: string, limit: number): Promise<MedicineHit[]> }
export const externalMedicineSource = null as MedicineSource | null;

/** Diagnosis terminology (e.g. ICD) — also NOT configured. Doctors enter diagnoses manually; the interface is the future hook. */
export interface DiagnosisHit { name: string; code: string; codeSystem: string }
export interface DiagnosisSource { name: string; search(query: string, limit: number): Promise<DiagnosisHit[]> }
export const externalDiagnosisSource = null as DiagnosisSource | null;

/** Drug-interaction / allergy-check source — NOT configured. The UI therefore never claims a medicine is safe or unsafe. */
export interface SafetyCheckSource { name: string }
export const externalSafetySource = null as SafetyCheckSource | null;
